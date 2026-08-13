const { getAccessToken, sheetsReadValues } = require('./lib/google');
const SHOPIFY_SHEET_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

async function shopifyPost(domain, token, path, data) {
  const res = await fetch(`https://${domain}/admin/api/2024-01/${path}`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

exports.handler = async (event) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST required' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'JSON ungültig' }) }; }

  const { kunden_id, artikel_sheet_id } = body;
  if (!kunden_id || !artikel_sheet_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id und artikel_sheet_id erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const shopRows = await sheetsReadValues(tok, SHOPIFY_SHEET_ID, 'A2:G500');
    const kunde = (shopRows || []).find(r => r[0] === kunden_id);
    if (!kunde) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const domain = kunde[2], shopToken = kunde[3];

    const rows = await sheetsReadValues(tok, artikel_sheet_id, 'A1:BT500');
    if (rows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Sheet hat keine Daten' }) };

    const header = rows[0];
    const col = (name) => header.findIndex(c => c === name);

    // Nach Handle gruppieren
    const produktMap = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const handle = r[col('Handle')];
      if (!handle) continue;
      if (!produktMap[handle]) produktMap[handle] = [];
      produktMap[handle].push(r);
    }

    const ergebnisse = [];
    for (const [handle, pRows] of Object.entries(produktMap)) {
      const first = pRows[0];
      const variants = pRows.map(r => {
        const v = {
          price: r[col('Variante Preis')] || '0.00',
          sku: r[col('Variante SKU')] || '',
          inventory_management: 'shopify',
          inventory_quantity: parseInt(r[col('Variante Lagerbestand')] || '0', 10),
        };
        const o1 = r[col('Option1 Wert')]; if (o1) v.option1 = o1;
        const o2 = r[col('Option2 Wert')]; if (o2) v.option2 = o2;
        const o3 = r[col('Option3 Wert')]; if (o3) v.option3 = o3;
        const w = r[col('Variante Gewicht')]; if (w) { v.weight = parseFloat(w); v.weight_unit = 'g'; }
        return v;
      });

      const options = [];
      const o1n = first[col('Option1 Name')]; if (o1n) options.push({ name: o1n, values: [...new Set(pRows.map(r => r[col('Option1 Wert')]).filter(Boolean))] });
      const o2n = first[col('Option2 Name')]; if (o2n) options.push({ name: o2n, values: [...new Set(pRows.map(r => r[col('Option2 Wert')]).filter(Boolean))] });
      const o3n = first[col('Option3 Name')]; if (o3n) options.push({ name: o3n, values: [...new Set(pRows.map(r => r[col('Option3 Wert')]).filter(Boolean))] });

      const product = {
        title: first[col('Titel')] || handle,
        body_html: first[col('Beschreibung HTML')] || '',
        vendor: first[col('Anbieter')] || '',
        product_type: first[col('Typ')] || '',
        handle, tags: first[col('Tags')] || '',
        status: 'draft',
        variants, options,
      };

      const result = await shopifyPost(domain, shopToken, 'products.json', { product });
      ergebnisse.push({ handle, shopify_id: result.product && result.product.id, status: 'erstellt' });
    }

    return { statusCode: 200, headers: h, body: JSON.stringify({ success: true, ergebnisse }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
