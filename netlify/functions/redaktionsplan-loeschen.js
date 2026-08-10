// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260806
//
// Netlify Function (Teil der Redaktionsplan-Ansicht, redaktionsplan.html):
// loescht eine oder mehrere Zeilen (per exaktem Thema-Treffer in Spalte B)
// dauerhaft aus dem Redaktionsplan-Sheet, ueber die Sheets-API
// (batchUpdate deleteDimension). Zeilen werden von unten nach oben
// geloescht, damit sich die Zeilennummern der anderen zu loeschenden
// Zeilen dabei nicht verschieben.
//
// Achtung: das ist eine echte, unwiderrufliche Loeschung (keine
// Papierkorb-Funktion wie bei Drive-Dateien) - der Nutzer bestaetigt das
// vorher explizit im Frontend.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
  sheetsBatchUpdate,
  getFirstSheetId,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON im Request-Body.' }) };
  }

  const kundenname = String(body.kundenname || '').trim();
  const themen = Array.isArray(body.themen) ? body.themen.map((t) => String(t || '').trim()).filter(Boolean) : [];

  if (!kundenname || !themen.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname und mindestens ein Thema sind Pflichtfelder.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenordner fuer "' + kundenname + '" gefunden.' }) };
    }
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofilSheet ? kundenprofilSheet.id : null;

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:Z500');

    // Alle Zeilenindizes (0-basiert, inkl. Header in rows[0]) finden, deren
    // Thema (Spalte B) exakt in der uebergebenen Liste vorkommt.
    const rowIndicesToDelete = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && themen.indexOf(rows[i][1]) !== -1) {
        rowIndicesToDelete.push(i);
      }
    }
    if (!rowIndicesToDelete.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Keines der uebergebenen Themen wurde im Redaktionsplan gefunden.' }) };
    }

    const sheetId = await getFirstSheetId(accessToken, redaktionsplanId);
    if (sheetId === undefined || sheetId === null) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sheet-ID (gid) konnte nicht ermittelt werden.' }) };
    }

    // Absteigend loeschen (groesste Zeilennummer zuerst), damit sich die
    // Position der noch nicht geloeschten Zeilen nicht verschiebt.
    rowIndicesToDelete.sort((a, b) => b - a);
    const requests = rowIndicesToDelete.map((rowIndex) => ({
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: 'ROWS',
          startIndex: rowIndex,
          endIndex: rowIndex + 1,
        },
      },
    }));

    await sheetsBatchUpdate(accessToken, redaktionsplanId, requests);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: rowIndicesToDelete.length,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Loeschen.', details: err.message }) };
  }
};
