const { requireAuth } = require('./lib/auth');
// Netlify Function: Erstellt oder aktualisiert einen Kunden in der
// Master-Kundenliste (Google Sheet). Sucht per Name — existiert der Kunde
// bereits, wird die Zeile aktualisiert; sonst wird eine neue Zeile angehaengt.
// Umgebungsvariable: MASTER_KUNDEN_SHEET_ID

const {
  getAccessToken,
  sheetsReadValues,
  sheetsWriteValues,
  sheetsAppendValues,
} = require('./lib/google');

const SHEET_ID = process.env.MASTER_KUNDEN_SHEET_ID || '1CveKc783N8K_LxKvM2weZA4-rXxMAs6inB4jUCwpXrg';

const HEADER = [
  'ID', 'Name', 'E-Mail', 'Telefon', 'Adresse', 'PLZ', 'Stadt',
  'Website', 'Ansprechpartner', 'Notizen', 'Erstellt',
];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON.' }) };
  }

  if (!data.name || !String(data.name).trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name ist Pflichtfeld.' }) };
  }

  const kundenname = String(data.name).trim();

  try {
    const accessToken = await getAccessToken();
    const rows = await sheetsReadValues(accessToken, SHEET_ID, 'A1:K500');

    // Header anlegen falls Sheet leer
    if (!rows.length) {
      await sheetsWriteValues(accessToken, SHEET_ID, [HEADER], 'A1');
    }

    // Vorhandene Zeile suchen (case-insensitive Name-Match)
    const dataRows = rows.length > 1 ? rows.slice(1) : [];
    var existingRowIndex = -1;
    for (var i = 0; i < dataRows.length; i++) {
      if (dataRows[i][1] && dataRows[i][1].toLowerCase() === kundenname.toLowerCase()) {
        existingRowIndex = i + 2; // +1 Header, +1 wegen 1-basiertem Index
        break;
      }
    }

    var existingRow = existingRowIndex > 0 ? dataRows[existingRowIndex - 2] : null;
    var id       = (existingRow && existingRow[0])  || generateId();
    var erstellt = (existingRow && existingRow[10]) || new Date().toISOString().slice(0, 10);

    var newRow = [
      id,
      kundenname,
      data.email           || '',
      data.telefon         || '',
      data.adresse         || '',
      data.plz             || '',
      data.stadt           || '',
      data.website         || '',
      data.ansprechpartner || '',
      data.notizen         || '',
      erstellt,
    ];

    if (existingRowIndex > 0) {
      var range = 'A' + existingRowIndex + ':K' + existingRowIndex;
      await sheetsWriteValues(accessToken, SHEET_ID, [newRow], range);
    } else {
      await sheetsAppendValues(accessToken, SHEET_ID, [newRow]);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, id: id }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
