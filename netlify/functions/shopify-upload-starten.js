const { getAccessToken, sheetsReadValues } = require('./lib/google');

function normalizeFilename(s) {
  return s.toLowerCase().replace(/[\s_]+/g, '-');
}

function driveUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

async function listDriveImages(tok, folderId) {
  const q   = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
  const data = await res.json();
  if (!res.ok) throw new Error('Drive-Fehler: ' + JSON.stringify(data));
  return (data.files || []).filter(f => f.name && !f.name.startsWith('.'));
}

function categorizeImages(driveImages, handle, optionValues) {
  const normHandle  = normalizeFilename(handle);
  const normOptions = optionValues.map(v => normalizeFilename(v));
  const general     = [];
  const variantMap  = new Map();

  for (const img of driveImages) {
    const normName = normalizeFilename(img.name.replace(/\.[^.]+$/, ''));
    if (!normName.startsWith(normHandle)) continue;
    const suffix = normName.slice(normHandle.length).replace(/^-/, '');

    if (suffix === '' || /^\d+$/.test(suffix)) {
      general.push({ img, position: suffix === '' ? 1 : parseInt(suffix) });
    } else {
      const match = normOptions.find(o => o === suffix);
      if (match) {
        variantMap.set(match, img);
      } else {
        general.push({ img, position: 9999 });
      }
    }
  }

  general.sort((a, b) => a.position - b.position || a.img.name.localeCompare(b.img.name));
  const generalImages = general.map(({ img }, i) => ({
    src: driveUrl(img.id),
    position: i + 1,
    alt: img.name.replace(/\.[^.]+$/, ''),
  }));

  return { generalImages, variantMap };
}

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

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const domain          = kundeRow[2];
    const token           = kundeRow[3];
    const mastertabelleId = kundeRow[6];
    const folderId        = kundeRow[7] || '';

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

    // Drive-Images werden nach dem Upload gematcht (Timeout-Schutz: nur wenn Zeit reicht)
    const allDriveImages = [];

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

      // Match Drive images to the REAL handle (from the filled Mastertabelle)
      const optionValues = [];
      if (opt1name) collectOption('Option1 value').forEach(v => optionValues.push(v));
      if (opt2name) collectOption('Option2 value').forEach(v => optionValues.push(v));
      if (opt3name) collectOption('Option3 value').forEach(v => optionValues.push(v));

      const { generalImages, variantMap } = allDriveImages.length
        ? categorizeImages(allDriveImages, handle, optionValues)
        : { generalImages: [], variantMap: new Map() };

      // Build images array: general images first
      const images = generalImages.map(img => {
        const obj = { src: img.src, position: img.position };
        if (img.alt) obj.alt = img.alt;
        return obj;
      });

      // Add variant images with __vi: tag for post-creation assignment
      const variantImgAdded = new Set();
      for (const [normOpt, driveImg] of variantMap) {
        const vsrc = driveUrl(driveImg.id);
        if (variantImgAdded.has(vsrc)) continue;
        variantImgAdded.add(vsrc);
        images.push({ src: vsrc, position: images.length + 1, alt: `__vi:${normOpt}` });
      }
      const hasVariantImages = variantMap.size > 0;

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
          continue;
        }

        const created = shopifyData.product;

        // Assign variant images after creation (we now know image IDs and variant IDs)
        if (hasVariantImages && created) {
          // Build map: normalized option value → shopify image id
          const imageIdByOpt = new Map();
          for (const img of created.images || []) {
            if (img.alt && img.alt.startsWith('__vi:')) {
              img.alt.slice(5).split(',').forEach(opt => imageIdByOpt.set(opt, img.id));
            }
          }

          // Match each created variant to its image
          const variantUpdates = [];
          for (const v of created.variants || []) {
            const optVals = [v.option1, v.option2, v.option3].filter(Boolean);
            for (const opt of optVals) {
              const imgId = imageIdByOpt.get(normalizeFilename(opt));
              if (imgId) { variantUpdates.push({ id: v.id, image_id: imgId }); break; }
            }
          }

          // Clean up __vi: alt texts from variant images
          const altCleanup = (created.images || [])
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
