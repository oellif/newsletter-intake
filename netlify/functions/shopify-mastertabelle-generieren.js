const { getAccessToken, sheetsReadValues, sheetsWriteValues, driveCreateFile } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';
const CLAUDE_FOLDER_ID  = '1Eb7QWpzwF97tfFaD9IsHB2Mt2gxXSxiE';

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
  'Google Shopping / Custom label 4',
];

const C = {};
HEADERS.forEach((h, i) => { C[h] = i; });

async function listDriveImages(tok, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=1000`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
  const data = await res.json();
  if (!res.ok) throw new Error('Drive-Ordner-Fehler: ' + JSON.stringify(data));
  return (data.files || []).filter(f => (f.mimeType || '').startsWith('image/'));
}

function driveUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

function buildProductRows(product, driveImages) {
  const variants     = product.variants || [];
  const shopifyImages = product.images  || [];

  const useImages = driveImages.length > 0
    ? driveImages.map((img, i) => ({ src: driveUrl(img.id), position: i + 1, alt: img.name.replace(/\.[^.]+$/, '') }))
    : shopifyImages.map(img => ({ src: img.src, position: img.position, alt: img.alt || '' }));

  const imageMap = {};
  shopifyImages.forEach(img => { imageMap[img.id] = img.src; });

  const maxRows = Math.max(variants.length, useImages.length, 1);
  const rows = [];

  for (let i = 0; i < maxRows; i++) {
    const v      = variants[i];
    const img    = useImages[i];
    const isFirst = i === 0;
    const row    = new Array(HEADERS.length).fill('');

    row[C['URL handle']] = product.handle;

    if (isFirst) {
      row[C['Title']]                     = product.title;
      row[C['Description']]               = product.body_html || '';
      row[C['Vendor']]                    = product.vendor || '';
      row[C['Type']]                      = product.product_type || '';
      row[C['Tags']]                      = product.tags || '';
      row[C['Published on online store']] = product.published_at ? 'TRUE' : 'FALSE';
      row[C['Status']]                    = product.status || '';
      if (product.options[0]) row[C['Option1 name']] = product.options[0].name;
      if (product.options[1]) row[C['Option2 name']] = product.options[1].name;
      if (product.options[2]) row[C['Option3 name']] = product.options[2].name;
    }

    if (v) {
      row[C['SKU']]                                = v.sku || '';
      row[C['Barcode']]                            = v.barcode || '';
      row[C['Option1 value']]                      = v.option1 || '';
      row[C['Option2 value']]                      = v.option2 || '';
      row[C['Option3 value']]                      = v.option3 || '';
      row[C['Price']]                              = v.price || '';
      row[C['Compare-at price']]                   = v.compare_at_price || '';
      row[C['Charge tax']]                         = v.taxable ? 'TRUE' : 'FALSE';
      row[C['Tax code']]                           = v.tax_code || '';
      row[C['Inventory tracker']]                  = v.inventory_management || '';
      row[C['Inventory quantity']]                 = v.inventory_quantity != null ? v.inventory_quantity : '';
      row[C['Continue selling when out of stock']] = v.inventory_policy === 'continue' ? 'TRUE' : 'FALSE';
      row[C['Weight value (grams)']]               = v.grams != null ? v.grams : '';
      row[C['Weight unit for display']]            = v.weight_unit || '';
      row[C['Requires shipping']]                  = v.requires_shipping ? 'TRUE' : 'FALSE';
      row[C['Fulfillment service']]                = v.fulfillment_service || '';
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
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST erforderlich' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}

  const { kunden_id, handles, folder_id } = body;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };
  if (!handles || !handles.length) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mindestens ein Masterartikel erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:G500');
    const rowIdx     = (kundenRows || []).findIndex(r => r[0] === kunden_id);
    if (rowIdx < 0) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const kundeRow = kundenRows[rowIdx];

    const domain   = kundeRow[2];
    const token    = kundeRow[3];
    const shopName = kundeRow[1] || 'Shop';

    // List Drive images if folder_id provided
    const allDriveImages = folder_id ? await listDriveImages(tok, folder_id) : [];

    // Fetch each masterartikel and build rows
    const allDataRows = [];
    for (const handle of handles) {
      const shopRes  = await fetch(
        `https://${domain}/admin/api/2024-01/products.json?handle=${encodeURIComponent(handle)}&status=draft`,
        { headers: { 'X-Shopify-Access-Token': token } }
      );
      const shopData = await shopRes.json();
      if (!shopData.products || !shopData.products.length) continue;

      // Filter Drive images relevant to this product (filename starts with handle)
      const productImages = allDriveImages.filter(img =>
        img.name.toLowerCase().startsWith(handle.toLowerCase())
      );
      // Fallback: use all drive images if single product and no handle-specific images found
      const useImages = productImages.length > 0
        ? productImages
        : (handles.length === 1 ? allDriveImages : []);

      allDataRows.push(...buildProductRows(shopData.products[0], useImages));
    }

    if (!allDataRows.length) {
      return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Keine Shopify-Produkte gefunden. Sind die Masterartikel als Entwurf vorhanden?' }) };
    }

    // Create new Google Sheet in Claude Code folder
    const datum        = new Date().toISOString().slice(0, 10);
    const safeShopName = shopName.replace(/[^a-zA-Z0-9]/g, '');
    const sheetTitle   = `Mastertabelle_${safeShopName}_${datum}`;

    const created = await driveCreateFile(tok, {
      name: sheetTitle,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [CLAUDE_FOLDER_ID],
    });

    // Write header + data rows
    await sheetsWriteValues(tok, created.id, [HEADERS, ...allDataRows], 'A1');

    // Save sheet ID to column G of kunden sheet
    const sheetRow = rowIdx + 2;
    await sheetsWriteValues(tok, SHOPIFY_KUNDEN_ID, [[created.id]], `G${sheetRow}`);

    const sheetUrl = created.webViewLink || `https://docs.google.com/spreadsheets/d/${created.id}/edit`;

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({ success: true, sheet_id: created.id, sheet_url: sheetUrl, rows: allDataRows.length }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
