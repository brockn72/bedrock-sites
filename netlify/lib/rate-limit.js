// netlify/lib/rate-limit.js
// Per-IP rate limiter backed by a tiny Supabase table. Used by capture-lead
// (SEC1) and send-desktop-link (SEC4) to stop a single IP from flooding
// signups or "email me a link" requests.
//
// ── One-time migration (run in Supabase SQL editor) ────────────────────────
//   create table if not exists rate_limits (
//     bucket_key text primary key,
//     hits       int  not null default 0,
//     created_at timestamptz not null default now()
//   );
//   create index if not exists idx_rate_limits_created on rate_limits(created_at);
//   -- optional cleanup job: delete from rate_limits where created_at < now() - interval '2 hours';
//
// If the table doesn't exist or Supabase is unreachable, the helper logs and
// allows the request (degrades open — losing the rate limit is preferable to
// 500-ing a real customer's signup). Once the table is in place, enforcement
// turns on automatically.

const { createHash } = require('crypto');

// hashed-bucket key: "<purpose>:<sha256(ip)[:16]>:<hourBucket>"
function bucketKey(purpose, ip, hourBucket) {
  const h = createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
  return `${purpose}:${h}:${hourBucket}`;
}

function clientIp(event) {
  if (!event || !event.headers) return 'unknown';
  const xff = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'] || '';
  const first = String(xff).split(',')[0].trim();
  return first || event.headers['client-ip'] || event.headers['Client-Ip'] || 'unknown';
}

// purpose: short string, e.g. 'signup' or 'desktop-link'
// max:     max hits allowed per IP per hour
// Returns { ok: true } or { ok: false, error: '...', retryAfter: <seconds> }
async function checkAndIncrement(event, purpose, max) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn('[rate-limit] Supabase not configured — allowing');
    return { ok: true, skipped: true };
  }

  const ip       = clientIp(event);
  const now      = new Date();
  const hour     = now.toISOString().slice(0, 13);       // "2026-05-25T18"
  const key      = bucketKey(purpose, ip, hour);
  const hdr      = {
    'Content-Type': 'application/json',
    apikey:         supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    // Read current hit count for this (purpose, ip, hour) bucket.
    const r = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?bucket_key=eq.${encodeURIComponent(key)}&select=hits&limit=1`,
      { headers: hdr }
    );
    let hits = 0;
    if (r.ok) {
      const rows = await r.json();
      if (rows.length) hits = rows[0].hits || 0;
    } else if (r.status === 404 || r.status === 406) {
      // Table doesn't exist yet — degrade open until Brock runs the migration.
      console.warn('[rate-limit] rate_limits table missing — allowing');
      return { ok: true, skipped: true };
    } else {
      console.warn('[rate-limit] read status', r.status);
      return { ok: true, skipped: true };
    }

    if (hits >= max) {
      // 60 minutes minus minutes-into-this-hour, rough retry estimate.
      const retryAfter = Math.max(60, 3600 - (now.getMinutes() * 60 + now.getSeconds()));
      return {
        ok: false,
        error: 'Too many requests from your network. Please wait an hour and try again.',
        retryAfter,
      };
    }

    // Upsert: bump the counter. If the row didn't exist we insert; if it did
    // we update. Postgres `on_conflict` via Supabase upsert handles both.
    await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=bucket_key`, {
      method:  'POST',
      headers: { ...hdr, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body:    JSON.stringify({ bucket_key: key, hits: hits + 1, created_at: now.toISOString() }),
    });

    return { ok: true };
  } catch (e) {
    console.warn('[rate-limit] error:', e && e.message);
    return { ok: true, skipped: true };
  }
}

module.exports = { checkAndIncrement };
