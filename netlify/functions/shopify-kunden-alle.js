const { getAccessToken, sheetsReadValues } = require('./lib/google');
const SHEET_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

exports.handler = async (event) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  try {
    const tok = await getAccessToken();
    const rows = await sheetsReadValues(tok, SHEET_ID, 'A2:G500');
    const kunden = (rows || []).filter(r => r[1]).map(r => ({
      id: r[0] || '', name: r[1] || '', domain: r[2] || '',
      token: r[3] || '',
      masterartikel: r[4] ? r[4].split(',').map(s => s.trim()).filter(Boolean) : [],
      claid_key: r[5] || '',
    }));
    return { statusCode: 200, headers: h, body: JSON.stringify({ kunden }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
