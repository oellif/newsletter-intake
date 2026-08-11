// Ablage- & Versionsregel v1 aktiv - umgestellt auf definition-API am 20260811
//
// Netlify Function (Skill A: Template-Mapping-Analyse): laedt ein bestehendes
// Klaviyo-Template und listet alle definition-Bloecke mit Pfad, Typ und
// Inhalts-Vorschau auf. Reine Lesefunktion, veraendert das Template NICHT.
//
// Ergebnis dient der menschlichen Sichtung: Welcher Block ist Ueberschrift,
// Fliesstext, Bild, CTA? Das geprueft Mapping wird dann per
// template-mapping-speichern.js im Kundenprofil abgelegt.
//
// Input: kundenname + templateName ODER templateId
// Output: blocks[] mit { path, type, contentPreview, imageUrl }

const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const DEFINITION_REVISION = '2026-07-15';

// Extrahiert lesbaren Text aus HTML-Content eines Textblocks
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Geht rekursiv durch definition.body.sections → rows → columns → blocks
// und liefert eine flache Liste mit Pfad und Block-Metadaten
function extractDefinitionBlocks(body) {
  const result = [];
  const sections = (body && body.sections) || [];
  sections.forEach(function (section, s) {
    const rows = (section && section.rows) || [];
    rows.forEach(function (row, r) {
      const columns = (row && row.columns) || [];
      columns.forEach(function (col, c) {
        const blocks = (col && col.blocks) || [];
        blocks.forEach(function (block, b) {
          const type = (block && block.type) || 'unknown';
          const blockData = (block && block.data) || {};
          const entry = {
            path: [s, r, c, b],
            pathLabel: 'S' + s + ':R' + r + ':C' + c + ':B' + b,
            type: type,
          };

          if (type === 'text') {
            const raw = stripHtml(blockData.content || '');
            entry.contentPreview = raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
            entry.contentLength = raw.length;
          } else if (type === 'image') {
            entry.imageUrl = blockData.image_url || blockData.url || null;
            entry.altText = blockData.alt_text || null;
            entry.linkUrl = (blockData.link && blockData.link.url) || null;
          } else if (type === 'button') {
            entry.buttonText = blockData.text || null;
            entry.buttonUrl = (blockData.link && blockData.link.url) || null;
          } else {
            // Unbekannter Typ: rohe data-Keys zeigen
            entry.dataKeys = Object.keys(blockData);
          }

          result.push(entry);
        });
      });
    });
  });
  return result;
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
  const templateId = String(data.templateId || '').trim();

  if (!kundenname || (!templateName && !templateId)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'kundenname + templateName ODER templateId sind Pflichtfelder.' }),
    };
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

    // Template-ID ermitteln (direkt oder per Name suchen)
    let resolvedId = templateId;
    let resolvedName = '';
    let editorType = '';

    if (!resolvedId) {
      const listRes = await fetch(
        'https://a.klaviyo.com/api/templates/?filter=' + encodeURIComponent("equals(name,'" + templateName + "')"),
        {
          headers: { Authorization: 'Bearer ' + klaviyoAccessToken, revision: DEFINITION_REVISION },
        }
      );
      const listData = await listRes.json().catch(function () { return {}; });
      const templates = (listData.data) || [];
      if (!templates.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Template mit Name "' + templateName + '" gefunden.' }) };
      }
      resolvedId = templates[0].id;
      resolvedName = templates[0].attributes.name;
      editorType = templates[0].attributes.editor_type;
    }

    // Template mit definition-Feld laden
    const getRes = await fetch(
      'https://a.klaviyo.com/api/templates/' + resolvedId + '/?additional-fields[template]=definition',
      {
        headers: { Authorization: 'Bearer ' + klaviyoAccessToken, revision: DEFINITION_REVISION },
      }
    );
    const tplData = await getRes.json().catch(function () { return null; });

    if (!getRes.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, templateId: resolvedId, klaviyoError: tplData }),
      };
    }

    const attrs = tplData.data.attributes;
    resolvedName = resolvedName || attrs.name;
    editorType = editorType || attrs.editor_type;
    const definition = attrs.definition;

    if (!definition) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          templateId: resolvedId,
          name: resolvedName,
          editor_type: editorType,
          error: 'Template hat kein definition-Feld. Vermutlich CODE-Typ oder aeltere API-Revision.',
        }),
      };
    }

    const blocks = extractDefinitionBlocks(definition.body);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        templateId: resolvedId,
        name: resolvedName,
        editor_type: editorType,
        totalBlocks: blocks.length,
        blocks: blocks,
        hinweis: 'Reine Lesefunktion – Template wurde NICHT veraendert. Pfad-Format: S=Section, R=Row, C=Column, B=Block.',
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler bei der Template-Analyse.', details: err.message }) };
  }
};
