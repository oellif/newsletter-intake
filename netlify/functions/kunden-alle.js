const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260804
//
// Netlify Function (Hilfsfunktion fuer das globale Navigationsmenue):
// listet ALLE Kundenordner (keine Teilstring-Suche wie kunde-suchen.js),
// damit die Kunden-Login-Auswahl im Nav-Menue ein vollstaendiges Dropdown
// zeigen kann, statt dass man erst ein paar Buchstaben tippen muesste.
//
// Nur lesend - schreibt oder veraendert nichts.

const { getAccessToken, driveFindFile } = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const q =
      "mimeType = 'application/vnd.google-apps.folder'" +
      " and '" + PARENT_FOLDER_ID + "' in parents" +
      " and trashed = false";
    const folders = await driveFindFile(accessToken, q);
    const sorted = (folders || []).slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, 'de');
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        kunden: sorted.map(function (f) { return { id: f.id, name: f.name }; }),
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Laden der Kundenliste.', details: err.message }) };
  }
};
