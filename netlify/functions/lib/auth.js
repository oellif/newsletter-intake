// Serverseitige Passwortpruefung fuer alle Cockpit-Funktionen.
// Der Browser schickt das Passwort als Header "X-Cockpit-Pw" mit (siehe
// public/pw-gate.js, dort wird fetch() entsprechend erweitert). Hier wird
// es gehasht und gegen den hinterlegten SHA-256-Hash geprueft - das
// Klartext-Passwort steht nirgends im Code.
// Der Hash kann per Netlify-Umgebungsvariable COCKPIT_PW_HASH
// ueberschrieben werden (Passwortwechsel ohne Deploy).
const crypto = require('crypto');

const PW_HASH = process.env.COCKPIT_PW_HASH
  || '4d37e19217cab195189d033f6e939540f34e84740747be49af0eda6a88875caa';

function requireAuth(event) {
  // CORS-Preflight immer durchlassen (traegt nie Custom-Header)
  if (event.httpMethod === 'OPTIONS') return null;

  const pw = (event.headers && (event.headers['x-cockpit-pw'] || event.headers['X-Cockpit-Pw'])) || '';
  const hash = crypto.createHash('sha256').update(pw).digest('hex');
  if (hash === PW_HASH) return null;

  return {
    statusCode: 401,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Cockpit-Pw',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ error: 'Nicht autorisiert – Passwort fehlt oder ist falsch.' }),
  };
}

module.exports = { requireAuth };
