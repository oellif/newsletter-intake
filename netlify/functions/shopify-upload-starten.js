const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

exports.handler = async (event) => {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST erforderlich' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const { kunden_id } = body;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:G500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const domain          = kundeRow[2];
    const token           = kundeRow[3];
    const mastertabelleId = kundeRow[6];

    if (!mastertabelleId) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Mastertabelle gefunden. Bitte zuerst generieren.' }) };
    }

    // Read Mastertabelle
    const allRows = await sheetsReadValues(tok, mastertabelleId, 'A1:BH2000');
    if (!allRows || allRows.length < 2) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mastertabelle ist leer oder enthält keine Datenzeilen.' }) };
    }

    const headerRow = allRows[0];
    const dataRows  = allRows.slice(1);

    // Build column index map
    const CI = {};
    headerRow.forEach((col, i) => { if (col) CI[col.trim()] = i; });
    const get = (row, col) => CI[col] !== undefined ? String(row[CI[col]] || '').trim() : '';

    // Group rows by URL handle, preserving order
    const productMap = new Map();
    const order = [];
    for (const row of dataRows) {
      const handle = get(row, 'URL handle');
      if (!handle) continue;
      if (!productMap.has(handle)) {
        productMap.set(handle, []);
        order.push(handle);
      }
      productMap.get(handle).push(row);
    }

    const results = [];
    const errors  = [];

    for (const handle of order) {
      const rows     = productMap.get(handle);
      const firstRow = rows.find(r => get(r, 'Title')) || rows[0];

      const title       = get(firstRow, 'Title');
      const description = get(firstRow, 'Description');
      const vendor      = get(firstRow, 'Vendor');
      const type        = get(firstRow, 'Type');
      const tags        = get(firstRow, 'Tags');
      const status      = get(firstRow, 'Status') || 'draft';
      const opt1name    = get(firstRow, 'Option1 name');
      const opt2name    = get(firstRow, 'Option2 name');
      const opt3name    = get(firstRow, 'Option3 name');

      if (!title) {
        errors.push({ handle, error: 'Kein Titel in der Mastertabelle' });
        continue;
      }

      // Options: unique values in order of appearance
      function collectOption(colName) {
        const vals = [];
        const seen = new Set();
        for (const r of rows) {
          const v = get(r, colName);
          if (v && !seen.has(v)) { seen.add(v); vals.push(v); }
        }
        return vals;
      }
      const options = [];
      if (opt1name) { const vals = collectOption('Option1 value'); if (vals.length) options.push({ name: opt1name, values: vals }); }
      if (opt2name) { const vals = collectOption('Option2 value'); if (vals.length) options.push({ name: opt2name, values: vals }); }
      if (opt3name) { const vals = collectOption('Option3 value'); if (vals.length) options.push({ name: opt3name, values: vals }); }

      // Variants: rows with at least a price or an option value
      const variantRows = rows.filter(r => get(r, 'Price') || get(r, 'Option1 value'));
      const variants = variantRows.map(r => {
        const v = { price: get(r, 'Price') || '0' };
        const cap = get(r, 'Compare-at price'); if (cap) v.compare_at_price = cap;
        const sku = get(r, 'SKU');             if (sku) v.sku = sku;
        const bar = get(r, 'Barcode');         if (bar) v.barcode = bar;
        if (opt1name) { const o = get(r, 'Option1 value'); if (o) v.option1 = o; }
        if (opt2name) { const o = get(r, 'Option2 value'); if (o) v.option2 = o; }
        if (opt3name) { const o = get(r, 'Option3 value'); if (o) v.option3 = o; }
        v.taxable             = get(r, 'Charge tax') !== 'FALSE';
        v.requires_shipping   = get(r, 'Requires shipping') !== 'FALSE';
        v.fulfillment_service = get(r, 'Fulfillment service') || 'manual';
        v.inventory_policy    = get(r, 'Continue selling when out of stock') === 'TRUE' ? 'continue' : 'deny';
        const inv = get(r, 'Inventory tracker'); if (inv) v.inventory_management = inv;
        const qty = get(r, 'Inventory quantity'); if (qty !== '') v.inventory_quantity = parseInt(qty) || 0;
        const grm = get(r, 'Weight value (grams)'); if (grm !== '') v.grams = parseInt(grm) || 0;
        const wun = get(r, 'Weight unit for display'); if (wun) v.weight_unit = wun;
        return v;
      });

      // Product images: unique non-empty URLs
      const seenUrls = new Set();
      const images   = [];
      for (const r of rows) {
        const src = get(r, 'Product image URL');
        if (!src || seenUrls.has(src)) continue;
        seenUrls.add(src);
        const imgObj = { src, position: parseInt(get(r, 'Image position')) || images.length + 1 };
        const alt = get(r, 'Image alt text'); if (alt) imgObj.alt = alt;
        images.push(imgObj);
      }

      const payload = { title, body_html: description, vendor, product_type: type, tags, status, handle };
      if (options.length)  payload.options  = options;
      if (variants.length) payload.variants = variants;
      if (images.length)   payload.images   = images;

      try {
        const shopifyRes = await fetch(`https://${domain}/admin/api/2024-01/products.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ product: payload }),
        });
        const shopifyData = await shopifyRes.json();
        if (!shopifyRes.ok) {
          errors.push({ handle, error: JSON.stringify(shopifyData.errors || shopifyData) });
        } else {
          results.push({
            handle,
            shopify_id: shopifyData.product.id,
            title: shopifyData.product.title,
            url: `https://${domain}/admin/products/${shopifyData.product.id}`,
          });
        }
      } catch(e) {
        errors.push({ handle, error: e.message });
      }
    }

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({ success: true, results, errors }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
