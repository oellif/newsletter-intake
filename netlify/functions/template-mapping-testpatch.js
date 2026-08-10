// Ablage- & Versionsregel v1 aktiv - neu 20260807
//
// TEMPORAERE Testfunktion (nicht Teil der offiziellen Skill-Kette): patcht
// das HTML eines Templates (idealerweise einer Testkopie, siehe
// template-mapping-testkopie.js) und ersetzt darin einen Text-Ausschnitt
// durch einen anderen. Dient nur dazu herauszufinden, ob ein PATCH auf ein
// SYSTEM_DRAGGABLE-Template dessen editor_type veraendert.

const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

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
  const templateId = String(data.templateId || '').trim();
  const suchtext = String(data.suchtext || '').trim();
  const ersatztext = String(data.ersatztext || '').trim();
  if (!kundenname || !templateId || !suchtext || !ersatztext) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'kundenname, templateId, suchtext, ersatztext sind Pflichtfelder.' }) };
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

    const before = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/templates/' + templateId + '/');
    const htmlBefore = before.data.attributes.html || '';
    if (!htmlBefore.includes(suchtext)) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Suchtext nicht im Template-HTML gefunden.', editorTypeVorher: before.data.attributes.editor_type }) };
    }
    const htmlNeu = htmlBefore.replace(suchtext, ersatztext);

    const patchResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'PATCH', '/api/templates/' + templateId + '/', {
      data: { type: 'template', id: templateId, attributes: { html: htmlNeu } },
    });

    const after = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/templates/' + templateId + '/');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        editorTypeVorher: before.data.attributes.editor_type,
        editorTypeNachPatch: patchResult.data.attributes.editor_type,
        editorTypeBeiErneutemGet: after.data.attributes.editor_type,
        ersatzUebernommen: (after.data.attributes.html || '').includes(ersatztext),
        klaviyoTemplateUrl: 'https://www.klaviyo.com/email-templates/' + templateId + '/edit',
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Test-Patch.', details: err.message }) };
  }
};
