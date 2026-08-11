// Ablage- & Versionsregel v1 aktiv - umgestellt auf definition-API am 20260811
//
// Netlify Function (Skill 8: Klaviyo-Template-Builder): erstellt pro Kampagne
// ein frisches SYSTEM_DRAGGABLE-Template über die Klaviyo definition-API
// (Revision 2026-07-15). Der Kunde kann das Ergebnis danach im visuellen
// Klaviyo-Drag&Drop-Editor final anpassen – die Drag&Drop-Faehigkeit bleibt
// erhalten (im Gegensatz zum alten CODE-Typ-Ansatz mit HTML-Markern).
//
// Felder aus dem Redaktionsplan:
//   B  (1)  Thema
//   E  (4)  Fliesstext/Copy
//   F  (5)  CTA-Varianten (JSON: [{text, url?, ausgewaehlt}])
//   H  (7)  Betreff-Varianten (JSON – fuer spaetere Nutzung)
//   J  (9)  Klaviyo-Template-ID (wird hier gesetzt)
//   K  (10) Template-Erstellungsdatum
//   AA (26) Ueberschrift (von copy-draft.js in Spalte AA geschrieben)

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
const DEFINITION_REVISION = '2026-07-15';

const COL_THEMA = 1;
const COL_COPY = 4;
const COL_CTA = 5;
const COL_TEMPLATE_ID = 9;
const COL_TEMPLATE_DATE = 10;
const COL_UEBERSCHRIFT = 26;

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function makeTextSection(htmlContent) {
  return {
    content_type: 'section',
    type: 'section',
    data: { properties: {}, display_options: {}, styles: {} },
    rows: [{
      data: { styles: {} },
      columns: [{
        blocks: [{
          content_type: 'block',
          type: 'text',
          data: { content: htmlContent, display_options: {}, styles: {} },
        }],
      }],
    }],
  };
}

function buildDefinition(ueberschrift, copyText, ctaText, ctaUrl) {
  const styles = [
    { style_type: 'base-styles', properties: {}, styles: {} },
    { style_type: 'text-styles', styles: {} },
    { style_type: 'heading-1-styles', styles: {} },
    { style_type: 'heading-2-styles', styles: {} },
    { style_type: 'heading-3-styles', styles: {} },
    { style_type: 'heading-4-styles', styles: {} },
    { style_type: 'link-styles', styles: {} },
    { style_type: 'mobile-styles', properties: {}, styles: {} },
  ];

  const sections = [];

  if (ueberschrift) {
    sections.push(makeTextSection(
      '<h2 style="margin:0 0 8px 0;font-size:24px;font-weight:bold;line-height:1.3;color:#1F2937;">' +
      escHtml(ueberschrift) + '</h2>'
    ));
  }

  if (copyText) {
    sections.push(makeTextSection(
      '<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">' +
      escHtml(copyText).replace(/\n/g, '<br>') + '</p>'
    ));
  }

  if (ctaText) {
    sections.push(makeTextSection(
      '<a href="' + escHtml(ctaUrl || '#') + '" style="display:inline-block;padding:12px 28px;' +
      'background:#2563EB;color:#ffffff;text-decoration:none;border-radius:6px;' +
      'font-weight:bold;font-size:15px;">' + escHtml(ctaText) + '</a>'
    ));
  }

  if (!sections.length) {
    sections.push(makeTextSection('<p>Newsletter-Inhalt</p>'));
  }

  return { styles, body: { properties: {}, styles: {}, sections } };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON.' }) };
  }

  const kundenname = String(data.kundenname || '').trim();
  const themaFilter = String(data.thema || '').trim();
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'kundenname ist Pflichtfeld.' }) };
  }
  if (!PARENT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'DRIVE_PARENT_FOLDER_ID fehlt.' }) };
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = sanitizeFolderName(kundenname);

    const folder = await findKundenordner(accessToken, PARENT_FOLDER_ID, folderName);
    if (!folder) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenordner gefunden.' }) };
    }

    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    if (!kundenprofilSheet) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenprofil gefunden.' }) };
    }

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilSheet.id, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan gefunden.' }) };
    }

    // AA = Spalte 27 (Index 26), daher Range bis AA
    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:AA500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Sicherstellen dass Spaltenheader J+K vorhanden sind
    const header = rows[0];
    if (!header[COL_TEMPLATE_ID]) {
      const newHeader = header.slice();
      while (newHeader.length <= COL_TEMPLATE_DATE) newHeader.push('');
      newHeader[COL_TEMPLATE_ID] = 'Klaviyo-Template-ID';
      newHeader[COL_TEMPLATE_DATE] = 'Template erstellt am';
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader.slice(0, 11)], 'A1:K1');
    }

    // Zielzeile suchen: hat Copy (E), kein Template-ID (J) – oder exakter Thema-Treffer
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[COL_THEMA]) continue;
      if (themaFilter) {
        if (String(row[COL_THEMA]).trim() === themaFilter) { targetIndex = i; break; }
      } else {
        const hasCopy = row[COL_COPY] && String(row[COL_COPY]).trim();
        const hasTemplate = row[COL_TEMPLATE_ID] && String(row[COL_TEMPLATE_ID]).trim();
        if (hasCopy && !hasTemplate) { targetIndex = i; break; }
      }
    }
    if (targetIndex === -1) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: themaFilter
            ? 'Thema "' + themaFilter + '" im Redaktionsplan nicht gefunden.'
            : 'Kein Thema mit Copy-Text ohne Template gefunden. Bitte zuerst Skill 6 (Copy-Draft) ausfuehren.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = String(targetRow[COL_THEMA] || '').trim();
    const ueberschrift = String(targetRow[COL_UEBERSCHRIFT] || '').trim();
    const copyText = String(targetRow[COL_COPY] || '').trim();

    let ctaText = '';
    let ctaUrl = '';
    try {
      const ctaList = JSON.parse(targetRow[COL_CTA] || '[]');
      if (Array.isArray(ctaList)) {
        const chosen = ctaList.find(function (c) { return c && c.ausgewaehlt; }) || ctaList[0];
        if (chosen) { ctaText = String(chosen.text || ''); ctaUrl = String(chosen.url || chosen.link || ''); }
      }
    } catch (err) {
      if (targetRow[COL_CTA]) ctaText = String(targetRow[COL_CTA]);
    }

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    const templateName = 'KI-OS ' + folderName + ' – ' + String(thema).substring(0, 50);
    const definition = buildDefinition(ueberschrift, copyText, ctaText, ctaUrl);

    const createRes = await fetch('https://a.klaviyo.com/api/templates/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + klaviyoAccessToken,
        'Content-Type': 'application/json',
        revision: DEFINITION_REVISION,
      },
      body: JSON.stringify({
        data: {
          type: 'template',
          attributes: {
            name: templateName,
            editor_type: 'SYSTEM_DRAGGABLE',
            definition: definition,
          },
        },
      }),
    });

    const created = await createRes.json().catch(function () { return null; });
    if (!createRes.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ step: 'create', success: false, klaviyoError: created }),
      };
    }

    const newTemplateId = created.data.id;
    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[newTemplateId, new Date().toISOString()]],
      'J' + sheetRowNumber + ':K' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        templateId: newTemplateId,
        klaviyoTemplateUrl: 'https://www.klaviyo.com/email-template-editor/' + newTemplateId,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Template-Builder.', details: err.message }) };
  }
};
