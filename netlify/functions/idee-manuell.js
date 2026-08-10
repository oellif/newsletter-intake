// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function: Skill 1 - manuelles Ideen-Textfeld.
//
// Nimmt Kundenname + freien Text (fertiger Text, Ueberschrift oder nur
// Stichworte/Aktion/Rabatt/neues Produkt) entgegen und traegt ihn OHNE
// weitere Freigabe direkt als neue Zeile in das Redaktionsplan-Sheet des
// jeweiligen Kunden ein. Die manuelle Eingabe ist selbst schon die
// Entscheidung - kein zusaetzlicher Checkbox-Schritt noetig (im Unterschied
// zu Skill 2, den automatisch generierten Vorschlaegen).
//
// Kategorie B der Ablage- & Versionsregel v1 (fortlaufende Liste): das
// Redaktionsplan-Sheet bleibt eine stabile Datei (gleicher Name, gleiche
// ID) - kein Snapshot pro einzelner Zeile, dafuer wird die Datei ab jetzt
// bevorzugt ueber die im Kundenprofil hinterlegte Datei-ID gefunden statt
// per Namenssuche (siehe findOrCreateSheetByRegister in lib/google.js).
//
// Der Kundenordner muss bereits existieren (von Skill 0 angelegt) - dieses
// Skill legt keine neuen Kundenordner an, sondern findet den bestehenden
// wieder und haengt bei Bedarf ein neues "Redaktionsplan"-Sheet dort ein.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findOrCreateSheetByRegister,
  sheetsAppendValues,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID; // Ordner "nfy_46"
const REDAKTIONSPLAN_HEADER = ['Datum', 'Thema / Text', 'Quelle', 'Status'];

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
  const text = String(data.text || '').trim();

  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname ist Pflichtfeld.' }) };
  }
  if (!text) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Text/Idee ist Pflichtfeld.' }) };
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
            'Kein Kundenordner fuer "' + kundenname + '" gefunden. Bitte zuerst die Neukundenanlage (Skill 0) fuer diesen Kunden ausfuellen.',
        }),
      };
    }

    // Kundenprofil-ID fuer das AKTUELL-Register (kann fehlen, falls Skill 0
    // aus irgendeinem Grund uebersprungen wurde - dann faellt die
    // Register-Funktion automatisch auf reine Namenssuche zurueck).
    const kundenprofil = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofil ? kundenprofil.id : null;

    const spreadsheetId = await findOrCreateSheetByRegister(
      accessToken,
      folder.id,
      kundenprofilId,
      'AKTUELL_Redaktionsplan_ID',
      'Redaktionsplan_' + folderName,
      REDAKTIONSPLAN_HEADER
    );

    const row = [
      new Date().toISOString(),
      text,
      'manuell',
      'im Plan (direkt uebernommen)',
    ];
    await sheetsAppendValues(accessToken, spreadsheetId, [row]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + spreadsheetId,
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
