// Temporaer: versucht das kaputte Template VBrCtm via render-Endpunkt als HTML zu laden

const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const TEMPLATE_ID = 'VBrCtm';
const REVISION = '2026-07-15';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName('eydl test 06082026');
    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const klaviyoToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    // Render-Endpunkt aufrufen
    const res = await fetch('https://a.klaviyo.com/api/templates/' + TEMPLATE_ID + '/render/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + klaviyoToken,
        'Content-Type': 'application/json',
        revision: REVISION,
      },
      body: JSON.stringify({
        data: {
          type: 'template',
          attributes: {
            context: { person: { first_name: 'Test' } },
          },
        },
      }),
    });

    const body = await res.json().catch(() => null);
    const html = body && body.data && body.data.attributes && body.data.attributes.html;

    if (!html) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, status: res.status, klaviyoError: body }) };
    }

    // Bild-URLs aus dem HTML extrahieren
    const imgMatches = [...html.matchAll(/src="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
    const uniqueImgs = [...new Set(imgMatches)];

    // Links extrahieren
    const linkMatches = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
    const uniqueLinks = [...new Set(linkMatches)];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        htmlLength: html.length,
        imageUrls: uniqueImgs,
        links: uniqueLinks,
        htmlPreview: html.substring(0, 500),
      }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
