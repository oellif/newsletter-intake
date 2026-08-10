// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260801
//
// Netlify Function (internes Tool: Kunde loeschen, Teil 1 - Suche): findet
// alle Kundenordner, deren Name den eingegebenen Teilstring enthaelt (z.B.
// "thi" -> "Thielemann"). Rein lesend, keine Aenderungen. Wird von der
// Live-Suche in kunde-loeschen.html genutzt.

const { getAccessToken, driveSearchFoldersByNameContains } = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const q = (event.queryStringParameters || {}).q || '';
  if (!q.trim() || q.trim().length < 2) {
    return { statusCode: 200, headers, body: JSON.stringify({ matches: [] }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folders = await driveSearchFoldersByNameContains(accessToken, PARENT_FOLDER_ID, q.trim());
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        matches: folders.map(function (f) { return { id: f.id, name: f.name }; }).slice(0, 20),
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler bei der Kundensuche.', details: err.message }) };
  }
};
