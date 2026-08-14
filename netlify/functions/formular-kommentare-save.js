const { requireAuth } = require('./lib/auth');
// Netlify Function (Formulare-Bereich): speichert Kommentare aus den
// Cockpit-Formularen (z.B. formular-masterartikel-optimierer.html) in das
// zentrale Google Sheet "Cockpit Formular-Kommentare". Jeder Speichervorgang
// haengt neue Zeilen an (Verlauf bleibt erhalten) - beim Auslesen zaehlt der
// jeweils neueste Eintrag pro Formular+Punkt.
//
// Request (POST, JSON):
//   { formular: "masterartikel-optimierer",
//     kommentare: [{ punkt: "Entscheidung 1 — ...", text: "..." }, ...] }

const { getAccessToken, sheetsReadValues, sheetsWriteValues, sheetsAppendValues } = require('./lib/google');

const SHEET_ID = process.env.FORMULAR_KOMMENTARE_SHEET_ID
  || '1QPjpp19F6kiVhjSt-Ln68PbrNbSnCXUMRVlQzJzb-C8';

const HEADER = ['Datum', 'Formular', 'Punkt', 'Kommentar'];

function zeitstempelWien() {
  return new Date().toLocaleString('de-AT', {
    timeZone: 'Europe/Vienna',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cockpit-Pw',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON im Request-Body.' }) };
  }

  const formular = String(body.formular || '').trim();
  const kommentare = Array.isArray(body.kommentare) ? body.kommentare : [];
  if (!formular) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Feld "formular" ist Pflicht.' }) };
  }
  const rows = kommentare
    .map(function (k) {
      return { punkt: String((k && k.punkt) || '').trim(), text: String((k && k.text) || '').trim() };
    })
    .filter(function (k) { return k.punkt && k.text; });
  if (!rows.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Keine Kommentare uebergeben.' }) };
  }

  try {
    const accessToken = await getAccessToken();

    // Kopfzeile einmalig sicherstellen (Sheet wurde leer angelegt)
    const first = await sheetsReadValues(accessToken, SHEET_ID, 'A1:D1');
    if (!first.length || !first[0] || !first[0][0]) {
      await sheetsWriteValues(accessToken, SHEET_ID, [HEADER], 'A1');
    }

    const stamp = zeitstempelWien();
    const values = rows.map(function (k) { return [stamp, formular, k.punkt, k.text]; });
    await sheetsAppendValues(accessToken, SHEET_ID, values);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        gespeichert: values.length,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Speichern.', details: err.message }) };
  }
};
