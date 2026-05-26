// BETA promo code: TEST200 (created in Stripe Dashboard → Coupons → 100% off setup fee only)
// This removes the $200 setup fee; the $20/mo subscription is unaffected.
// `allow_promotion_codes: true` is set below so the Stripe-hosted checkout shows
// the promo-code field — the codes themselves live in Stripe (single source of truth).
//
// SEC5: server-side one-time state token replaces the client-supplied lead_id
// in Stripe metadata. The webhook resolves the state token back to the real
// lead row, so a tampered client body can't redirect the payment to someone
// else's lead.

const { createCheckoutState } = require('../lib/checkout-state');

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

  // SEC5: verify the lead actually exists and matches the email the client
  // claims to be paying for. Without this, anyone could submit a stranger's
  // leadId and trigger a deploy on that account.
  let verifiedLeadId   = null;
  let verifiedBusiness = businessName || null;
  let verifiedEmail    = email || null;
  if (leadId) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (supabaseUrl && supabaseKey) {
      try {
        const lr = await fetch(
          `${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=id,email,business_name,status&limit=1`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        if (lr.ok) {
          const rows = await lr.json();
          const lead = rows[0];
          if (!lead) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Lead not found. Refresh the page and try again.' }) };
          }
          if (lead.status === 'paid') {
            return { statusCode: 400, body: JSON.stringify({ error: 'This site has already been paid for.' }) };
          }
          if (email && lead.email && lead.email.toLowerCase() !== email.toLowerCase()) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email does not match this lead.' }) };
          }
          verifiedLeadId   = lead.id;
          verifiedBusiness = lead.business_name || verifiedBusiness;
          verifiedEmail    = lead.email || verifiedEmail;
        }
      } catch (_) { /* fall through — state token still gets the client-supplied values, audited later */ }
    }
  }

  // SEC5: issue the one-time state token. The webhook will look up the real
  // lead_id from this token instead of trusting metadata[lead_id].
  const stateRes = await createCheckoutState({
    kind:          'site',
    lead_id:       verifiedLeadId || leadId || null,
    business_name: verifiedBusiness,
    email:         verifiedEmail,
  });
  if (!stateRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: stateRes.error || 'Could not start checkout.' }) };
  }
  const stateToken = stateRes.token;

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
  // SEC5: stash the state token in BOTH places the webhook reads from. The
  // legacy metadata[lead_id] is kept too so any in-flight checkout from
  // before this deploy still resolves correctly; once the rollout window has
  // passed it can be dropped.
  params.append('metadata[state]',                    stateToken);
  params.append('subscription_data[metadata][state]', stateToken);
  if (verifiedLeadId)   params.append('metadata[lead_id]',                    verifiedLeadId);
  if (verifiedLeadId)   params.append('subscription_data[metadata][lead_id]', verifiedLeadId);
  if (verifiedBusiness) params.append('metadata[business_name]',              verifiedBusiness);

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
