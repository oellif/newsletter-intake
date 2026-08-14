const { requireAuth } = require('./lib/auth');
// Schritt 2 des Uploads: laedt EIN Bild hoch. Wir laden die Datei selbst
// authentifiziert von Google Drive (keine oeffentliche Freigabe noetig,
// kein Rate-Limit durch Shopify-Server) und schicken Shopify die rohen
// Bytes als base64-Attachment - Shopify muss nichts von extern abrufen.
// Ein Aufruf = ein Bild = volles 10s-Zeitfenster fuer ~3s Arbeit.
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
};

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST erforderlich' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const { kunden_id, product_id, file_id, alt, position } = body;
  if (!kunden_id || !product_id || !file_id) {
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id, product_id und file_id erforderlich' }) };
  }

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const domain = kundeRow[2];
    const token  = kundeRow[3];

    // Bild-Bytes authentifiziert von Drive laden
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file_id}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: 'Bearer ' + tok } }
    );
    if (!driveRes.ok) {
      const errText = await driveRes.text().catch(() => '');
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: `Drive-Download fehlgeschlagen (${driveRes.status}): ${errText.slice(0, 200)}` }) };
    }
    const mime   = (driveRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const buffer = Buffer.from(await driveRes.arrayBuffer());
    if (buffer.length > 15 * 1024 * 1024) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: `Bild zu gross (${Math.round(buffer.length / 1024 / 1024)} MB, max. 15 MB)` }) };
    }

    const image = {
      attachment: buffer.toString('base64'),
      filename:   (alt || file_id) + (EXT_BY_MIME[mime] || '.jpg'),
    };
    if (alt) image.alt = alt;
    if (position) image.position = position;

    const shopifyRes  = await fetch(`https://${domain}/admin/api/2024-01/products/${product_id}/images.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    });
    const shopifyData = await shopifyRes.json();
    if (!shopifyRes.ok) {
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: JSON.stringify(shopifyData.errors || shopifyData) }) };
    }

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({ success: true, image_id: shopifyData.image.id }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
