const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260801
//
// Netlify Function (internes Tool: Kunde loeschen, Teil 2 - Loeschen):
// verschiebt den kompletten Drive-Kundenordner (Kundenprofil, Redaktions-
// plan, Produktkatalog, alles darin) in den Google-Drive-Papierkorb - NICHT
// endgueltig geloescht, 30 Tage lang wiederherstellbar. Klaviyo-Daten
// (Kampagnen, Listen, Vorlagen) werden bewusst NICHT angefasst, da dort
// ggf. reale Versanddaten haengen - das bleibt manuelle Aufgabe in Klaviyo.
//
// Sicherheitsmechanismus: der Aufrufer muss den vollen, exakten Ordner-
// namen erneut eintippen (confirmName) - reicht nicht, nur die ID aus der
// Trefferliste zu haben. Verhindert versehentliches Loeschen des falschen
// Kunden bei aehnlichen Namen (z.B. "Thielemann" vs. "Thielemann GmbH").

const { getAccessToken, driveTrashFile } = require('./lib/google');

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

  const folderId = String(data.folderId || '').trim();
  const folderName = String(data.folderName || '').trim();
  const confirmName = String(data.confirmName || '').trim();

  if (!folderId || !folderName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'folderId und folderName sind Pflichtfelder.' }) };
  }
  if (!confirmName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bitte den Kundennamen zur Bestaetigung erneut eingeben.' }) };
  }
  if (confirmName.toLowerCase() !== folderName.toLowerCase()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Eingegebener Name stimmt nicht mit dem ausgewaehlten Kunden ueberein. Nichts wurde geloescht.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const result = await driveTrashFile(accessToken, folderId);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        folderId: folderId,
        folderName: folderName,
        note: 'Ordner wurde in den Google-Drive-Papierkorb verschoben (30 Tage lang wiederherstellbar). Klaviyo-Daten wurden nicht angefasst.',
        trashed: result.trashed,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Loeschen.', details: err.message }) };
  }
};
