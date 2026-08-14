const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260805
//
// Netlify Function (Hilfsfunktion fuer die Sidebar-Navigation): liefert
// einen kurzen Status fuer einen Kunden - ob Klaviyo verbunden ist
// (KLAVIYO_ACCESS_TOKEN im Kundenprofil-Register gesetzt) UND, wenn ja,
// mit welchem Klaviyo-Account (Firmenname aus GET /api/accounts/). Wird
// in nav.js genutzt, um neben dem eingeloggten Kundennamen anzuzeigen,
// ob und mit welchem Account verbunden ist, ohne dafuer extra auf die
// Seite "Klaviyo verbinden" wechseln zu muessen.
//
// Nur lesend - schreibt oder veraendert nichts (der einzige "schreibende"
// Nebeneffekt ist der uebliche Token-Refresh in getValidAccessToken, falls
// der gespeicherte Access-Token abgelaufen ist - das ist Teil des
// normalen Klaviyo-Verbindungs-Flows, kein eigenstaendiges Schreiben).

const {
  getAccessToken,
  findKundenordner,
  findKundenprofil,
  getRegisterValue,
} = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

// Versucht aus der Klaviyo-Accounts-Antwort einen sinnvollen Anzeigenamen
// zu ziehen - je nach Account sind unterschiedliche Felder gefuellt.
function extractAccountName(accountsResponse) {
  const acc = accountsResponse && accountsResponse.data && accountsResponse.data[0];
  if (!acc) { return null; }
  const attrs = acc.attributes || {};
  const contact = attrs.contact_information || {};
  return contact.organization_name || contact.default_sender_name || attrs.public_api_key || acc.id || null;
}

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const kundenname = ((event.queryStringParameters || {}).kundenname || '').trim();
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'kundenname ist Pflichtparameter.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, kundenname);
    if (!folder) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, klaviyoConnected: false }) };
    }
    const kundenprofil = await findKundenprofil(accessToken, folder.id, kundenname);
    if (!kundenprofil) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: true, klaviyoConnected: false }) };
    }
    const token = await getRegisterValue(accessToken, kundenprofil.id, 'KLAVIYO_ACCESS_TOKEN');
    const klaviyoConnected = !!(token && String(token).trim());

    let klaviyoAccountName = null;
    if (klaviyoConnected) {
      try {
        const validToken = await klaviyo.getValidAccessToken(accessToken, kundenprofil.id);
        const accountsResponse = await klaviyo.klaviyoRequest(validToken, 'GET', '/api/accounts/');
        klaviyoAccountName = extractAccountName(accountsResponse);
      } catch (accErr) {
        // Verbindung besteht laut Token, Account-Detailabfrage ist aber
        // fehlgeschlagen (z.B. Token wirklich ungueltig geworden) - dann
        // zeigen wir einfach keinen Accountnamen, aber der Ja/Nein-Status
        // soll trotzdem stimmen.
        console.error('Klaviyo-Account-Abfrage fehlgeschlagen:', accErr.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ found: true, klaviyoConnected: klaviyoConnected, klaviyoAccountName: klaviyoAccountName }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, headers, body: JSON.stringify({ found: false, klaviyoConnected: false, error: err.message }) };
  }
};
