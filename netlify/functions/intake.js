const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Netlify Function: nimmt Formulardaten aus der Neukundenanlage entgegen,
// legt automatisch einen Kundenordner in Google Drive an und schreibt
// alle Angaben in ein Kundenprofil-Sheet (Feld/Wert).
//
// Kategorie A der Ablage- & Versionsregel v1 (lebendes Einzeldokument):
// das Kundenprofil-Sheet ist die _AKTUELL-Datei. Existiert es schon
// (erneuter Lauf fuer denselben Kunden), wird VOR dem Ueberschreiben ein
// datierter Schnappschuss des alten Stands ins Archiv kopiert, danach wird
// dieselbe Datei (gleiche ID, gleicher Name) mit den neuen Werten
// ueberschrieben - es entsteht nie eine zweite Kundenprofil-Datei
// (frueher z.B. "Kundenprofil_eydl_TEST" + "..._v2").
//
// Authentifizierung laeuft ueber einen OAuth-Refresh-Token des echten
// Google-Kontos (florian.oellinger@eydl.shop), NICHT ueber ein Service
// Account. Grund: Service Accounts haben 0 GB Drive-Speicherkontingent,
// wodurch das Anlegen von Dateien selbst in freigegebenen Ordnern mit
// "storageQuotaExceeded" fehlschlaegt. Mit dem Refresh-Token gehoeren die
// erzeugten Dateien dem echten Nutzer (15 GB Kontingent).

const {
  getAccessToken,
  sanitizeFolderName,
  driveCreateFile,
  findKundenordner,
  findKundenprofil,
  sheetsWriteValues,
  setRegisterValue,
  archiveSnapshot,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID; // Ordner "nfy_46"

function buildRows(data) {
  const rows = [
    ['Feld', 'Wert'],
    ['Kundenname', data.kundenname || ''],
    ['Website', data.website || ''],
    ['Formular-Umfang', data.modus || ''],
    ['Brand Voice Stichworte', data.brandvoiceStichworte || ''],
    ['Brand Voice Beispielsatz', data.brandvoiceBeispiel || ''],
    ['Freigabe-Kanal', data.freigabe || ''],
    ['Pflichtangaben (Basic)', data.pflichtangabenBasic || ''],
  ];

  if (data.modus === 'Umfassend') {
    rows.push(
      ['Zielgruppen', data.zielgruppen || ''],
      ['Segment-Tonalitaet', data.segmentTonalitaet || ''],
      ['Textbeispiele/Links', data.textbeispiele || ''],
      ['Tabu-Begriffe', data.tabu || ''],
      ['Emoji-Nutzung', (data.emoji || '') + ' ' + (data.emojiDetails || '')],
      ['Impressum-Snippet', data.impressum || ''],
      ['Abmeldelink-Text', data.abmeldelink || ''],
      ['Laenderspezifische Besonderheiten', data.laenderBesonderheiten || ''],
      ['Listen-Mapping', data.listenMapping || ''],
      ['Wiederkehrende Rubriken', data.rubriken || ''],
      ['Versandfrequenz', data.frequenz || ''],
      ['Saisonale Besonderheiten', data.saison || ''],
      ['Ansprechpartner Freigaben', data.ansprechpartner || ''],
      ['Uebliche Vorlaufzeit', data.vorlaufzeit || '']
    );
  }

  rows.push(['Zuletzt aktualisiert am', new Date().toISOString()]);
  rows.push(['Status', 'Automatisch angelegt/aktualisiert via Custom-HTML-Formular']);
  return rows;
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

  if (!data.kundenname || !String(data.kundenname).trim()) {
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
    const folderName = sanitizeFolderName(data.kundenname);
    const sheetName = 'Kundenprofil_' + folderName;
    const rows = buildRows(data);

    // 1) Kundenordner finden oder anlegen (kein Duplikat bei erneutem Lauf)
    let folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      folder = await driveCreateFile(accessToken, {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [PARENT_FOLDER_ID],
      });
    }

    // 2) Kundenprofil-Sheet finden (Bootstrap-Namenssuche, einmalig) oder neu anlegen
    const existing = await findKundenprofil(accessToken, folder.id, folderName);

    let spreadsheetId;
    if (existing) {
      // Kategorie A: vor dem Ueberschreiben den alten Stand archivieren
      await archiveSnapshot(accessToken, existing.id, sheetName);
      await sheetsWriteValues(accessToken, existing.id, rows);
      spreadsheetId = existing.id;
    } else {
      const created = await driveCreateFile(accessToken, {
        name: sheetName,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folder.id],
      });
      await sheetsWriteValues(accessToken, created.id, rows);
      spreadsheetId = created.id;
    }

    // 3) Sich selbst im AKTUELL-Register eintragen (Punkt 2 + 4 der Regel)
    await setRegisterValue(accessToken, spreadsheetId, 'AKTUELL_Kundenprofil_ID', spreadsheetId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        folderId: folder.id,
        folderUrl: folder.webViewLink || ('https://drive.google.com/drive/folders/' + folder.id),
        spreadsheetId: spreadsheetId,
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
