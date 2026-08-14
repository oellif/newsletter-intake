// Schritt 1 des Uploads: legt EIN Produkt ohne Bilder an und gibt den
// Bild-Plan zurueck (welche Drive-Dateien in welcher Reihenfolge, welche
// davon Variantenbilder sind). Die Bilder selbst laedt der Browser danach
// einzeln ueber shopify-bild-hochladen hoch - so hat jedes Bild ein
// eigenes volles Zeitfenster und nichts wird abgeschnitten.
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

function normalizeFilename(s) {
  return s.toLowerCase().replace(/[\s_]+/g, '-');
}

function extractDriveFileId(url) {
  const m = String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/) || String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

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
  const { kunden_id, handle } = body;
  if (!kunden_id || !handle) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id und handle erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const domain          = kundeRow[2];
    const token           = kundeRow[3];
    const mastertabelleId = kundeRow[6];
    if (!mastertabelleId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Mastertabelle vorhanden.' }) };

    const allRows = await sheetsReadValues(tok, mastertabelleId, 'A1:CZ2000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mastertabelle ist leer.' }) };

    const CI = {};
    allRows[0].forEach((col, i) => { if (col) CI[col.trim()] = i; });
    const get = (row, col) => CI[col] !== undefined ? String(row[CI[col]] || '').trim() : '';

    const rows = allRows.slice(1).filter(r => get(r, 'URL handle') === handle);
    if (!rows.length) return { statusCode: 404, headers: h, body: JSON.stringify({ error: `Handle "${handle}" nicht in der Mastertabelle` }) };

    const firstRow    = rows.find(r => get(r, 'Title')) || rows[0];
    const title       = get(firstRow, 'Title');
    if (!title) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Kein Titel in der Mastertabelle' }) };

    const opt1name = get(firstRow, 'Option1 name');
    const opt2name = get(firstRow, 'Option2 name');
    const opt3name = get(firstRow, 'Option3 name');

    function collectOption(colName) {
      const vals = []; const seen = new Set();
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

    // ── Bild-Plan bauen ────────────────────────────────────────────────
    // Allgemeine Bilder aus "Product image URL" (dedupliziert, nach Position),
    // Variantenbilder aus "Variant image URL" ueber den diskriminierenden
    // Optionswert (der Wert, der eindeutig auf genau ein Bild zeigt).
    const entries = new Map(); // url → { file_id, alt, position, opts }

    for (const r of rows) {
      const url = get(r, 'Product image URL');
      if (!url || entries.has(url)) continue;
      entries.set(url, {
        file_id:  extractDriveFileId(url),
        alt:      get(r, 'Image alt text') || '',
        position: parseInt(get(r, 'Image position')) || 999,
        opts:     [],
      });
    }

    const optToVarUrls = new Map();
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
    for (const [norm, urls] of optToVarUrls) {
      if (urls.size !== 1) continue; // Optionswert zeigt auf mehrere Bilder → nicht eindeutig
      const url = [...urls][0];
      if (entries.has(url)) {
        entries.get(url).opts.push(norm);
      } else {
        entries.set(url, { file_id: extractDriveFileId(url), alt: norm, position: 1000, opts: [norm] });
      }
    }

    const images = [...entries.values()]
      .filter(e => e.file_id)
      .sort((a, b) => a.position - b.position)
      .map((e, i) => ({ file_id: e.file_id, alt: e.alt, position: i + 1, opts: e.opts }));

    // ── Produkt anlegen (ohne Bilder) ─────────────────────────────────
    const payload = {
      title,
      body_html:    get(firstRow, 'Description'),
      vendor:       get(firstRow, 'Vendor'),
      product_type: get(firstRow, 'Type'),
      tags:         get(firstRow, 'Tags'),
      status:       get(firstRow, 'Status') || 'draft',
      handle,
    };
    if (options.length)  payload.options  = options;
    if (variants.length) payload.variants = variants;

    const shopifyRes  = await fetch(`https://${domain}/admin/api/2024-01/products.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: payload }),
    });
    const shopifyData = await shopifyRes.json();
    if (!shopifyRes.ok) {
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: JSON.stringify(shopifyData.errors || shopifyData) }) };
    }

    const created = shopifyData.product;

    // Metafelder aus den dynamischen Spalten ("Metafield: ns.key [type]")
    // ans neue Produkt schreiben. Wert: erste nicht-leere Zelle der Spalte
    // innerhalb der Produktzeilen.
    const MF_RE = /^Metafield: ([^.\s]+)\.([^\s\[]+) \[([^\]]+)\]$/;
    let metafieldsSet = 0;
    const metafieldErrors = [];
    for (const col of Object.keys(CI)) {
      const m = col.match(MF_RE);
      if (!m) continue;
      const raw = rows.map(r => get(r, col)).find(v => v) || '';
      if (!raw) continue;

      let value = raw;
      if (m[3] === 'number_integer')      value = parseInt(raw) || 0;
      else if (m[3] === 'number_decimal') value = parseFloat(raw) || 0;
      else if (m[3] === 'boolean')        value = raw.toLowerCase() === 'true';

      const mfRes = await fetch(`https://${domain}/admin/api/2024-01/products/${created.id}/metafields.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ metafield: { namespace: m[1], key: m[2], type: m[3], value } }),
      });
      if (mfRes.ok) metafieldsSet++;
      else {
        const err = await mfRes.json().catch(() => ({}));
        metafieldErrors.push(`${m[1]}.${m[2]}: ${JSON.stringify(err.errors || err)}`);
      }
    }

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({
        success: true,
        product_id: created.id,
        title: created.title,
        admin_url: `https://${domain}/admin/products/${created.id}`,
        images,
        metafields_set: metafieldsSet,
        metafield_errors: metafieldErrors,
      }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
