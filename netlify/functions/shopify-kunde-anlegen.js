const { getAccessToken, sheetsReadValues, sheetsAppendValues } = require('./lib/google');
const MH_SHEET_ID = '1CveKc783N8K_LxKvM2weZA4-rXxMAs6inB4jUCwpXrg';
const SHOPIFY_SHEET_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

function genId() {
  return Math.random().toString(36).slice(2, 15);
}

exports.handler = async (event) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST required' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'JSON ungültig' }) }; }

  const { name, domain, access_token, masterartikel, claid_key } = body;
  if (!name || !domain || !access_token) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'name, domain, access_token erforderlich' }) };

  try {
    const tok = await getAccessToken();

    // Masterlist prüfen
    const masterRows = await sheetsReadValues(tok, MH_SHEET_ID, 'A2:K500');
    const existing = (masterRows || []).find(r => r[7] && r[7].includes(domain.replace(/^https?:\/\//, '')));
    let kundenId;
    if (existing) {
      kundenId = existing[0];
    } else {
      kundenId = genId();
      const heute = new Date().toISOString().slice(0, 10);
      await sheetsAppendValues(tok, MH_SHEET_ID, [[kundenId, name, '', '', '', '', '', domain, '', '', heute]]);
    }

    // Shopify-Kunden Sheet
    const shopifyRows = await sheetsReadValues(tok, SHOPIFY_SHEET_ID, 'A2:G500');
    const shopifyExists = (shopifyRows || []).find(r => r[2] === domain);
    if (!shopifyExists) {
      const heute = new Date().toISOString().slice(0, 10);
      await sheetsAppendValues(tok, SHOPIFY_SHEET_ID, [[kundenId, name, domain, access_token, masterartikel || '', claid_key || '', heute]]);
    }

    return { statusCode: 200, headers: h, body: JSON.stringify({ success: true, kunden_id: kundenId }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
