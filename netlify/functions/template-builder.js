const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - komplett neu am 20260811
//
// Netlify Function (Skill 8: Klaviyo-Template-Builder): liest das gespeicherte
// Mapping fuer den Kunden (aus Kundenprofil-Sheet, Register MAPPING_<TYP>),
// holt die Definition des Master-Templates, ersetzt NUR die gemappten Bloecke
// mit dem kampagnenspezifischen Content und erstellt eine neue Kopie.
//
// Der Kunde kann die erstellte Kopie danach im Klaviyo-Drag&Drop-Editor
// anpassen – Design, Logo und Layout des Master-Templates bleiben erhalten.
//
// Felder aus dem Redaktionsplan:
//   B  (1)  Thema
//   E  (4)  Fliesstext/Copy
//   F  (5)  CTA-Varianten (JSON: [{text, url?, ausgewaehlt}])
//   H  (7)  Betreff-Varianten (fuer preheader)
//   J  (9)  Klaviyo-Template-ID (wird hier gesetzt)
//   K  (10) Template-Erstellungsdatum
//   L  (11) Bild 1 URL (manuell eingetragen)
//   M  (12) Bild 2 URL
//   N  (13) Bild 3 URL
//   AA (26) Ueberschrift

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
const COL_BETREFF = 7;
const COL_TEMPLATE_ID = 9;
const COL_TEMPLATE_DATE = 10;
const COL_BILD1 = 11;
const COL_BILD2 = 12;
const COL_BILD3 = 13;
const COL_UEBERSCHRIFT = 26;

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Setzt den Content eines Blocks anhand seines Typs und des Ziel-Felds
function applyFieldToBlock(block, field, campaignData) {
  const type = block.type;
  const d = block.data || {};

  if (field === 'ueberschrift' && type === 'text') {
    const text = campaignData.ueberschrift;
    if (text) {
      d.content = '<h2 style="margin:0;font-size:24px;font-weight:bold;line-height:1.3;">' + escHtml(text) + '</h2>';
    }
  } else if (field === 'fliesstext' && type === 'text') {
    const text = campaignData.fliesstext;
    if (text) {
      d.content = '<p style="margin:0;font-size:15px;line-height:1.6;">' +
        escHtml(text).replace(/\n/g, '<br>') + '</p>';
    }
  } else if (field === 'preheader' && type === 'text') {
    const text = campaignData.preheader;
    if (text) {
      d.content = escHtml(text);
    }
  } else if ((field === 'bild_1' || field === 'bild_2' || field === 'bild_3') && type === 'image') {
    const urlMap = { bild_1: campaignData.bild1, bild_2: campaignData.bild2, bild_3: campaignData.bild3 };
    const url = urlMap[field];
    if (url) {
      d.image_url = url;
      if (d.url !== undefined) d.url = url;
    }
  } else if (field === 'cta') {
    if (type === 'button') {
      if (campaignData.ctaText) d.text = campaignData.ctaText;
      if (campaignData.ctaUrl) d.link = Object.assign({}, d.link || {}, { url: campaignData.ctaUrl });
    } else if (type === 'text') {
      // CTA als Link in einem Text-Block
      const text = campaignData.ctaText;
      const url = campaignData.ctaUrl || '#';
      if (text) {
        d.content = '<a href="' + escHtml(url) + '" style="display:inline-block;padding:12px 28px;' +
          'background:#2563EB;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">' +
          escHtml(text) + '</a>';
      }
    }
  }

  block.data = d;
  return block;
}

// Tiefe Kopie der Definition, dann gemappte Bloecke ersetzen
function applyMappingToDefinition(definition, mappingBlocks, campaignData) {
  // Tiefe Kopie via JSON (einfachste Methode fuer plain-JSON-Strukturen)
  const def = JSON.parse(JSON.stringify(definition));
  const sections = (def.body && def.body.sections) || [];

  mappingBlocks.forEach(function (mapping) {
    const [s, r, c, b] = mapping.path;
    try {
      const block = sections[s].rows[r].columns[c].blocks[b];
      applyFieldToBlock(block, mapping.field, campaignData);
    } catch (err) {
      // Pfad existiert nicht im Template - ignorieren
      console.warn('Mapping-Pfad nicht gefunden:', mapping.path, err.message);
    }
  });

  return def;
}

exports.handler = async (event) => {
  const authErr = requireAuth(event); if (authErr) return authErr;
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
  // templateType: B2C oder B2B (Standard: B2C)
  const templateType = String(data.templateType || 'B2C').trim().toUpperCase();

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
    if (!folder) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenordner gefunden.' }) };

    const kundenprofilSheet = await findKundenprofil(accessToken, folder.id, folderName);
    if (!kundenprofilSheet) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Kundenprofil gefunden.' }) };

    // Mapping laden
    const registerKey = 'MAPPING_' + templateType;
    const mappingRaw = await getRegisterValue(accessToken, kundenprofilSheet.id, registerKey);
    if (!mappingRaw) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: 'Kein Mapping fuer Typ "' + templateType + '" gefunden. Bitte zuerst Skill A (template-mapping-analyse) und template-mapping-speichern ausfuehren.',
          registerKey: registerKey,
        }),
      };
    }

    let mapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Mapping im Sheet ist kein gueltiges JSON.' }) };
    }

    const masterTemplateId = mapping.templateId;
    const mappingBlocks = mapping.blocks || [];

    // Redaktionsplan laden (bis Spalte AA = Index 26)
    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilSheet.id, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:AA500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Zielzeile finden
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
            ? 'Thema "' + themaFilter + '" nicht gefunden.'
            : 'Kein Thema mit Copy-Text ohne Template gefunden. Bitte Skill 6 (Copy-Draft) zuerst ausfuehren.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = String(targetRow[COL_THEMA] || '').trim();

    // Kampagnen-Daten aus dem Redaktionsplan
    const campaignData = {
      ueberschrift: String(targetRow[COL_UEBERSCHRIFT] || '').trim(),
      fliesstext: String(targetRow[COL_COPY] || '').trim(),
      bild1: String(targetRow[COL_BILD1] || '').trim() || null,
      bild2: String(targetRow[COL_BILD2] || '').trim() || null,
      bild3: String(targetRow[COL_BILD3] || '').trim() || null,
      ctaText: '',
      ctaUrl: '',
      preheader: '',
    };

    // CTA aus JSON-Feld lesen
    try {
      const ctaList = JSON.parse(targetRow[COL_CTA] || '[]');
      if (Array.isArray(ctaList)) {
        const chosen = ctaList.find(function (c) { return c && c.ausgewaehlt; }) || ctaList[0];
        if (chosen) { campaignData.ctaText = String(chosen.text || ''); campaignData.ctaUrl = String(chosen.url || chosen.link || ''); }
      }
    } catch (err) {
      if (targetRow[COL_CTA]) campaignData.ctaText = String(targetRow[COL_CTA]);
    }

    // Preheader aus Betreff-Varianten
    try {
      const variants = JSON.parse(targetRow[COL_BETREFF] || '[]');
      if (Array.isArray(variants) && variants[0]) campaignData.preheader = String(variants[0].preview || '');
    } catch (err) { /* ignorieren */ }

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    // Master-Template-Definition laden
    const masterRes = await fetch(
      'https://a.klaviyo.com/api/templates/' + masterTemplateId + '/?additional-fields[template]=definition',
      {
        headers: { Authorization: 'Bearer ' + klaviyoAccessToken, revision: DEFINITION_REVISION },
      }
    );
    const masterData = await masterRes.json().catch(function () { return null; });
    if (!masterRes.ok || !masterData) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ step: 'read-master', success: false, klaviyoError: masterData }),
      };
    }

    const masterAttrs = masterData.data.attributes;
    if (!masterAttrs.definition) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          step: 'read-master',
          success: false,
          error: 'Master-Template hat kein definition-Feld (evtl. CODE-Typ). Bitte ein SYSTEM_DRAGGABLE-Template als Master verwenden.',
        }),
      };
    }

    // Definition mit Kampagnen-Content befuellen
    const newDefinition = applyMappingToDefinition(masterAttrs.definition, mappingBlocks, campaignData);

    // Neues Template erstellen (Kopie mit neuem Content)
    const templateName = 'KI-OS ' + folderName + ' [' + templateType + '] – ' + String(thema).substring(0, 40);
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
            definition: newDefinition,
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

    // Template-ID in Redaktionsplan speichern
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
        templateType: templateType,
        masterTemplateId: masterTemplateId,
        newTemplateId: newTemplateId,
        klaviyoTemplateUrl: 'https://www.klaviyo.com/email-template-editor/' + newTemplateId,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Template-Builder.', details: err.message }) };
  }
};
