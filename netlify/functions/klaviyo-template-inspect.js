const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260806
//
// TEMPORAERE Diagnose-Function (nicht Teil der offiziellen Skill-Kette):
// sucht ein Klaviyo-Template eines Kunden per Name und gibt dessen rohes
// HTML zurueck, damit wir es analysieren koennen (Reverse-Engineering des
// vom Kunden von Hand gebauten Master-Templates, z.B. "nfy_46_eydl_d2c_offer").
// Nur GET-artig, keine Schreiboperation.

const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;

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
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Template mit Name "' + templateName + '" gefunden.', allNamesHint: 'Pruefe Schreibweise/Grossschreibung.' }) };
    }
    const tpl = templates[0];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: tpl.id,
        name: tpl.attributes.name,
        editor_type: tpl.attributes.editor_type,
        html: tpl.attributes.html || null,
        text: tpl.attributes.text || null,
        htmlLength: (tpl.attributes.html || '').length,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler bei der Template-Suche.', details: err.message }) };
  }
};
