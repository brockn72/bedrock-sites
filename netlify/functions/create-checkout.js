// BETA promo code: TEST200 (created in Stripe Dashboard → Coupons → 100% off setup fee only)
// This removes the $200 setup fee; the $20/mo subscription is unaffected.
// `allow_promotion_codes: true` is set below so the Stripe-hosted checkout shows
// the promo-code field — the codes themselves live in Stripe (single source of truth).

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const stripeKey     = process.env.STRIPE_SECRET_KEY;
  const setupPriceId  = process.env.STRIPE_SETUP_PRICE_ID; // $200 one-time setup fee (charged today)
  const monthlyPriceId = process.env.STRIPE_PRICE_ID;      // $20/mo recurring (starts after 30-day trial)
  const siteUrl       = process.env.SITE_URL || 'https://bedrock-sites.netlify.app';

  // Both prices are required: the customer must see and agree to the one-time
  // setup AND the recurring plan on Stripe's page (transparency — no silent sub).
  if (!stripeKey || !setupPriceId || !monthlyPriceId) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'Stripe not fully configured — set STRIPE_SECRET_KEY, STRIPE_SETUP_PRICE_ID ($200 one-time) and STRIPE_PRICE_ID ($20/mo) in Netlify env vars',
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { leadId, businessName, email } = body;

  // Subscription Checkout so the customer sees the whole deal on Stripe's page:
  //   • $200 one-time setup  → charged today
  //   • $20/mo hosting       → 30-day trial, first charge 30 days out
  // Stripe collects the one-time line item immediately even while the
  // recurring item is trialing — exactly the "pay setup now, nothing else
  // for 30 days, then $20/mo" flow.
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('payment_method_types[]', 'card');
  params.append('line_items[0][price]',    setupPriceId);
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[1][price]',    monthlyPriceId);
  params.append('line_items[1][quantity]', '1');
  params.append('subscription_data[trial_period_days]', '30');
  // Let customers enter Stripe-managed promo codes on the secure checkout page
  // (single source of truth — codes are created/expired in the Stripe dashboard).
  params.append('allow_promotion_codes', 'true');
  params.append('success_url', `${siteUrl}?payment=success`);
  params.append('cancel_url',  `${siteUrl}/#builder`);
  if (email)        params.append('customer_email',                       email);
  if (leadId)       params.append('metadata[lead_id]',                    leadId);
  if (leadId)       params.append('subscription_data[metadata][lead_id]', leadId);
  if (businessName) params.append('metadata[business_name]',              businessName);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    return { statusCode: 502, body: JSON.stringify({ error: `Stripe error: ${err}` }) };
  }

  const session = await res.json();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
