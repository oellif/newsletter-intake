// Ablage- & Versionsregel v1 aktiv - neu 20260807
//
// TEMPORAERE Testfunktion (nicht Teil der offiziellen Skill-Kette): prueft
// die Hypothese, dass ein FRISCH per API erstelltes SYSTEM_DRAGGABLE-
// Template (statt eines alten, von Hand gebauten) sich sauber ueber die
// "definition" auslesen und wieder befuellen laesst - als Alternative zum
// bestehenden, kaputten Header-Block im Original-Template.

const { getAccessToken, sanitizeFolderName, findKundenordner, findKundenprofil } = require('./lib/google');
const klaviyo = require('./lib/klaviyo');

const PARENT_FOLDER_ID = process.env.DRIVE_PARENT_FOLDER_ID;
const TEST_REVISION = '2026-07-15';

function minimalDefinition() {
  // base-styles: properties + styles; alle anderen: nur styles (kein properties erlaubt)
  const styles = [
    { style_type: 'base-styles', properties: {}, styles: {} },
    { style_type: 'text-styles', styles: {} },
    { style_type: 'heading-1-styles', styles: {} },
    { style_type: 'heading-2-styles', styles: {} },
    { style_type: 'heading-3-styles', styles: {} },
    { style_type: 'heading-4-styles', styles: {} },
    { style_type: 'link-styles', styles: {} },
    { style_type: 'mobile-styles', styles: {} },
  ];
  return {
    styles: styles,
    body: {
      properties: {},
      styles: {},
      sections: [
        {
          content_type: 'section',
          type: 'section',
          data: { properties: {}, display_options: {}, styles: {} },
          rows: [
            {
              data: { styles: {} },
              columns: [
                {
                  blocks: [
                    {
                      content_type: 'block',
                      type: 'text',
                      data: {
                        content: '<p id="mapping-ueberschrift">TEST-UEBERSCHRIFT</p><p id="mapping-fliesstext">TEST-FLIESSTEXT</p>',
                        display_options: {},
                        styles: {},
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiges JSON.' }) };
  }

  const kundenname = String(data.kundenname || '').trim();
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

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilSheet.id);

    // 1) Frisches Test-Template per definition anlegen.
    const createRes = await fetch('https://a.klaviyo.com/api/templates/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + klaviyoAccessToken,
        'Content-Type': 'application/json',
        revision: TEST_REVISION,
      },
      body: JSON.stringify({
        data: {
          type: 'template',
          attributes: {
            name: 'MAPPING-TEST-' + Date.now(),
            editor_type: 'SYSTEM_DRAGGABLE',
            definition: minimalDefinition(),
          },
        },
      }),
    });
    const created = await createRes.json().catch(function () { return null; });
    if (!createRes.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ step: 'create', success: false, klaviyoError: created }) };
    }
    const newId = created.data.id;

    // 2) Sofort wieder mit definition zurueckladen - Testfrage: klappt das
    // bei einem frisch per API erstellten Template (ohne den alten,
    // kaputten Header) sauber?
    const getRes = await fetch(
      'https://a.klaviyo.com/api/templates/' + newId + '/?additional-fields[template]=definition',
      {
        headers: {
          Authorization: 'Bearer ' + klaviyoAccessToken,
          'Content-Type': 'application/json',
          revision: TEST_REVISION,
        },
      }
    );
    const fetched = await getRes.json().catch(function () { return null; });
    if (!getRes.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ step: 'get', success: false, templateId: newId, klaviyoError: fetched }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        templateId: newId,
        editor_type: fetched.data.attributes.editor_type,
        hasDefinition: !!fetched.data.attributes.definition,
        klaviyoTemplateUrl: 'https://www.klaviyo.com/email-template-editor/' + newId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Definition-Testaufbau.', details: err.message }) };
  }
};
