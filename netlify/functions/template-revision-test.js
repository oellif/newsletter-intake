const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const TEMPLATE_ID = 'VBrCtm';

function stripTags(html) {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/\s{2,}/g, ' ')
             .trim();
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName('eydl test 06082026');
    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const klaviyoToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    const res = await fetch('https://a.klaviyo.com/api/template-render/', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + klaviyoToken, 'Content-Type': 'application/json', revision: '2026-07-15' },
      body: JSON.stringify({ data: { type: 'template', attributes: { id: TEMPLATE_ID, context: { person: { first_name: 'Test', last_name: 'Kunde' } } } } }),
    });

    const body = await res.json().catch(() => null);
    const html = body && body.data && body.data.attributes && body.data.attributes.html;
    if (!html) return { statusCode: 200, headers, body: JSON.stringify({ success: false, raw: body }) };

    // Bilder mit Alt-Text
    const images = [...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi)]
      .map(m => ({ src: m[1], alt: m[2] || '' }))
      .filter((img, i, arr) => arr.findIndex(x => x.src === img.src) === i);

    // Links mit Linktext
    const links = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ href: m[1], text: stripTags(m[2]).substring(0, 80) }))
      .filter(l => !l.href.includes('unsubscribe') && !l.href.includes('manage_preferences'))
      .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i);

    // Sichtbarer Text (grob)
    const plainText = stripTags(html).substring(0, 3000);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, images, links, plainText }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
