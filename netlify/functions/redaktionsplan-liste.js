const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260805
//
// Netlify Function fuer die neue Redaktionsplan-Ansicht (HTML-Seite
// redaktionsplan.html): liest ALLE Zeilen des Redaktionsplans eines
// Kunden (nicht nur die fuer eine bestimmte Stufe offenen wie
// themen-liste.js) und liefert pro Zeile den Kernstatus zurueck - vor
// allem, ob fuer dieses Thema schon ein Copy-Draft erstellt wurde.
//
// Nur lesend - schreibt oder veraendert nichts.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

// row = ['Datum'0,'Thema'1,'Quelle'2,'?'3,'Copy-Text'4,'CTA'5,'Copy erstellt am'6,
//        'Betreff-Varianten'7,'Betreff erstellt am'8,'Template-ID'9,'Template erstellt am'10, ...]
function hasValue(row, i) {
  return !!(row[i] && String(row[i]).trim());
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

  const q = event.queryStringParameters || {};
  const kundenname = String(q.kundenname || '').trim();
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'kundenname ist Pflichtparameter.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return { statusCode: 200, headers, body: JSON.stringify({ items: [], hinweis: 'Kein Kundenordner fuer "' + kundenname + '" gefunden.' }) };
    }

    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofilSheet ? kundenprofilSheet.id : null;

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 200, headers, body: JSON.stringify({ items: [], hinweis: 'Noch kein Redaktionsplan fuer "' + kundenname + '" vorhanden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:Z500');
    const items = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      items.push({
        thema: row[1],
        datum: row[0] || '',
        quelle: row[2] || '',
        copyErstellt: hasValue(row, 4),
        copyErstelltAm: row[6] || '',
        // Spalte Y (Index 24): geplantes Versanddatum - manuell in der
        // Redaktionsplan-Ansicht gepflegt, siehe
        // redaktionsplan-versand-datum-save.js.
        versandDatum: row[24] || '',
      });
    }
    // Neueste zuerst (Eintragsdatum absteigend).
    items.sort(function (a, b) {
      return (b.datum || '').localeCompare(a.datum || '');
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ items: items, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Laden des Redaktionsplans.', details: err.message }) };
  }
};
