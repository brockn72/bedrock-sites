// log-time-event.js
// Backs the portal "Time saved with Bedrock" stat card (B3a). Each real Bedrock
// action — estimate sent, invoice approved, receipt uploaded, asset exported —
// fires window.bedrockLogTime(actionType), which POSTs here. The card reads back
// every event the user has logged so the number is always traceable to a real
// action, never fabricated.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { action_type, minutes_credited, ref_id?, metadata? }   → { row:{…} }
//   { action:'load' }                                       → { events:[…], total_minutes }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Table: bedrock_time_log (see supabase/schema.sql).

// Server-side allow-list — the front-end may try other strings, but only these
// earn minutes. Keep in sync with TIME_CREDITS in portal.html.
const TIME_CREDITS = {
  website_built:        180,
  brand_kit_completed:   90,
  estimate_created:      20,
  estimate_approved:     20,
  invoice_created:       15,
  invoice_sent:          15,
  receipt_scanned:        8,
  customer_added:         5,
  job_created:            5,
  marketing_exported:    25,
  asset_uploaded:         3,
};

// SEC9: sanitize the JSONB `metadata` column before insert.
const { sanitizeJsonb } = require('../lib/sanitize');

function sb(url, key, path, opts) {
  return fetch(`${url}/rest/v1/${path}`, Object.assign({
    headers: Object.assign({
      apikey:         key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    }, (opts && opts.headers) || {}),
  }, opts || {}));
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

  // Identify the contractor from their Supabase session.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  // ── LOAD: every event this contractor has logged, newest first ──────────
  if (body.action === 'load') {
    const res = await sb(supabaseUrl, supabaseKey,
      `bedrock_time_log?user_id=eq.${userId}&select=action_type,minutes_credited,ref_id,metadata,created_at&order=created_at.desc`);
    if (!res.ok) {
      console.error('[log-time-event] load', res.status, await res.text());
      return { statusCode: 500, body: JSON.stringify({ error: 'Load failed' }) };
    }
    const events = await res.json();
    const total_minutes = events.reduce((s, e) => s + (e.minutes_credited || 0), 0);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, total_minutes }) };
  }

  // ── INSERT: enforce the server-side credit table ────────────────────────
  const actionType = String(body.action_type || '').trim();
  if (!actionType || !(actionType in TIME_CREDITS)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action_type' }) };
  }
  const rec = {
    user_id:          userId,
    action_type:      actionType,
    minutes_credited: TIME_CREDITS[actionType],   // ignore any client-supplied value
    ref_id:           body.ref_id || null,
    metadata:         sanitizeJsonb(body.metadata || null),
  };
  const res = await sb(supabaseUrl, supabaseKey, 'bedrock_time_log',
    { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rec) });
  if (!res.ok) {
    console.error('[log-time-event] insert', res.status, await res.text());
    return { statusCode: 500, body: JSON.stringify({ error: 'Insert failed' }) };
  }
  const rows = await res.json();
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row: rows[0] || null }) };
};
