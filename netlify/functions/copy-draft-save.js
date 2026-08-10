// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260805
//
// Netlify Function (Teil der neuen editierbaren Copy-Draft-Seite,
// orchestrator.html): speichert manuell bearbeitete Werte (Copy-Text,
// Call-to-Action, Betreff-Varianten) fuer ein bereits vorhandenes Thema
// zurueck in dieselbe Redaktionsplan-Zeile - ueberschreibt NUR die
// Inhalts-Spalten E, F, H, laesst die "erstellt am"-Zeitstempel (G, I)
// unangetastet, da diese den Zeitpunkt der urspruenglichen KI-Erzeugung
// dokumentieren, nicht den der manuellen Bearbeitung.
//
// Hinweis: Ein bereits gebautes Klaviyo-Template (Skill 8) wird hier NICHT
// automatisch aktualisiert - das ist bewusst ausgeklammert und wird in
// einem spaeteren Schritt behandelt (siehe Redaktionsplan-Umbau, Punkt 5).
//
// Nur diese eine Zeile wird veraendert - keine neue Zeile, kein Snapshot.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
  sheetsWriteValues,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

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

  const kundenname = String(body.kundenname || '').trim();
  const thema = String(body.thema || '').trim();
  const copyText = String(body.copyText || '');
  const ctas = Array.isArray(body.ctas) ? body.ctas : [];
  const variants = Array.isArray(body.variants) ? body.variants : [];
  const betreffModus = String(body.betreffModus || '').trim(); // 'ab' oder 'einzel', leer = unveraendert lassen

  if (!kundenname || !thema) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname und Thema sind Pflichtfelder.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenordner fuer "' + kundenname + '" gefunden.' }) };
    }
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofilSheet ? kundenprofilSheet.id : null;

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:Z500');
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i][1] === thema) { targetIndex = i; break; }
    }
    if (targetIndex === -1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Thema "' + thema + '" wurde im Redaktionsplan nicht gefunden.' }) };
    }

    const sheetRowNumber = targetIndex + 1;
    // Spalte E: Copy-Text. Spalte F: CTA-Varianten (JSON-Array). Spalte H: Betreff-Varianten (JSON).
    await sheetsWriteValues(accessToken, redaktionsplanId, [[copyText, JSON.stringify(ctas)]], 'E' + sheetRowNumber + ':F' + sheetRowNumber);
    if (variants.length) {
      await sheetsWriteValues(accessToken, redaktionsplanId, [[JSON.stringify(variants)]], 'H' + sheetRowNumber + ':H' + sheetRowNumber);
    }
    if (betreffModus) {
      // Spalte Z ggf. per Header ergaenzen (nicht destruktiv), analog zur
      // Versand-Datum-Spalte Y.
      const headerRow = rows[0] || [];
      if (!headerRow[25] || !String(headerRow[25]).trim()) {
        await sheetsWriteValues(accessToken, redaktionsplanId, [['Betreff-Modus']], 'Z1');
      }
      await sheetsWriteValues(accessToken, redaktionsplanId, [[betreffModus]], 'Z' + sheetRowNumber);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Speichern.', details: err.message }) };
  }
};
