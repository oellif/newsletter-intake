const { requireAuth } = require('./lib/auth');
// Workflow 2 (Bestandsoptimierung), Schritt 1: Liste aller Shop-Artikel
// fuer die Auswahl per Checkbox. Liefert Titel, Handle, Status und
// Bildanzahl - keine Preise/Bestaende (braucht die Auswahl nicht).
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cockpit-Pw',
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
    const domain = kundeRow[2];
    const token  = kundeRow[3];

    const res  = await fetch(`https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,status,images,tags`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    const data = await res.json();
    if (!res.ok) return { statusCode: 502, headers: h, body: JSON.stringify({ error: JSON.stringify(data.errors || data) }) };

    const artikel = (data.products || []).map(p => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      bilder: (p.images || []).length,
      ist_master: String(p.tags || '').split(',').some(t => t.trim().toLowerCase() === 'master'),
    }));

    return { statusCode: 200, headers: h, body: JSON.stringify({ artikel, total: artikel.length }) };
  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
