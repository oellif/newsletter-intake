// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260731
//
// Netlify Function (Skill 14: Newsletter-Performance-Reporter): liest
// fuer eine bereits ECHT versendete Klaviyo-Kampagne (nicht mehr Entwurf)
// die Kennzahlen ueber die offizielle Campaign-Values-Reports-API aus
// (Oeffnungen, Klicks, Zustellungen, Abmeldungen, Empfaengeranzahl) und
// schreibt sie als kurzen Report in den Redaktionsplan. Standardmaessig
// wird die Kampagne aus Skill 12 (Spalte P, "Klaviyo-Kampagne-ID")
// verwendet; per campaignIdOverride kann auch gezielt eine andere,
// bereits versendete Kampagne ausgewertet werden (z.B. zum Testen anhand
// einer Test-/Vorschau-Kampagne aus Skill 9/13).

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
const EXTRA_HEADER = ['Report-Oeffnungen', 'Report-Klicks', 'Report-Empfaenger', 'Report erstellt am'];

const STATISTICS = [
  'delivered',
  'opens',
  'opens_unique',
  'clicks',
  'clicks_unique',
  'unsubscribes',
  'bounced',
  'recipients',
];

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
  const campaignIdOverride = String(data.campaignIdOverride || '').trim();
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

    const rows = await sheetsReadValues(accessToken, redaktionsplanId, 'A1:X500');
    if (rows.length <= 1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Redaktionsplan ist leer.' }) };
    }

    // Kopfzeile ggf. um Report-Spalten (U-X) ergaenzen, ohne A-T anzufassen.
    const header = rows[0];
    if (header.length < 24 || !header[20]) {
      const newHeader = header.slice(0, 20).concat(EXTRA_HEADER);
      await sheetsWriteValues(accessToken, redaktionsplanId, [newHeader], 'A1:X1');
    }

    // Zielzeile: hat Klaviyo-Kampagne (P), aber noch keinen Report (X) -
    // oder exakter Thema-Treffer. Wird nur zur Zeilenzuordnung genutzt,
    // wenn campaignIdOverride NICHT gesetzt ist.
    let targetIndex = -1;
    let campaignId = campaignIdOverride;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[1]) continue;
      const hasCampaign = row[15] && String(row[15]).trim();
      const hasReport = row[23] && String(row[23]).trim();
      if (themaFilter) {
        if (row[1] === themaFilter) { targetIndex = i; break; }
      } else if (hasCampaign && !hasReport) {
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
            : 'Kein Thema mit Klaviyo-Kampagne ohne Report gefunden. Bitte zuerst Skill 12 (Campaign-Versand-Setup) laufen lassen.',
        }),
      };
    }

    const targetRow = rows[targetIndex];
    const thema = targetRow[1];
    if (!campaignId) {
      campaignId = targetRow[15];
    }
    if (!campaignId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Fuer dieses Thema wurde noch keine Klaviyo-Kampagne angelegt (Skill 12).' }) };
    }

    const klaviyoAccessToken = await klaviyo.getValidAccessToken(accessToken, kundenprofilId);

    // Status pruefen: ein Report ist nur fuer bereits versendete Kampagnen
    // sinnvoll (Entwuerfe haben keine Statistiken).
    const campaignInfo = await klaviyo.klaviyoRequest(
      klaviyoAccessToken, 'GET',
      '/api/campaigns/' + campaignId + '/?fields[campaign]=name,status'
    );
    const status = campaignInfo && campaignInfo.data && campaignInfo.data.attributes && campaignInfo.data.attributes.status;
    if (status && status !== 'Sent' && status !== 'Sending') {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          error: 'Diese Kampagne wurde noch nicht versendet (Status: "' + status + '"). Ein Performance-Report ist erst nach dem Versand moeglich. Bitte in Klaviyo pruefen/freigeben und danach erneut versuchen.',
          campaignId: campaignId,
          status: status,
        }),
      };
    }

    // Klaviyo verlangt fuer den Values-Report zwingend eine
    // conversion_metric_id (z.B. um "Bestellung ausgeloest" o.ae. zu
    // tracken) - auch wenn uns hier nur die reinen Kampagnen-Kennzahlen
    // (Oeffnungen/Klicks/Empfaenger) interessieren. Wir nehmen dafuer die
    // Standard-Metrik "Placed Order", oder ersatzweise die erste
    // verfuegbare Metrik des Accounts.
    const metricsResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'GET', '/api/metrics/?fields[metric]=name');
    const metrics = (metricsResult.data || []);
    const placedOrder = metrics.find(function (m) { return m.attributes && m.attributes.name === 'Placed Order'; });
    const conversionMetricId = placedOrder ? placedOrder.id : (metrics[0] && metrics[0].id);
    if (!conversionMetricId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Kein Klaviyo-Metric fuer conversion_metric_id gefunden - Report nicht moeglich.' }) };
    }

    const reportResult = await klaviyo.klaviyoRequest(klaviyoAccessToken, 'POST', '/api/campaign-values-reports/', {
      data: {
        type: 'campaign-values-report',
        attributes: {
          timeframe: { key: 'last_365_days' },
          statistics: STATISTICS,
          conversion_metric_id: conversionMetricId,
          filter: 'equals(campaign_id,"' + campaignId + '")',
        },
      },
    });

    const resultRow = reportResult && reportResult.data && reportResult.data.attributes &&
      reportResult.data.attributes.results && reportResult.data.attributes.results[0];
    const stats = (resultRow && resultRow.statistics) || {};

    const opens = stats.opens_unique != null ? stats.opens_unique : (stats.opens || 0);
    const clicks = stats.clicks_unique != null ? stats.clicks_unique : (stats.clicks || 0);
    const recipients = stats.recipients != null ? stats.recipients : (stats.delivered || 0);

    const sheetRowNumber = targetIndex + 1;
    await sheetsWriteValues(
      accessToken,
      redaktionsplanId,
      [[opens, clicks, recipients, new Date().toISOString()]],
      'U' + sheetRowNumber + ':X' + sheetRowNumber
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        thema: thema,
        campaignId: campaignId,
        opens: opens,
        clicks: clicks,
        recipients: recipients,
        rawStatistics: stats,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + redaktionsplanId,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fehler beim Performance-Reporter.', details: err.message }) };
  }
};
