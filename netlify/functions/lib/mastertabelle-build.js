// Gemeinsame Bau-Logik fuer Mastertabellen (Neuanlage-Workflow) und
// Bestandstabellen (Optimierungs-Workflow). Ausgelagert aus
// shopify-mastertabelle-generieren.js, damit beide Workflows dieselben
// Spalten und dieselbe Zeilen-Struktur verwenden.

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

function normalizeFilename(s) {
  return s.toLowerCase().replace(/[\s_]+/g, '-');
}

function driveUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

// Baut die Tabellenzeilen fuer EIN Shopify-Produkt: Hauptzeile mit Texten,
// Variantenzeilen mit Optionswerten/SKU/Preis, Bilder aus generalImages
// oder (Fallback) aus den bestehenden Shopify-Bildern des Produkts.
function buildProductRows(product, generalImages, variantMap) {
  const variants      = product.variants  || [];
  const shopifyImages = product.images    || [];

  const useImages = generalImages.length > 0
    ? generalImages
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
      // Funktions-Tag "Master" nicht uebernehmen - es kennzeichnet nur den
      // Masterartikel selbst und gehoert nicht auf die neuen Produkte
      row[C['Tags']]                      = String(product.tags || '')
        .split(',').map(t => t.trim())
        .filter(t => t && t.toLowerCase() !== 'master')
        .join(', ');
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
      // Variant image: Drive match zuerst, sonst bestehendes Shopify-Bild
      const optVals = [v.option1, v.option2, v.option3].filter(Boolean);
      let varImgSrc = null;
      for (const opt of optVals) {
        const driveImg = variantMap.get(normalizeFilename(opt));
        if (driveImg) { varImgSrc = driveUrl(driveImg.id); break; }
      }
      if (!varImgSrc && v.image_id && imageMap[v.image_id]) {
        varImgSrc = imageMap[v.image_id];
      }
      if (varImgSrc) row[C['Variant image URL']] = varImgSrc;
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

// Laedt die Metafelder eines Produkts (App- und Shopify-interne Namespaces
// werden uebersprungen) und liefert sie als Spalten-Zusaetze:
// { colName: "Metafield: ns.key [type]", value }
async function ladeProduktMetafelder(domain, token, productId) {
  const res  = await fetch(
    `https://${domain}/admin/api/2024-01/products/${productId}/metafields.json?limit=250`,
    { headers: { 'X-Shopify-Access-Token': token } }
  );
  const data = await res.json();
  if (!res.ok) return [];
  return (data.metafields || [])
    .filter(m => !m.namespace.startsWith('shopify') && !m.namespace.includes('--'))
    .map(m => ({
      colName: `Metafield: ${m.namespace}.${m.key} [${m.type}]`,
      value: typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value),
    }));
}

module.exports = { HEADERS, C, buildProductRows, ladeProduktMetafelder, normalizeFilename, driveUrl };
