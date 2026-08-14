const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - neu 20260811
//
// Netlify Function: Speichert ein geprueftes Template-Mapping pro Kunde und
// Template-Typ im AKTUELL-Register des Kundenprofil-Sheets.
//
// Schluessel-Format im Sheet: MAPPING_<TYP> (z.B. MAPPING_B2C, MAPPING_B2B)
// Wert: JSON mit templateId + blocks-Array
//
// Gueltige Felder im Mapping:
//   ueberschrift  → Überschrift (Redaktionsplan Spalte AA)
//   fliesstext    → Copy-Text (Spalte E)
//   bild_1..3     → Bild-URLs (Spalten L, M, N)
//   cta           → CTA-Button (Spalte F, hat text + url)
//   preheader     → Vorschautext (aus Betreff-Varianten Spalte H)
//
// Pfad-Format: [sectionIndex, rowIndex, columnIndex, blockIndex]

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  setRegisterValue,
} = require('./lib/google');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

const VALID_FIELDS = ['ueberschrift', 'fliesstext', 'bild_1', 'bild_2', 'bild_3', 'cta', 'preheader'];

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON.' }) };
  }

  const kundenname = String(data.kundenname || '').trim();
  const templateId = String(data.templateId || '').trim();
  const templateType = String(data.templateType || '').trim().toUpperCase();
  const blocks = data.blocks;

  if (!kundenname || !templateId || !templateType) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'kundenname, templateId und templateType sind Pflichtfelder.' }),
    };
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'blocks muss ein nicht-leeres Array sein.' }),
    };
  }

  // Jedes Block-Objekt validieren
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!Array.isArray(b.path) || b.path.length !== 4) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'blocks[' + i + '].path muss ein Array mit 4 Elementen sein [s,r,c,b].' }),
      };
    }
    if (!b.field || !VALID_FIELDS.includes(b.field)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'blocks[' + i + '].field "' + b.field + '" ungueltig. Erlaubt: ' + VALID_FIELDS.join(', ') }),
      };
    }
  }

  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID fehlt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);
    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenordner gefunden.' }) };
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    if (!kundenprofilSheet) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenprofil gefunden.' }) };

    const registerKey = 'MAPPING_' + templateType;
    const mappingValue = JSON.stringify({
      templateId: templateId,
      templateType: templateType,
      savedAt: new Date().toISOString(),
      blocks: blocks,
    });

    await setRegisterValue(accessToken, kundenprofilSheet.id, registerKey, mappingValue);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        registerKey: registerKey,
        templateId: templateId,
        templateType: templateType,
        blockCount: blocks.length,
        hinweis: 'Mapping gespeichert unter Register "' + registerKey + '" im Kundenprofil.',
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Speichern des Mappings.', details: err.message }) };
  }
};
