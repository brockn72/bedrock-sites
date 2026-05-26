// G6 (Batch G, 2026-05-26): returns the authenticated contractor's referral
// code + summary stats. Lazily creates a referral_code for the profile on
// first call (so existing users get a code without a separate migration step).
//
// GET /.netlify/functions/get-referral-info
// Authorization: Bearer <supabase access token>
//
// Response:
// {
//   code: "SMITH10",
//   share_url: "https://bedrock-sites.com/ref/SMITH10",
//   invited:   1,            // total referrals attributed to this user
//   joined:    1,            // referred users who signed up (status >= paid)
//   credited:  1,            // referred users who paid AND triggered a reward
//   credits_earned_months:   2,
//   credits_applied_months:  0
// }
//
// SEC8: no PII about referred contractors leaks — just counts. Service-role
// key is used for DB writes so RLS doesn't block the lazy code allocation.

const { generateReferralCode } = require('../lib/referral-code');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const siteUrl     = process.env.SITE_URL || 'https://bedrock-sites.com';
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  // Verify the access token → user
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  const user   = await userRes.json();
  const userId = user.id;

  // Fetch the user's profile (need business_name to seed the code, and the
  // existing referral_* counters).
  const profRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=id,business_name,referral_code,referral_credits_earned,referral_credits_applied&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!profRes.ok) {
    console.error('[get-referral-info] profile lookup status=', profRes.status);
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }
  const profiles = await profRes.json();
  const profile  = profiles[0] || null;

  // No profile row yet → return an empty state. The contractor's first
  // get-profile call seeds the row; we won't pre-create it from here to
  // avoid duplicate-insert races with that endpoint.
  if (!profile) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: null, share_url: null,
        invited: 0, joined: 0, credited: 0,
        credits_earned_months: 0, credits_applied_months: 0,
        message: 'Finish setting up your profile to get your referral code.',
      }),
    };
  }

  // Lazy-allocate the code if missing.
  let code = profile.referral_code;
  if (!code) {
    const findExisting = async (candidate) => {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(candidate)}&select=user_id&limit=1`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (!r.ok) return true; // be conservative on lookup failure
      const rows = await r.json();
      return rows.length > 0;
    };
    try {
      code = await generateReferralCode(profile.business_name, findExisting);
    } catch (e) {
      console.error('[get-referral-info] code allocation failed:', e.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not allocate code' }) };
    }
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey:         supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer:        'return=minimal',
        },
        body: JSON.stringify({ referral_code: code }),
      }
    );
    if (!patchRes.ok) {
      // Most likely a uniqueness collision raced us — retry the read once.
      console.warn('[get-referral-info] code persist status=', patchRes.status);
      const reread = await fetch(
        `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=referral_code&limit=1`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (reread.ok) {
        const r = await reread.json();
        if (r[0] && r[0].referral_code) code = r[0].referral_code;
      }
    }
  }

  // Stats: count referrals attributed to this referrer.
  // Status legend (see G4-referrals.sql): pending | paid | credited | voided.
  let invited = 0, joined = 0, credited = 0;
  try {
    const refRes = await fetch(
      `${supabaseUrl}/rest/v1/referrals?referrer_user_id=eq.${userId}&select=status`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (refRes.ok) {
      const rows = await refRes.json();
      for (const r of rows) {
        invited++;
        if (r.status === 'paid' || r.status === 'credited') joined++;
        if (r.status === 'credited') credited++;
      }
    }
  } catch (_) { /* referrals table may not exist yet — return zeros */ }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      share_url: `${siteUrl}/ref/${encodeURIComponent(code)}`,
      invited, joined, credited,
      credits_earned_months:  profile.referral_credits_earned  || 0,
      credits_applied_months: profile.referral_credits_applied || 0,
    }),
  };
};
