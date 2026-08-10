// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260731
//
// Netlify Function (Skill 13: Vorschau an Kunden senden): sendet dem
// Kunden/der Ansprechperson eine echte Vorschau-E-Mail der fertigen
// Newsletter-Kampagne (Betreff + fertiges Template aus Skill 8) - nicht
// an die interne Test-Adresse (Skill 9), sondern an eine vom Nutzer bei
// jedem Aufruf angegebene Kunden-E-Mail. Genau wie in Skill 9 wird dafuer
// KEIN Klaviyo-Test-Endpunkt genutzt (der ist deprecated), sondern ein
// echter, winziger Kampagnenversand ueber die Campaigns-API an eine
// dedizierte "Kunden-Vorschau"-Liste mit genau einem Profil (der
// angegebenen Empfaenger-Adresse). Der eigentliche Versand-Entwurf aus
// Skill 12 (an die echte Zielgruppe) bleibt davon unberuehrt - hier wird
// eine EIGENE, kleine Kampagne angelegt und sofort nur an die Vorschau-
// Liste verschickt.

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
const EXTRA_HEADER = ['Kunden-Vorschau-Kampagne-ID', 'Vorschau gesendet an', 'Vorschau gesendet am'];
const PREVIEW_LIST_NAME = 'KI-OS Kunden-Vorschau';
const FALLBACK_SENDER_EMAIL = process.env.INTERNAL_TEST_EMAIL || 'office@kf-laserworks.com';

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
  const kundenEmail = String(data.kundenEmail || '').trim();
  if (!kundenname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kundenname ist Pflichtfeld.' }) };
  }
  if (!kundenEmail || kundenEmail.indexOf('@') === -1) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Eine gueltige Kunden-E-Mail ist Pflichtfeld.' }) };
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

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:T500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Kopfzeile ggf. um Kunden-Vorschau-Spalten (R-T) ergaenzen, ohne A-Q anzufassen.
    const header = rows[0];
    if (header.length < 20 || !header[17]) {
      const newHeader = header.slice(0, 17).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:T1');
    }

    // Zielzeile: hat Klaviyo-Kampagne (P, aus Skill 12), aber noch keine
    // Kunden-Vorschau (R) - oder exakter Thema-Treffer.
    let targetIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasTemplate = row[9] && String(row[9]).trim();
      const hasVorschau = row[17] && String(row[17]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (hasTemplate && !hasVorschau) {
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
            : 'Kein Thema mit Klaviyo-Template ohne Kunden-Vorschau gefunden. Bitte zuerst Skill 8 (Template-Builder) laufen lassen.',
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

    // 1) Kunden-Vorschau-Liste sicherstellen (einmalig pro Kunde anlegen, danach wiederverwenden).
    let previewListId = await getRegisterValue(accessToken, kundenprofilId, 'KLAVIYO_PREVIEW_LIST_ID');
    if (!previewListId) {
      const listResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/lists/', {
        data: { type: 'list', attributes: { name: PREVIEW_LIST_NAME } },
      });
      previewListId = listResult.data.id;
      await setRegisterValue(accessToken, kundenprofilId, 'KLAVIYO_PREVIEW_LIST_ID', previewListId);
    }

    // 2) Empfaenger-Profil sicherstellen und der Vorschau-Liste hinzufuegen.
    const profileResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/profile-import/', {
      data: { type: 'profile', attributes: { email: kundenEmail } },
    }).catch(function () { return null; });
    let previewProfileId = profileResult && profileResult.data && profileResult.data.id;
    if (!previewProfileId) {
      const fallbackProfile = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/profiles/', {
        data: { type: 'profile', attributes: { email: kundenEmail } },
      }).catch(function () { return null; });
      previewProfileId = fallbackProfile && fallbackProfile.data && fallbackProfile.data.id;
    }
    if (previewProfileId) {
      await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/lists/' + previewListId + '/relationships/profiles/', {
        data: [{ type: 'profile', id: previewProfileId }],
      }).catch(function () { /* bereits Mitglied - ignorieren */ });
    }

    // 3) Eigene, kleine Vorschau-Kampagne anlegen (Ziel: nur die Vorschau-Liste), Versand sofort.
    const campaignResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaigns/', {
      data: {
        type: 'campaign',
        attributes: {
          name: 'VORSCHAU - ' + thema,
          audiences: { included: [previewListId] },
          send_strategy: { method: 'immediate' },
          'campaign-messages': {
            data: [
              {
                type: 'campaign-message',
                attributes: {
                  channel: 'email',
                  label: 'Kundenvorschau',
                  content: {
                    subject: '[VORSCHAU] ' + subject,
                    preview_text: previewText,
                    from_email: FALLBACK_SENDER_EMAIL,
                    from_label: folderName + ' (Vorschau)',
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

    // 4) Bestehendes Template (aus Skill 8) dieser Vorschau-Kampagnennachricht zuweisen.
    await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaign-message-assign-template/', {
      data: {
        type: 'campaign-message',
        id: campaignMessageId,
        relationships: { template: { data: { type: 'template', id: templateId } } },
      },
    });

    // 5) Vorschau-Kampagne sofort an die Vorschau-Liste versenden.
    await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaign-send-jobs/', {
      data: { type: 'campaign-send-job', id: campaignId },
    });

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[campaignId, kundenEmail, new Date().toISOString()]],
      'R' + sheetRowNumber + ':T' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        campaignId: campaignId,
        sentTo: kundenEmail,
        subject: subject,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Kunden-Vorschau-Versand.', details: err.message }) };
  }
};
