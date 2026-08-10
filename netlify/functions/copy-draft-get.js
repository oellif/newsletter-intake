// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260805
//
// Netlify Function (Teil der editierbaren Copy-Draft-Seite,
// orchestrator.html): liest die bereits gespeicherten Werte (Copy-Text,
// CTA, Betreff-Varianten, Klaviyo-Template-Link) fuer ein Thema, das
// schon einen Copy-Draft hat - OHNE die KI erneut aufzurufen. Damit kann
// man ein bestehendes Thema aus dem Redaktionsplan oeffnen und bearbeiten,
// ohne dass der Text ungefragt neu generiert wird.
//
// Nur lesend - schreibt oder veraendert nichts.

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

  const q = event.queryStringParameters || {};
  const kundenname = String(q.kundenname || '').trim();
  const thema = String(q.thema || '').trim();
  if (!kundenname || !thema) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'kundenname und thema sind Pflichtparameter.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return { statusCode: 200, headers, body: JSON.stringify({ exists: false }) };
    }
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofilSheet ? kundenprofilSheet.id : null;

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 200, headers, body: JSON.stringify({ exists: false }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:Z500');
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i][1] === thema) { targetIndex = i; break; }
    }
    if (targetIndex === -1) {
      return { statusCode: 200, headers, body: JSON.stringify({ exists: false }) };
    }

    const row = rows[targetIndex];
    const copyText = row[4] || '';
    if (!copyText.trim()) {
      return { statusCode: 200, headers, body: JSON.stringify({ exists: false }) };
    }
    // Spalte F: JSON-Array von CTA-Varianten (neu) - oder, bei aelteren
    // Zeilen, noch der reine alte Text (Legacy) - dann in eine Variante
    // umwandeln, damit die Seite in beiden Faellen funktioniert.
    let ctas = [];
    try {
      const parsed = JSON.parse(row[5] || '[]');
      ctas = Array.isArray(parsed) ? parsed : [{ text: String(row[5] || ''), ausgewaehlt: true }];
    } catch (err) {
      ctas = row[5] ? [{ text: row[5], ausgewaehlt: true }] : [];
    }
    let variants = [];
    try {
      variants = JSON.parse(row[7] || '[]');
    } catch (err) {
      variants = [];
    }
    const templateId = row[9] || '';
    const betreffModus = row[25] || 'ab'; // Spalte Z: 'ab' (A/B-Test) oder 'einzel' (Einzelbetreff)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        exists: true,
        thema: thema,
        copyText: copyText,
        ctas: ctas,
        variants: variants,
        betreffModus: betreffModus,
        klaviyoTemplateUrl: templateId ? 'https://www.klaviyo.com/email-templates/' + templateId + '/edit' : '',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Laden des Copy-Drafts.', details: err.message }) };
  }
};
