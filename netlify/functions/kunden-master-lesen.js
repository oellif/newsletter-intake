// Netlify Function: Liest alle Eintraege aus der Master-Kundenliste (Google Sheet).
// Gibt alle Felder zurueck: ID, Name, E-Mail, Telefon, Adresse, PLZ, Stadt,
// Website, Ansprechpartner, Notizen, Erstellt.
// Umgebungsvariable: MASTER_KUNDEN_SHEET_ID

const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHEET_ID = process.env.MASTER_KUNDEN_SHEET_ID;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  if (!SHEET_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'MASTER_KUNDEN_SHEET_ID nicht gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const rows = await sheetsReadValues(accessToken, SHEET_ID, 'A1:K500');

    if (rows.length < 2) {
      return { statusCode: 200, headers, body: JSON.stringify({ kunden: [] }) };
    }

    // Zeile 1 = Header, Zeile 2+ = Daten
    const kunden = rows.slice(1)
      .filter(function (r) { return r[1]; })
      .map(function (r) {
        return {
          id:              r[0]  || '',
          name:            r[1]  || '',
          email:           r[2]  || '',
          telefon:         r[3]  || '',
          adresse:         r[4]  || '',
          plz:             r[5]  || '',
          stadt:           r[6]  || '',
          website:         r[7]  || '',
          ansprechpartner: r[8]  || '',
          notizen:         r[9]  || '',
          erstellt:        r[10] || '',
        };
      });

    return { statusCode: 200, headers, body: JSON.stringify({ kunden: kunden }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
