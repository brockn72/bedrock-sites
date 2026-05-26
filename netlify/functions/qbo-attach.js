// qbo-attach.js
// OPS7: upload a receipt photo to QuickBooks Online as an Attachable, linked
// to the Purchase record created earlier by qbo-sync (entity='receipt'). So
// the image lives in QBO against the expense, not just in Bedrock.
//
// Approval-gated upstream: Donna only calls this after the contractor has
// approved the receipt and qbo-sync returned a Purchase id.
//
// ── Request body (POST, Authorization: Bearer <supabase access token>) ────
//   { purchase_id: '123', image_base64: 'data:image/jpeg;base64,...',
//     file_name?: 'receipt-2026-05-25.jpg' }
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { attached, attachable_id? , skipped?, reason? }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   QBO_SANDBOX, SUPABASE_URL, SUPABASE_SERVICE_KEY

const { getQboConnection } = require('./qbo-refresh');

function qboApiBase() {
  return process.env.QBO_SANDBOX === 'false'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

// Pull MIME + raw bytes out of a data: URL. Returns { contentType, buffer } or null.
function decodeDataUrl(s) {
  if (typeof s !== 'string') return null;
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(s.trim());
  if (!m) return null;
  try {
    return { contentType: m[1], buffer: Buffer.from(m[2], 'base64') };
  } catch (_) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const purchaseId = String(body.purchase_id || '').trim();
  const imgB64     = body.image_base64;
  if (!purchaseId) return { statusCode: 400, body: JSON.stringify({ error: 'purchase_id required' }) };
  if (!imgB64)     return { statusCode: 400, body: JSON.stringify({ error: 'image_base64 required' }) };

  const decoded = decodeDataUrl(imgB64);
  if (!decoded) return { statusCode: 400, body: JSON.stringify({ error: 'image_base64 must be a data: URL' }) };

  // Identify the contractor + look up their QBO connection.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  let conn;
  try { conn = await getQboConnection(userId, supabaseUrl, supabaseKey); }
  catch (e) {
    console.warn('[qbo-attach] conn code=', (e && e.code) || 'unknown');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attached: false, skipped: true, reason: 'QuickBooks needs reconnecting.' }) };
  }
  if (!conn.connected) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attached: false, skipped: true, reason: 'QuickBooks not connected.' }) };
  }

  // Build the multipart body QBO expects:
  //   file_metadata_01  →  the Attachable JSON (AttachableRef links it to the Purchase)
  //   file_content_01   →  the actual image bytes
  // The numeric suffix lets one request upload multiple files; we always send one.
  const ext = (decoded.contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
  const fileName = String(body.file_name || ('receipt-' + Date.now() + '.' + ext));
  const meta = {
    AttachableRef: [{ EntityRef: { type: 'Purchase', value: purchaseId } }],
    FileName:      fileName,
    ContentType:   decoded.contentType,
  };

  const form = new FormData();
  form.append('file_metadata_01',
    new Blob([JSON.stringify(meta)], { type: 'application/json' }),
    'meta.json');
  form.append('file_content_01',
    new Blob([decoded.buffer], { type: decoded.contentType }),
    fileName);

  try {
    const r = await fetch(
      `${qboApiBase()}/v3/company/${conn.realm_id}/upload?minorversion=65`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${conn.access_token}`, Accept: 'application/json' },
        body: form,
      }
    );
    if (!r.ok) {
      console.warn('[qbo-attach] upload status=', r.status);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attached: false, error: 'QuickBooks rejected the image attachment.' }) };
    }
    const data = await r.json();
    // QBO returns AttachableResponse[0].Attachable.Id on success.
    const att = (data.AttachableResponse && data.AttachableResponse[0] && data.AttachableResponse[0].Attachable) || null;
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attached: true, attachable_id: (att && att.Id) || null }) };
  } catch (e) {
    console.warn('[qbo-attach] network code=', (e && e.code) || 'unknown');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attached: false, error: 'Could not reach QuickBooks to attach the image.' }) };
  }
};
