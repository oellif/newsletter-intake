// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Gemeinsame Hilfsfunktionen fuer die Klaviyo-OAuth-Integration (Skill 3+).
// Jede/r Kunde/in verbindet den EIGENEN Klaviyo-Account ueber OAuth 2.0 mit
// PKCE. Die App-Zugangsdaten (Client-ID/-Secret) sind global (Netlify Env
// Vars), die pro-Kunde-Tokens liegen im AKTUELL-Register des jeweiligen
// Kundenprofil-Sheets (siehe lib/google.js), NIE hart codiert oder geteilt.

const crypto = require('crypto');
const google = require('./google');

const KLAVIYO_API_BASE = 'https://a.klaviyo.com';
const KLAVIYO_API_REVISION = '2024-10-15';

const SCOPES = [
  'accounts:read',
  'campaigns:read', 'campaigns:write',
  'lists:read', 'lists:write',
  'profiles:read', 'profiles:write',
  'templates:read', 'templates:write',
  'flows:read',
  'metrics:read',
  'images:read', 'images:write',
  'catalogs:read', 'catalogs:write',
  'segments:read',
].join(' ');

function base64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// PKCE code_verifier: 43-128 Zeichen, hier 86 (64 Zufalls-Bytes base64url-codiert).
function generateCodeVerifier() {
  return base64url(crypto.randomBytes(64));
}

function generateCodeChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

function encodeState(kundenname) {
  return base64url(Buffer.from(kundenname, 'utf8'));
}

function decodeState(state) {
  // base64url dekodieren (Padding wieder auffuellen, falls noetig)
  let padded = state.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getAuthorizeUrl(state, codeChallenge) {
  const clientId = process.env.KLAVIYO_CLIENT_ID;
  const redirectUri = process.env.KLAVIYO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error('KLAVIYO_CLIENT_ID oder KLAVIYO_REDIRECT_URI ist nicht als Umgebungsvariable gesetzt.');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state,
  });
  return 'https://www.klaviyo.com/oauth/authorize?' + params.toString();
}

function basicAuthHeader() {
  const clientId = process.env.KLAVIYO_CLIENT_ID;
  const clientSecret = process.env.KLAVIYO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('KLAVIYO_CLIENT_ID oder KLAVIYO_CLIENT_SECRET ist nicht als Umgebungsvariable gesetzt.');
  }
  return 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
}

async function exchangeCodeForTokens(code, codeVerifier) {
  const redirectUri = process.env.KLAVIYO_REDIRECT_URI;
  const res = await fetch('https://a.klaviyo.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Klaviyo-Token-Tausch-Fehler: ' + JSON.stringify(data));
  }
  return data; // { access_token, refresh_token, expires_in, token_type, scope }
}

async function refreshTokens(refreshToken) {
  const res = await fetch('https://a.klaviyo.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Klaviyo-Refresh-Fehler: ' + JSON.stringify(data));
  }
  return data;
}

// Liefert einen gueltigen Access-Token fuer den Kunden mit dem gegebenen
// Kundenprofil-Sheet (kundenprofilId). Erneuert automatisch ueber den
// Refresh-Token, wenn der gespeicherte Token abgelaufen oder nah dran ist
// (5-Minuten-Puffer). googleAccessToken wird gebraucht, um das Register im
// Kundenprofil-Sheet zu lesen/schreiben (siehe lib/google.js).
async function getValidAccessToken(googleAccessToken, kundenprofilId) {
  const accessToken = await google.getRegisterValue(googleAccessToken, kundenprofilId, 'KLAVIYO_ACCESS_TOKEN');
  const refreshToken = await google.getRegisterValue(googleAccessToken, kundenprofilId, 'KLAVIYO_REFRESH_TOKEN');
  const expiresAt = await google.getRegisterValue(googleAccessToken, kundenprofilId, 'KLAVIYO_TOKEN_EXPIRES_AT');

  if (!refreshToken) {
    throw new Error('Kein Klaviyo-Zugang fuer diesen Kunden hinterlegt. Bitte zuerst ueber "Mit Klaviyo verbinden" autorisieren.');
  }

  const bufferMs = 5 * 60 * 1000;
  if (accessToken && expiresAt && Date.now() < Number(expiresAt) - bufferMs) {
    return accessToken;
  }

  const tokens = await refreshTokens(refreshToken);
  const newExpiresAt = Date.now() + tokens.expires_in * 1000;
  await google.setRegisterValue(googleAccessToken, kundenprofilId, 'KLAVIYO_ACCESS_TOKEN', tokens.access_token);
  await google.setRegisterValue(googleAccessToken, kundenprofilId, 'KLAVIYO_TOKEN_EXPIRES_AT', String(newExpiresAt));
  if (tokens.refresh_token) {
    await google.setRegisterValue(googleAccessToken, kundenprofilId, 'KLAVIYO_REFRESH_TOKEN', tokens.refresh_token);
  }
  return tokens.access_token;
}

// Generischer Klaviyo-API-Aufruf (JSON:API). path z.B. "/api/accounts/".
async function klaviyoRequest(accessToken, method, path, body) {
  const res = await fetch(KLAVIYO_API_BASE + path, {
    method: method,
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      revision: KLAVIYO_API_REVISION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(function () { return null; });
  if (!res.ok) {
    throw new Error('Klaviyo-API-Fehler (' + res.status + '): ' + JSON.stringify(data));
  }
  return data;
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  encodeState,
  decodeState,
  getAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
  getValidAccessToken,
  klaviyoRequest,
};
