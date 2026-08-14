const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260730
//
// Netlify Function (Skill 9: Test-Mail an mich senden): da Klaviyos
// einziger direkter "Render and Send Template"-Testmail-Endpunkt von
// Klaviyo selbst als deprecated markiert ist ("no longer verifying
// accounts for this functionality" - v1-2 API, POST
// /api/v1/email-template/{id}/send), wird hier stattdessen ein
// echter, aber winziger Klaviyo-Kampagnenversand ueber die aktuelle,
// offiziell unterstuetzte Campaigns-API an eine interne Test-Liste
// (nur die Test-Empfaenger-Adresse) ausgeloest. Das haelt die
// Automatisierung vollstaendig im API-Fluss, ohne manuell in die
// Klaviyo-UI wechseln zu muessen.
//
// Ablauf: bestehendes Template (Skill 8) einer neuen Kampagne
// zuweisen, an eine interne Test-Liste mit genau einem Profil (der
// Test-Empfaenger-Adresse) senden, sofort abschicken.

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
const EXTRA_HEADER = ['Test-Kampagne-ID', 'Testmail gesendet am'];
const TEST_RECIPIENT_EMAIL = process.env.INTERNAL_TEST_EMAIL || 'office@kf-laserworks.com';
const TEST_LIST_NAME = 'KI-OS Interner Test';

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

    let redaktionsplanId = await getRegisterValue(accessToken, kundenprofilId, 'AKTUELL_Redaktionsplan_ID');
    if (!redaktionsplanId) {
      const redaktionsplanSheet = await findSheet(accessToken, folder.id, 'Redaktionsplan_' + folderName);
      if (redaktionsplanSheet) redaktionsplanId = redaktionsplanSheet.id;
    }
    if (!redaktionsplanId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Kein Redaktionsplan fuer "' + kundenname + '" gefunden.' }) };
    }

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:M500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Kopfzeile ggf. um Testmail-Spalten (L-M) ergaenzen, ohne A-K anzufassen.
    const header = rows[0];
    if (header.length < 13 || !header[11]) {
      const newHeader = header.slice(0, 11).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:M1');
    }

    // Zielzeile: hat Klaviyo-Template-ID (J), aber noch keine Testmail (L) -
    // oder exakter Thema-Treffer.
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasTemplate = row[9] && String(row[9]).trim();
      const hasTestmail = row[11] && String(row[11]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (hasTemplate && !hasTestmail) {
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
            : 'Kein Thema mit Klaviyo-Template ohne Testmail gefunden. Bitte zuerst Skill 8 (Template-Builder) laufen lassen.',
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
    const subject = (variants[0] && variants[0].betreff) || thema;
    const previewText = (variants[0] && variants[0].preview) || '';

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilId);

    // 1) Interne Test-Liste sicherstellen (einmalig anlegen, danach wiederverwenden).
    let testListId = await getRegisterValue(accessToken, kundenprofilId, 'KLAVIYO_TEST_LIST_ID');
    if (!testListId) {
      const listResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/lists/', {
        data: { type: 'list', attributes: { name: TEST_LIST_NAME } },
      });
      testListId = listResult.data.id;
      await setRegisterValue(accessToken, kundenprofilId, 'KLAVIYO_TEST_LIST_ID', testListId);
    }

    // 2) Test-Empfaenger-Profil sicherstellen und der Test-Liste hinzufuegen.
    const profileResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/profile-import/', {
      data: { type: 'profile', attributes: { email: TEST_RECIPIENT_EMAIL } },
    }).catch(function () { return null; });
    let testProfileId = profileResult && profileResult.data && profileResult.data.id;
    if (!testProfileId) {
      // Fallback: create-or-update Profiles-Endpoint, falls profile-import nicht verfuegbar ist.
      const fallbackProfile = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/profiles/', {
        data: { type: 'profile', attributes: { email: TEST_RECIPIENT_EMAIL } },
      }).catch(function (err) { return { error: err }; });
      testProfileId = fallbackProfile && fallbackProfile.data && fallbackProfile.data.id;
    }
    if (testProfileId) {
      await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/lists/' + testListId + '/relationships/profiles/', {
        data: [{ type: 'profile', id: testProfileId }],
      }).catch(function () { /* bereits Mitglied - ignorieren */ });
    }

    // 3) Kampagne anlegen (Ziel: interne Test-Liste), Versand sofort.
    const campaignResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaigns/', {
      data: {
        type: 'campaign',
        attributes: {
          name: 'TEST - ' + thema,
          audiences: { included: [testListId] },
          send_strategy: { method: 'immediate' },
          'campaign-messages': {
            data: [
              {
                type: 'campaign-message',
                attributes: {
                  channel: 'email',
                  label: 'Testmail',
                  content: {
                    subject: '[TEST] ' + subject,
                    preview_text: previewText,
                    from_email: TEST_RECIPIENT_EMAIL,
                    from_label: 'KI-OS Newsletter (Test)',
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

    // 4) Bestehendes Template dieser Test-Kampagnennachricht zuweisen.
    await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaign-message-assign-template/', {
      data: {
        type: 'campaign-message',
        id: campaignMessageId,
        relationships: { template: { data: { type: 'template', id: templateId } } },
      },
    });

    // 5) Kampagne sofort versenden.
    await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaign-send-jobs/', {
      data: { type: 'campaign-send-job', id: campaignId },
    });

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[campaignId, new Date().toISOString()]],
      'L' + sheetRowNumber + ':M' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        campaignId: campaignId,
        testRecipient: TEST_RECIPIENT_EMAIL,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Testmail-Versand.', details: err.message }) };
  }
};
