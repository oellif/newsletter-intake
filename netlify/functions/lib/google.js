// Ablage- & Versionsregel v1 aktiv – umgestellt am 20260730
//
// Gemeinsame Hilfsfunktionen fuer Google Drive/Sheets, genutzt von den
// Skill-2-Functions (ideen-generieren, ideen-liste, ideen-freigeben) sowie
// (fuer die Register-Funktionen) von intake.js und idee-manuell.js.
// Bewusst getrennt von intake.js / idee-manuell.js (Skill 0 / Skill 1),
// damit Aenderungen hier die bereits funktionierenden Skills nicht anfassen.

async function getAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET oder GOOGLE_REFRESH_TOKEN sind nicht gesetzt (Netlify Umgebungsvariablen fehlen).'
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error('Token-Fehler: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function sanitizeFolderName(name) {
  return String(name || 'Unbenannt').replace(/[\\/:*?"<>|]/g, '-').trim();
}

function escapeForDriveQuery(name) {
  return String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveFindFile(accessToken, query) {
  const url =
    'https://www.googleapis.com/drive/v3/files?q=' +
    encodeURIComponent(query) +
    '&fields=files(id,name)&spaces=drive';
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Drive-Suche-Fehler: ' + JSON.stringify(data));
  }
  return data.files || [];
}

async function driveCreateFile(accessToken, body) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Drive-Fehler: ' + JSON.stringify(data));
  }
  return data;
}

// Kopiert eine Datei (fuer datierte Archiv-Schnappschuesse, Punkt 3 der
// Ablage- & Versionsregel v1). Der Snapshot ist danach ein unabhaengiges,
// eingefrorenes Sheet - keine Referenz auf das Original.
async function driveCopyFile(accessToken, fileId, body) {
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Drive-Kopier-Fehler: ' + JSON.stringify(data));
  }
  return data;
}

async function sheetsReadValues(accessToken, spreadsheetId, range) {
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '/values/' + encodeURIComponent(range),
    { headers: { Authorization: 'Bearer ' + accessToken } }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Sheets-Lese-Fehler: ' + JSON.stringify(data));
  }
  return data.values || [];
}

async function sheetsWriteValues(accessToken, spreadsheetId, rows, range) {
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' +
      spreadsheetId +
      '/values/' +
      encodeURIComponent(range || 'A1') +
      '?valueInputOption=RAW',
    {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Sheets-Schreib-Fehler: ' + JSON.stringify(data));
  }
  return data;
}

// Fuehrt beliebige batchUpdate-Requests aus (z.B. deleteDimension zum
// Loeschen von Zeilen). requests ist ein Array von Sheets-API-Request-
// Objekten, siehe https://developers.google.com/sheets/api/reference/rest.
async function sheetsBatchUpdate(accessToken, spreadsheetId, requests) {
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + ':batchUpdate',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: requests }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Sheets-BatchUpdate-Fehler: ' + JSON.stringify(data));
  }
  return data;
}

// Liefert die interne sheetId (gid) des ersten Tabs eines Spreadsheets -
// wird fuer deleteDimension-Requests benoetigt (die arbeiten nicht mit dem
// Namen "Tabelle1", sondern mit der numerischen gid).
async function getFirstSheetId(accessToken, spreadsheetId) {
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '?fields=sheets.properties',
    { headers: { Authorization: 'Bearer ' + accessToken } }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Sheets-Metadaten-Fehler: ' + JSON.stringify(data));
  }
  return data.sheets && data.sheets[0] && data.sheets[0].properties && data.sheets[0].properties.sheetId;
}

async function sheetsAppendValues(accessToken, spreadsheetId, rows) {
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' +
      spreadsheetId +
      '/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Sheets-Append-Fehler: ' + JSON.stringify(data));
  }
  return data;
}

// Sucht alle direkten Unterordner (Kundenordner) von parentFolderId, deren
// Name den Suchbegriff enthaelt (Gross-/Kleinschreibung ignoriert Drive
// automatisch bei "contains"). Genutzt vom internen "Kunde loeschen"-Tool
// fuer die Live-Trefferliste (z.B. "thi" -> "Thielemann").
async function driveSearchFoldersByNameContains(accessToken, parentFolderId, substring) {
  const q =
    "mimeType = 'application/vnd.google-apps.folder'" +
    " and '" + parentFolderId + "' in parents" +
    " and trashed = false" +
    " and name contains '" + escapeForDriveQuery(substring) + "'";
  return driveFindFile(accessToken, q);
}

// Verschiebt eine Drive-Datei/einen Ordner in den Papierkorb (NICHT
// endgueltig geloescht - 30 Tage lang wiederherstellbar). Trashing eines
// Ordners macht auch dessen Inhalt fuer normale Ansichten unsichtbar.
async function driveTrashFile(accessToken, fileId) {
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=id,name,trashed',
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Drive-Papierkorb-Fehler: ' + JSON.stringify(data));
  }
  return data;
}

async function findKundenordner(accessToken, parentFolderId, folderName) {
  const q =
    "name = '" + escapeForDriveQuery(folderName) + "'" +
    " and mimeType = 'application/vnd.google-apps.folder'" +
    " and '" + parentFolderId + "' in parents" +
    " and trashed = false";
  const files = await driveFindFile(accessToken, q);
  return files[0] || null;
}

async function findSheet(accessToken, folderId, sheetName) {
  const q =
    "name = '" + escapeForDriveQuery(sheetName) + "'" +
    " and mimeType = 'application/vnd.google-apps.spreadsheet'" +
    " and '" + folderId + "' in parents" +
    " and trashed = false";
  const files = await driveFindFile(accessToken, q);
  return files[0] || null;
}

async function findOrCreateSheet(accessToken, folderId, sheetName, header) {
  const existing = await findSheet(accessToken, folderId, sheetName);
  if (existing) {
    return existing.id;
  }
  const created = await driveCreateFile(accessToken, {
    name: sheetName,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: [folderId],
  });
  await sheetsWriteValues(accessToken, created.id, [header]);
  return created.id;
}

// Findet das Kundenprofil-Sheet eines Kunden (Bootstrap-Namenssuche - das
// Kundenprofil selbst ist der Ort, an dem das AKTUELL-Register liegt, kann
// also nicht ueber das Register gefunden werden, siehe Punkt 4 der Regel).
async function findKundenprofil(accessToken, folderId, folderName) {
  return findSheet(accessToken, folderId, 'Kundenprofil_' + folderName);
}

// --- AKTUELL-Register (Ablage- & Versionsregel v1, Punkt 2 + 4) ---------
// Das Register liegt als zusaetzliche Feld/Wert-Zeilen direkt im
// Kundenprofil-Sheet, z.B. "AKTUELL_Redaktionsplan_ID" -> "<file-id>".

async function getRegisterValue(accessToken, kundenprofilId, key) {
  if (!kundenprofilId) return null;
  const rows = await sheetsReadValues(accessToken, kundenprofilId, 'A1:B300');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === key) {
      return rows[i][1] || null;
    }
  }
  return null;
}

async function setRegisterValue(accessToken, kundenprofilId, key, value) {
  if (!kundenprofilId) return;
  const rows = await sheetsReadValues(accessToken, kundenprofilId, 'A1:B300');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === key) {
      await sheetsWriteValues(accessToken, kundenprofilId, [[value]], 'B' + (i + 1));
      return;
    }
  }
  await sheetsAppendValues(accessToken, kundenprofilId, [[key, value]]);
}

// Findet ein Sheet (Redaktionsplan/Ideenpool) bevorzugt ueber die im
// Kundenprofil-Register hinterlegte Datei-ID - niemals ueber Namenssuche,
// sobald die ID einmal registriert ist (Punkt 2). Nur beim allerersten Mal
// (Register noch leer) wird einmalig per Name gesucht/angelegt und die ID
// danach im Register gespeichert.
async function findOrCreateSheetByRegister(accessToken, folderId, kundenprofilId, registerKey, sheetName, header) {
  const registeredId = await getRegisterValue(accessToken, kundenprofilId, registerKey);
  if (registeredId) {
    return registeredId;
  }
  const sheetId = await findOrCreateSheet(accessToken, folderId, sheetName, header);
  if (kundenprofilId) {
    await setRegisterValue(accessToken, kundenprofilId, registerKey, sheetId);
  }
  return sheetId;
}

// Zeitstempel-Suffix _JJJJMMTT_HHMM (Ablage- & Versionsregel v1, Punkt 1).
function timestampSuffix() {
  const d = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return (
    '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '_' + pad(d.getHours()) + pad(d.getMinutes())
  );
}

// Legt einen eingefrorenen, datierten Schnappschuss einer _AKTUELL-Datei im
// Ordner "_Archiv (alte Versionen)" an (Punkt 3). Nutzt Drive files.copy,
// damit der Snapshot unabhaengig vom Original ist.
async function archiveSnapshot(accessToken, sourceFileId, sourceBaseName) {
  const archiveFolderId = process.env.ARCHIVE_FOLDER_ID;
  if (!archiveFolderId) {
    throw new Error('ARCHIVE_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.');
  }
  const name = sourceBaseName + timestampSuffix();
  return driveCopyFile(accessToken, sourceFileId, {
    name: name,
    parents: [archiveFolderId],
  });
}

// Entfernt ```json / ``` Markdown-Zaeune, falls das Modell trotz Anweisung
// welche mitschickt, und parst den Rest als JSON.
function parseJsonFromModelText(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  return JSON.parse(cleaned);
}

// Wie callClaude, aber mit Bildern (fuer die Alt-Text-Bildanalyse des
// Masterartikel-Optimierers). images = [{ media_type, data }] mit data
// als base64-String. Bilder werden als content-Bloecke VOR dem Text
// uebergeben (Anthropic-Empfehlung fuer Vision-Prompts).
async function callClaudeVision(prompt, images, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY ist nicht als Umgebungsvariable gesetzt.');
  }
  const content = [];
  for (const img of images || []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.media_type, data: img.data },
    });
  }
  content.push({ type: 'text', text: prompt });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      // Grosszuegig: das Modell denkt intern nach (Extended Thinking) und
      // verbraucht dabei Tokens aus demselben Budget wie die Antwort
      max_tokens: maxTokens || 16000,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Anthropic-Fehler: ' + JSON.stringify(data));
  }
  const textBlock = (data.content || []).find(function (b) { return b.type === 'text'; });
  if (!textBlock || !textBlock.text) {
    throw new Error('Claude-Antwort ohne Textblock (stop_reason: ' + data.stop_reason
      + ', bloecke: ' + (data.content || []).map(function (b) { return b.type; }).join(',') + ')');
  }
  return textBlock.text;
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY ist nicht als Umgebungsvariable gesetzt.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Anthropic-Fehler: ' + JSON.stringify(data));
  }
  // Bei Modellen mit "Extended Thinking" (z.B. claude-sonnet-5) enthaelt
  // content[0] einen "thinking"-Block ohne .text - der eigentliche
  // Antworttext steckt im ersten Block vom Typ "text".
  const textBlock = (data.content || []).find(function (b) { return b.type === 'text'; });
  return textBlock && textBlock.text;
}

module.exports = {
  getAccessToken,
  sanitizeFolderName,
  driveFindFile,
  driveCreateFile,
  driveCopyFile,
  driveSearchFoldersByNameContains,
  driveTrashFile,
  sheetsReadValues,
  sheetsWriteValues,
  sheetsAppendValues,
  sheetsBatchUpdate,
  getFirstSheetId,
  findKundenordner,
  findSheet,
  findOrCreateSheet,
  findKundenprofil,
  getRegisterValue,
  setRegisterValue,
  findOrCreateSheetByRegister,
  timestampSuffix,
  archiveSnapshot,
  parseJsonFromModelText,
  callClaude,
  callClaudeVision,
};
