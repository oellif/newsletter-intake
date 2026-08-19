const { requireAuth } = require('./lib/auth');
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST required' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'JSON ungültig' }) }; }

  // Token wird serverseitig aus der Kundentabelle geholt - der Browser
  // schickt nur noch die kunden_id, nie den Shopify-Token
  const { kunden_id } = body;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };

  try {
    const tok        = await getAccessToken();
    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:G500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const domain = kundeRow[2];
    const token  = kundeRow[3];
    // Masterartikel = Artikel mit Tag "Master" (egal welcher Status).
    // Die REST-API kann nicht direkt nach Tags filtern, daher alle laden
    // und serverseitig filtern.
    const res = await fetch(`https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,tags`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const produkte = (data.products || []).filter(p =>
      String(p.tags || '').split(',').some(t => t.trim().toLowerCase() === 'master')
    ).map(p => ({ id: p.id, title: p.title, handle: p.handle }));
    return { statusCode: 200, headers: h, body: JSON.stringify({ produkte }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
