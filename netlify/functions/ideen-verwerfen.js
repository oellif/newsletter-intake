const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260805
//
// Netlify Function: verwirft ausgewaehlte KI-Themenvorschlaege aus dem
// Ideenpool-Sheet endgueltig (Status "verworfen"). Verworfene Vorschlaege
// werden NICHT in den Redaktionsplan uebernommen, verschwinden aus der
// Liste der offenen Vorschlaege (wie freigegebene auch) und werden von
// ideen-generieren.js kuenftig aus der Ausschlussliste an die KI
// mitgegeben, damit sie nie wieder vorgeschlagen werden.
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
  sheetsWriteValues,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Keine Vorschlaege zum Verwerfen ausgewaehlt.' }) };
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

    let count = 0;
    for (const item of items) {
      const row = parseInt(item.row, 10);
      if (!row || row < 2) continue;
      await sheetsWriteValues(accessToken, ideenpoolId, [['verworfen']], 'D' + row);
      count++;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, count: count }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Verwerfen.', details: err.message }) };
  }
};
