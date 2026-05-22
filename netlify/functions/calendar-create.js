// calendar-create.js
// Creates a Google Calendar event when a contractor schedules a job in Donna
// and has connected Google (oauth_connections, provider='google', with the
// calendar scope).
//
// Graceful by design: if Calendar isn't connected this returns
// { created:false, reason:… } with HTTP 200 so Donna can show a message
// without the scheduling flow ever breaking.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { summary, description?, start, end, timezone? }
//   start / end: ISO 8601 datetime strings (UTC 'Z' form is fine).
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { created, event_link?, reason? }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const { getGoogleConnection } = require('../lib/google-token');

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

  // Identify the contractor.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  const ok = (p) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });

  if (!body.start || !body.end) return ok({ created: false, reason: 'missing start/end' });

  // Look up the Google connection — skip gracefully if it's not there.
  let conn = { connected: false };
  try { conn = await getGoogleConnection(userId, supabaseUrl, supabaseKey); }
  catch (e) {
    console.error('[calendar-create] google connection', e.message);
    return ok({ created: false, reason: 'Calendar needs reconnecting.' });
  }
  if (!conn.connected || (conn.scopes || '').indexOf('calendar') === -1) {
    return ok({ created: false, reason: 'Calendar not connected.' });
  }

  const evt = {
    summary:     String(body.summary || 'Scheduled job'),
    description: String(body.description || ''),
    start: { dateTime: body.start },
    end:   { dateTime: body.end },
  };
  if (body.timezone) { evt.start.timeZone = body.timezone; evt.end.timeZone = body.timezone; }

  try {
    const cRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
    });
    if (!cRes.ok) {
      console.error('[calendar-create] calendar api', cRes.status, await cRes.text());
      return ok({ created: false, reason: 'Calendar didn’t accept that event.' });
    }
    const ev = await cRes.json();
    return ok({ created: true, event_link: ev.htmlLink || null });
  } catch (e) {
    console.error('[calendar-create]', e.message);
    return ok({ created: false, reason: 'Could not reach Google Calendar.' });
  }
};
