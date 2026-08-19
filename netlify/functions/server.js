require('dotenv').config({ path: '/opt/cockpit/.env' });
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

function toEvent(req) {
  const rawBody = req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || null);
  return {
    httpMethod: req.method,
    headers: req.headers,
    queryStringParameters: req.query || {},
    body: rawBody,
    path: req.path,
    rawUrl: req.originalUrl,
  };
}

app.all('/:name', async (req, res) => {
  const name = req.params.name;
  let fn;
  try {
    fn = require(path.join(__dirname, name));
  } catch (e) {
    console.error(`[${name}] Nicht gefunden:`, e.message);
    return res.status(404).json({ error: `Function not found: ${name}` });
  }

  if (typeof fn.handler !== 'function') {
    return res.status(500).json({ error: `${name}: kein handler exportiert` });
  }

  const event = toEvent(req);
  try {
    const result = await fn.handler(event, {});
    const { statusCode = 200, headers = {}, body = '' } = result;
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.status(statusCode).send(body);
  } catch (err) {
    console.error(`[${name}] Fehler:`, err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.FUNCTIONS_PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Cockpit Functions Server läuft auf Port ${PORT}`);
});
