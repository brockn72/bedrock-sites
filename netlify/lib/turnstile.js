// netlify/lib/turnstile.js
// Server-side verification for Cloudflare Turnstile tokens.
//
// SEC1 / SEC4: protects capture-lead.js and send-desktop-link.js from bots
// that can otherwise hit those endpoints directly without going through the
// site UI.
//
// Usage in a Netlify function:
//
//   const { verifyTurnstile } = require('../lib/turnstile');
//   const ts = await verifyTurnstile(body.turnstileToken, event);
//   if (!ts.ok) return { statusCode: 403, body: JSON.stringify({ error: ts.error }) };
//
// ── Required Netlify env var ──────────────────────────────────────────────
//   TURNSTILE_SECRET   — secret key from the Cloudflare Turnstile dashboard
//                        (paired with TURNSTILE_SITE_KEY used on the client)
//
// If TURNSTILE_SECRET is not set we log a warning and allow the request
// through. That way this code can ship before Brock has created the widget;
// once the env var is set, enforcement turns on automatically.

async function verifyTurnstile(token, event) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    console.warn('[turnstile] TURNSTILE_SECRET not set — bot check skipped');
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'Missing bot-check token. Refresh the page and try again.' };
  }

  // Cloudflare wants application/x-www-form-urlencoded. The remoteip is
  // optional but improves their scoring.
  const remoteip = (event && event.headers &&
      (event.headers['x-forwarded-for'] || event.headers['client-ip'] || '')
    ).split(',')[0].trim();

  const form = new URLSearchParams();
  form.append('secret',   secret);
  form.append('response', token);
  if (remoteip) form.append('remoteip', remoteip);

  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!r.ok) {
      console.error('[turnstile] siteverify HTTP', r.status);
      return { ok: false, error: 'Bot check failed. Try again.' };
    }
    const data = await r.json();
    if (data.success) return { ok: true };
    console.warn('[turnstile] verify rejected', (data['error-codes'] || []).join(','));
    return { ok: false, error: 'Bot check failed. Refresh the page and try again.' };
  } catch (e) {
    console.error('[turnstile] network error:', e && e.message);
    // Fail-closed on network errors so attackers can't bypass by DOSing Cloudflare.
    return { ok: false, error: 'Bot check unreachable. Try again.' };
  }
}

module.exports = { verifyTurnstile };
