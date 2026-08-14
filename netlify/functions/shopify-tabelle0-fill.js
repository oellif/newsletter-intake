const { requireAuth } = require('./lib/auth');
const { getAccessToken, sheetsReadValues, sheetsWriteValues } = require('./lib/google');

const SHOPIFY_SHEET_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';
const TABELLE0_ID = '1v07YkO76KPTYsAh8hKsUXZmXr9iZtAciechymWySkRw';

const HEADERS = [
  'Title','URL handle','Description','Vendor','Product category','Type','Tags',
  'Published on online store','Status','SKU','Barcode',
  'Option1 name','Option1 value','Option1 Linked To',
  'Option2 name','Option2 value','Option2 Linked To',
  'Option3 name','Option3 value','Option3 Linked To',
  'Price','Compare-at price','Cost per item','Charge tax','Tax code',
  'Unit price total measure','Unit price total measure unit',
  'Unit price base measure','Unit price base measure unit',
  'Inventory tracker','Inventory quantity','Continue selling when out of stock',
  'Weight value (grams)','Weight unit for display','Requires shipping','Fulfillment service',
  'Product image URL','Image position','Image alt text','Variant image URL',
  'Gift card','SEO title','SEO description',
  'Color (product.metafields.shopify.color-pattern)',
  'Google Shopping / Google product category','Google Shopping / Gender',
  'Google Shopping / Age group','Google Shopping / Manufacturer part number (MPN)',
  'Google Shopping / Ad group name','Google Shopping / Ads labels',
  'Google Shopping / Condition','Google Shopping / Custom product',
  'Google Shopping / Custom label 0','Google Shopping / Custom label 1',
  'Google Shopping / Custom label 2','Google Shopping / Custom label 3',
  'Google Shopping / Custom label 4'
];

// Col indices (0-based)
const C = {};
HEADERS.forEach((h, i) => { C[h] = i; });

function buildProductRows(product) {
  const variants = product.variants || [];
  const images   = product.images   || [];

  const imageMap = {};
  images.forEach(img => { imageMap[img.id] = img.src; });

  const maxRows = Math.max(variants.length, images.length);
  const rows = [];

  for (let i = 0; i < maxRows; i++) {
    const v       = variants[i];
    const img     = images[i];
    const isFirst = i === 0;
    const row     = new Array(HEADERS.length).fill('');

    // Fields present on every row
    row[C['URL handle']] = product.handle;

    if (isFirst) {
      row[C['Title']]                    = product.title;
      row[C['Description']]              = product.body_html || '';
      row[C['Vendor']]                   = product.vendor || '';
      row[C['Type']]                     = product.product_type || '';
      row[C['Tags']]                     = product.tags || '';
      row[C['Published on online store']]= product.published_at ? 'TRUE' : 'FALSE';
      row[C['Status']]                   = product.status || '';
      if (product.options[0]) row[C['Option1 name']] = product.options[0].name;
      if (product.options[1]) row[C['Option2 name']] = product.options[1].name;
      if (product.options[2]) row[C['Option3 name']] = product.options[2].name;
    }

    if (v) {
      row[C['SKU']]                              = v.sku || '';
      row[C['Barcode']]                          = v.barcode || '';
      row[C['Option1 value']]                    = v.option1 || '';
      row[C['Option2 value']]                    = v.option2 || '';
      row[C['Option3 value']]                    = v.option3 || '';
      row[C['Price']]                            = v.price || '';
      row[C['Compare-at price']]                 = v.compare_at_price || '';
      row[C['Charge tax']]                       = v.taxable ? 'TRUE' : 'FALSE';
      row[C['Tax code']]                         = v.tax_code || '';
      row[C['Inventory tracker']]                = v.inventory_management || '';
      row[C['Inventory quantity']]               = v.inventory_quantity != null ? v.inventory_quantity : '';
      row[C['Continue selling when out of stock']]= v.inventory_policy === 'continue' ? 'TRUE' : 'FALSE';
      row[C['Weight value (grams)']]             = v.grams != null ? v.grams : '';
      row[C['Weight unit for display']]          = v.weight_unit || '';
      row[C['Requires shipping']]                = v.requires_shipping ? 'TRUE' : 'FALSE';
      row[C['Fulfillment service']]              = v.fulfillment_service || '';
      if (v.image_id && imageMap[v.image_id]) {
        row[C['Variant image URL']] = imageMap[v.image_id];
      }
    }

    if (img) {
      row[C['Product image URL']] = img.src || '';
      row[C['Image position']]    = img.position != null ? img.position : '';
      row[C['Image alt text']]    = img.alt || '';
    }

    row[C['Gift card']] = 'FALSE';
    rows.push(row);
  }

  return rows;
}

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
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
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const domain  = kundeRow[2];
    const token   = kundeRow[3];
    const handles = kundeRow[4] ? kundeRow[4].split(',').map(s => s.trim()).filter(Boolean) : [];
    if (!handles.length) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Masterartikel ausgewählt' }) };

    const dataRows = [];
    for (const handle of handles) {
      const res  = await fetch(`https://${domain}/admin/api/2024-01/products.json?handle=${handle}&status=draft`, {
        headers: { 'X-Shopify-Access-Token': token }
      });
      const data = await res.json();
      if (data.products && data.products.length > 0) {
        dataRows.push(...buildProductRows(data.products[0]));
      }
    }

    if (!dataRows.length) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Keine Produkte gefunden' }) };

    // Clear old content
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${TABELLE0_ID}/values/A1:BH500:clear`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }
    );

    // Write header row + data rows
    await sheetsWriteValues(tok, TABELLE0_ID, [HEADERS, ...dataRows], 'A1');

    return { statusCode: 200, headers: h, body: JSON.stringify({ success: true, rows: dataRows.length }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
