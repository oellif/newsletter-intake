// Ablage- & Versionsregel v1 aktiv - neu 20260807
//
// TEMPORAERE Diagnose-Function (nicht Teil der offiziellen Skill-Kette):
// laedt die "definition" (Block-Struktur) eines SYSTEM_DRAGGABLE-Templates,
// um zu pruefen, ob und wie einzelne Text-Bloecke darin adressierbar sind -
// als Alternative zum (nicht unterstuetzten) HTML-PATCH.

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
  if (!kundenname || !templateId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'kundenname und templateId sind Pflichtfelder.' }) };
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

    // Isolierter Test mit neuerer API-Revision (NICHT die produktive
    // Konstante in lib/klaviyo.js) - additional-fields[template]=definition
    // ist erst ab einer neueren Revision als 2024-10-15 bekannt.
    const testRevision = String(data.revision || '2025-10-15');
    const res = await fetch(
      'https://a.klaviyo.com/api/templates/' + templateId + '/?additional-fields[template]=definition',
      {
        headers: {
          Authorization: 'Bearer ' + klaviyoAccessToken,
          'Content-Type': 'application/json',
          revision: testRevision,
        },
      }
    );
    const result = await res.json().catch(function () { return null; });
    if (!res.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, testRevision: testRevision, klaviyoError: result }),
      };
    }

    const def = result.data.attributes.definition || null;
    const defString = def ? JSON.stringify(def) : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        testRevision: testRevision,
        editor_type: result.data.attributes.editor_type,
        hasDefinition: !!def,
        definitionLength: defString ? defString.length : 0,
        definitionPreview: defString ? defString.slice(0, 4000) : null,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Laden der Definition.', details: err.message }) };
  }
};
