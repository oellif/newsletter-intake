const { requireAuth } = require('./lib/auth');
// Gruppen-Analyse fuer den Artikeloptimierer: erkennt in EINEM guenstigen
// Text-KI-Aufruf Gruppen aehnlicher Artikel (gleicher Pilz in 3 Groessen,
// gleicher Korb in 3 Durchmessern) und bestimmt pro Gruppe die
// SIGNIFIKANTE Abmessung (die sich innerhalb der Gruppe unterscheidet).
// KONSERVATIVE Regel (Entscheidung des Nutzers): gruppiert wird nur bei
// gleicher Produktart + gleichem Material + nahezu gleichem Namensstamm -
// im Zweifel KEINE Gruppe (dann greift die Standardregel im Optimierer).
const { getAccessToken, sheetsReadValues, callClaudeVision, parseJsonFromModelText } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

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
  const { kunden_id, sheet_id, handles } = body;
  if (!kunden_id || !sheet_id || !Array.isArray(handles) || handles.length < 2) {
    // Mit weniger als 2 Artikeln gibt es nichts zu gruppieren
    return { statusCode: 200, headers: h, body: JSON.stringify({ gruppen: [] }) };
  }

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const kundeRow   = (kundenRows || []).find(r => r[0] === kunden_id);
    if (!kundeRow) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };

    const allRows = await sheetsReadValues(tok, sheet_id, 'A1:CZ2000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Bestandstabelle ist leer.' }) };
    const CI = {};
    allRows[0].forEach((col, i) => { if (col) CI[col.trim()] = i; });
    const get = (row, col) => CI[col] !== undefined ? String(row[CI[col]] || '').trim() : '';

    // Kompakte Artikel-Steckbriefe fuer die KI (nur Hauptzeilen)
    const artikel = [];
    for (const handle of handles) {
      const rows = allRows.slice(1).filter(r => get(r, 'URL handle') === handle);
      if (!rows.length) continue;
      const mainRow = rows.find(r => get(r, 'Title')) || rows[0];
      artikel.push({
        handle,
        titel: get(mainRow, 'Title'),
        typ: get(mainRow, 'Type'),
        beschreibung_auszug: get(mainRow, 'Description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300),
      });
    }
    if (artikel.length < 2) return { statusCode: 200, headers: h, body: JSON.stringify({ gruppen: [] }) };

    const prompt = `Du analysierst Shopify-Artikel eines Shops und erkennst Gruppen des GLEICHEN Produkts in verschiedenen Groessen (z. B. derselbe Deko-Pilz in 3 Hoehen, derselbe Korb in 3 Durchmessern, dieselbe Kiste in 3 Laengen).

STRENGE REGELN:
- Eine Gruppe nur bilden, wenn Produktart, Material UND Namensstamm praktisch identisch sind und sich die Artikel im Wesentlichen nur in der Groesse unterscheiden.
- IM ZWEIFEL KEINE GRUPPE - lieber keinen Artikel gruppieren als einen falsch.
- Gruppen haben mindestens 2 Mitglieder.
- Pro Gruppe die SIGNIFIKANTE Abmessung bestimmen: die Dimension, die sich zwischen den Mitgliedern unterscheidet. Erlaubte Werte: "Durchmesser", "Hoehe", "Laenge", "Breite".

ARTIKEL:
${JSON.stringify(artikel, null, 1)}

Antworte AUSSCHLIESSLICH als JSON, ohne Markdown-Zaeune:
{ "gruppen": [ { "name": "<kurzer Gruppenname>", "abmessung": "<Durchmesser|Hoehe|Laenge|Breite>", "handles": ["<handle>", ...] } ] }
Keine Gruppen gefunden -> { "gruppen": [] }`;

    const antwort = await callClaudeVision(prompt, [], 8000);
    let ergebnis;
    try { ergebnis = parseJsonFromModelText(antwort); }
    catch(e) { return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'Gruppen-Antwort war kein JSON' }) }; }

    // Maschinelle Absicherung: nur bekannte Handles, min. 2 Mitglieder,
    // jeder Handle in hoechstens einer Gruppe, gueltige Abmessung
    const bekannt = new Set(artikel.map(a => a.handle));
    const vergeben = new Set();
    const ERLAUBT = ['Durchmesser', 'Hoehe', 'Laenge', 'Breite'];
    const gruppen = [];
    for (const g of (ergebnis.gruppen || [])) {
      const mitglieder = (g.handles || []).filter(x => bekannt.has(x) && !vergeben.has(x));
      const abmessung  = ERLAUBT.find(a => a.toLowerCase() === String(g.abmessung || '').toLowerCase());
      if (mitglieder.length < 2 || !abmessung) continue;
      mitglieder.forEach(x => vergeben.add(x));
      gruppen.push({ name: String(g.name || 'Gruppe'), abmessung, handles: mitglieder });
    }

    return { statusCode: 200, headers: h, body: JSON.stringify({ gruppen }) };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
