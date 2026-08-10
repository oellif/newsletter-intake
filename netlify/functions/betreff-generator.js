// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function (Skill 7: Betreff-A/B-Test-Generator): erzeugt 3-5
// Varianten fuer Betreffzeile + Preview-Text zu einem Thema, das bereits
// einen Copy-Text hat (Skill 6), passend zur Zielgruppen-Tonalitaet aus
// dem Kundenprofil.
//
// Kategorie B: Redaktionsplan wird ueber das Kundenprofil-Register
// gefunden. Die Varianten werden als JSON-Array in einer zusaetzlichen
// Spalte (Betreff-Varianten) derselben Zeile gespeichert - keine neue
// Zeile, kein Snapshot.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
  sheetsWriteValues,
  parseJsonFromModelText,
  callClaude,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const EXTRA_HEADER = ['Betreff-Varianten (JSON)', 'Betreff erstellt am'];

function buildProfileText(rows) {
  return rows
    .slice(1)
    .filter((r) => r[0] && r[1])
    .map((r) => '- ' + r[0] + ': ' + r[1])
    .join('\n');
}

function buildPrompt(profileText, thema, copyText) {
  return (
    'Du erstellst Betreffzeilen-Varianten fuer einen A/B-Test eines Newsletters.\n\n' +
    'Kundenprofil (Tonalitaet, Zielgruppe):\n' + (profileText || '(keine Angaben)') + '\n\n' +
    'Thema: ' + thema + '\n' +
    'Bereits geschriebener Newsletter-Text (Kontext):\n' + (copyText || '(kein Copy-Text vorhanden)') + '\n\n' +
    'Erzeuge genau 4 unterschiedliche Varianten fuer Betreffzeile + Preview-Text (Vorschautext). ' +
    'Die Betreffzeile soll max. 60 Zeichen, der Preview-Text max. 90 Zeichen lang sein. ' +
    'Variiere den Ansatz (z.B. neugierig machend, direkt/nutzenorientiert, dringlich/zeitlich begrenzt, persoenlich/emotional), ' +
    'passend zur Tonalitaet aus dem Kundenprofil.\n\n' +
    'Antworte AUSSCHLIESSLICH mit einem JSON-Array (kein Markdown, kein Fliesstext, keine Code-Zaeune) in genau diesem Format:\n' +
    '[{"betreff": "...", "preview": "...", "ansatz": "kurze Bezeichnung des Ansatzes"}]'
  );
}

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

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON im Request-Body.' }) };
  }

  const kundenname = String(data.kundenname || '').trim();
  const themaFilter = String(data.thema || '').trim();
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname ist Pflichtfeld.' }) };
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
    let profileText = '';
    if (kundenprofilSheet) {
      const profileRows = await sheetsReadValues(accessToken, kundenprofilSheet.id, 'A1:B30');
      profileText = buildProfileText(profileRows);
    }

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:J500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Kopfzeile ggf. um Betreff-Spalten (H-I) ergaenzen, ohne A-G anzufassen.
    const header = rows[0];
    if (header.length < 9 || !header[7]) {
      const newHeader = header.slice(0, 7).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:I1');
    }

    // Zielzeile: hat bereits Copy-Text (Spalte E), aber noch keine
    // Betreff-Varianten (Spalte H) - oder exakter Thema-Treffer.
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasCopy = row[4] && String(row[4]).trim();
      const hasBetreff = row[7] && String(row[7]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (hasCopy && !hasBetreff) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: themaFilter
            ? 'Thema "' + themaFilter + '" wurde im Redaktionsplan nicht gefunden.'
            : 'Kein Thema mit Copy-Text ohne Betreff-Varianten gefunden. Bitte zuerst Skill 6 (Copy-Draft) laufen lassen.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = targetRow[1];
    const copyText = targetRow[4] || '';

    const prompt = buildPrompt(profileText, thema, copyText);
    const modelText = await callClaude(prompt);

    let variants;
    try {
      variants = parseJsonFromModelText(modelText);
    } catch (err) {
      throw new Error('Antwort des Modells konnte nicht als JSON gelesen werden: ' + modelText);
    }
    if (!Array.isArray(variants) || !variants.length) {
      throw new Error('Modell hat keine verwertbaren Betreff-Varianten geliefert.');
    }

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[JSON.stringify(variants), new Date().toISOString()]],
      'H' + sheetRowNumber + ':I' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        variants: variants,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Betreff-Generator.', details: err.message }) };
  }
};
