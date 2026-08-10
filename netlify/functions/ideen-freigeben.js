// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function: verarbeitet die Checkbox-Freigabe von Skill-2-Vorschlaegen.
//
// Markiert die ausgewaehlten Zeilen im Ideenpool-Sheet als "freigegeben"
// und uebernimmt sie 1:1 in den Redaktionsplan - erst ab hier gelten sie
// als geplant, davor waren sie nur ein KI-Vorschlag.
//
// Kategorie B der Ablage- & Versionsregel v1: Ideenpool/Redaktionsplan
// werden bevorzugt ueber die im Kundenprofil-Register hinterlegte Datei-ID
// gefunden statt per Namenssuche.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  findOrCreateSheetByRegister,
  sheetsWriteValues,
  sheetsAppendValues,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const REDAKTIONSPLAN_HEADER = ['Datum', 'Thema / Text', 'Quelle', 'Status'];

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON im Request-Body.' }) };
  }

  const kundenname = String(data.kundenname || '').trim();
  const items = Array.isArray(data.items) ? data.items : [];

  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname ist Pflichtfeld.' }) };
  }
  if (!items.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Keine Vorschlaege zum Freigeben ausgewaehlt.' }) };
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
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Ideenpool fuer diesen Kunden gefunden.' }) };
      }
      ideenpoolId = ideenpoolSheet.id;
    }

    const redaktionsplanId = await findOrCreateSheetByRegister(
      accessToken,
      folder.id,
      kundenprofilId,
      'AKTUELL_Redaktionsplan_ID',
      'Redaktionsplan_' + folderName,
      REDAKTIONSPLAN_HEADER
    );

    const timestamp = new Date().toISOString();

    for (const item of items) {
      const row = parseInt(item.row, 10);
      if (!row || row < 2) continue;
      // Ideenpool-Zeile als freigegeben markieren (Spalte D)
      await sheetsWriteValues(accessToken, ideenpoolId, [['freigegeben']], 'D' + row);
    }

    const planRows = items
      .filter((item) => item.thema)
      .map((item) => [timestamp, item.thema, 'automatisch (freigegeben)', 'im Plan (aus Vorschlag freigegeben)']);
    if (planRows.length) {
      await sheetsAppendValues(accessToken, redaktionsplanId, planRows);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: planRows.length,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
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
