// onboarding-email-scheduler.js
// Netlify scheduled function — runs daily and fires the day 2 and day 7
// onboarding emails to any contractor whose profile is exactly that old and
// hasn't received that email yet. Day 0 is fired immediately from
// stripe-webhook.js, not here.
//
// Sent state lives on profiles.onboarding_emails_sent (JSONB), keyed "day2",
// "day7". Read the SQL migration in the session summary before deploying:
//   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_emails_sent JSONB DEFAULT '{}';
//
// Schedule lives in netlify.toml under [functions."onboarding-email-scheduler"].
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   RESEND_API_KEY, RESEND_FROM, SITE_URL
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const { sendOnboardingEmail } = require('../lib/onboarding-email');

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[onboarding-scheduler] missing env config');
    return { statusCode: 200, body: 'skipped — not configured' };
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    console.error('[onboarding-scheduler] Resend not configured');
    return { statusCode: 200, body: 'skipped — Resend not configured' };
  }

  const hdr = { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } };

  // Pull profiles. (Cap at 1000 for safety; well above Phase 1's target customer count.)
  let profiles = [];
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=user_id,contact_name,business_name,email,created_at,onboarding_emails_sent&order=created_at.asc&limit=1000`,
      hdr
    );
    if (r.ok) profiles = await r.json();
    else console.error('[onboarding-scheduler] profiles list', r.status, await r.text());
  } catch (e) {
    console.error('[onboarding-scheduler] profiles list failed:', e.message);
    return { statusCode: 200, body: 'error listing profiles' };
  }

  // Index sites + leads by user_id so each contractor's live URL is one map lookup.
  let sites = [], leads = [];
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/sites?select=user_id,live_url,subdomain&limit=1000`, hdr);
    if (r.ok) sites = await r.json();
  } catch (_) { /* non-fatal */ }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/leads?select=user_id,site_url&limit=1000`, hdr);
    if (r.ok) leads = await r.json();
  } catch (_) { /* non-fatal */ }
  const siteByUser = {};
  sites.forEach((s) => { if (s.user_id && !siteByUser[s.user_id]) siteByUser[s.user_id] = s.live_url || ''; });
  leads.forEach((l) => { if (l.user_id && !siteByUser[l.user_id] && l.site_url) siteByUser[l.user_id] = l.site_url; });

  const now = Date.now();
  let sent2 = 0, sent7 = 0, skipped = 0, errors = 0;

  for (const p of profiles) {
    if (!p.email || !p.created_at) { skipped++; continue; }
    const ageDays = Math.floor((now - new Date(p.created_at).getTime()) / 86400000);
    const flags   = p.onboarding_emails_sent || {};
    let day = null;
    // Day 7 takes priority if both are eligible (older contractor catching up).
    if (ageDays >= 7 && !flags.day7) day = 7;
    else if (ageDays >= 2 && !flags.day2) day = 2;
    if (!day) { skipped++; continue; }

    const result = await sendOnboardingEmail({
      to:           p.email,
      name:         p.contact_name || p.business_name || '',
      site_url:     siteByUser[p.user_id] || '',
      delay_index:  day,
      user_id:      p.user_id,
      supabaseUrl:  supabaseUrl,
      supabaseKey:  supabaseKey,
    });
    if (result.sent) { day === 7 ? sent7++ : sent2++; }
    else errors++;
  }

  console.log(`[onboarding-scheduler] day2:${sent2} day7:${sent7} skipped:${skipped} errors:${errors} total:${profiles.length}`);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sent_day2: sent2, sent_day7: sent7, skipped: skipped, errors: errors, total: profiles.length }),
  };
};
