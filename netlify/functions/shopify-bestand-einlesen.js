const { requireAuth } = require('./lib/auth');
// Workflow 2 (Bestandsoptimierung), Schritt 2: liest die ausgewaehlten
// Shop-Artikel in eine neue Bestandstabelle ein (gleiche Struktur wie die
// Mastertabelle, inkl. Metafeld-Spalten und bestehender Shopify-Bilder).
// Die Tabellen-ID wird in Spalte I der Kundentabelle gespeichert -
// getrennt von Spalte G (Mastertabelle des Neuanlage-Workflows).
const { getAccessToken, sheetsReadValues, sheetsWriteValues, driveCreateFile } = require('./lib/google');
const { HEADERS, buildProductRows, ladeProduktMetafelder } = require('./lib/mastertabelle-build');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';
const MASTERTABELLEN_FOLDER_ID = '1JsT09BPz8VVrBQx8NsahaEt0iuDIYS2O';

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cockpit-Pw',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST erforderlich' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const { kunden_id, handles } = body;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };
  if (!handles || !handles.length) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mindestens ein Artikel erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:G500');
    const rowIdx     = (kundenRows || []).findIndex(r => r[0] === kunden_id);
    if (rowIdx < 0) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const kundeRow = kundenRows[rowIdx];
    const domain   = kundeRow[2];
    const token    = kundeRow[3];
    const shopName = kundeRow[1] || 'Shop';

    const allDataRows   = [];
    const metafieldCols = [];
    const mfColIndex    = new Map();
    const mfAssignments = [];

    for (const handle of handles) {
      const shopRes  = await fetch(
        `https://${domain}/admin/api/2024-01/products.json?handle=${encodeURIComponent(handle)}`,
        { headers: { 'X-Shopify-Access-Token': token } }
      );
      const shopData = await shopRes.json();
      if (!shopData.products || !shopData.products.length) continue;

      const product  = shopData.products[0];
      // Keine Drive-Bilder: buildProductRows uebernimmt automatisch die
      // bestehenden Shopify-Bilder (CDN-URLs) inkl. Positionen/Alt-Texten
      const prodRows = buildProductRows(product, [], new Map());

      const metafields = await ladeProduktMetafelder(domain, token, product.id);
      if (metafields.length && prodRows.length) {
        const values = new Map();
        for (const m of metafields) {
          if (!mfColIndex.has(m.colName)) {
            mfColIndex.set(m.colName, metafieldCols.length);
            metafieldCols.push(m.colName);
          }
          values.set(m.colName, m.value);
        }
        mfAssignments.push({ row: prodRows[0], values });
      }

      allDataRows.push(...prodRows);
    }

    if (!allDataRows.length) {
      return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Keine der ausgewaehlten Artikel in Shopify gefunden.' }) };
    }

    const datum        = new Date().toISOString().slice(0, 10);
    const safeShopName = shopName.replace(/[^a-zA-Z0-9]/g, '');
    const sheetTitle   = `Bestandstabelle_${safeShopName}_${datum}`;

    const created = await driveCreateFile(tok, {
      name: sheetTitle,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [MASTERTABELLEN_FOLDER_ID],
    });

    const fullHeaders = [...HEADERS, ...metafieldCols];
    if (metafieldCols.length) {
      for (const r of allDataRows) { while (r.length < fullHeaders.length) r.push(''); }
      for (const { row, values } of mfAssignments) {
        for (const [col, val] of values) {
          row[HEADERS.length + mfColIndex.get(col)] = val;
        }
      }
    }
    await sheetsWriteValues(tok, created.id, [fullHeaders, ...allDataRows], 'A1');

    // Bestandstabellen-ID in Spalte I speichern (G = Mastertabelle bleibt unberuehrt)
    await sheetsWriteValues(tok, SHOPIFY_KUNDEN_ID, [[created.id]], `I${rowIdx + 2}`);

    const sheetUrl = created.webViewLink || `https://docs.google.com/spreadsheets/d/${created.id}/edit`;

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({ success: true, sheet_id: created.id, sheet_url: sheetUrl, rows: allDataRows.length, artikel: handles.length }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
