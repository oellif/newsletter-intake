// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function: Redirect-Ziel nach der Klaviyo-Autorisierung. Tauscht
// den Authorization-Code gegen Access-/Refresh-Token und speichert beides
// (plus Ablaufzeit) im AKTUELL-Register des Kundenprofil-Sheets. Von da an
// kann lib/klaviyo.js#getValidAccessToken() fuer diesen Kunden echte
// Klaviyo-API-Aufrufe machen, ohne dass ein Secret irgendwo im Klartext im
// Sheet steht (Access-/Refresh-Token liegen dort, aber das Sheet ist nur
// fuer den Google-Account der Agentur sichtbar, nicht oeffentlich).

const google = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

function htmlPage(statusCode, title, message, extraHtml) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<!doctype html><html><body style="font-family:sans-serif;margin:0;">' +
      '<div style="max-width:640px;margin:60px auto;padding:0 20px;">' +
      '<h2>' + title + '</h2><p>' + message + '</p>' + (extraHtml || '') +
      '</div>' +
      '<script src="/nav.js"></script>' +
      '</body></html>',
  };
}

function naechsteSchritteHtml(folderName) {
  const q = encodeURIComponent(folderName);
  return (
    '<p style="margin-top:24px;font-weight:bold;">Was moechtest du jetzt tun?</p>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
    '<a href="/idee.html?kundenname=' + q + '" style="display:inline-block;padding:10px 18px;background:#2563EB;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Thema selbst eintragen</a>' +
    '<a href="/ideen-freigabe.html?kundenname=' + q + '" style="display:inline-block;padding:10px 18px;background:#4B5563;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">KI-Vorschlaege abrufen</a>' +
    '</div>'
  );
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};

  if (q.error) {
    return htmlPage(400, 'Klaviyo-Verbindung abgebrochen', 'Klaviyo hat die Autorisierung mit folgendem Fehler beendet: ' + (q.error_description || q.error));
  }
  if (!q.code || !q.state) {
    return htmlPage(400, 'Ungueltiger Aufruf', 'Es fehlen code oder state in der Callback-URL.');
  }
  if (!PARENT_FOLDER_ID) {
    return htmlPage(500, 'Konfigurationsfehler', 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.');
  }

  try {
    const folderName = klaviyo.decodeState(q.state);
    const accessToken = await google.getAccessToken();

    const folder = await google.findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return htmlPage(404, 'Kunde nicht gefunden', 'Kunde "' + folderName + '" wurde nicht gefunden.');
    }
    const kundenprofil = await google.findKundenprofil(accessToken, folder.id, folderName);
    if (!kundenprofil) {
      return htmlPage(404, 'Kundenprofil nicht gefunden', 'Kein Kundenprofil-Sheet fuer "' + folderName + '" gefunden.');
    }

    const codeVerifier = await google.getRegisterValue(accessToken, kundenprofil.id, 'KLAVIYO_PENDING_VERIFIER');
    if (!codeVerifier) {
      return htmlPage(400, 'Kein offener Verbindungsversuch', 'Fuer "' + folderName + '" wurde kein offener Klaviyo-Verbindungsversuch gefunden (evtl. abgelaufen oder bereits verwendet). Bitte den Verbindungslink erneut oeffnen.');
    }

    const tokens = await klaviyo.exchangeCodeForTokens(q.code, codeVerifier);
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    await google.setRegisterValue(accessToken, kundenprofil.id, 'KLAVIYO_ACCESS_TOKEN', tokens.access_token);
    await google.setRegisterValue(accessToken, kundenprofil.id, 'KLAVIYO_REFRESH_TOKEN', tokens.refresh_token);
    await google.setRegisterValue(accessToken, kundenprofil.id, 'KLAVIYO_TOKEN_EXPIRES_AT', String(expiresAt));
    await google.setRegisterValue(accessToken, kundenprofil.id, 'KLAVIYO_PENDING_VERIFIER', '');

    return htmlPage(
      200,
      'Klaviyo verbunden ✓',
      'Der Klaviyo-Account fuer "' + folderName + '" wurde erfolgreich verbunden.'
    );
  } catch (err) {
    console.error(err);
    return htmlPage(500, 'Fehler bei der Verbindung', err.message);
  }
};
