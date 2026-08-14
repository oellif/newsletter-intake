const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260803
//
// Netlify Function (Hilfsfunktion fuer Autopilot + alle Einzel-Skills mit
// Thema-Auswahl): liest die Redaktionsplan-Zeilen, die fuer eine bestimmte
// Ausbau-Stufe (?stufe=...) noch offen sind, und liefert sie als Liste
// zurueck. Damit muss auf keiner Seite mehr ein Thema exakt abgetippt
// werden - das Thema steht ja schon im Redaktionsplan, hier wird es nur
// noch zur Auswahl angezeigt.
//
// Stufen (jede spiegelt die "Zielzeile bestimmen"-Logik der jeweiligen
// Skill-Function 1:1 wider):
//   copy       - noch kein Copy-Text (Skill 6 offen)            [Default]
//   betreff    - Copy-Text da, noch keine Betreff-Varianten (Skill 7 offen)
//   template   - Copy+Betreff da, noch kein Klaviyo-Template (Skill 8 offen)
//   testmail   - Template da, noch keine Testmail (Skill 9 offen)
//   qa         - Template da, noch kein QA-Check (Skill 11 offen)
//   campaign   - Template+QA da, noch keine Kampagne (Skill 12 offen)
//   vorschau   - Template da, noch keine Kundenvorschau (Skill 13 offen)
//   report     - Kampagne da, noch kein Report (Skill 14 offen)
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
//        'Betreff-Varianten'7,'Betreff erstellt am'8,'Template-ID'9,'Template erstellt am'10,
//        'Test-Kampagne-ID'11,'Testmail gesendet am'12,'QA-Ergebnis'13,'QA am'14,
//        'Kampagne-ID'15,'Kampagne am'16,'Kundenvorschau'17,...,'Report'23]
function isOpenForStufe(row, stufe) {
  var has = function (i) { return !!(row[i] && String(row[i]).trim()); };
  switch (stufe) {
    case 'betreff': return has(4) && !has(7);
    case 'template': return has(4) && has(7) && !has(9);
    case 'testmail': return has(9) && !has(11);
    case 'qa': return has(9) && !has(13);
    case 'campaign': return has(9) && has(13) && !has(15);
    case 'vorschau': return has(9) && !has(17);
    case 'report': return has(15) && !has(23);
    case 'copy':
    default:
      return !has(4);
  }
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
  const stufe = String(q.stufe || 'copy').trim();
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
      return { statusCode: 200, headers, body: JSON.stringify({ themen: [], hinweis: 'Kein Kundenordner fuer "' + kundenname + '" gefunden.' }) };
    }

    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofilSheet ? kundenprofilSheet.id : null;

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 200, headers, body: JSON.stringify({ themen: [], hinweis: 'Noch kein Redaktionsplan fuer "' + kundenname + '" vorhanden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:X500');
    const themen = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      if (!isOpenForStufe(row, stufe)) continue; // fuer diese Stufe schon erledigt
      themen.push({
        thema: row[1],
        quelle: row[2] || '',
        datum: row[0] || '',
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ themen: themen, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Laden der Themenliste.', details: err.message }) };
  }
};
