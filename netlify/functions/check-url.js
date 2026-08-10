// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260804
//
// Netlify Function (Hilfsfunktion fuer die Neukundenanlage): prueft
// serverseitig, ob eine eingegebene Website-URL tatsaechlich erreichbar
// ist. Serverseitig, weil ein direkter fetch() aus dem Browser bei
// fremden Domains fast immer an CORS scheitert - hier ist das egal, da
// der Server die Anfrage stellt, nicht der Browser.
//
// Nur lesend - schreibt oder veraendert nichts.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  let url = ((event.queryStringParameters || {}).url || '').trim();
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'url ist Pflichtparameter.' }) };
  }
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 8000);

  try {
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      // Manche Server lehnen HEAD ab (405/501) - dann GET nachschieben.
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      }
    } finally {
      clearTimeout(timeout);
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reachable: res.ok, status: res.status, finalUrl: res.url }),
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reachable: false, error: err.name === 'AbortError' ? 'Zeitueberschreitung (8s)' : err.message }),
    };
  }
};
