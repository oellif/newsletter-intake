// Ablage- & Versionsregel v1 aktiv - neu 20260807
//
// Netlify Function (Skill A: Template-Mapping-Analyse): laedt ein
// bestehendes, von Hand in Klaviyo gebautes Template und listet alle
// text-tragenden HTML-Bloecke mit Position/Laenge auf, damit ein Mensch
// (nicht automatisch!) entscheiden kann, welcher Block Ueberschrift,
// Fliesstext usw. ist. Reine Lesefunktion, veraendert das Template NICHT.
//
// Ergebnis dieser Funktion ist ein Vorschlag zur Pruefung - erst danach
// wird per template-mapping-speichern.js ein geprueftes Mapping abgelegt.

const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

// Extrahiert grobe Text-Bloecke (Inhalt von p/h1-h6/td/div/span mit
// nennenswertem Text) per Regex - bewusst simpel gehalten, da dies nur zur
// menschlichen Sichtung dient, nicht zur automatischen Entscheidung.
function extractTextBlocks(html) {
  const blocks = [];
  const tagRegex = /<(p|h1|h2|h3|h4|td|div|span)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  let idx = 0;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[1];
    const attrs = match[2] || '';
    const innerRaw = match[3] || '';
    // Nur den unmittelbaren Text dieses Blocks pruefen (keine verschachtelten
    // Tags mitzaehlen), damit Container-Elemente nicht faelschlich als
    // Textblock erscheinen.
    const text = innerRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length >= 8 && text.length <= 600) {
      blocks.push({
        index: idx,
        tag: tag,
        hasStyle: /style=/i.test(attrs),
        containsMergeTag: /\{\{|\{%/.test(innerRaw),
        textLength: text.length,
        textPreview: text.length > 140 ? text.slice(0, 140) + '...' : text,
      });
      idx++;
    }
  }
  return blocks;
}

exports.handler = async (event) => {
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
  const templateName = String(data.templateName || '').trim();
  if (!kundenname || !templateName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'kundenname und templateName sind Pflichtfelder.' }) };
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

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    const listResult = await klaviyo.klaviyoRequest(
      klaviyoAccessToken,
      'GET',
      '/api/templates/?filter=' + encodeURIComponent("equals(name,'" + templateName + "')")
    );
    const templates = listResult.data || [];
    if (!templates.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Template mit Name "' + templateName + '" gefunden.' }) };
    }
    const tpl = templates[0];
    const html = tpl.attributes.html || '';
    const blocks = extractTextBlocks(html);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: tpl.id,
        name: tpl.attributes.name,
        editor_type: tpl.attributes.editor_type,
        htmlLength: html.length,
        textBlocks: blocks,
        hinweis: 'Dies ist nur ein Vorschlag zur Pruefung durch einen Menschen. Es wurde noch nichts am Template veraendert.',
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler bei der Template-Analyse.', details: err.message }) };
  }
};
