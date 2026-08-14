const { requireAuth } = require('./lib/auth');
exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST required' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'JSON ungültig' }) }; }

  const { domain, token } = body;
  if (!domain || !token) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'domain und token erforderlich' }) };

  try {
    const res = await fetch(`https://${domain}/admin/api/2024-01/products.json?status=draft&limit=250&fields=id,title,handle`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { statusCode: 200, headers: h, body: JSON.stringify({ produkte: data.products || [] }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
