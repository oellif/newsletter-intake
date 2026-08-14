const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

// Map Mastertabelle column names → Shopify CSV column names
const COL_MAP = {
  'Title':                                'Title',
  'URL handle':                           'Handle',
  'Description':                          'Body (HTML)',
  'Vendor':                               'Vendor',
  'Product category':                     'Product Category',
  'Type':                                 'Type',
  'Tags':                                 'Tags',
  'Published on online store':            'Published',
  'Status':                               'Status',
  'SKU':                                  'Variant SKU',
  'Barcode':                              'Variant Barcode',
  'Option1 name':                         'Option1 Name',
  'Option1 value':                        'Option1 Value',
  'Option2 name':                         'Option2 Name',
  'Option2 value':                        'Option2 Value',
  'Option3 name':                         'Option3 Name',
  'Option3 value':                        'Option3 Value',
  'Price':                                'Variant Price',
  'Compare-at price':                     'Variant Compare At Price',
  'Charge tax':                           'Variant Taxable',
  'Inventory tracker':                    'Variant Inventory Tracker',
  'Inventory quantity':                   'Variant Inventory Qty',
  'Continue selling when out of stock':   'Variant Inventory Policy',
  'Weight value (grams)':                 'Variant Grams',
  'Weight unit for display':              'Variant Weight Unit',
  'Requires shipping':                    'Variant Requires Shipping',
  'Fulfillment service':                  'Variant Fulfillment Service',
  'Product image URL':                    'Image Src',
  'Image position':                       'Image Position',
  'Image alt text':                       'Image Alt Text',
  'Variant image URL':                    'Variant Image',
  'Gift card':                            'Gift Card',
  'SEO title':                            'SEO Title',
  'SEO description':                      'SEO Description',
};

// Columns to include in the output CSV (in this order)
const CSV_HEADERS = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags',
  'Published', 'Status',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Barcode', 'Variant Price', 'Variant Compare At Price',
  'Variant Taxable', 'Variant Inventory Tracker', 'Variant Inventory Qty',
  'Variant Inventory Policy', 'Variant Grams', 'Variant Weight Unit',
  'Variant Requires Shipping', 'Variant Fulfillment Service',
  'Image Src', 'Image Position', 'Image Alt Text', 'Variant Image',
  'Gift Card', 'SEO Title', 'SEO Description',
];

function csvCell(val) {
  const s = String(val == null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function transformValue(shopifyCol, value) {
  if (shopifyCol === 'Variant Inventory Policy') {
    return value === 'TRUE' ? 'continue' : 'deny';
  }
  if (shopifyCol === 'Published') {
    return value === 'TRUE' ? 'true' : 'false';
  }
  return value;
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
  const { kunden_id } = body;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows    = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:G500');
    const kundeRow      = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const mastertabelleId = kundeRow[6];
    if (!mastertabelleId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Mastertabelle vorhanden.' }) };

    // Read Mastertabelle
    const allRows = await sheetsReadValues(tok, mastertabelleId, 'A1:CZ5000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mastertabelle ist leer.' }) };

    const headerRow = allRows[0];
    const dataRows  = allRows.slice(1).filter(r => r.some(c => c !== undefined && c !== null && c !== ''));

    // Build column index map for Mastertabelle
    const SRC = {}; // mastertabelle col name → index
    headerRow.forEach((col, i) => { if (col) SRC[col.trim()] = i; });

    // Build CSV rows
    const csvRows = [CSV_HEADERS.join(',')]; // header line

    for (const row of dataRows) {
      const out = CSV_HEADERS.map(shopifyCol => {
        // Find the Mastertabelle column that maps to this Shopify column
        const srcCol = Object.keys(COL_MAP).find(k => COL_MAP[k] === shopifyCol);
        if (!srcCol) return '';
        const idx = SRC[srcCol];
        const raw = idx !== undefined ? String(row[idx] || '') : '';
        return csvCell(transformValue(shopifyCol, raw));
      });
      csvRows.push(out.join(','));
    }

    const csvContent = '﻿' + csvRows.join('\r\n'); // UTF-8 BOM for Excel compatibility

    return {
      statusCode: 200,
      headers: {
        ...h,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="shopify-import.csv"',
      },
      body: csvContent,
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
