const { getAccessToken, sheetsReadValues } = require('./lib/google');
const SHOPIFY_SHEET_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

async function shopifyGet(domain, token, path) {
  const res = await fetch(`https://${domain}/admin/api/2024-01/${path}`, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  return res.json();
}

exports.handler = async (event) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };

  const { kunden_id } = event.queryStringParameters || {};
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };

  try {
    const tok = await getAccessToken();
    const rows = await sheetsReadValues(tok, SHOPIFY_SHEET_ID, 'A2:G500');
    const kunde = (rows || []).find(r => r[0] === kunden_id);
    if (!kunde) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const domain = kunde[2], shopToken = kunde[3];
    const data = await shopifyGet(domain, shopToken, 'products.json?status=draft&limit=250&fields=id,title,handle');

    return { statusCode: 200, headers: h, body: JSON.stringify({ produkte: data.products || [] }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
