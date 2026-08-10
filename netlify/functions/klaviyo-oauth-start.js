// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function: startet den Klaviyo-OAuth-Flow (PKCE) fuer einen
// bestehenden Kunden. Aufruf per Link/Button:
//   /.netlify/functions/klaviyo-oauth-start?kunde=<Kundenname>
// Der Kunde muss vorher per Neukundenanlage (Skill 0) angelegt worden sein.
//
// Ablauf: code_verifier erzeugen, im Kundenprofil-Register zwischenspeichern
// (AKTUELL_..., ueberlebt den Redirect zu Klaviyo und zurueck), dann Redirect
// zur Klaviyo-Autorisierungsseite mit code_challenge + state (= Kundenname).

const google = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

function htmlError(statusCode, message) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><body style="font-family:sans-serif;max-width:640px;margin:60px auto;">' +
      '<h2>Klaviyo-Verbindung konnte nicht gestartet werden</h2><p>' + message + '</p></body></html>',
  };
}

exports.handler = async (event) => {
  const kunde = (event.queryStringParameters || {}).kunde;
  if (!kunde || !String(kunde).trim()) {
    return htmlError(400, 'Kein Kundenname angegeben (?kunde=... fehlt in der URL).');
  }
  if (!PARENT_FOLDER_ID) {
    return htmlError(500, 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.');
  }

  try {
    const accessToken = await google.getAccessToken();
    const folderName = google.sanitizeFolderName(kunde);

    const folder = await google.findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return htmlError(404, 'Kunde "' + folderName + '" wurde nicht gefunden. Bitte zuerst die Neukundenanlage (Skill 0) fuer diesen Kunden ausfuellen.');
    }

    const kundenprofil = await google.findKundenprofil(accessToken, folder.id, folderName);
    if (!kundenprofil) {
      return htmlError(404, 'Kein Kundenprofil-Sheet fuer "' + folderName + '" gefunden.');
    }

    const codeVerifier = klaviyo.generateCodeVerifier();
    const codeChallenge = klaviyo.generateCodeChallenge(codeVerifier);

    // Verifier zwischenspeichern, damit die Callback-Function ihn wiederfindet
    // (ueberlebt den Redirect zu Klaviyo und zurueck, da Netlify Functions
    // zustandslos sind und keinen gemeinsamen Speicher zwischen Aufrufen haben).
    await google.setRegisterValue(accessToken, kundenprofil.id, 'KLAVIYO_PENDING_VERIFIER', codeVerifier);

    const state = klaviyo.encodeState(folderName);
    const authorizeUrl = klaviyo.getAuthorizeUrl(state, codeChallenge);

    return {
      statusCode: 302,
      headers: { Location: authorizeUrl },
      body: '',
    };
  } catch (err) {
    console.error(err);
    return htmlError(500, 'Fehler: ' + err.message);
  }
};
