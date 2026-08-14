const { requireAuth } = require('./lib/auth');
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const { kunden_id } = body;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };

  try {
    const tok = await getAccessToken();
    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:G500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const mastertabelleId = kundeRow[6];
    if (!mastertabelleId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Mastertabelle vorhanden.' }) };

    const allRows = await sheetsReadValues(tok, mastertabelleId, 'A1:B5000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mastertabelle leer.' }) };

    const handleCol = allRows[0].findIndex(c => c && c.trim() === 'URL handle');
    const titleCol  = allRows[0].findIndex(c => c && c.trim() === 'Title');

    const seen = new Set();
    const handles = [];
    for (let i = 1; i < allRows.length; i++) {
      const row    = allRows[i];
      const handle = String(row[handleCol] || '').trim();
      const title  = String(row[titleCol]  || '').trim();
      if (handle && !seen.has(handle)) {
        seen.add(handle);
        handles.push({ handle, title: title || handle });
      }
    }

    return { statusCode: 200, headers: h, body: JSON.stringify({ handles, total: handles.length }) };
  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
