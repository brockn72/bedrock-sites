// netlify/lib/onboarding-email.js
// Shared helper for the 3-part onboarding email sequence. Used by both
// send-onboarding-sequence.js (HTTP-fired, e.g. from the Stripe webhook on
// day 0) and onboarding-email-scheduler.js (daily scheduled fn that finds
// contractors hitting day 2 / day 7 of their signup).
//
// Voice rule: emails read like a note from Brock — plain HTML, conversational,
// short — not a marketing blast.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   RESEND_API_KEY, RESEND_FROM, SITE_URL

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function firstName(n) { var s = String(n || '').trim().split(/\s+/)[0]; return s || 'there'; }

// Each template returns { subject, html } given the contractor's opts.
const TEMPLATES = {
  0: function(opts) {
    var siteBlock = opts.site_url
      ? '<p>Your site is live: <a href="' + esc(opts.site_url) + '">' + esc(opts.site_url) + '</a></p>'
        + '<p style="color:#888;font-size:13px">DNS can take up to 24 hours to settle everywhere — if a friend says it doesn\'t load, give it a few more hours.</p>'
      : '<p>Your account is set up. We\'ll send your live URL as soon as the build finishes (usually a few minutes, sometimes a few hours).</p>';
    return {
      subject: 'Your Bedrock site is live — here\'s what\'s next',
      html:
        '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;color:#111;line-height:1.55;font-size:15px">'
        + '<p>Hey ' + esc(firstName(opts.name)) + ',</p>'
        + siteBlock
        + '<p>I built this for you. If anything looks off — wrong photo, wrong service, typo, whatever — just reply to this email and I\'ll fix it.</p>'
        + '<p><strong>Two things worth knowing:</strong></p>'
        + '<ul style="padding-left:1.1rem">'
        + '  <li>Your portal lives at <a href="' + esc(opts.portal_url) + '">' + esc(opts.portal_url) + '</a>. That\'s where you edit the site, see analytics, and manage everything.</li>'
        + '  <li>You won\'t be charged again for 30 days. After that it\'s $20/month for hosting.</li>'
        + '</ul>'
        + '<p>Once you\'re settled in, two other tools are sitting in your portal that pair really well with the site:</p>'
        + '<ul style="padding-left:1.1rem">'
        + '  <li><strong>Bedrock Marketing</strong> — make flyers, social posts, door hangers, business cards from your brand kit in a few minutes.</li>'
        + '  <li><strong>Bedrock Operations · Donna</strong> — drafts your estimates and invoices so you don\'t have to type the same line items every time. You approve before anything sends.</li>'
        + '</ul>'
        + '<p>Take a look whenever you have a quiet ten minutes. No rush.</p>'
        + '<p>— Brock<br><span style="color:#888;font-size:13px">Bedrock Digital</span></p>'
        + '</div>',
    };
  },
  2: function(opts) {
    var portal = esc(opts.portal_url);
    return {
      subject: '3 ways contractors are using Bedrock this week',
      html:
        '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;color:#111;line-height:1.55;font-size:15px">'
        + '<p>Hey ' + esc(firstName(opts.name)) + ',</p>'
        + '<p>Quick note — wanted to share three things contractors in your boat have been doing this week:</p>'
        + '<ol style="padding-left:1.1rem">'
        + '  <li style="margin-bottom:0.6rem"><strong>Made a door hanger before hitting a new neighborhood.</strong> Marketing → Build Materials → Door Hanger. Five minutes, print-ready PDF.</li>'
        + '  <li style="margin-bottom:0.6rem"><strong>Drafted an estimate without typing the same line items again.</strong> Donna builds it from a plain description like "600 sq ft paver patio." You approve before anything sends.</li>'
        + '  <li><strong>Connected QuickBooks once, watched their real margins show up.</strong> Finance pulls your real numbers and shows which jobs actually paid.</li>'
        + '</ol>'
        + '<p>Each one\'s a couple clicks from your portal:</p>'
        + '<ul style="padding-left:1.1rem">'
        + '  <li>Marketing: <a href="' + portal + '#marketing">' + portal + '#marketing</a></li>'
        + '  <li>Donna: <a href="' + portal + '#operations">' + portal + '#operations</a></li>'
        + '  <li>Finance: <a href="' + portal + '#finance">' + portal + '#finance</a></li>'
        + '</ul>'
        + '<p>Any questions? Just reply to this email.</p>'
        + '<p>— Brock</p>'
        + '</div>',
    };
  },
  7: function(opts) {
    var portal = esc(opts.portal_url);
    return {
      subject: 'How\'s the site working for you?',
      html:
        '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;color:#111;line-height:1.55;font-size:15px">'
        + '<p>Hey ' + esc(firstName(opts.name)) + ',</p>'
        + '<p>Quick check-in — it\'s been a week. Have you gotten any calls or messages from the site yet?</p>'
        + '<p>A couple things on my mind:</p>'
        + '<ul style="padding-left:1.1rem">'
        + '  <li>If the wording or photos aren\'t quite right, log into your portal and tweak them anytime. Or reply to this email and I\'ll do it for you.</li>'
        + '  <li>The free SEO &amp; GEO Optimizer in your portal will run a quick audit and tell you exactly what\'s holding your rankings back. Worth five minutes: <a href="' + portal + '#website">' + portal + '#website</a></li>'
        + '  <li>When you\'re ready to get more out of Bedrock, Donna and Finance are a couple clicks away — but no pressure.</li>'
        + '</ul>'
        + '<p>Genuinely curious how it\'s going. Hit reply with anything.</p>'
        + '<p>— Brock</p>'
        + '</div>',
    };
  },
};

// Send one onboarding email and (optionally) mark profiles.onboarding_emails_sent.
// opts: { to, name, site_url, delay_index, user_id?, supabaseUrl?, supabaseKey? }
async function sendOnboardingEmail(opts) {
  if (!opts || !opts.to) return { sent: false, error: 'missing recipient' };
  const dayIdx = Number(opts.delay_index);
  if (![0, 2, 7].includes(dayIdx)) return { sent: false, error: 'delay_index must be 0, 2, or 7' };

  const resendKey  = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM;
  if (!resendKey || !resendFrom) return { sent: false, error: 'Resend not configured' };
  if (process.env.RESEND_DRY_RUN === 'true') {
    console.log('[onboarding-email][dry-run] email skipped (delay_index ' + dayIdx + ')');
    return { sent: false, dry_run: true };
  }

  const siteUrl   = process.env.SITE_URL || 'https://bedrock-sites.com';
  const portalUrl = `${siteUrl}/portal.html`;
  const tpl = TEMPLATES[dayIdx]({
    name:       opts.name || '',
    site_url:   opts.site_url || '',
    portal_url: portalUrl,
  });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:     resendFrom,
        to:       [opts.to],
        subject:  tpl.subject,
        html:     tpl.html,
        reply_to: process.env.NOTIFY_EMAIL || undefined,
      }),
    });
    if (!res.ok) {
      // SEC8: status only — body echoes recipient address.
      console.error('[onboarding-email] resend status=', res.status);
      return { sent: false, error: 'Resend failed (' + res.status + ')' };
    }
  } catch (e) {
    console.error('[onboarding-email] send failed:', e.message);
    return { sent: false, error: 'Network error sending email' };
  }

  // Mark this email as sent in profiles.onboarding_emails_sent (best-effort —
  // a failed mark just means a duplicate next run; better than not sending).
  if (opts.user_id && opts.supabaseUrl && opts.supabaseKey) {
    try {
      const key = 'day' + dayIdx;
      // Read current state (we don't want to clobber other day flags).
      const r = await fetch(
        `${opts.supabaseUrl}/rest/v1/profiles?user_id=eq.${opts.user_id}&select=onboarding_emails_sent&limit=1`,
        { headers: { apikey: opts.supabaseKey, Authorization: `Bearer ${opts.supabaseKey}` } }
      );
      let current = {};
      if (r.ok) { const rows = await r.json(); if (rows.length && rows[0].onboarding_emails_sent) current = rows[0].onboarding_emails_sent; }
      current[key] = true;
      await fetch(
        `${opts.supabaseUrl}/rest/v1/profiles?user_id=eq.${opts.user_id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey:         opts.supabaseKey,
            Authorization: `Bearer ${opts.supabaseKey}`,
            Prefer:        'return=minimal',
          },
          body: JSON.stringify({ onboarding_emails_sent: current }),
        }
      );
    } catch (e) {
      console.error('[onboarding-email] mark failed:', e.message);
    }
  }

  return { sent: true, kind: 'day' + dayIdx };
}

module.exports = { sendOnboardingEmail, TEMPLATES };
