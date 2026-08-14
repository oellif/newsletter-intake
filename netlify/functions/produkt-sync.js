const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function (Skill 5: Newsletter-Produkt-Sync): zieht den aktuellen
// Produktkatalog eines Kunden aus dessen eigenem, per OAuth verbundenem
// Klaviyo-Account (siehe klaviyo-oauth-start.js / klaviyo-oauth-callback.js)
// und schreibt ihn in ein Sheet "Produktkatalog_<Kunde>". Dient als Basis
// fuer Feature-Bloecke im Newsletter und fuer eigenstaendige Ideenfindung
// in Skill 2, wenn kein manueller Rohinput vorliegt.
//
// Kategorie B der Ablage- & Versionsregel v1 (fortlaufende Liste): Datei-ID
// bleibt stabil im Kundenprofil-Register (AKTUELL_Produktkatalog_ID), kein
// Snapshot pro Zeile - bei jedem Sync wird der Inhalt einfach ueberschrieben,
// da der Katalog ohnehin nur den aktuellen Klaviyo-Stand widerspiegelt.

const google = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

const HEADER = ['Externe ID', 'Titel', 'Beschreibung', 'Preis', 'URL', 'Bild-URL', 'Zuletzt synchronisiert am'];

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const kunde = (event.queryStringParameters || {}).kunde;
  if (!kunde || !String(kunde).trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kein Kundenname angegeben (?kunde=...).' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const googleAccessToken = await google.getAccessToken();
    const folderName = google.sanitizeFolderName(kunde);

    const folder = await google.findKundenordner(googleAccessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kunde "' + folderName + '" wurde nicht gefunden.' }) };
    }
    const kundenprofil = await google.findKundenprofil(googleAccessToken, folder.id, folderName);
    if (!kundenprofil) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenprofil-Sheet fuer "' + folderName + '" gefunden.' }) };
    }

    // Gueltigen Klaviyo-Access-Token fuer DIESEN Kunden holen (nicht die Agentur).
    const klaviyoAccessToken = await klaviyo.getValidAccessToken(googleAccessToken, kundenprofil.id);

    const data = await klaviyo.klaviyoRequest(
      klaviyoAccessToken,
      'GET',
      '/api/catalog-items/?fields[catalog-item]=external_id,title,description,price,url,images&page[size]=100'
    );

    const items = data.data || [];
    const now = new Date().toISOString();
    const rows = items.map(function (item) {
      const a = item.attributes || {};
      const imageUrl = (a.images && a.images[0] && a.images[0].full_url) || '';
      return [a.external_id || '', a.title || '', a.description || '', a.price != null ? a.price : '', a.url || '', imageUrl, now];
    });

    const sheetId = await google.findOrCreateSheetByRegister(
      googleAccessToken,
      folder.id,
      kundenprofil.id,
      'AKTUELL_Produktkatalog_ID',
      'Produktkatalog_' + folderName,
      HEADER
    );

    // Kompletter Refresh: Katalog spiegelt nur den aktuellen Klaviyo-Stand,
    // daher wird der Inhalt bei jedem Sync ueberschrieben (kein Append,
    // kein Snapshot - siehe Kommentar oben).
    await google.sheetsWriteValues(googleAccessToken, sheetId, [HEADER].concat(rows));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        anzahlProdukte: rows.length,
        sheetId: sheetId,
        sheetUrl: 'https://docs.google.com/spreadsheets/d/' + sheetId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Produkt-Sync.', details: err.message }) };
  }
};
