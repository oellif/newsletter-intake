const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260730
//
// Netlify Function (Skill 11: Newsletter-QA-Check): prueft das in
// Skill 8 gebaute Klaviyo-Template vor dem Versand auf drei Dinge:
// 1) kaputte/verdaechtige Links (Live-Check per HTTP-Request),
// 2) Pflichtangaben aus dem Kundenprofil (Impressum, Abmeldelink,
//    sonstige Pflichtangaben) - werden per Stichwortabgleich im
//    gerenderten HTML gesucht,
// 3) einfache Darstellungs-Heuristiken fuer Desktop/Mobile (Viewport-
//    Meta-Tag vorhanden, Bilder ohne Alt-Text).
// Rein pruefend/beratend - schreibt nur eine Status-Zusammenfassung
// in den Redaktionsplan, aendert das Template selbst nicht.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  sheetsReadValues,
  sheetsWriteValues,
} = require('./lib/google');

const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const EXTRA_HEADER = ['QA-Status', 'QA geprueft am'];
const MAX_LINKS_TO_CHECK = 15;
const LINK_CHECK_TIMEOUT_MS = 6000;

function extractLinks(html) {
  const matches = String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi);
  const links = [];
  for (const m of matches) links.push(m[1]);
  return Array.from(new Set(links));
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function extractKeywords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/g, ' ')
    .split(/\s+/)
    .filter(function (w) { return w.length > 4; });
}

async function checkLink(url) {
  if (!url || url === '#' || url.startsWith('javascript:')) {
    return { url: url, status: 'ignoriert', ok: true, detail: 'Platzhalter-Link (kein echtes Ziel)' };
  }
  if (url.startsWith('mailto:') || url.startsWith('tel:')) {
    return { url: url, status: 'ignoriert', ok: true, detail: 'mailto/tel-Link, kein HTTP-Check moeglich' };
  }
  if (url.startsWith('{{') || url.indexOf('{{') !== -1) {
    return { url: url, status: 'ignoriert', ok: true, detail: 'Klaviyo-Template-Variable, erst zur Laufzeit aufgeloest' };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { url: url, status: 'warnung', ok: false, detail: 'Kein absoluter http(s)-Link' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, LINK_CHECK_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      }
    } finally {
      clearTimeout(timeout);
    }
    if (res.ok) return { url: url, status: 'ok', ok: true, detail: 'HTTP ' + res.status };
    return { url: url, status: 'fehler', ok: false, detail: 'HTTP ' + res.status };
  } catch (err) {
    return { url: url, status: 'fehler', ok: false, detail: 'Nicht erreichbar: ' + err.message };
  }
}

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
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

    const profileRows = await sheetsReadValues(accessToken, kundenprofilId, 'A1:B30');
    const profileMap = {};
    profileRows.slice(1).forEach(function (r) {
      if (r[0]) profileMap[r[0]] = r[1] || '';
    });
    const pflichtangabenText = [
      profileMap['Pflichtangaben (Basic)'],
      profileMap['Impressum-Snippet'],
      profileMap['Abmeldelink-Text'],
    ].filter(Boolean).join(' ');

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:O500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Kopfzeile ggf. um QA-Spalten (N-O) ergaenzen, ohne A-M anzufassen.
    const header = rows[0];
    if (header.length < 15 || !header[13]) {
      const newHeader = header.slice(0, 13).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:O1');
    }

    // Zielzeile: hat Klaviyo-Template-ID (J), aber noch keinen QA-Status (N) -
    // oder exakter Thema-Treffer.
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasTemplate = row[9] && String(row[9]).trim();
      const hasQa = row[13] && String(row[13]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (hasTemplate && !hasQa) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: themaFilter
            ? 'Thema "' + themaFilter + '" wurde im Redaktionsplan nicht gefunden.'
            : 'Kein Thema mit Klaviyo-Template ohne QA-Check gefunden. Bitte zuerst Skill 8 (Template-Builder) laufen lassen.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = targetRow[1];
    const templateId = targetRow[9];
    if (!templateId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Fuer dieses Thema wurde noch kein Klaviyo-Template gebaut (Skill 8).' }) };
    }

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilId);
    const templateResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/templates/' + templateId + '/');
    const html = templateResult && templateResult.data && templateResult.data.attributes && templateResult.data.attributes.html;
    if (!html) {
      throw new Error('Klaviyo-Template (ID ' + templateId + ') konnte nicht gelesen werden oder ist leer.');
    }

    // 1) Links pruefen (auf MAX_LINKS_TO_CHECK begrenzt, um Laufzeit/Rate-Limits zu schonen).
    const allLinks = extractLinks(html);
    const linksToCheck = allLinks.slice(0, MAX_LINKS_TO_CHECK);
    const linkResults = await Promise.all(linksToCheck.map(checkLink));
    const brokenLinks = linkResults.filter(function (l) { return l.status === 'fehler'; });
    const warnLinks = linkResults.filter(function (l) { return l.status === 'warnung'; });

    // 2) Pflichtangaben pruefen: Stichwortabgleich im sichtbaren Text.
    const visibleText = stripTags(html).toLowerCase();
    const requiredKeywords = extractKeywords(pflichtangabenText);
    const uniqueKeywords = Array.from(new Set(requiredKeywords));
    const missingKeywords = uniqueKeywords.filter(function (kw) { return visibleText.indexOf(kw) === -1; });
    const pflichtangabenOk = !pflichtangabenText || missingKeywords.length === 0;

    // 3) Einfache Darstellungs-Heuristiken.
    const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(html);
    const imgTags = html.match(/<img[^>]*>/gi) || [];
    const imagesWithoutAlt = imgTags.filter(function (tag) { return !/alt\s*=\s*["'][^"']*["']/i.test(tag); }).length;

    const findings = {
      links: {
        total: allLinks.length,
        checked: linksToCheck.length,
        broken: brokenLinks,
        warnings: warnLinks,
        ok: brokenLinks.length === 0,
      },
      pflichtangaben: {
        ok: pflichtangabenOk,
        fehlendeStichworte: missingKeywords,
        hinweis: pflichtangabenText ? null : 'Kein Pflichtangaben-Text im Kundenprofil hinterlegt - Check uebersprungen.',
      },
      darstellung: {
        hasViewportMeta: hasViewportMeta,
        imagesTotal: imgTags.length,
        imagesWithoutAlt: imagesWithoutAlt,
        ok: hasViewportMeta && imagesWithoutAlt === 0,
      },
    };

    const overallOk = findings.links.ok && findings.pflichtangaben.ok && findings.darstellung.ok;
    const status = overallOk ? 'OK' : 'Warnung - siehe Details';

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[status, new Date().toISOString()]],
      'N' + sheetRowNumber + ':O' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        status: status,
        findings: findings,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim QA-Check.', details: err.message }) };
  }
};
