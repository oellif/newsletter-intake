const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260730
//
// Netlify Function (Skill 12: Campaign-Versand-Setup): legt eine
// echte Klaviyo-Kampagne als DRAFT an - verknuepft das Template aus
// Skill 8, die beste Betreff-Variante aus Skill 7 und eine Zielgruppe
// (entweder explizit uebergeben oder automatisch per einfachem
// Stichwortabgleich wie in Skill 10 vorgeschlagen). Loest KEINEN
// Versand aus - das bleibt ein manueller, bestaetigter Schritt in
// der Klaviyo-UI oder in einem spaeteren Skill.

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
const EXTRA_HEADER = ['Klaviyo-Kampagne-ID', 'Kampagne erstellt am'];
const FALLBACK_SENDER_EMAIL = process.env.INTERNAL_TEST_EMAIL || 'office@kf-laserworks.com';

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
  keywords.forEach(function (kw) { if (nameLower.indexOf(kw) !== -1) score += 1; });
  return score;
}

// Sucht eine E-Mail-Adresse im Impressum/Abmeldelink-Text des Kundenprofils,
// damit die Kampagne nicht mit einer offensichtlich falschen Absenderadresse
// angelegt wird. Findet sie keine, wird klar markiert ein Platzhalter genutzt.
function guessSenderEmail(profileMap) {
  const haystack = [
    profileMap['Impressum-Snippet'],
    profileMap['Abmeldelink-Text'],
    profileMap['Pflichtangaben (Basic)'],
  ].filter(Boolean).join(' ');
  const match = haystack.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? { email: match[0], guessed: true } : { email: FALLBACK_SENDER_EMAIL, guessed: false };
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
  const audienceIdOverride = String(data.audienceId || '').trim();
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
    profileRows.slice(1).forEach(function (r) { if (r[0]) profileMap[r[0]] = r[1] || ''; });

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:Z500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Kopfzeile ggf. um Kampagnen-Spalten (P-Q) ergaenzen, ohne A-O anzufassen.
    const header = rows[0];
    if (header.length < 17 || !header[15]) {
      const newHeader = header.slice(0, 15).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:Q1');
    }

    // Zielzeile: hat Template (J) und QA-Status (N), aber noch keine
    // Kampagne (P) - oder exakter Thema-Treffer.
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasTemplate = row[9] && String(row[9]).trim();
      const hasQa = row[13] && String(row[13]).trim();
      const hasCampaign = row[15] && String(row[15]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (hasTemplate && hasQa && !hasCampaign) {
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
            : 'Kein Thema mit Template + QA-Check ohne Kampagne gefunden. Bitte zuerst Skill 8 (Template) und Skill 11 (QA-Check) laufen lassen.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = targetRow[1];
    const templateId = targetRow[9];
    if (!templateId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Fuer dieses Thema wurde noch kein Klaviyo-Template gebaut (Skill 8).' }) };
    }
    let variants = [];
    try {
      variants = JSON.parse(targetRow[7] || '[]');
    } catch (err) {
      variants = [];
    }
    const betreffModus = String(targetRow[25] || 'ab').trim() || 'ab';

    // Ausgewaehlte Variante(n) ermitteln - respektiert die Checkbox-Auswahl
    // und den eigenen Betreff aus der Copy-Draft-Seite, statt blind immer
    // die erste generierte Variante zu nehmen.
    const selected = variants.filter(function (v) { return v && v.ausgewaehlt; });
    // Klaviyo unterstuetzt Betreff-A/B-Tests aktuell NICHT ueber die API
    // (nur manuell in der Klaviyo-UI) - wir koennen also technisch immer nur
    // EINEN Betreff pro Kampagne setzen. Bei "ab" mit mehreren Haken nehmen
    // wir die erste ausgewaehlte Variante und weisen im Response klar darauf
    // hin, welche weiteren Varianten fuer einen manuellen A/B-Test uebrig sind.
    const chosen = selected[0] || variants[0] || null;
    const subject = (chosen && chosen.betreff) || thema;
    const previewText = (chosen && chosen.preview) || '';
    const otherSelectedSubjects = selected.slice(1).map(function (v) { return v.betreff; }).filter(Boolean);
    const abTestNote = (betreffModus === 'ab' && otherSelectedSubjects.length)
      ? 'Hinweis: Klaviyo unterstuetzt Betreff-A/B-Tests nicht automatisiert ueber die API. Es wurde "' + subject + '" als Kampagnen-Betreff verwendet. Weitere ausgewaehlte Varianten fuer einen manuellen A/B-Test in der Klaviyo-UI: ' + otherSelectedSubjects.join(' | ')
      : null;

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilId);

    // Zielgruppe bestimmen: explizit uebergeben, oder automatisch per
    // Stichwortabgleich (gleiche Logik wie Skill 10, hier ohne Reichweiten-
    // Schaetzung, da wir nur die ID fuer die Kampagne brauchen).
    let audienceId = audienceIdOverride;
    let audienceName = null;
    if (!audienceId) {
      const [listsResult, segmentsResult] = await Promise.all([
        klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/lists/?fields[list]=name'),
        klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/segments/?fields[segment]=name'),
      ]);
      const lists = (listsResult.data || []).map(function (l) { return { id: l.id, name: l.attributes.name }; });
      const segments = (segmentsResult.data || []).map(function (s) { return { id: s.id, name: s.attributes.name }; });
      const audiences = lists.concat(segments);
      if (!audiences.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Dieser Klaviyo-Account hat weder Listen noch Segmente - keine Zielgruppe fuer die Kampagne verfuegbar.' }) };
      }
      const keywords = extractKeywords(thema);
      const scored = audiences.map(function (a) { return Object.assign({}, a, { score: scoreMatch(keywords, a.name) }); });
      scored.sort(function (a, b) { return b.score - a.score; });
      audienceId = scored[0].id;
      audienceName = scored[0].name;
    }

    const sender = guessSenderEmail(profileMap);

    // Versand-Datum (geplant) aus Spalte Y (Index 24) des Redaktionsplans -
    // vom Nutzer ueber die Redaktionsplan-Seite gepflegt. Zwei moegliche
    // Formate: nur Datum "JJJJ-MM-TT" (Uhrzeit fehlt -> 09:00 UTC als
    // Standard) oder Datum+Uhrzeit "JJJJ-MM-TTTHH:MM" (seit der Ergaenzung
    // des Uhrzeit-Felds in der Redaktionsplan-Oberflaeche - wird 1:1
    // uebernommen, als UTC interpretiert). Ohne gueltigen Wert bleibt der
    // bisherige Platzhalter (+7 Tage) als Fallback bestehen.
    const versandDatumRaw = String(targetRow[24] || '').trim();
    let sendDatetime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    let versandDatumUsed = false;
    let parsed = null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(versandDatumRaw)) {
      parsed = new Date(versandDatumRaw + ':00.000Z');
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(versandDatumRaw)) {
      parsed = new Date(versandDatumRaw + 'T09:00:00.000Z');
    }
    if (parsed && !isNaN(parsed.getTime())) {
      sendDatetime = parsed.toISOString();
      versandDatumUsed = true;
    }

    // Kampagne als Entwurf anlegen. send_strategy "manual" heisst: Klaviyo
    // legt sie als Entwurf an und versendet NICHT automatisch.
    const campaignResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaigns/', {
      data: {
        type: 'campaign',
        attributes: {
          // "Skill" als erstes Wort im Kampagnennamen - solange wir noch in
          // der Entwicklungs-/Testphase sind, damit in Klaviyo auf einen
          // Blick erkennbar ist, welche Kampagnen aus diesem System stammen
          // und bei Bedarf wieder geloescht werden koennen.
          name: 'Skill - ' + thema,
          audiences: { included: [audienceId] },
          // "static" verlangt einen Zeitpunkt (options_static.datetime), loest
          // aber selbst KEINEN Versand aus - Klaviyo legt die Kampagne als
          // Entwurf an; erst ein separater send-job (den wir hier bewusst
          // nicht aufrufen) wuerde tatsaechlich versenden.
          send_strategy: {
            method: 'static',
            options_static: {
              datetime: sendDatetime,
              is_local: false,
            },
          },
          'campaign-messages': {
            data: [
              {
                type: 'campaign-message',
                attributes: {
                  channel: 'email',
                  label: 'Hauptversion',
                  content: {
                    subject: subject,
                    preview_text: previewText,
                    from_email: sender.email,
                    from_label: folderName,
                  },
                },
              },
            ],
          },
        },
      },
    });

    const campaignId = campaignResult.data.id;
    const campaignMessageId = campaignResult.data.relationships['campaign-messages'].data[0].id;

    await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaign-message-assign-template/', {
      data: {
        type: 'campaign-message',
        id: campaignMessageId,
        relationships: { template: { data: { type: 'template', id: templateId } } },
      },
    });

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[campaignId, new Date().toISOString()]],
      'P' + sheetRowNumber + ':Q' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        campaignId: campaignId,
        subject: subject,
        audienceId: audienceId,
        audienceName: audienceName,
        senderEmail: sender.email,
        senderEmailGuessed: sender.guessed,
        note: 'Kampagne wurde als Entwurf angelegt und NICHT versendet. Bitte in Klaviyo pruefen (v.a. Absenderadresse) und manuell freigeben.',
        abTestNote: abTestNote,
        sendDatetime: sendDatetime,
        versandDatumAusRedaktionsplanVerwendet: versandDatumUsed,
        klaviyoCampaignUrl: 'https://www.klaviyo.com/campaign/' + campaignId + '/edit',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Campaign-Versand-Setup.', details: err.message }) };
  }
};
