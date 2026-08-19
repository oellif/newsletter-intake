const { requireAuth } = require('./lib/auth');
// Workflow 2 (Bestandsoptimierung), letzter Schritt: spielt die freigegebenen
// Werte aus der Bestandstabelle auf den BESTEHENDEN Shopify-Artikel zurueck.
// Vorher wird der alte Zustand als JSON-Schnappschuss in Drive gesichert.
// Es werden NUR Text-/SEO-Felder, Tags, Metafelder und Bild-Alt-Texte
// aktualisiert - Preise, Bestaende, Varianten, Status und Handle bleiben
// grundsaetzlich unberuehrt.
const { getAccessToken, sheetsReadValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';
const SNAPSHOT_FOLDER_ID = '1JsT09BPz8VVrBQx8NsahaEt0iuDIYS2O'; // "Master Tabellen"

async function driveUploadText(tok, name, parents, text) {
  const boundary = 'mh_snapshot_boundary_7391';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents, mimeType: 'application/json' }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` + text + `\r\n--${boundary}--`;
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Drive-Schnappschuss-Fehler: ' + JSON.stringify(data));
  return data;
}

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
  const { kunden_id, handle, sheet_id } = body;
  if (!kunden_id || !handle || !sheet_id) {
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id, handle und sheet_id erforderlich' }) };
  }

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const domain = kundeRow[2];
    const token  = kundeRow[3];

    // Bestandstabelle lesen
    const allRows = await sheetsReadValues(tok, sheet_id, 'A1:CZ2000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Bestandstabelle ist leer.' }) };
    const CI = {};
    allRows[0].forEach((col, i) => { if (col) CI[col.trim()] = i; });
    const get = (row, col) => CI[col] !== undefined ? String(row[CI[col]] || '').trim() : '';

    const rows = allRows.slice(1).filter(r => get(r, 'URL handle') === handle);
    if (!rows.length) return { statusCode: 404, headers: h, body: JSON.stringify({ error: `Handle "${handle}" nicht in der Bestandstabelle` }) };
    const mainRow = rows.find(r => get(r, 'Title')) || rows[0];

    // Bestehendes Produkt holen (kompletter Zustand fuer den Schnappschuss)
    const prodRes  = await fetch(`https://${domain}/admin/api/2024-01/products.json?handle=${encodeURIComponent(handle)}`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    const prodData = await prodRes.json();
    if (!prodRes.ok || !(prodData.products || []).length) {
      return { statusCode: 404, headers: h, body: JSON.stringify({ error: `Artikel "${handle}" nicht in Shopify gefunden` }) };
    }
    const produkt = prodData.products[0];

    const mfRes  = await fetch(`https://${domain}/admin/api/2024-01/products/${produkt.id}/metafields.json?limit=250`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    const mfData = await mfRes.json();
    const alteMetafelder = mfRes.ok ? (mfData.metafields || []) : [];

    // Schnappschuss des alten Zustands nach Drive (Rueckgaengig-Netz)
    const zeitstempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snapshot = await driveUploadText(
      tok,
      `Snapshot_${handle}_${zeitstempel}.json`,
      [SNAPSHOT_FOLDER_ID],
      JSON.stringify({ produkt, metafelder: alteMetafelder }, null, 2)
    );

    // ── Produktfelder aktualisieren (NUR Texte/SEO/Tags/Vendor/Type) ──
    const upd = { id: produkt.id };
    const setIf = (col, key) => { const v = get(mainRow, col); if (v) upd[key] = v; };
    setIf('Title', 'title');
    setIf('Description', 'body_html');
    setIf('Vendor', 'vendor');
    setIf('Type', 'product_type');
    setIf('Tags', 'tags');
    // SEO-Titel/-Beschreibung laufen bei Shopify ueber globale Metafelder
    setIf('SEO title', 'metafields_global_title_tag');
    setIf('SEO description', 'metafields_global_description_tag');

    const putRes  = await fetch(`https://${domain}/admin/api/2024-01/products/${produkt.id}.json`, {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: upd }),
    });
    const putData = await putRes.json();
    if (!putRes.ok) {
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'Shopify-Update fehlgeschlagen: ' + JSON.stringify(putData.errors || putData) }) };
    }

    // ── Metafelder aktualisieren/anlegen ──────────────────────────────
    const MF_RE = /^Metafield: ([^.\s]+)\.([^\s\[]+) \[([^\]]+)\]$/;
    let metafelderGesetzt = 0;
    for (const col of Object.keys(CI)) {
      const m = col.match(MF_RE);
      if (!m) continue;
      const raw = rows.map(r => get(r, col)).find(v => v) || '';
      if (!raw) continue;

      let value = raw;
      if (m[3] === 'number_integer')      value = parseInt(raw) || 0;
      else if (m[3] === 'number_decimal') value = parseFloat(raw) || 0;
      else if (m[3] === 'boolean')        value = raw.toLowerCase() === 'true';

      const vorhanden = alteMetafelder.find(x => x.namespace === m[1] && x.key === m[2]);
      const res = vorhanden
        ? await fetch(`https://${domain}/admin/api/2024-01/metafields/${vorhanden.id}.json`, {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ metafield: { id: vorhanden.id, value, type: m[3] } }),
          })
        : await fetch(`https://${domain}/admin/api/2024-01/products/${produkt.id}/metafields.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ metafield: { namespace: m[1], key: m[2], type: m[3], value } }),
          });
      if (res.ok) metafelderGesetzt++;
    }

    // ── Bild-Alt-Texte aktualisieren ──────────────────────────────────
    // Zuordnung ueber die Bild-URL (CDN-src aus der Tabelle), Fallback Position
    let altTexteGesetzt = 0;
    for (const r of rows) {
      const url = get(r, 'Product image URL');
      const alt = get(r, 'Image alt text');
      if (!url || !alt) continue;
      const pos = parseInt(get(r, 'Image position')) || 0;
      const img = (produkt.images || []).find(i => i.src === url)
        || (produkt.images || []).find(i => i.position === pos);
      if (!img || img.alt === alt) continue;
      const res = await fetch(`https://${domain}/admin/api/2024-01/products/${produkt.id}/images/${img.id}.json`, {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { id: img.id, alt } }),
      });
      if (res.ok) altTexteGesetzt++;
    }

    // Kategorien lassen sich ueber diese Schnittstelle nicht setzen -
    // transparent zurueckmelden, falls Werte in der Tabelle stehen
    const nichtUebernommen = [];
    if (get(mainRow, 'Product category'))                              nichtUebernommen.push('Product category');
    if (get(mainRow, 'Google Shopping / Google product category'))     nichtUebernommen.push('Google-Kategorie');

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({
        success: true,
        product_id: produkt.id,
        title: putData.product ? putData.product.title : produkt.title,
        admin_url: `https://${domain}/admin/products/${produkt.id}`,
        metafelder_gesetzt: metafelderGesetzt,
        alt_texte_gesetzt: altTexteGesetzt,
        nicht_uebernommen: nichtUebernommen,
        snapshot_url: snapshot.webViewLink || `https://drive.google.com/file/d/${snapshot.id}/view`,
      }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
