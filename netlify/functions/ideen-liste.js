// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function: liefert die aktuell offenen (noch nicht freigegebenen)
// Vorschlaege aus dem Ideenpool-Sheet eines Kunden fuer die
// Checkbox-Freigabeseite.
//
// Kategorie B der Ablage- & Versionsregel v1: Ideenpool wird bevorzugt
// ueber die im Kundenprofil-Register hinterlegte Datei-ID gefunden statt
// per Namenssuche.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
} = require('./lib/google');

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
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const kundenname = String((event.queryStringParameters || {}).kundenname || '').trim();
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname ist Pflichtfeld.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }),
    };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Kein Kundenordner fuer "' + kundenname + '" gefunden.' }),
      };
    }

    const kundenprofil = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofil ? kundenprofil.id : null;

    let ideenpoolId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Ideenpool_ID');
    if (!ideenpoolId) {
      const ideenpoolSheet = await findSheet(accessToken, folder.id, 'Ideenpool_' + folderName);
      if (!ideenpoolSheet) {
        return { statusCode: 200, headers, body: JSON.stringify({ items: [] }) };
      }
      ideenpoolId = ideenpoolSheet.id;
    }

    const rows = await sheetsReadValues(accessToken, ideenpoolId, 'A1:D1000');
    const items = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const status = (row[3] || '').trim();
      if (status === 'offen') {
        items.push({
          row: i + 1, // 1-basierte Sheet-Zeile (Zeile 1 = Kopfzeile)
          datum: row[0] || '',
          thema: row[1] || '',
          begruendung: row[2] || '',
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + ideenpoolId,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Fehler bei der Verarbeitung.', details: err.message }),
    };
  }
};
