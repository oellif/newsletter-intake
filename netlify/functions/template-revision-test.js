const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const TEMPLATE_ID = 'VBrCtm';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName('eydl test 06082026');
    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const klaviyoToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    const results = {};

    // Endpunkt 1: /api/template-render/ mit neuester Revision
    const r1 = await fetch('https://a.klaviyo.com/api/template-render/', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + klaviyoToken, 'Content-Type': 'application/json', revision: '2026-07-15' },
      body: JSON.stringify({ data: { type: 'template', attributes: { id: TEMPLATE_ID, context: { person: { first_name: 'Test' } } } } }),
    });
    const b1 = await r1.json().catch(() => null);
    results.templateRender_2026 = {
      status: r1.status,
      hasHtml: !!(b1 && b1.data && b1.data.attributes && b1.data.attributes.html),
      error: b1 && b1.errors && b1.errors[0] && b1.errors[0].detail,
    };

    // Endpunkt 2: /api/template-render/ mit aelterer Revision
    const r2 = await fetch('https://a.klaviyo.com/api/template-render/', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + klaviyoToken, 'Content-Type': 'application/json', revision: '2024-10-15' },
      body: JSON.stringify({ data: { type: 'template', attributes: { id: TEMPLATE_ID, context: { person: { first_name: 'Test' } } } } }),
    });
    const b2 = await r2.json().catch(() => null);
    const html2 = b2 && b2.data && b2.data.attributes && b2.data.attributes.html;
    results.templateRender_2024 = {
      status: r2.status,
      hasHtml: !!html2,
      error: b2 && b2.errors && b2.errors[0] && b2.errors[0].detail,
      imageUrls: html2 ? [...new Set([...html2.matchAll(/src="(https?:\/\/[^"]+)"/g)].map(m => m[1]))] : null,
    };

    // Endpunkt 3: GET ohne definition-Feld (Basis-Info)
    const r3 = await fetch('https://a.klaviyo.com/api/templates/' + TEMPLATE_ID + '/', {
      headers: { Authorization: 'Bearer ' + klaviyoToken, revision: '2026-07-15' },
    });
    const b3 = await r3.json().catch(() => null);
    results.getBasic = {
      status: r3.status,
      name: b3 && b3.data && b3.data.attributes && b3.data.attributes.name,
      editorType: b3 && b3.data && b3.data.attributes && b3.data.attributes.editor_type,
      html: b3 && b3.data && b3.data.attributes && b3.data.attributes.html ? 'vorhanden' : 'fehlt',
    };

    return { statusCode: 200, headers, body: JSON.stringify(results, null, 2) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
