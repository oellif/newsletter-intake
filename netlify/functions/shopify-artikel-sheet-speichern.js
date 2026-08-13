const { getAccessToken, sheetsReadValues, sheetsWriteValues } = require('./lib/google');
const SHOPIFY_SHEET_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

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
    const rows = await sheetsReadValues(tok, SHOPIFY_SHEET_ID, 'A2:G500');
    const rowIdx = (rows || []).findIndex(r => r[0] === kunden_id);
    if (rowIdx < 0) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const sheetRow = rowIdx + 2;
    await sheetsWriteValues(tok, SHOPIFY_SHEET_ID, `G${sheetRow}`, [[artikel_sheet_id]]);

    return { statusCode: 200, headers: h, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
