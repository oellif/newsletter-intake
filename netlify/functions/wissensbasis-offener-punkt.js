// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260806
//
// Netlify Function: haengt einen "offenen Punkt" an das zentrale,
// projektuebergreifende Google Sheet "OffenePunkte_Liste" im
// _Wissensbasis-Drive-Ordner an. Nutzt denselben Google-Account/OAuth wie
// der Rest des Newsletter-Systems (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN),
// der bereits Schreibrechte auf diesen Ordner hat.
//
// Grund fuer eine eigene, sehr kleine Function statt Wiederverwendung der
// Kundenprofil-Suche: dieses Sheet ist NICHT pro Kunde, sondern eine feste,
// projektuebergreifende Liste mit fester Spreadsheet-ID - keine Ordner-/
// Kundenprofil-Suche noetig, nur ein direkter Append.
//
// Spalten: ProjektID | ProjektLabel | Datum | Punkt | Status

const { getAccessToken, sheetsAppendValues } = require('./lib/google');

// Feste Spreadsheet-ID von OffenePunkte_Liste im _Wissensbasis-Ordner.
const OFFENE_PUNKTE_SHEET_ID = '1je_-SswEt-RJDX5ffKFyvUtFXJtkMC2SlOkKHcyhCIk';

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

  const projektId = String(body.projektId || '').trim();
  const projektLabel = String(body.projektLabel || '').trim();
  const punkt = String(body.punkt || '').trim();

  if (!projektId || !projektLabel || !punkt) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'projektId, projektLabel und punkt sind Pflichtfelder.' }),
    };
  }

  const datum = new Date().toISOString().slice(0, 10);

  try {
    const accessToken = await getAccessToken();
    await sheetsAppendValues(accessToken, OFFENE_PUNKTE_SHEET_ID, [
      [projektId, projektLabel, datum, punkt, 'offen'],
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + OFFENE_PUNKTE_SHEET_ID,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Anhaengen des offenen Punkts.', details: err.message }) };
  }
};
