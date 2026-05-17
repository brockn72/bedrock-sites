const { createHmac, timingSafeEqual } = require('crypto');

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

  if (stripeEvent.type === 'checkout.session.completed') {
    const session      = stripeEvent.data.object;
    const leadId       = session.metadata?.lead_id;
    const businessName = session.metadata?.business_name || 'Unknown Business';
    const customerEmail = session.customer_details?.email || session.customer_email || '';
    const stripeKey    = process.env.STRIPE_SECRET_KEY;
    const subPriceId   = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;

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

    // Auto-create $19/mo subscription using the payment method saved during checkout
    if (stripeKey && subPriceId && session.customer && session.payment_intent) {
      // Retrieve the payment intent to get the saved payment method
      const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${session.payment_intent}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (piRes.ok) {
        const pi = await piRes.json();
        const pmId = pi.payment_method;
        if (pmId) {
          // Set it as the customer's default so the subscription invoices it automatically
          await fetch(`https://api.stripe.com/v1/customers/${session.customer}`, {
            method: 'POST',
            headers: {
              Authorization:  `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              'invoice_settings[default_payment_method]': pmId,
            }).toString(),
          });
          // Create the recurring subscription
          await fetch('https://api.stripe.com/v1/subscriptions', {
            method: 'POST',
            headers: {
              Authorization:  `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              customer:         session.customer,
              'items[0][price]': subPriceId,
            }).toString(),
          });
        }
      }
    }

    // Email Brock to deploy the site
    if (resendKey) {
      const fromEmail = process.env.RESEND_FROM  || 'onboarding@resend.dev';
      const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';

      const html = `
        <div style="font-family:sans-serif;max-width:540px">
          <h2 style="color:#111">Paid order ready to deploy: ${businessName}</h2>
          <p>Payment confirmed via Stripe. Pull up this lead in Supabase and deploy their site.</p>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:6px 12px 6px 0;color:#666;width:140px">Business</td><td>${businessName}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Customer email</td><td><a href="mailto:${customerEmail}">${customerEmail || '—'}</a></td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Lead ID</td><td>${leadId || '—'}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Stripe session</td><td>${session.id}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Amount</td><td>$${((session.amount_total || 0) / 100).toFixed(2)}</td></tr>
          </table>
          <p style="margin-top:20px;padding:12px;background:#f0f5ea;border-left:3px solid #3b6d11;font-size:14px">
            Next step: deploy their site to Cloudflare Pages, then update the lead record with the live URL.
          </p>
          <p style="color:#888;font-size:12px">Auto-deploy will be added here once Cloudflare Pages is configured.</p>
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
          subject: `Paid — deploy now: ${businessName}`,
          html,
        }),
      });
    }

    // Auto-deploy to Cloudflare Pages goes here once CF is configured
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
