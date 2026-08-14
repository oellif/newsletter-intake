// Schritt 3 des Uploads: ordnet die bereits hochgeladenen Bilder den
// Varianten zu. Der Browser schickt die Zuordnung Bild-ID → Optionswerte
// (aus dem Bild-Plan von shopify-produkt-anlegen); hier werden die
// Varianten des Produkts geholt, gematcht und per PUT verknuepft.
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

function normalizeFilename(s) {
  return s.toLowerCase().replace(/[\s_]+/g, '-');
}

exports.handler = async (event) => {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST erforderlich' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const { kunden_id, product_id, images } = body; // images: [{ image_id, opts: ['nuss'] }]
  if (!kunden_id || !product_id || !Array.isArray(images) || !images.length) {
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id, product_id und images erforderlich' }) };
  }

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const domain = kundeRow[2];
    const token  = kundeRow[3];

    const imageIdByOpt = new Map();
    for (const img of images) {
      (img.opts || []).forEach(opt => imageIdByOpt.set(normalizeFilename(opt), img.image_id));
    }

    const prodRes  = await fetch(`https://${domain}/admin/api/2024-01/products/${product_id}.json?fields=id,variants`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    const prodData = await prodRes.json();
    if (!prodRes.ok) {
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: JSON.stringify(prodData.errors || prodData) }) };
    }

    const variantUpdates = [];
    for (const v of prodData.product.variants || []) {
      const optVals = [v.option1, v.option2, v.option3].filter(Boolean);
      for (const opt of optVals) {
        const imgId = imageIdByOpt.get(normalizeFilename(opt));
        if (imgId) { variantUpdates.push({ id: v.id, image_id: imgId }); break; }
      }
    }

    if (variantUpdates.length) {
      const putRes  = await fetch(`https://${domain}/admin/api/2024-01/products/${product_id}.json`, {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: { id: product_id, variants: variantUpdates } }),
      });
      const putData = await putRes.json();
      if (!putRes.ok) {
        return { statusCode: 502, headers: h, body: JSON.stringify({ error: JSON.stringify(putData.errors || putData) }) };
      }
    }

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({ success: true, variants_assigned: variantUpdates.length }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
