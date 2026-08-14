const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function (Skill 6: Newsletter-Copy-Draft): generiert Fliesstext
// und Call-to-Action fuer ein bereits im Redaktionsplan eingeplantes Thema,
// auf Basis von Kundenprofil (Tonalitaet, Brand Voice, Pflichtangaben) und
// dem Thema/Quelle-Text der jeweiligen Redaktionsplan-Zeile.
//
// Kategorie B: Redaktionsplan wird ueber das Kundenprofil-Register gefunden
// (nie per Namenssuche, sobald registriert). Der generierte Copy-Text wird
// NICHT als neue Zeile angehaengt, sondern in zusaetzliche Spalten (Copy-
// Text, Call-to-Action, Copy erstellt am) derselben Zeile geschrieben -
// die Zeile bleibt inhaltlich das eine Thema, nur ergaenzt.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
  sheetsWriteValues,
  sheetsBatchUpdate,
  getFirstSheetId,
  parseJsonFromModelText,
  callClaude,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const EXTRA_HEADER = ['Copy-Text', 'Call-to-Action', 'Copy erstellt am'];

function buildProfileText(rows) {
  return rows
    .slice(1)
    .filter((r) => r[0] && r[1])
    .map((r) => '- ' + r[0] + ': ' + r[1])
    .join('\n');
}

function buildPrompt(profileText, thema, quelle) {
  return (
    'Du schreibst den Fliesstext fuer einen Abschnitt eines Kunden-Newsletters.\n\n' +
    'Kundenprofil (Tonalitaet, Brand Voice, Pflichtangaben, Zielgruppe):\n' +
    (profileText || '(keine Angaben)') + '\n\n' +
    'Thema dieser Ausgabe: ' + thema + '\n' +
    (quelle ? 'Quelle/Kontext: ' + quelle + '\n' : '') + '\n' +
    'Schreibe eine kurze Ueberschrift (max. 8 Woerter, ohne Punkt am Ende) sowie einen Newsletter-Abschnitt ' +
    '(Fliesstext, 80-150 Woerter) passend zur Tonalitaet aus dem Kundenprofil, ' +
    'plus genau 3 unterschiedliche Call-to-Action-Varianten zum Testen (je max. 6 Woerter, z.B. "Jetzt entdecken", ' +
    '"Jetzt sichern", "Mehr erfahren") - variiere den Ansatz (z.B. neugierig, dringlich, direkt).\n\n' +
    'Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, kein Fliesstext drumherum, keine Code-Zaeune) in genau diesem Format:\n' +
    '{"ueberschrift": "...", "copyText": "...", "ctas": ["...", "...", "..."]}'
  );
}

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
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
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden. Es muss zuerst ein Thema eingeplant sein (Skill 1/2).' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:AA500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer - kein Thema fuer Copy-Draft vorhanden.' }) };
    }

    // Kopfzeile ggf. um Copy-Spalten (E-G) ergaenzen, ohne bestehende Spalten A-D anzufassen.
    const header = rows[0];
    if (header.length < 7 || !header[4]) {
      const newHeader = header.slice(0, 4).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:G1');
    }
    // Spalte AA (Ueberschrift) ggf. separat ergaenzen, ohne die dazwischen
    // liegenden, von anderen Skills genutzten Spalten anzufassen. Das Grid
    // muss dafuer ggf. erst ueber 26 Spalten hinaus erweitert werden
    // (Google Sheets legt neue Sheets standardmaessig nur mit 26 Spalten an).
    if (!header[26]) {
      const sheetId = await getFirstSheetId(accessToken, redaktionsplanId);
      if (sheetId !== undefined && sheetId !== null) {
        try {
          await sheetsBatchUpdate(accessToken, redaktionsplanId, [
            { appendDimension: { sheetId: sheetId, dimension: 'COLUMNS', length: 5 } },
          ]);
        } catch (err) {
          // Grid ggf. schon breit genug - dann einfach weitermachen.
        }
      }
      await sheetsWriteValues(accessToken, redaktionsplanId, [['Ueberschrift']], 'AA1');
    }

    // Zielzeile bestimmen: entweder exakter Thema-Treffer, oder erste Zeile
    // ohne bisherigen Copy-Text (Spalte E leer).
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasCopy = row[4] && String(row[4]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (!hasCopy) {
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
            : 'Kein offenes Thema ohne Copy-Text im Redaktionsplan gefunden.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = targetRow[1];
    const quelle = targetRow[2] || '';

    const prompt = buildPrompt(profileText, thema, quelle);
    const modelText = await callClaude(prompt);

    let copy;
    try {
      copy = parseJsonFromModelText(modelText);
    } catch (err) {
      throw new Error('Antwort des Modells konnte nicht als JSON gelesen werden: ' + modelText);
    }
    if (!copy || !copy.copyText) {
      throw new Error('Modell hat keinen verwertbaren Copy-Text geliefert.');
    }
    var ctaTexts = Array.isArray(copy.ctas) ? copy.ctas.filter(Boolean) : (copy.cta ? [copy.cta] : []);
    // Erste Variante ist per Default ausgewaehlt, damit sofort etwas
    // uebernommen werden kann, ohne dass der Nutzer erst manuell auswaehlen muss.
    var ctas = ctaTexts.map(function (text, idx) { return { text: text, ausgewaehlt: idx === 0 }; });

    const sheetRowNumber = targetIndex + 1; // 1-basiert, Header ist Zeile 1
    const ueberschrift = copy.ueberschrift || '';
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[copy.copyText, JSON.stringify(ctas), new Date().toISOString()]],
      'E' + sheetRowNumber + ':G' + sheetRowNumber
    );
    if (ueberschrift) {
      await sheetsWriteValues(accessToken, redaktionsplanId, [[ueberschrift]], 'AA' + sheetRowNumber);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        ueberschrift: ueberschrift,
        copyText: copy.copyText,
        ctas: ctas,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Copy-Draft.', details: err.message }) };
  }
};
