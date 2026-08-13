const { getAccessToken, sheetsReadValues, sheetsWriteValues } = require('./lib/google');

const SHOPIFY_SHEET_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';
const TABELLE0_ID = '1v07YkO76KPTYsAh8hKsUXZmXr9iZtAciechymWySkRw';

const HEADERS = [
  'Handle','Title','Body (HTML)','Vendor','Product Category','Type','Tags','Published',
  'Option1 Name','Option1 Value','Option2 Name','Option2 Value','Option3 Name','Option3 Value',
  'Variant SKU','Variant Grams','Variant Inventory Tracker','Variant Inventory Qty',
  'Variant Inventory Policy','Variant Fulfillment Service','Variant Price','Variant Compare At Price',
  'Variant Requires Shipping','Variant Taxable','Variant Barcode',
  'Image Src','Image Position','Image Alt Text',
  'Gift Card','SEO Title','SEO Description',
  'Google Shopping / Google Product Category','Google Shopping / Gender','Google Shopping / Age Group',
  'Google Shopping / MPN','Google Shopping / Condition','Google Shopping / Custom Product',
  'Google Shopping / Custom Label 0','Google Shopping / Custom Label 1','Google Shopping / Custom Label 2',
  'Google Shopping / Custom Label 3','Google Shopping / Custom Label 4',
  'Variant Image','Variant Weight Unit','Variant Tax Code','Cost per item','Status'
];

function buildProductRows(product) {
  const variants = product.variants || [];
  const images = product.images || [];
  const imageMap = {};
  images.forEach(img => { imageMap[img.id] = img.src; });

  const maxRows = Math.max(variants.length, images.length);
  const rows = [];

  for (let i = 0; i < maxRows; i++) {
    const v = variants[i];
    const img = images[i];
    const isFirst = i === 0;

    const row = new Array(HEADERS.length).fill('');

    row[0] = product.handle;

    if (isFirst) {
      row[1]  = product.title;
      row[2]  = product.body_html || '';
      row[3]  = product.vendor || '';
      row[4]  = '';
      row[5]  = product.product_type || '';
      row[6]  = product.tags || '';
      row[7]  = 'FALSE';
      if (product.options[0]) row[8]  = product.options[0].name;
      if (product.options[1]) row[10] = product.options[1].name;
      if (product.options[2]) row[12] = product.options[2].name;
      row[46] = product.status || 'draft';
    }

    if (v) {
      row[9]  = v.option1 || '';
      row[11] = v.option2 || '';
      row[13] = v.option3 || '';
      row[14] = v.sku || '';
      row[15] = v.grams || 0;
      row[16] = v.inventory_management || '';
      row[17] = v.inventory_quantity || 0;
      row[18] = v.inventory_policy || '';
      row[19] = v.fulfillment_service || '';
      row[20] = v.price || '';
      row[21] = v.compare_at_price || '';
      row[22] = v.requires_shipping ? 'TRUE' : 'FALSE';
      row[23] = v.taxable ? 'TRUE' : 'FALSE';
      row[24] = v.barcode || '';
      if (v.image_id && imageMap[v.image_id]) row[42] = imageMap[v.image_id];
      row[43] = v.weight_unit || '';
    }

    if (img) {
      row[25] = img.src || '';
      row[26] = img.position || '';
      row[27] = img.alt || '';
    }

    row[28] = 'FALSE';
    rows.push(row);
  }

  return rows;
}

exports.handler = async (event) => {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const kunden_id = body.kunden_id || (event.queryStringParameters || {}).kunden_id;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_SHEET_ID, 'A2:G500');
    const kundeRow = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const domain = kundeRow[2];
    const token  = kundeRow[3];
    const handles = kundeRow[4] ? kundeRow[4].split(',').map(s => s.trim()).filter(Boolean) : [];
    if (!handles.length) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Masterartikel' }) };

    const allRows = [];
    for (const handle of handles) {
      const res = await fetch(`https://${domain}/admin/api/2024-01/products.json?handle=${handle}&status=draft`, {
        headers: { 'X-Shopify-Access-Token': token }
      });
      const data = await res.json();
      if (data.products && data.products.length > 0) {
        allRows.push(...buildProductRows(data.products[0]));
      }
    }

    if (!allRows.length) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Keine Produkte gefunden' }) };

    // Clear old data first
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${TABELLE0_ID}/values/A2:AV500:clear`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }
    );

    await sheetsWriteValues(tok, TABELLE0_ID, allRows, 'A2');

    return { statusCode: 200, headers: h, body: JSON.stringify({ success: true, rows: allRows.length }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
