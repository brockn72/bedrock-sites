const { createHmac, timingSafeEqual } = require('crypto');
const { deploySite } = require('../lib/deploy-site');

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts  = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const sig       = parts.v1;
  if (!timestamp || !sig) return false;

  const signed   = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signed).digest('hex');

  // Constant-time comparison to prevent timing attacks
  const expBuf = Buffer.from(expected, 'hex');
  const sigBuf = Buffer.from(sig,      'hex');
  if (expBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(expBuf, sigBuf);
}

// Upsert one `subscriptions` row per tool for a contractor. Used by the tool
// subscription flow (Marketing / Finance & Operations) — entirely separate from
// the site-build flow, which keys off metadata.lead_id instead.
async function upsertToolSubs(supabaseUrl, supabaseKey, userId, tools, status, stripeSubId, stripeCustId) {
  if (!supabaseUrl || !supabaseKey || !userId || !tools || !tools.length) return;
  const now = new Date().toISOString();
  const rows = tools.map((t) => ({
    user_id: userId,
    tool:    t === 'cfo' ? 'finance_operations' : t,   // normalize the legacy cart key
    status:  status,
    stripe_subscription_id: stripeSubId || null,
    stripe_customer_id:     stripeCustId || null,
    updated_at: now,
  }));
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/subscriptions?on_conflict=user_id,tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!r.ok) console.error('[stripe-webhook] subscriptions upsert', r.status, await r.text());
  } catch (e) {
    console.error('[stripe-webhook] subscriptions upsert failed:', e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const supabaseKey   = process.env.SUPABASE_SERVICE_KEY;
  const resendKey     = process.env.RESEND_API_KEY;

  if (!webhookSecret) {
    return { statusCode: 500, body: 'STRIPE_WEBHOOK_SECRET not configured' };
  }

  // Netlify may base64-encode the body for binary payloads
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const sigHeader = event.headers['stripe-signature'];
  if (!verifyStripeSignature(rawBody, sigHeader, webhookSecret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // ── Tool subscription lifecycle (Marketing / Finance & Operations) ──────────
  // Fired when a Stripe subscription changes state. Site-build subscriptions
  // carry metadata.lead_id (no tools) so they're skipped here.
  if (stripeEvent.type === 'customer.subscription.updated' ||
      stripeEvent.type === 'customer.subscription.deleted') {
    const sub      = stripeEvent.data.object;
    const userId   = sub.metadata && sub.metadata.user_id;
    const toolsStr = sub.metadata && sub.metadata.tools;
    if (userId && toolsStr) {
      const tools = toolsStr.split(',').map((s) => s.trim()).filter(Boolean);
      // Status mapping:
      //   active / trialing      → 'active'   (tools fully unlocked)
      //   past_due               → 'past_due' (tools still work; portal shows a "update your card" banner)
      //   unpaid / canceled      → 'canceled' (tools locked — every retry failed or the contractor canceled)
      let status = 'active';
      if (stripeEvent.type === 'customer.subscription.deleted'
          || sub.status === 'canceled' || sub.status === 'unpaid') status = 'canceled';
      else if (sub.status === 'past_due') status = 'past_due';
      else if (sub.status === 'active' || sub.status === 'trialing') status = 'active';
      else status = sub.status || 'active';
      await upsertToolSubs(supabaseUrl, supabaseKey, userId, tools, status, sub.id, sub.customer || '');
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session      = stripeEvent.data.object;

    // ── Tool subscription checkout (Marketing / Finance & Operations) ─────────
    // Distinguished from a site build by metadata.tools (site builds use
    // metadata.lead_id). Mark the tools active and stop — none of the
    // site-build logic below applies.
    if (session.metadata && session.metadata.tools) {
      const subUserId = session.metadata.user_id || '';
      const subTools  = session.metadata.tools.split(',').map((s) => s.trim()).filter(Boolean);
      await upsertToolSubs(supabaseUrl, supabaseKey, subUserId, subTools, 'active',
                           session.subscription || '', session.customer || '');
      if (resendKey) {
        const fromEmail = process.env.RESEND_FROM  || 'hello@bedrock-sites.com';
        const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromEmail, to: [toEmail],
            subject: `New tool subscription: ${subTools.join(', ')}`,
            html: `<div style="font-family:sans-serif"><h2>New tool subscription</h2>
                   <p>Tools: <strong>${subTools.join(', ')}</strong><br>
                   Customer: ${session.customer_details?.email || session.customer_email || '—'}<br>
                   User ID: ${subUserId || '—'}<br>
                   Stripe subscription: ${session.subscription || '—'}</p></div>`,
          }),
        }).catch((e) => console.error('[stripe-webhook] notify email failed:', e.message));
      }
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    const leadId       = session.metadata?.lead_id;
    const businessName = session.metadata?.business_name || 'Unknown Business';
    const customerEmail = session.customer_details?.email || session.customer_email || '';

    // Mark lead as paid in Supabase
    if (supabaseUrl && supabaseKey && leadId) {
      await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey:         supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer:        'return=minimal',
        },
        body: JSON.stringify({
          status:            'paid',
          stripe_session_id: session.id,
        }),
      });
    }

    // The $20/mo subscription and its 30-day trial are now created by the Stripe
    // Checkout session itself (subscription mode — see create-checkout.js). The
    // customer sees and agrees to it on Stripe's page. Re-creating it here would
    // double-bill them, so the webhook no longer touches subscriptions.

    // Auto-deploy site to Cloudflare Workers
    let deployedUrl = '';
    if (leadId) {
      try {
        const deployResult = await deploySite(leadId);
        deployedUrl = deployResult.url;
      } catch (deployErr) {
        console.error('Auto-deploy failed:', deployErr.message);
      }
    }

    // Email Brock
    if (resendKey) {
      const fromEmail = process.env.RESEND_FROM  || 'hello@bedrock-sites.com';
      const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';
      const siteBlock = deployedUrl
        ? `<p style="margin-top:20px;padding:12px;background:#f0f5ea;border-left:3px solid #3b6d11;font-size:14px">
             Site deployed: <a href="${deployedUrl}">${deployedUrl}</a>
           </p>`
        : `<p style="margin-top:20px;padding:12px;background:#fff3cd;border-left:3px solid #c9a84c;font-size:14px">
             Auto-deploy did not complete — check Netlify logs and redeploy manually via<br>
             POST /.netlify/functions/deploy-customer-site with {"leadId":"${leadId || ''}"}
           </p>`;

      const html = `
        <div style="font-family:sans-serif;max-width:540px">
          <h2 style="color:#111">New paid customer: ${businessName}</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:6px 12px 6px 0;color:#666;width:140px">Business</td><td>${businessName}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Customer email</td><td><a href="mailto:${customerEmail}">${customerEmail || '—'}</a></td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Lead ID</td><td>${leadId || '—'}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Stripe session</td><td>${session.id}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Amount</td><td>$${((session.amount_total || 0) / 100).toFixed(2)}</td></tr>
          </table>
          ${siteBlock}
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    fromEmail,
          to:      [toEmail],
          subject: deployedUrl ? `Live: ${businessName} — ${deployedUrl}` : `Paid (deploy failed): ${businessName}`,
          html,
        }),
      });
    }

    // Welcome email to customer
    if (resendKey && customerEmail && deployedUrl) {
      const fromEmail  = process.env.RESEND_FROM  || 'hello@bedrock-sites.com';
      const portalUrl  = process.env.SITE_URL ? `${process.env.SITE_URL}/portal.html` : 'https://bedrock-sites.com/portal.html';
      const customerHtml = `
        <div style="font-family:sans-serif;max-width:560px;color:#111">
          <h2 style="font-size:1.4rem;margin-bottom:0.5rem">Your site is live.</h2>
          <p style="color:#555;font-size:0.9rem;margin-bottom:1.5rem">Here's everything you need to know.</p>

          <div style="background:#f5f5f0;border-left:3px solid #c9a84c;padding:1rem 1.25rem;margin-bottom:1.5rem">
            <div style="font-size:0.7rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin-bottom:0.25rem">Your website</div>
            <a href="${deployedUrl}" style="font-size:1rem;font-weight:500;color:#111">${deployedUrl}</a>
            <div style="font-size:0.75rem;color:#888;margin-top:0.4rem">DNS may take up to 24 hours to fully propagate worldwide.</div>
          </div>

          <table style="border-collapse:collapse;width:100%;margin-bottom:1.5rem">
            <tr>
              <td style="padding:8px 12px 8px 0;color:#666;font-size:0.85rem;width:140px;vertical-align:top">Your first $20 charge</td>
              <td style="padding:8px 0;font-size:0.85rem">30 days from today — we give you a full month free to get settled in.</td>
            </tr>
            <tr>
              <td style="padding:8px 12px 8px 0;color:#666;font-size:0.85rem;vertical-align:top">Edit your site</td>
              <td style="padding:8px 0;font-size:0.85rem">Log in to your portal anytime to update your info, photos, or hours.</td>
            </tr>
            <tr>
              <td style="padding:8px 12px 8px 0;color:#666;font-size:0.85rem;vertical-align:top">Questions?</td>
              <td style="padding:8px 0;font-size:0.85rem">Reply to this email or reach us at <a href="mailto:hello@bedrock-sites.com" style="color:#111">hello@bedrock-sites.com</a>.</td>
            </tr>
          </table>

          <a href="${portalUrl}" style="display:inline-block;font-size:0.75rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#fff;background:#111;padding:0.85rem 1.75rem;text-decoration:none">Log in to your portal →</a>

          <p style="font-size:0.7rem;color:#aaa;margin-top:2rem">Bedrock Sites · <a href="https://bedrock-sites.com" style="color:#aaa">bedrock-sites.com</a></p>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    fromEmail,
          to:      [customerEmail],
          subject: `Your site is live — ${businessName}`,
          html:    customerHtml,
        }),
      });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
