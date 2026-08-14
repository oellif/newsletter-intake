const { getAccessToken, sheetsReadValues, sheetsWriteValues } = require('./lib/google');

const SHOPIFY_KUNDEN_ID = '12ut5Em-7XlkAKjf-heUG6ugVdRDF1D_wK67v6dM17CE';

function normalizeFilename(s) {
  return s.toLowerCase().replace(/[\s_]+/g, '-');
}

function driveUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

async function listDriveImages(tok, folderId) {
  const q   = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
  const data = await res.json();
  if (!res.ok) throw new Error('Drive-Fehler: ' + JSON.stringify(data));
  return (data.files || []).filter(f => f.name && !f.name.startsWith('.'));
}

function categorizeImages(driveImages, handle, optionValues) {
  const normHandle  = normalizeFilename(handle);
  const normOptions = optionValues.map(v => normalizeFilename(v));
  const general     = [];
  const variantMap  = new Map();

  for (const img of driveImages) {
    const normName = normalizeFilename(img.name.replace(/\.[^.]+$/, ''));
    if (!normName.startsWith(normHandle)) continue;
    const suffix = normName.slice(normHandle.length).replace(/^-/, '');

    if (suffix === '' || /^\d+$/.test(suffix)) {
      general.push({ img, position: suffix === '' ? 1 : parseInt(suffix) });
    } else {
      const match = normOptions.find(o => o === suffix);
      if (match) {
        variantMap.set(match, img);
      } else {
        general.push({ img, position: 9999 });
      }
    }
  }

  general.sort((a, b) => a.position - b.position || a.img.name.localeCompare(b.img.name));
  const generalImages = general.map(({ img }, i) => ({
    src: driveUrl(img.id),
    position: i + 1,
    alt: img.name.replace(/\.[^.]+$/, ''),
  }));

  return { generalImages, variantMap };
}

exports.handler = async (event) => {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'POST erforderlich' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  const { kunden_id, folder_id } = body;
  if (!kunden_id) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'kunden_id erforderlich' }) };

  try {
    const tok = await getAccessToken();

    const kundenRows = await sheetsReadValues(tok, SHOPIFY_KUNDEN_ID, 'A2:H500');
    const rowIdx     = (kundenRows || []).findIndex(r => r[0] === kunden_id);
    if (rowIdx < 0) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    const kundeRow = kundenRows[rowIdx];

    const mastertabelleId = kundeRow[6];
    // Ordner-ID: direkt uebergeben gewinnt, sonst gespeicherter Wert (Spalte H)
    const folderId = folder_id || kundeRow[7] || '';

    if (!mastertabelleId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Keine Mastertabelle vorhanden.' }) };
    if (!folderId)        return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Kein Bildordner angegeben.' }) };

    // Uebergebene Ordner-ID fuer das naechste Mal speichern
    if (folder_id && folder_id !== kundeRow[7]) {
      await sheetsWriteValues(tok, SHOPIFY_KUNDEN_ID, [[folder_id]], 'H' + (rowIdx + 2));
    }

    // Read Mastertabelle
    const allRows = await sheetsReadValues(tok, mastertabelleId, 'A1:CZ2000');
    if (!allRows || allRows.length < 2) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Mastertabelle ist leer.' }) };

    const headerRow = allRows[0];
    const dataRows  = allRows.slice(1);

    const CI = {};
    headerRow.forEach((col, i) => { if (col) CI[col.trim()] = i; });
    const get    = (row, col) => CI[col] !== undefined ? String(row[CI[col]] || '').trim() : '';
    const colIdx = (col) => CI[col];

    // List Drive images
    const driveImages = await listDriveImages(tok, folderId);

    // Group rows by handle, collect option values per handle
    const handleMeta = new Map(); // handle → { optionValues: Set, rowIndices: [] }
    dataRows.forEach((row, i) => {
      const handle = get(row, 'URL handle');
      if (!handle) return;
      if (!handleMeta.has(handle)) handleMeta.set(handle, { optionValues: new Set(), rowIndices: [] });
      const meta = handleMeta.get(handle);
      meta.rowIndices.push(i);
      [get(row, 'Option1 value'), get(row, 'Option2 value'), get(row, 'Option3 value')]
        .filter(Boolean).forEach(v => meta.optionValues.add(v));
    });

    // Build updated rows
    const updatedRows = dataRows.map(r => [...r]);
    const imgUrlCol  = colIdx('Product image URL');
    const imgPosCol  = colIdx('Image position');
    const imgAltCol  = colIdx('Image alt text');
    const varImgCol  = colIdx('Variant image URL');

    let handlesMatched = 0;

    for (const [handle, meta] of handleMeta) {
      const optArr = [...meta.optionValues];
      const { generalImages, variantMap } = categorizeImages(driveImages, handle, optArr);

      if (generalImages.length === 0 && variantMap.size === 0) continue;
      handlesMatched++;

      // Assign general images: one per row (in order), rest get empty
      meta.rowIndices.forEach((ri, idx) => {
        const row = updatedRows[ri];
        const img = generalImages[idx];
        if (img && imgUrlCol !== undefined) {
          while (row.length <= Math.max(imgUrlCol, imgPosCol || 0, imgAltCol || 0, varImgCol || 0)) row.push('');
          row[imgUrlCol] = img.src;
          if (imgPosCol !== undefined) row[imgPosCol] = String(img.position);
          if (imgAltCol !== undefined) row[imgAltCol] = img.alt || '';
        } else if (imgUrlCol !== undefined && idx > 0) {
          // Only clear if there was a previous value from old run
          if (row[imgUrlCol]) row[imgUrlCol] = '';
        }

        // Variant image: match by option values of this row
        const optVals = [get(row, 'Option1 value'), get(row, 'Option2 value'), get(row, 'Option3 value')].filter(Boolean);
        if (varImgCol !== undefined) {
          while (row.length <= varImgCol) row.push('');
          let varSrc = '';
          for (const opt of optVals) {
            const driveImg = variantMap.get(normalizeFilename(opt));
            if (driveImg) { varSrc = driveUrl(driveImg.id); break; }
          }
          row[varImgCol] = varSrc;
        }
      });
    }

    // Write updated rows back (starting at row 2, keeping header intact)
    await sheetsWriteValues(tok, mastertabelleId, updatedRows, 'A2');

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({ success: true, handles_matched: handlesMatched, total_drive_images: driveImages.length }),
    };

  } catch(err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
