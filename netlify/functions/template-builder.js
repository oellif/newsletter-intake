// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260730
//
// Netlify Function (Skill 8: Klaviyo-Template-Builder): baut bzw.
// aktualisiert EIN dauerhaftes E-Mail-Template pro Kunde direkt in
// Klaviyo. Kategorie A (lebendes Einzelobjekt): die Template-ID wird
// im Kundenprofil-Register gespeichert (KLAVIYO_TEMPLATE_ID) und bei
// jedem Lauf wiederverwendet/aktualisiert statt neu angelegt.
//
// Damit manuelle Design-Aenderungen in der Klaviyo-UI (Layout, Farben,
// Bilder) NICHT ueberschrieben werden, liest die Funktion vor jeder
// Aenderung den aktuellen HTML-Stand des Templates und ersetzt nur den
// Inhalt zwischen festen Marker-Kommentaren (<!--AUTO:...--/-->). Alles
// ausserhalb der Marker bleibt unangetastet.

const {
  getAccessToken,
  sanitizeFolderName,
  findKundenordner,
  findKundenprofil,
  findSheet,
  getRegisterValue,
  setRegisterValue,
  sheetsReadValues,
  sheetsWriteValues,
} = require('./lib/google');

const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const EXTRA_HEADER = ['Klaviyo-Template-ID', 'Template aktualisiert am'];

const MARKERS = {
  copy: 'COPY',
  cta: 'CTA',
  preheader: 'PREHEADER',
};

function baseTemplateHtml() {
  return (
    '<!DOCTYPE html>\n' +
    '<html>\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>\n' +
    '<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">\n' +
    '  <div style="display:none;max-height:0;overflow:hidden;">\n' +
    '    <!--AUTO:PREHEADER_START--><!--AUTO:PREHEADER_END-->\n' +
    '  </div>\n' +
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">\n' +
    '    <tr><td align="center">\n' +
    '      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">\n' +
    '        <tr><td style="padding:24px;font-size:15px;line-height:1.6;color:#1F2937;">\n' +
    '          <!--AUTO:COPY_START--><!--AUTO:COPY_END-->\n' +
    '        </td></tr>\n' +
    '        <tr><td style="padding:0 24px 32px 24px;">\n' +
    '          <!--AUTO:CTA_START--><!--AUTO:CTA_END-->\n' +
    '        </td></tr>\n' +
    '      </table>\n' +
    '    </td></tr>\n' +
    '  </table>\n' +
    '</body>\n</html>'
  );
}

// Ersetzt den Inhalt zwischen <!--AUTO:NAME_START--> und <!--AUTO:NAME_END-->
// in html durch neuen Inhalt. Wirft einen Fehler, falls die Marker fehlen
// (z.B. weil sie manuell aus dem Template entfernt wurden) statt das
// Template blind zu ueberschreiben.
function replaceMarker(html, name, newContent) {
  const startTag = '<!--AUTO:' + name + '_START-->';
  const endTag = '<!--AUTO:' + name + '_END-->';
  const startIdx = html.indexOf(startTag);
  const endIdx = html.indexOf(endTag);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      'Marker "' + startTag + '" / "' + endTag + '" wurden im bestehenden Klaviyo-Template nicht gefunden. ' +
      'Vermutlich wurden sie in der Klaviyo-UI manuell entfernt. Bitte Marker wiederherstellen oder Template neu anlegen lassen.'
    );
  }
  return (
    html.slice(0, startIdx + startTag.length) +
    newContent +
    html.slice(endIdx)
  );
}

function ctaButtonHtml(ctaText) {
  return (
    '<a href="#" style="display:inline-block;padding:12px 24px;background:#2563EB;color:#ffffff;' +
    'text-decoration:none;border-radius:6px;font-weight:bold;">' +
    String(ctaText).replace(/</g, '&lt;') + '</a>'
  );
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

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:K500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Kopfzeile ggf. um Template-Spalten (J-K) ergaenzen, ohne A-I anzufassen.
    const header = rows[0];
    if (header.length < 11 || !header[9]) {
      const newHeader = header.slice(0, 9).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:K1');
    }

    // Zielzeile: hat Copy-Text (E) und Betreff-Varianten (H), aber noch
    // keine Template-ID (J) - oder exakter Thema-Treffer.
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasCopy = row[4] && String(row[4]).trim();
      const hasBetreff = row[7] && String(row[7]).trim();
      const hasTemplate = row[9] && String(row[9]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (hasCopy && hasBetreff && !hasTemplate) {
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
            : 'Kein Thema mit Copy-Text + Betreff-Varianten ohne Template gefunden. Bitte zuerst Skill 6 (Copy-Draft) und Skill 7 (Betreff-Generator) laufen lassen.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = targetRow[1];
    const copyText = targetRow[4] || '';
    // Spalte F: JSON-Array von CTA-Varianten (neu, Mehrfachauswahl moeglich)
    // - oder, bei aelteren Zeilen, noch der reine alte Text (Legacy). Fuers
    // Template wird die erste ausgewaehlte Variante genommen (oder, falls
    // keine markiert ist, einfach die erste vorhandene).
    let ctaList = [];
    try {
      const parsedCta = JSON.parse(targetRow[5] || '[]');
      ctaList = Array.isArray(parsedCta) ? parsedCta : [{ text: String(targetRow[5] || ''), ausgewaehlt: true }];
    } catch (err) {
      ctaList = targetRow[5] ? [{ text: targetRow[5], ausgewaehlt: true }] : [];
    }
    const chosenCta = ctaList.find(function (c) { return c && c.ausgewaehlt; }) || ctaList[0];
    const cta = (chosenCta && chosenCta.text) || '';
    let variants = [];
    try {
      variants = JSON.parse(targetRow[7] || '[]');
    } catch (err) {
      variants = [];
    }
    const preheader = (variants[0] && variants[0].preview) || '';

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilId);

    let templateId = await getRegisterValue(accessToken, kundenprofilId, 'KLAVIYO_TEMPLATE_ID');
    const templateName = 'Newsletter-Template - ' + folderName;
    let currentHtml;
    let isNewTemplate = false;

    if (templateId) {
      // Bestehendes Template: aktuellen Stand lesen, um manuelle
      // Design-Aenderungen nicht zu ueberschreiben.
      const existing = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/templates/' + templateId + '/');
      currentHtml = existing && existing.data && existing.data.attributes && existing.data.attributes.html;
      if (!currentHtml) {
        throw new Error('Bestehendes Klaviyo-Template (ID ' + templateId + ') konnte nicht gelesen werden.');
      }
    } else {
      currentHtml = baseTemplateHtml();
      isNewTemplate = true;
    }

    let newHtml = currentHtml;
    newHtml = replaceMarker(newHtml, MARKERS.copy, String(copyText).replace(/</g, '&lt;').replace(/\n/g, '<br>'));
    newHtml = replaceMarker(newHtml, MARKERS.cta, ctaButtonHtml(cta));
    newHtml = replaceMarker(newHtml, MARKERS.preheader, String(preheader).replace(/</g, '&lt;'));

    let templateResult;
    if (isNewTemplate) {
      templateResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/templates/', {
        data: { type: 'template', attributes: { name: templateName, editor_type: 'CODE', html: newHtml } },
      });
      templateId = templateResult.data.id;
      await setRegisterValue(accessToken, kundenprofilId, 'KLAVIYO_TEMPLATE_ID', templateId);
    } else {
      templateResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'PATCH', '/api/templates/' + templateId + '/', {
        data: { type: 'template', id: templateId, attributes: { html: newHtml } },
      });
    }

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[templateId, new Date().toISOString()]],
      'J' + sheetRowNumber + ':K' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        templateId: templateId,
        wasNewTemplate: isNewTemplate,
        klaviyoTemplateUrl: 'https://www.klaviyo.com/email-templates/' + templateId + '/edit',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Template-Builder.', details: err.message }) };
  }
};
