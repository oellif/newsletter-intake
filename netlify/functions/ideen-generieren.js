const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function: Skill 2 - automatische Ideen-Generierung.
//
// Liest das Kundenprofil (Skill 0) und den bisherigen Redaktionsplan
// (Skill 1) eines Kunden, schickt beides an die Claude API und laesst
// daraus 5 konkrete Themenvorschlaege erarbeiten - entweder saisonal
// passend oder noch nicht verwendet. Die Vorschlaege landen im
// Ideenpool-Sheet mit Status "offen" und muessen erst ueber die
// Checkbox-Freigabeseite (ideen-freigeben) bestaetigt werden, bevor sie
// in den Redaktionsplan uebernommen werden.
//
// Kategorie B der Ablage- & Versionsregel v1: Redaktionsplan/Ideenpool
// werden bevorzugt ueber die im Kundenprofil-Register hinterlegte Datei-ID
// gefunden statt per Namenssuche (siehe lib/google.js).
//
// Laeuft unabhaengig davon, ob ueberhaupt manuelle Rohinputs (Skill 1)
// vorliegen - das Kundenprofil allein reicht als Grundlage.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  findOrCreateSheetByRegister,
  sheetsReadValues,
  sheetsAppendValues,
  parseJsonFromModelText,
  callClaude,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const IDEENPOOL_HEADER = ['Datum', 'Thema-Vorschlag', 'Begruendung', 'Status'];

function buildProfileText(rows) {
  // rows: Feld/Wert-Paare aus dem Kundenprofil-Sheet (erste Zeile = Kopfzeile)
  return rows
    .slice(1)
    .filter((r) => r[0] && r[1])
    .map((r) => '- ' + r[0] + ': ' + r[1])
    .join('\n');
}

function buildUsedThemesText(redaktionsplanRows, ideenpoolRows) {
  var themen = [];
  if (redaktionsplanRows && redaktionsplanRows.length > 1) {
    themen = themen.concat(redaktionsplanRows.slice(1).map((r) => r[1]).filter(Boolean));
  }
  // Auch bereits frueher vorgeschlagene Ideenpool-Themen ausschliessen -
  // unabhaengig vom Status (offen/freigegeben/verworfen). Besonders
  // verworfene Vorschlaege sollen nie wieder vorgeschlagen werden.
  if (ideenpoolRows && ideenpoolRows.length > 1) {
    themen = themen.concat(ideenpoolRows.slice(1).map((r) => r[1]).filter(Boolean));
  }
  if (!themen.length) {
    return '(noch keine bisherigen Themen erfasst)';
  }
  return themen
    .slice(-60)
    .map((t) => '- ' + t)
    .join('\n');
}

function buildPrompt(profileText, usedThemesText) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    'Du hilfst einer Agentur bei der Themenfindung fuer den naechsten Newsletter eines Kunden.\n\n' +
    'Kundenprofil:\n' + (profileText || '(keine Angaben)') + '\n\n' +
    'Bereits in frueheren Ausgaben verwendete Themen (bitte nicht wiederholen):\n' + usedThemesText + '\n\n' +
    'Heutiges Datum: ' + today + '\n\n' +
    'Schlage genau 5 neue, konkrete Themenideen fuer die naechste Newsletter-Ausgabe vor. ' +
    'Jede Idee soll entweder jahreszeitlich/saisonal passend sein ODER ein Aspekt sein, der in den bisherigen Themen noch nicht vorkam. ' +
    'Beruecksichtige Tonalitaet und wiederkehrende Rubriken aus dem Kundenprofil, falls vorhanden.\n\n' +
    'Antworte AUSSCHLIESSLICH mit einem JSON-Array (kein Markdown, kein Fliesstext, keine Code-Zaeune) in genau diesem Format:\n' +
    '[{"thema": "Kurzer, konkreter Themenname", "begruendung": "Ein Satz, warum dieses Thema jetzt passt"}]'
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
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname ist Pflichtfeld.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }),
    };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error:
            'Kein Kundenordner fuer "' + kundenname + '" gefunden. Bitte zuerst die Neukundenanlage (Skill 0) ausfuellen.',
        }),
      };
    }

    // Kundenprofil lesen (Pflicht - ohne Profil keine sinnvolle Grundlage).
    // Gleichzeitig die Quelle des AKTUELL-Registers fuer diesen Kunden.
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofilSheet ? kundenprofilSheet.id : null;
    let profileText = '';
    if (kundenprofilSheet) {
      const profileRows = await sheetsReadValues(accessToken, kundenprofilSheet.id, 'A1:B30');
      profileText = buildProfileText(profileRows);
    }

    // Redaktionsplan lesen (optional - kann leer/nicht vorhanden sein).
    // Bevorzugt ueber das Register, sonst Bootstrap per Namenssuche.
    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    let planRows = null;
    if (redaktionsplanId) {
      planRows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:D500');
    }

    // Bestehenden Ideenpool ebenfalls lesen (falls schon vorhanden), damit
    // bereits frueher vorgeschlagene Themen - egal ob offen, freigegeben
    // oder verworfen - nicht noch einmal vorgeschlagen werden.
    let ideenpoolRowsExisting = null;
    const existingIdeenpoolId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Ideenpool_ID');
    if (existingIdeenpoolId) {
      ideenpoolRowsExisting = await sheetsReadValues(accessToken, existingIdeenpoolId, 'A1:D1000');
    }

    const usedThemesText = buildUsedThemesText(planRows, ideenpoolRowsExisting);
    const prompt = buildPrompt(profileText, usedThemesText);
    const modelText = await callClaude(prompt);

    let ideas;
    try {
      ideas = parseJsonFromModelText(modelText);
    } catch (err) {
      throw new Error('Antwort des Modells konnte nicht als JSON gelesen werden: ' + modelText);
    }
    if (!Array.isArray(ideas) || !ideas.length) {
      throw new Error('Modell hat keine verwertbaren Themenvorschlaege geliefert.');
    }

    const ideenpoolId = await findOrCreateSheetByRegister(
      accessToken,
      folder.id,
      kundenprofilId,
      'AKTUELL_Ideenpool_ID',
      'Ideenpool_' + folderName,
      IDEENPOOL_HEADER
    );

    const timestamp = new Date().toISOString();
    const rows = ideas.map((idea) => [timestamp, idea.thema || '', idea.begruendung || '', 'offen']);
    await sheetsAppendValues(accessToken, ideenpoolId, rows);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: ideas.length,
        ideas,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + ideenpoolId,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Fehler bei der Verarbeitung.', details: err.message }),
    };
  }
};
