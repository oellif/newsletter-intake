// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260730
//
// Netlify Function (Skill 10: Zielgruppen-Segment-Mapper): liest die
// tatsaechliche Listen- und Segmentstruktur des Kunden-Klaviyo-Accounts
// aus, schaetzt die Reichweite (Naeherungswert, keine exakte Zaehlung -
// Klaviyo liefert keine direkten Totals ueber die Standard-API) und
// schlaegt anhand des Redaktionsplan-Themas eine passende Zielgruppe
// vor. Rein informativ/beratend - schreibt nichts fest, die eigentliche
// Zuordnung passiert erst in Skill 12 (Campaign-Versand-Setup).

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
} = require('./lib/google');

const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const REACH_PAGE_SIZE = 100;
const REACH_MAX_PAGES = 3; // Naeherungs-Obergrenze, um Rate-Limits/Laufzeit zu schonen.

const STOPWORDS = ['der', 'die', 'das', 'und', 'auf', 'bis', 'im', 'zu', 'mit', 'fuer', 'neue', 'neuer', 'neues', 'test', 'idee'];

function extractKeywords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/g, ' ')
    .split(/\s+/)
    .filter(function (w) { return w.length > 3 && STOPWORDS.indexOf(w) === -1; });
}

function scoreMatch(keywords, name) {
  const nameLower = String(name || '').toLowerCase();
  let score = 0;
  keywords.forEach(function (kw) {
    if (nameLower.indexOf(kw) !== -1) score += 1;
  });
  return score;
}

// Naeherungsweise Reichweite: paginiert bis zu REACH_MAX_PAGES Seiten a
// REACH_PAGE_SIZE Profile. Liefert entweder die exakte Zahl (wenn keine
// weitere Seite existiert) oder eine "mindestens N" Naeherung.
async function estimateReach(klaviyoAccessToken, kind, id) {
  const basePath = kind === 'list' ? '/api/lists/' + id + '/profiles/' : '/api/segments/' + id + '/profiles/';
  let count = 0;
  let cursorParam = '';
  let hasMore = false;
  for (let page = 0; page < REACH_MAX_PAGES; page++) {
    const path = basePath + '?page[size]=' + REACH_PAGE_SIZE + '&fields[profile]=id' + cursorParam;
    const result = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', path);
    const items = (result && result.data) || [];
    count += items.length;
    const nextLink = result && result.links && result.links.next;
    if (!nextLink) { hasMore = false; break; }
    hasMore = true;
    const nextUrl = new URL(nextLink);
    const cursor = nextUrl.searchParams.get('page[cursor]');
    if (!cursor) break;
    cursorParam = '&page[cursor]=' + encodeURIComponent(cursor);
  }
  return { count: count, isApproximate: hasMore };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON im Request-Body.' }) };
  }

  const kundenname = String(data.kundenname || '').trim();
  const themaFilter = String(data.thema || '').trim();
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname ist Pflichtfeld.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID ist nicht als Umgebungsvariable gesetzt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenordner fuer "' + kundenname + '" gefunden.' }) };
    }

    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    const kundenprofilId = kundenprofilSheet ? kundenprofilSheet.id : null;
    if (!kundenprofilId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenprofil fuer "' + kundenname + '" gefunden.' }) };
    }

    // Thema optional aus Redaktionsplan uebernehmen, falls nicht direkt uebergeben.
    let thema = themaFilter;
    if (!thema) {
      let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
      if (!redaktionsplanId) {
        const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
        if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
      }
      if (redaktionsplanId) {
        const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:B500');
        for (let i = rows.length - 1; i >= 1; i--) {
          if (rows[i] && rows[i][1]) { thema = rows[i][1]; break; }
        }
      }
    }

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilId);

    const [listsResult, segmentsResult] = await Promise.all([
      klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/lists/?fields[list]=name'),
      klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/segments/?fields[segment]=name'),
    ]);

    const lists = (listsResult.data || []).map(function (l) { return { kind: 'list', id: l.id, name: l.attributes.name }; });
    const segments = (segmentsResult.data || []).map(function (s) { return { kind: 'segment', id: s.id, name: s.attributes.name }; });
    const audiences = lists.concat(segments);

    if (!audiences.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Dieser Klaviyo-Account hat weder Listen noch Segmente.' }) };
    }

    const keywords = extractKeywords(thema);
    const scored = audiences.map(function (a) {
      return Object.assign({}, a, { matchScore: scoreMatch(keywords, a.name) });
    });
    scored.sort(function (a, b) { return b.matchScore - a.matchScore; });

    // Reichweite nur fuer die Top-5 Kandidaten schaetzen (Rate-Limits/Laufzeit schonen).
    const topCandidates = scored.slice(0, 5);
    for (const candidate of topCandidates) {
      const reach = await estimateReach(klaviyoAccessToken, candidate.kind, candidate.id);
      candidate.estimatedReach = reach.count;
      candidate.reachIsApproximate = reach.isApproximate;
    }

    const suggestion = topCandidates[0] || null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema || null,
        suggestion: suggestion,
        candidates: topCandidates,
        totalListsAndSegments: audiences.length,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Segment-Mapper.', details: err.message }) };
  }
};
