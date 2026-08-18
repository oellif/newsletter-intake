// Liest den gespeicherten "Daniel bearbeitet"-Status aller Formulare aus dem Google Sheet.
// Status-Zeilen haben die Form: [Datum, Formular, "__daniel__:punktSlug:rundeN", "true"/"false"]
// Schreiben läuft weiterhin über formular-kommentare-save.js mit demselben Format.

const { requireAuth } = require('./lib/auth');
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHEET_ID = process.env.FORMULAR_KOMMENTARE_SHEET_ID
  || '1QPjpp19F6kiVhjSt-Ln68PbrNbSnCXUMRVlQzJzb-C8';

exports.handler = async (event) => {
  const authErr = requireAuth(event);
  if (authErr) return authErr;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cockpit-Pw',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const formular = (event.queryStringParameters || {}).formular || null;

  try {
    const token = await getAccessToken();
    const rows = await sheetsReadValues(token, SHEET_ID, 'A:D');

    // Pro Schlüssel (formular||punkt) den neuesten Eintrag merken
    const latest = {};
    for (const row of rows) {
      const [, form, punkt] = row;
      if (!punkt || !punkt.startsWith('__')) continue;
      if (formular && form !== formular) continue;
      latest[form + '||' + punkt] = { formular: form, punkt, bearbeitet: row[3] === 'true' };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ status: Object.values(latest) }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
