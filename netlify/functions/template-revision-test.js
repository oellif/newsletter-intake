// Temporaere Testfunktion - prueft ob aeltere Klaviyo-API-Revisionen
// die Definition des kaputten Templates VBrCtm zurueckgeben koennen.
// Nach dem Test loeschen.

const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const TEMPLATE_ID = 'VBrCtm';
const REVISIONS = ['2024-10-15', '2024-07-15', '2024-02-15', '2023-10-15'];

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName('eydl test 06082026');
    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const klaviyoToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    const results = [];

    for (const revision of REVISIONS) {
      const res = await fetch(
        'https://a.klaviyo.com/api/templates/' + TEMPLATE_ID + '/?additional-fields[template]=definition',
        { headers: { Authorization: 'Bearer ' + klaviyoToken, revision } }
      );
      const body = await res.json().catch(() => null);
      const hasDefinition = !!(body && body.data && body.data.attributes && body.data.attributes.definition);
      const error = body && body.errors && body.errors[0] && body.errors[0].detail;

      results.push({
        revision,
        status: res.status,
        hasDefinition,
        error: error || null,
        blockCount: hasDefinition ? countBlocks(body.data.attributes.definition) : null,
      });

      if (hasDefinition) break;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ templateId: TEMPLATE_ID, results }, null, 2) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function countBlocks(definition) {
  let count = 0;
  const sections = (definition.body && definition.body.sections) || [];
  sections.forEach(s => (s.rows || []).forEach(r => (r.columns || []).forEach(c => { count += (c.blocks || []).length; })));
  return count;
}
