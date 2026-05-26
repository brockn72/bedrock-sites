// send-onboarding-sequence.js
// HTTP endpoint for sending one onboarding email — day 0 (immediate, fired
// from stripe-webhook.js on a paid site build), day 2, or day 7. The daily
// onboarding-email-scheduler.js handles days 2 and 7 for everyone else.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { email, name?, site_url?, delay_index: 0|2|7, user_id? }
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { sent, kind?, error? }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   RESEND_API_KEY, RESEND_FROM, SITE_URL
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (optional — used to mark sent-flag)

const { sendOnboardingEmail } = require('../lib/onboarding-email');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (process.env.RESEND_DRY_RUN === 'true') {
    console.log('[send-onboarding-sequence][dry-run] email skipped');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: false, dry_run: true }),
    };
  }

  const result = await sendOnboardingEmail({
    to:           body.email,
    name:         body.name,
    site_url:     body.site_url,
    delay_index:  body.delay_index,
    user_id:      body.user_id,
    supabaseUrl:  process.env.SUPABASE_URL,
    supabaseKey:  process.env.SUPABASE_SERVICE_KEY,
  });

  return {
    statusCode: result.sent ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
