const { requireAuth } = require('./lib/auth');
// Masterartikel-Optimierer, Phase Analyse+Generierung: nimmt EINEN Artikel
// (per handle) aus der Mastertabelle, laedt Kundenprofil + Bilder und laesst
// Claude alle Text-/SEO-Felder nach dem festen Regelwerk befuellen.
// SCHREIBT NICHTS - gibt Vorher/Nachher zurueck; die Uebernahme macht erst
// masterartikel-optimierung-uebernehmen nach menschlicher Freigabe.
const { getAccessToken, sheetsReadValues, callClaudeVision, parseJsonFromModelText } = require('./lib/google');
const { REGELWERK } = require('./lib/optimierer-regelwerk');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';
// Fallback-Kundenprofil (eydl Wood Jewelry) - siehe Wissensbasis-Anleitung.
// Entscheidung des Nutzers (Fall A): gilt auch fuer den Shop Marktplatz Helden.
const KUNDENPROFIL_FALLBACK_ID = '1Go0XDuaR6FthGuaWDliMiMarzP4G1t4w';
const MAX_BILDER = 6;
const MAX_BILD_BYTES = 4 * 1024 * 1024; // Anthropic-Limit ~5MB pro Bild, Puffer lassen

// Spalten, die der Optimierer befuellen darf (Whitelist - alles andere
// wird aus der Claude-Antwort verworfen)
const ERLAUBTE_FELDER = new Set([
  'Title', 'URL handle', 'Description', 'Vendor', 'Type', 'Tags',
  'SEO title', 'SEO description', 'Product category',
  'Google Shopping / Google product category', 'Google Shopping / Gender',
  'Google Shopping / Age group', 'Google Shopping / Condition',
]);
function istErlaubtesFeld(col) {
  return ERLAUBTE_FELDER.has(col) || col.startsWith('Metafield: ');
}

function extractDriveFileId(url) {
  const m = String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/) || String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

async function ladeKundenprofil(tok, kundenName) {
  // Bevorzugt: Datei "Kundenprofil_Masterartikel_<Name>" per Drive-Suche,
  // sonst der eydl-Fallback (Fall-A-Entscheidung).
  try {
    const safe = String(kundenName || '').replace(/'/g, "\\'");
    const q = encodeURIComponent(`name contains 'Kundenprofil_Masterartikel' and name contains '${safe}' and trashed = false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`, {
      headers: { Authorization: 'Bearer ' + tok },
    });
    const data = await res.json();
    if (res.ok && data.files && data.files.length) {
      const txt = await ladeDriveText(tok, data.files[0].id);
      if (txt) return txt;
    }
  } catch (e) {}
  return ladeDriveText(tok, KUNDENPROFIL_FALLBACK_ID);
}

async function ladeDriveText(tok, fileId) {
  // Normale Datei: alt=media. Google-Doc: Export als text/plain.
  let res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: 'Bearer ' + tok },
  });
  if (!res.ok) {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
      headers: { Authorization: 'Bearer ' + tok },
    });
  }
  return res.ok ? res.text() : '';
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
  // sheet_id optional: Workflow 2 (Bestandsoptimierung) uebergibt die
  // Bestandstabelle explizit; ohne sheet_id gilt die Mastertabelle (Spalte G)
  // master_handle: Masterartikel als NORM-Vorlage (Bestandsoptimierung) -
  // Struktur, Tag-Schema und Metafeld-Set werden darauf normalisiert
  // kein_scharfes_s: Schweizer Rechtschreibung - ss statt scharfem s,
  // doppelt abgesichert (KI-Anweisung + maschinelle Ersetzung unten)
  const { kunden_id, handle, sheet_id, modus, master_handle, kein_scharfes_s } = body;
  if (!kunden_id || !handle) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id und handle erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const kundenName      = kundeRow[1] || '';
    const domain          = kundeRow[2];
    const token           = kundeRow[3];
    const mastertabelleId = sheet_id || kundeRow[6];
    if (!mastertabelleId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Mastertabelle vorhanden.' }) };

    // Mastertabelle lesen, Zeilen des Handles finden
    const allRows = await sheetsReadValues(tok, mastertabelleId, 'A1:CZ2000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mastertabelle ist leer.' }) };
    const headerRow = allRows[0];
    const CI = {};
    headerRow.forEach((col, i) => { if (col) CI[col.trim()] = i; });
    const get = (row, col) => CI[col] !== undefined ? String(row[CI[col]] || '').trim() : '';

    const rows = allRows.slice(1).filter(r => get(r, 'URL handle') === handle);
    if (!rows.length) return { statusCode: 404, headers: h, body: JSON.stringify({ error: `Handle "${handle}" nicht in der Mastertabelle` }) };
    const mainRow = rows.find(r => get(r, 'Title')) || rows[0];

    // ist_live: existiert der Handle in Shopify als AKTIVES Produkt?
    // Dann darf der Handle NIEMALS geaendert werden (feste Nutzer-Entscheidung).
    let istLive = false;
    try {
      const liveRes  = await fetch(`https://${domain}/admin/api/2024-01/products.json?handle=${encodeURIComponent(handle)}&fields=id,status`, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      const liveData = await liveRes.json();
      istLive = !!(liveRes.ok && (liveData.products || []).some(p => p.status === 'active'));
    } catch(e) {}

    // Handle-Schutz: bei Live-Artikeln UND im Bestandsmodus einfrieren -
    // im Bestand wuerde ein neuer Handle die Zuordnung zum bestehenden
    // Shopify-Artikel zerstoeren (Zurueckspielen findet ihn nicht mehr)
    const handleGeschuetzt = istLive || modus === 'bestand';

    // Master-Vorlage laden (falls angegeben): Titel-/Beschreibungsaufbau,
    // Tags, Vendor/Typ und Metafelder des Masters dienen als Norm
    let vorlageText = '';
    if (master_handle && master_handle !== handle) {
      try {
        const mRes  = await fetch(
          `https://${domain}/admin/api/2024-01/products.json?handle=${encodeURIComponent(master_handle)}`,
          { headers: { 'X-Shopify-Access-Token': token } }
        );
        const mData = await mRes.json();
        const master = mRes.ok && (mData.products || [])[0];
        if (master) {
          const mfRes  = await fetch(`https://${domain}/admin/api/2024-01/products/${master.id}/metafields.json?limit=250`, {
            headers: { 'X-Shopify-Access-Token': token },
          });
          const mfData = await mfRes.json();
          const masterMfs = (mfRes.ok ? (mfData.metafields || []) : [])
            .filter(m => !m.namespace.startsWith('shopify') && !m.namespace.includes('--'))
            .map(m => `- ${m.namespace}.${m.key}: ${String(typeof m.value === 'object' ? JSON.stringify(m.value) : m.value).slice(0, 200)}`);
          vorlageText = `\n=== NORM-VORLAGE (Masterartikel "${master.title}") ===
Der zu optimierende Artikel MUSS auf diese Vorlage normalisiert werden:
- Beschreibungs-AUFBAU exakt wie die Vorlage (gleiche Absatz-Struktur, gleicher Stil) - Inhalte artikelspezifisch
- Tag-SCHEMA wie die Vorlage (gleiche Kategorien-Logik, artikelspezifische Werte)
- Vendor und Typ exakt wie die Vorlage (ausser Typ ist ein Funktionskennzeichen)
- ALLE Metafelder der Vorlage muessen am Artikel gefuellt werden (artikelspezifischer Wert; wenn nicht ableitbar -> "offen"-Liste, NICHT erfinden)
Vorlage-Titel: ${master.title}
Vorlage-Vendor: ${master.vendor || ''} | Vorlage-Typ: ${master.product_type || ''}
Vorlage-Tags: ${String(master.tags || '').split(',').map(t => t.trim()).filter(t => t.toLowerCase() !== 'master').join(', ')}
Vorlage-Beschreibung (Aufbau-Referenz):
${String(master.body_html || '').slice(0, 2500)}
Vorlage-Metafelder:
${masterMfs.join('\n') || '(keine)'}\n`;
        }
      } catch(e) {}
    }

    // Kundenprofil (Pflicht-Input - ohne Profil keine Textgenerierung)
    const kundenprofil = await ladeKundenprofil(tok, kundenName);
    if (!kundenprofil) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Kein Kundenprofil gefunden (Kundenprofil_Masterartikel_*.md in Drive). Ohne Profil keine Textgenerierung.' }) };
    }

    // Bilder sammeln fuer die Alt-Text-Bildanalyse. Zwei Quellen:
    // - Drive-Links (Workflow 1, Neuanlage): authentifiziert laden, Ordner
    //   muss nicht oeffentlich sein
    // - Shopify-CDN-Links (Workflow 2, Bestand): direkt laden, oeffentlich
    const bildInfos = []; // { url, position, art, ... }
    const seenUrls = new Set();
    for (const r of rows) {
      const url = get(r, 'Product image URL');
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        bildInfos.push({ url, position: parseInt(get(r, 'Image position')) || bildInfos.length + 1, art: 'produkt', alt_bisher: get(r, 'Image alt text') });
      }
    }
    for (const r of rows) {
      const url = get(r, 'Variant image URL');
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        const opts = [get(r, 'Option1 value'), get(r, 'Option2 value'), get(r, 'Option3 value')].filter(Boolean);
        bildInfos.push({ url, position: 0, art: 'variante', optionswerte: opts });
      }
    }

    const images = [];
    const bildBeschreibung = [];
    for (const info of bildInfos.slice(0, MAX_BILDER)) {
      try {
        const fid = extractDriveFileId(info.url);
        const res = fid
          ? await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?alt=media&supportsAllDrives=true`, {
              headers: { Authorization: 'Bearer ' + tok },
            })
          : await fetch(info.url); // Shopify-CDN oder andere oeffentliche URL
        if (!res.ok) continue;
        const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
        const buf  = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_BILD_BYTES) continue;
        images.push({ media_type: mime, data: buf.toString('base64') });
        bildBeschreibung.push(
          info.art === 'produkt'
            ? `Bild ${images.length}: Produktbild Position ${info.position}${info.alt_bisher ? ` (bisheriger Alt-Text: "${info.alt_bisher}")` : ''}`
            : `Bild ${images.length}: Variantenbild fuer Optionswerte ${JSON.stringify(info.optionswerte)}`
        );
      } catch(e) {}
    }

    // Artikel-Daten fuer den Prompt
    const artikelFelder = {};
    for (const col of Object.keys(CI)) {
      if (istErlaubtesFeld(col)) artikelFelder[col] = get(mainRow, col);
    }
    const varianten = rows.map(r => ({
      option1: get(r, 'Option1 value'), option2: get(r, 'Option2 value'), option3: get(r, 'Option3 value'),
      sku: get(r, 'SKU'), preis: get(r, 'Price'),
    }));
    const optionNamen = [get(mainRow, 'Option1 name'), get(mainRow, 'Option2 name'), get(mainRow, 'Option3 name')].filter(Boolean);
    const metafeldSpalten = Object.keys(CI).filter(c => c.startsWith('Metafield: '));

    const prompt = `Du bist der Masterartikel-Optimierer fuer Shopify-Artikel. Arbeite EXAKT nach diesem Regelwerk:

${REGELWERK}

=== KUNDENPROFIL (Brand Voice, Tags, Metafelder - fliesst in JEDEN Text ein) ===
${kundenprofil}
${vorlageText}

=== ARTIKEL (aktueller Stand aus der Mastertabelle) ===
URL handle: ${handle}
ist_live: ${istLive}${handleGeschuetzt ? ' — HANDLE GESCHUETZT: Feld "URL handle" KOMPLETT WEGLASSEN!' : ' (neuer Artikel: SEO-Handle darf vorgeschlagen werden)'}
Optionsnamen: ${JSON.stringify(optionNamen)}
Felder: ${JSON.stringify(artikelFelder, null, 1)}
Varianten: ${JSON.stringify(varianten)}
Vorhandene Metafeld-Spalten: ${JSON.stringify(metafeldSpalten)}
${images.length ? `\n=== BILDER (oben angehaengt, fuer die Alt-Text-Analyse) ===\n${bildBeschreibung.join('\n')}` : '\nKeine Bilder verfuegbar - KEINE alt_texte erzeugen, stattdessen in "offen" vermerken.'}

=== AUFGABE ===
${vorlageText ? 'Normalisiere den Artikel ZUERST auf die NORM-VORLAGE (Struktur, Tag-Schema, Vendor/Typ, Metafeld-Set), dann optimiere die Inhalte. ' : ''}${kein_scharfes_s ? 'SCHWEIZER RECHTSCHREIBUNG: Das Zeichen "ß" darf in KEINEM Text vorkommen - schreibe stattdessen immer "ss" (z. B. "Grösse" statt "Größe", "geniessen" statt "genießen"). ' : ''}Optimiere alle Text- und SEO-Felder nach dem Regelwerk. Erfinde NIE Fakten.
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Markdown-Zaeune, exakt in dieser Form:
{
  "felder": { "<Spaltenname wie im Artikel>": "<neuer Wert>", ... },
  "alt_texte": [ { "position": <Image position der Zeile>, "alt": "<Alt-Text max 125 Zeichen>" }, ... ],
  "unsicher": [ { "feld": "<Spaltenname>", "grund": "<warum unsicher>" } ],
  "offen": [ "<fehlende Info, die ein Mensch nachtragen muss>" ]
}
Regeln fuer "felder": nur Spaltennamen aus dem Artikel verwenden; nur Felder aufnehmen, die du wirklich verbesserst; gesperrte Felder (SKU, Preise, Bestaende, Status, Optionen ...) NIEMALS aufnehmen.${handleGeschuetzt ? ' "URL handle" NICHT aufnehmen (Handle ist geschuetzt).' : ''}
Regeln fuer "alt_texte": nur wenn Bilder angehaengt sind; Position = die Image position des jeweiligen Produktbildes; Variantenbilder bekommen KEINEN Eintrag in alt_texte.`;

    const antwort = await callClaudeVision(prompt, images, 16000);
    let ergebnis;
    try {
      ergebnis = parseJsonFromModelText(antwort);
    } catch(e) {
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'Claude-Antwort war kein gueltiges JSON: ' + String(antwort).slice(0, 300) }) };
    }

    // Server-seitige Absicherung: Whitelist + Handle-Schutz + ss-Garantie
    const entschaerfen = (s) => kein_scharfes_s ? String(s).replace(/ß/g, 'ss') : String(s);
    const felder = {};
    for (const [k, v] of Object.entries(ergebnis.felder || {})) {
      if (!istErlaubtesFeld(k)) continue;
      if (k === 'URL handle' && handleGeschuetzt) continue;
      if (CI[k] === undefined) continue; // Spalte existiert nicht in dieser Tabelle
      felder[k] = entschaerfen(v);
    }

    // Vorher-Werte fuer die Vorher/Nachher-Ansicht
    const vorher = {};
    for (const k of Object.keys(felder)) vorher[k] = get(mainRow, k);
    const alt_vorher = rows
      .filter(r => get(r, 'Product image URL'))
      .map(r => ({ position: parseInt(get(r, 'Image position')) || 0, alt: get(r, 'Image alt text') }));

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({
        success: true,
        handle,
        ist_live: istLive,
        titel: get(mainRow, 'Title') || handle,
        felder,
        vorher,
        alt_texte: (ergebnis.alt_texte || []).map(a => ({ position: parseInt(a.position) || 0, alt: entschaerfen(a.alt || '') })),
        alt_vorher,
        unsicher: ergebnis.unsicher || [],
        offen: ergebnis.offen || [],
        bilder_analysiert: images.length,
      }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
