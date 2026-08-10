// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260805
//
// Netlify Function (Teil der Redaktionsplan-Ansicht, redaktionsplan.html):
// speichert das geplante Versanddatum fuer ein Thema in Spalte Y (Index 24)
// des Redaktionsplan-Sheets. Das ist eine neue, bisher nicht genutzte
// Spalte - nicht destruktiv: bestehende Spalten A-X bleiben unangetastet.
// Falls in Zeile 1 (Header) noch keine Ueberschrift fuer Spalte Y steht,
// wird sie beim ersten Speichern einmalig ergaenzt (Kategorie B der
// Ablage- & Versionsregel v1: fortlaufende Liste, stabile Datei-ID).
//
// Nur diese eine Zelle wird veraendert - keine neue Zeile, kein Snapshot.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
  sheetsWriteValues,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const VERSAND_DATUM_HEADER = 'Versand-Datum (geplant)';

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
  const thema = String(body.thema || '').trim();
  const versandDatum = String(body.versandDatum || '').trim(); // z.B. "2026-08-20", oder leer zum Loeschen

  if (!kundenname || !thema) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname und Thema sind Pflichtfelder.' }) };
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

    // Spalte Y (Index 24) im Header ergaenzen, falls noch nicht vorhanden -
    // nicht destruktiv, laesst A-X unangetastet.
    const headerRow = rows[0] || [];
    if (!headerRow[24] || !String(headerRow[24]).trim()) {
      await sheetsWriteValues(accessToken, redaktionsplanId, [[VERSAND_DATUM_HEADER]], 'Y1');
    }

    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i][1] === thema) { targetIndex = i; break; }
    }
    if (targetIndex === -1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Thema "' + thema + '" wurde im Redaktionsplan nicht gefunden.' }) };
    }

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(accessToken, redaktionsplanId, [[versandDatum]], 'Y' + sheetRowNumber);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Speichern.', details: err.message }) };
  }
};
