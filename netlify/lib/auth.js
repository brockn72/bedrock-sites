// netlify/lib/auth.js
// Validate a Supabase access token from the Authorization header. Used by
// create-subscription-checkout (SEC5) so the server-side user_id comes from
// the verified JWT, not from whatever the client posts in the body.

async function getUserFromAuthHeader(event) {
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return { ok: false, error: 'Auth service not configured' };
  }
  const header = (event && event.headers &&
    (event.headers.authorization || event.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(header));
  if (!m) return { ok: false, error: 'Missing access token — sign in again.' };
  const accessToken = m[1];

  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey:         supabaseAnon,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!r.ok) {
      return { ok: false, error: 'Session expired — sign in again.' };
    }
    const user = await r.json();
    if (!user || !user.id) return { ok: false, error: 'Invalid session.' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, error: 'Could not verify session — try again.' };
  }
}

module.exports = { getUserFromAuthHeader };
