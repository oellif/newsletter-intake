const { getAccessToken, sheetsReadValues } = require('./lib/google');

function normalizeFilename(s) {
  return s.toLowerCase().replace(/[\s_]+/g, '-');
}

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

exports.handler = async (event) => {
  let UPLOAD_START = null; // set AFTER Sheets reads, so reads don't eat the image time budget
  const TIME_LIMIT_MS = 7500; // time for all products + images (measured from after Sheets reads)

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

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
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

    UPLOAD_START = Date.now(); // start timer AFTER Sheets reads are done

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

      // Build images from pre-filled Mastertabelle columns (written by "Bilder zuordnen")
      const seenUrls = new Set();

      // Find discriminating option values: opts that map to exactly 1 variant image URL
      // (S/M/L map to nuss+ahorn+apfel → not discriminating; "Nuss" only maps to nuss.jpg → discriminating)
      const optToVarUrls = new Map(); // normalized opt → Set of variant image URLs
      for (const r of rows) {
        const url = get(r, 'Variant image URL');
        if (!url) continue;
        [get(r, 'Option1 value'), get(r, 'Option2 value'), get(r, 'Option3 value')]
          .filter(Boolean).forEach(opt => {
            const norm = normalizeFilename(opt);
            if (!optToVarUrls.has(norm)) optToVarUrls.set(norm, new Set());
            optToVarUrls.get(norm).add(url);
          });
      }
      const urlToDiscrimOpts = new Map(); // URL → [discriminating opt values]
      for (const [norm, urls] of optToVarUrls) {
        if (urls.size === 1) {
          const url = [...urls][0];
          if (!urlToDiscrimOpts.has(url)) urlToDiscrimOpts.set(url, []);
          urlToDiscrimOpts.get(url).push(norm);
        }
      }

      // Variant images go first (priority for time budget), tagged with __vi: for assignment
      const images = [];
      for (const [url, opts] of urlToDiscrimOpts) {
        seenUrls.add(url);
        images.push({ src: url, position: images.length + 1, alt: `__vi:${opts.join(',')}` });
      }

      // Then general product images
      for (const r of rows) {
        const imgUrl = get(r, 'Product image URL');
        if (!imgUrl || seenUrls.has(imgUrl)) continue;
        seenUrls.add(imgUrl);
        const pos = parseInt(get(r, 'Image position')) || images.length + 1;
        const alt = get(r, 'Image alt text') || '';
        const obj = { src: imgUrl, position: pos };
        if (alt) obj.alt = alt;
        images.push(obj);
      }

      const hasVariantImages = urlToDiscrimOpts.size > 0;

      // Create product WITHOUT images first (avoids Shopify synchronous image fetch timeout)
      const payload = { title, body_html: description, vendor, product_type: type, tags, status, handle };
      if (options.length)  payload.options  = options;
      if (variants.length) payload.variants = variants;

      try {
        const shopifyRes = await fetch(`https://${domain}/admin/api/2024-01/products.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ product: payload }),
        });
        const shopifyData = await shopifyRes.json();
        if (!shopifyRes.ok) {
          errors.push({ handle, error: JSON.stringify(shopifyData.errors || shopifyData) });
          continue;
        }

        const created = shopifyData.product;

        // Upload images sequentially to avoid Drive rate-limiting (variant images are first = priority)
        const uploadedImages = [];
        for (const img of images) {
          if (Date.now() - UPLOAD_START > TIME_LIMIT_MS) break; // stay within Netlify timeout
          const result = await fetch(`https://${domain}/admin/api/2024-01/products/${created.id}/images.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: { src: img.src, position: img.position, alt: img.alt || '' } }),
          })
          .then(r => r.ok ? r.json() : null)
          .then(d => d ? d.image : null)
          .catch(() => null);
          if (result) uploadedImages.push(result);
        }

        // Assign variant images using __vi: tags from uploaded image alts
        if (hasVariantImages && uploadedImages.length) {
          const imageIdByOpt = new Map();
          for (const img of uploadedImages) {
            if (img.alt && img.alt.startsWith('__vi:')) {
              img.alt.slice(5).split(',').forEach(opt => imageIdByOpt.set(opt, img.id));
            }
          }

          const variantUpdates = [];
          for (const v of created.variants || []) {
            const optVals = [v.option1, v.option2, v.option3].filter(Boolean);
            for (const opt of optVals) {
              const imgId = imageIdByOpt.get(normalizeFilename(opt));
              if (imgId) { variantUpdates.push({ id: v.id, image_id: imgId }); break; }
            }
          }

          const altCleanup = uploadedImages
            .filter(img => img.alt && img.alt.startsWith('__vi:'))
            .map(img => ({ id: img.id, alt: '' }));

          if (variantUpdates.length || altCleanup.length) {
            const putBody = { product: { id: created.id } };
            if (variantUpdates.length) putBody.product.variants = variantUpdates;
            if (altCleanup.length)     putBody.product.images   = altCleanup;
            await fetch(`https://${domain}/admin/api/2024-01/products/${created.id}.json`, {
              method: 'PUT',
              headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
              body: JSON.stringify(putBody),
            });
          }
        }

        results.push({
          handle,
          shopify_id: created.id,
          title: created.title,
          url: `https://${domain}/admin/products/${created.id}`,
        });
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
