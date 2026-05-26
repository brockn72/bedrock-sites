// G18d: lightweight "email yourself a link" sender for mobile homepage visitors.
// Accepts a single email address, sends one Resend email with a link back to the
// site, returns { success: true }. No Supabase write, no DB at all — this is a
// frictionless way for someone on their phone to switch over to their laptop.
//
// SEC4: gated by Cloudflare Turnstile + per-IP rate limit (5/hour) so the same
// endpoint can't be used as a free email-blast cannon.

const { verifyTurnstile }   = require('../lib/turnstile');
const { checkAndIncrement } = require('../lib/rate-limit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const email          = (body.email || '').trim();
  const turnstileToken = body.turnstileToken;
  if (!email || email.indexOf('@') === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  // SEC4: per-IP cooldown — same IP can request the email at most 5 times per hour.
  const rl = await checkAndIncrement(event, 'desktop-link', 5);
  if (!rl.ok) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter || 3600) },
      body: JSON.stringify({ error: rl.error }),
    };
  }
  // SEC4: bot-check token (reuses the SEC1 verify helper).
  const ts = await verifyTurnstile(turnstileToken, event);
  if (!ts.ok) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: ts.error }),
    };
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  if (process.env.RESEND_DRY_RUN === 'true') {
    console.log('[send-desktop-link][dry-run] email skipped');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, emailed: false }),
    };
  }

  const fromEmail = process.env.RESEND_FROM || 'hello@bedrock-sites.com';
  const siteUrl   = process.env.SITE_URL || 'https://bedrock-sites.com';
  const esc       = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));

  const html = `
    <div style="font-family:'DM Sans',sans-serif;max-width:540px;color:#0D1B2E">
      <h2 style="font-family:'Cormorant Garamond',serif;color:#0D1B2E;margin-bottom:0.5rem">Here's the link you requested</h2>
      <p style="font-size:15px;line-height:1.6;color:#4A5568">Open it on your laptop or desktop to explore Bedrock Digital with more room to look around.</p>
      <p style="margin:1.5rem 0">
        <a href="${esc(siteUrl)}" style="display:inline-block;background:#C9922A;color:#fff;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-size:14px;padding:0.9rem 1.4rem;border-radius:5px;text-decoration:none">Open Bedrock Digital &rarr;</a>
      </p>
      <p style="font-size:13px;color:#7a7a7a;margin-top:2rem">Or paste this link into your browser: <a href="${esc(siteUrl)}" style="color:#C9922A">${esc(siteUrl)}</a></p>
      <p style="font-size:12px;color:#9a9a9a;margin-top:2rem;padding-top:1rem;border-top:1px solid #eee">You asked us to email this from the homepage. We won't send anything else unless you ask. &mdash; Bedrock Digital</p>
    </div>
  `;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:     fromEmail,
        to:       [email],
        subject:  'Your Bedrock Digital link',
        html,
      }),
    });
    if (!r.ok) {
      // SEC8: log status only; the response body echoes recipient email.
      console.error('[send-desktop-link] Resend status=', r.status);
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not send right now — please try again.' }) };
    }
  } catch (e) {
    console.error('[send-desktop-link] network error:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Email service unreachable' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
