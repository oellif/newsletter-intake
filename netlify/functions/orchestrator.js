const { requireAuth } = require('./lib/auth');
// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260731
//
// Netlify Function (Master-Skill / Orchestrator): verkettet fuer ein
// einzelnes Thema die drei zuverlaessig schnellen, rein generativen
// Einzel-Skills automatisch:
//   Skill 6 (Copy-Draft) -> Skill 7 (Betreff-A/B-Test) -> Skill 8
//   (Klaviyo-Template-Builder)
// Diese drei rufen nur Claude bzw. Klaviyos Template-API auf und sind
// damit innerhalb des Netlify-Function-Zeitlimits sicher verkettbar.
// Die Zeilenauswahl-Logik jedes Einzel-Skills ("erste Zeile, die den
// vorherigen Schritt schon hat, den eigenen aber noch nicht") sorgt
// dafuer, dass alle drei Aufrufe automatisch auf derselben
// Redaktionsplan-Zeile landen, ohne dass der Orchestrator selbst Zeilen
// verwalten muss.
//
// BEWUSST NICHT mit angekettet: Skill 9 (Testmail), 10 (Segment-Mapper),
// 11 (QA-Check, kann durch Live-Link-Checks lange dauern), 12 (Kampagne
// anlegen), 13 (Kundenvorschau) und 14 (Reporting). Das sind entweder
// zeitlich riskant fuer eine einzelne Function-Ausfuehrung oder
// erfordern eine bewusste menschliche Entscheidung (z.B. QA-Freigabe vor
// dem Kampagnen-Entwurf, oder eine echte Kunden-E-Mail-Adresse). Der
// Orchestrator meldet nach den automatisierten Schritten klar, welche
// manuellen Folgeschritte noch offen sind.

const copyDraft = require('./copy-draft');
const betreffGenerator = require('./betreff-generator');
const templateBuilder = require('./template-builder');

function makeEvent(body) {
  return { httpMethod: 'POST', body: JSON.stringify(body) };
}

async function runStep(name, fn, body) {
  const result = await fn.handler(makeEvent(body));
  let parsed;
  try {
    parsed = JSON.parse(result.body);
  } catch (err) {
    parsed = { error: 'Antwort von Skill "' + name + '" konnte nicht gelesen werden.' };
  }
  return { name: name, statusCode: result.statusCode, ok: result.statusCode >= 200 && result.statusCode < 300, data: parsed };
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

  const steps = [];
  let thema = themaFilter;

  // 1) Copy-Draft
  const step1 = await runStep('Copy-Draft (Skill 6)', copyDraft, { kundenname: kundenname, thema: thema });
  steps.push(step1);
  if (!step1.ok) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, stoppedAt: step1.name, steps: steps }),
    };
  }
  // Ab hier exaktes Thema uebernehmen, damit alle Folgeschritte garantiert
  // dieselbe Zeile treffen (auch wenn kein Thema uebergeben wurde).
  thema = step1.data.thema || thema;

  // 2) Betreff-Generator
  const step2 = await runStep('Betreff-A/B-Test (Skill 7)', betreffGenerator, { kundenname: kundenname, thema: thema });
  steps.push(step2);
  if (!step2.ok) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, stoppedAt: step2.name, thema: thema, steps: steps }),
    };
  }

  // 3) Template-Builder
  const step3 = await runStep('Klaviyo-Template-Builder (Skill 8)', templateBuilder, { kundenname: kundenname, thema: thema });
  steps.push(step3);
  if (!step3.ok) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, stoppedAt: step3.name, thema: thema, steps: steps }),
    };
  }

  const folderNameHint = kundenname;
  const nextSteps = [
    { skill: 'Skill 9: Test-Mail an mich senden', seite: 'test-mail-send.html', grund: 'Echte Testmail pruefen, bevor es weitergeht.' },
    { skill: 'Skill 10: Zielgruppen-Segment-Mapper', seite: 'segment-mapper.html', grund: 'Passende Zielgruppe vorschlagen lassen (optional, Skill 12 macht das sonst automatisch).' },
    { skill: 'Skill 11: Newsletter-QA-Check', seite: 'qa-check.html', grund: 'Links, Pflichtangaben und Darstellung pruefen lassen - vor dem Kampagnen-Entwurf empfohlen.' },
    { skill: 'Skill 12: Campaign-Versand-Setup', seite: 'campaign-setup.html', grund: 'Legt die Kampagne als Entwurf an (kein Versand). Erst nach QA-Freigabe empfohlen.' },
    { skill: 'Skill 13: Vorschau an Kunden senden', seite: 'kunden-vorschau.html', grund: 'Braucht eine bestaetigte Kunden-E-Mail - bewusst manuell.' },
    { skill: 'Skill 14: Newsletter-Performance-Reporter', seite: 'performance-reporter.html', grund: 'Erst sinnvoll, nachdem die Kampagne in Klaviyo tatsaechlich versendet wurde.' },
  ];

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      thema: thema,
      kundenname: folderNameHint,
      steps: steps,
      note: 'Copy-Text, Betreff-Varianten und Klaviyo-Template wurden automatisch erstellt. Die folgenden Schritte erfordern eine bewusste menschliche Entscheidung oder koennten laenger laufen und wurden daher NICHT automatisch ausgefuehrt:',
      nextSteps: nextSteps,
    }),
  };
};
