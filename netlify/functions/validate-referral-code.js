// G7 (Batch G, 2026-05-26): pre-checkout validation of a referral code.
//
// Public POST — used by the lead-capture form and the subscription cart to
// confirm a code is real before stamping it onto the lead/checkout.
//
// Request body: { code: "SMITH10", email?: "buyer@example.com" }
//   email is optional but recommended — lets us block self-referral by email
//   match (the buyer can't redeem their own code).
//
// Response (200):
//   { valid: true,  business_name: "Smith Plumbing" }   // for nicer UI copy
//   { valid: false, reason: "unknown" | "self" | "malformed" }
//
// SEC8: no other PII leaks. business_name is intentionally returned so the
// signup form can show "You'll be supporting Smith Plumbing" — that's the
// referrer's public business identity, not private data.

const { looksLikeReferralCode } = require('../lib/referral-code');

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
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const raw   = (body.code || '').toString().trim();
  const code  = raw.toUpperCase();
  const email = (body.email || '').toString().trim().toLowerCase();

  if (!looksLikeReferralCode(code)) {
    return ok({ valid: false, reason: 'malformed' });
  }

  // Look up the code → referrer profile (one query, includes business_name +
  // email for the self-referral guard).
  const r = await fetch(
    `${supabaseUrl}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(code)}&select=user_id,business_name,email&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!r.ok) {
    console.error('[validate-referral-code] lookup status=', r.status);
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }
  const rows = await r.json();
  if (!rows.length) return ok({ valid: false, reason: 'unknown' });

  const referrer = rows[0];
  if (email && referrer.email && referrer.email.toLowerCase() === email) {
    return ok({ valid: false, reason: 'self' });
  }

  return ok({ valid: true, business_name: referrer.business_name || 'a Bedrock customer' });
};

function ok(payload) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
