// vision-ocr.js
// Reads a receipt photo with the Google Cloud Vision API and pulls out the
// fields Donna pre-fills on the receipt form: vendor, amount, and date.
//
// Wired to the receipt upload in bedrock-donna-v1.html. Best-effort by design —
// if Vision can't read a field, that field comes back null and the contractor
// fills it in themselves.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { image_base64: "data:image/jpeg;base64,/9j/…" }
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { vendor, amount, date, raw_text }
//
// ── Required Netlify env var ───────────────────────────────────────────────
//   GOOGLE_VISION_API_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Receipt scanning isn’t configured yet — enter the details by hand.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const dataUrl = body.image_base64 || '';
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) {
    return { statusCode: 400, body: JSON.stringify({ error: 'image_base64 must be a base64 data URL' }) };
  }
  const content = m[2];

  // ── Call Vision: full-document text detection ─────────────────────────────
  let visionRes;
  try {
    visionRes = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image:    { content: content },
          features: [{ type: 'TEXT_DETECTION' }],
        }],
      }),
    });
  } catch (e) {
    console.error('[vision-ocr] network', e);
    return { statusCode: 502, body: JSON.stringify({ error: 'Couldn’t reach the receipt scanner.' }) };
  }

  if (!visionRes.ok) {
    console.error(`[vision-ocr] ${visionRes.status} — ${await visionRes.text()}`);
    return { statusCode: 502, body: JSON.stringify({ error: 'Receipt scan failed — enter the details by hand.' }) };
  }

  const data = await visionRes.json();
  const resp = (data.responses && data.responses[0]) || {};
  const text = (resp.fullTextAnnotation && resp.fullTextAnnotation.text)
    || (resp.textAnnotations && resp.textAnnotations[0] && resp.textAnnotations[0].description)
    || '';

  if (!text) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor: null, amount: null, date: null, raw_text: '' }) };
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // ── Vendor: first line that reads like a business name ────────────────────
  // Skip lines that are mostly digits/symbols (addresses, phone numbers, totals).
  let vendor = null;
  for (const line of lines.slice(0, 6)) {
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters >= 3 && !/^\d/.test(line) && !/receipt|invoice|order/i.test(line)) {
      vendor = line.replace(/\s{2,}/g, ' ').slice(0, 80);
      break;
    }
  }

  // ── Amount: prefer a line containing "total"; else the largest currency value ─
  const moneyRe = /(\d{1,3}(?:,\d{3})*|\d+)\.\d{2}/g;
  let amount = null;
  const totalLine = lines.find((l) => /\b(grand\s*total|total|amount\s*due|balance)\b/i.test(l) && moneyRe.test(l));
  if (totalLine) {
    const found = totalLine.match(moneyRe);
    if (found && found.length) amount = parseFloat(found[found.length - 1].replace(/,/g, ''));
  }
  if (amount == null) {
    let max = 0;
    const all = text.match(moneyRe) || [];
    all.forEach((v) => { const n = parseFloat(v.replace(/,/g, '')); if (n > max) max = n; });
    if (max > 0) amount = max;
  }

  // ── Date: first thing that parses as a date ───────────────────────────────
  let date = null;
  const dateMatch = text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/)
    || text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\b/i);
  if (dateMatch) {
    const parsed = new Date(dateMatch[1].replace(/\./g, '/'));
    if (!isNaN(parsed.getTime())) {
      date = parsed.toISOString().slice(0, 10);   // YYYY-MM-DD for the form's date input
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor: vendor, amount: amount, date: date, raw_text: text.slice(0, 2000) }),
  };
};
