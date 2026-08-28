const { requireAuth } = require('./lib/auth');
// Masterartikel-Optimierer, Phase Uebernahme: schreibt die vom Menschen
// freigegebenen (ggf. korrigierten) Felder in die Mastertabelle. Nur diese
// Function schreibt - die Optimierung selbst (masterartikel-optimieren)
// liest nur. Handle-Schutz fuer Live-Artikel wird hier nochmals erzwungen.
const { getAccessToken, sheetsReadValues, sheetsWriteValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

const ERLAUBTE_FELDER = new Set([
  'Title', 'URL handle', 'Description', 'Vendor', 'Type', 'Tags',
  'SEO title', 'SEO description', 'Product category',
  'Google Shopping / Google product category', 'Google Shopping / Gender',
  'Google Shopping / Age group', 'Google Shopping / Condition',
]);
function istErlaubtesFeld(col) {
  return ERLAUBTE_FELDER.has(col) || col.startsWith('Metafield: ');
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
  // sheet_id optional: Workflow 2 (Bestand) schreibt in die Bestandstabelle
  const { kunden_id, handle, felder, alt_texte, sheet_id, modus } = body;
  if (!kunden_id || !handle) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id und handle erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const domain          = kundeRow[2];
    const token           = kundeRow[3];
    const mastertabelleId = sheet_id || kundeRow[6];
    if (!mastertabelleId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Mastertabelle vorhanden.' }) };

    const allRows = await sheetsReadValues(tok, mastertabelleId, 'A1:CZ2000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mastertabelle ist leer.' }) };
    const headerRow = allRows[0];
    const CI = {};
    headerRow.forEach((col, i) => { if (col) CI[col.trim()] = i; });
    const get = (row, col) => CI[col] !== undefined ? String(row[CI[col]] || '').trim() : '';

    const dataRows    = allRows.slice(1);
    const updatedRows = dataRows.map(r => [...r]);
    const groupIdx    = [];
    dataRows.forEach((r, i) => { if (get(r, 'URL handle') === handle) groupIdx.push(i); });
    if (!groupIdx.length) return { statusCode: 404, headers: h, body: JSON.stringify({ error: `Handle "${handle}" nicht in der Mastertabelle` }) };
    const mainIdx = groupIdx.find(i => get(dataRows[i], 'Title')) ?? groupIdx[0];

    // Handle-Schutz nochmals serverseitig pruefen
    let istLive = false;
    try {
      const liveRes  = await fetch(`https://${domain}/admin/api/2024-01/products.json?handle=${encodeURIComponent(handle)}&fields=id,status`, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      const liveData = await liveRes.json();
      istLive = !!(liveRes.ok && (liveData.products || []).some(p => p.status === 'active'));
    } catch(e) {}

    // Neue Metafeld-Spalten (z. B. aus der Metafeld-Datenbank) duerfen der
    // Tabelle hinzugefuegt werden - Kopfzeile wird dann mitgeschrieben
    let headerErweitert = false;
    for (const k of Object.keys(felder || {})) {
      if (k.startsWith('Metafield: ') && CI[k] === undefined) {
        headerRow.push(k);
        CI[k] = headerRow.length - 1;
        headerErweitert = true;
      }
    }

    const setCell = (rowIdx, col, val) => {
      const ci = CI[col];
      if (ci === undefined) return false;
      const row = updatedRows[rowIdx];
      while (row.length <= ci) row.push('');
      row[ci] = val;
      return true;
    };

    // Felder in die Hauptzeile schreiben (Whitelist)
    let feldCount = 0;
    let neuerHandle = '';
    for (const [k, v] of Object.entries(felder || {})) {
      if (!istErlaubtesFeld(k)) continue;
      if (k === 'URL handle') {
        if (istLive || modus === 'bestand') continue; // Handle einfrieren
        neuerHandle = String(v).trim();
        continue; // wird unten fuer ALLE Zeilen der Gruppe gesetzt
      }
      if (setCell(mainIdx, k, String(v))) feldCount++;
    }

    // Alt-Texte: je Zeile ueber die Image position zuordnen
    let altCount = 0;
    for (const a of (alt_texte || [])) {
      const pos = parseInt(a.position);
      if (!pos || !a.alt) continue;
      for (const i of groupIdx) {
        if (get(dataRows[i], 'Product image URL') && (parseInt(get(dataRows[i], 'Image position')) || 0) === pos) {
          if (setCell(i, 'Image alt text', String(a.alt))) altCount++;
          break;
        }
      }
    }

    // Neuer Handle (nur neue Artikel): in allen Zeilen der Gruppe ersetzen
    if (neuerHandle && neuerHandle !== handle) {
      for (const i of groupIdx) { setCell(i, 'URL handle', neuerHandle); }
      feldCount++;
    }

    if (headerErweitert) {
      await sheetsWriteValues(tok, mastertabelleId, [headerRow], 'A1');
    }
    await sheetsWriteValues(tok, mastertabelleId, updatedRows, 'A2');

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({
        success: true,
        felder_uebernommen: feldCount,
        alt_texte_uebernommen: altCount,
        neuer_handle: neuerHandle && neuerHandle !== handle ? neuerHandle : null,
        ist_live: istLive,
      }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
