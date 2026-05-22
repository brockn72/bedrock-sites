// Creates a Stripe Checkout Session (subscription mode) for Bedrock's recurring
// tools — Marketing and Finance & Operations.
//
// The website build has its own flow with a one-time $200 setup fee
// (create-checkout.js); this function handles the purely-recurring tool
// subscriptions, so a contractor can buy Operations + Finance from the portal.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   STRIPE_SECRET_KEY          — already set (LIVE)
//   SITE_URL                   — already set (https://bedrock-sites.com)
//   STRIPE_MARKETING_PRICE_ID  — Bedrock Marketing recurring price (~$30/mo)
//   STRIPE_FINOPS_PRICE_ID     — Finance & Operations recurring price (~$70/mo)
// Create those two products in the Stripe dashboard (LIVE mode), copy each
// recurring price ID (price_...), and add them as Netlify env vars.
//
// Request body: { tools: ['marketing','finance_operations'], email, userId }
// Response:     { url: 'https://checkout.stripe.com/...' }

const PRICE_ENV = {
  marketing:          'STRIPE_MARKETING_PRICE_ID',
  finance_operations: 'STRIPE_FINOPS_PRICE_ID',
  // portal cart uses the legacy key "cfo" for the Finance & Operations bundle
  cfo:                'STRIPE_FINOPS_PRICE_ID',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl   = process.env.SITE_URL || 'https://bedrock-sites.com';
  if (!stripeKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Stripe not configured — set STRIPE_SECRET_KEY' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const tools  = Array.isArray(body.tools) ? body.tools : [];
  const email  = body.email || '';
  const userId = body.userId || '';
  if (!tools.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No tools selected' }) };
  }

  // Resolve each requested tool to its configured Stripe price ID.
  const priceIds = [];
  const missing  = [];
  const billed   = [];
  for (const t of tools) {
    const envName = PRICE_ENV[t];
    if (!envName) continue;                       // unknown / non-recurring (e.g. website) — skip
    const pid = process.env[envName];
    if (pid) { priceIds.push(pid); billed.push(t); }
    else     { missing.push(envName); }
  }
  if (missing.length) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'Missing Stripe price IDs: ' + missing.join(', ')
             + '. Create the products in the Stripe dashboard (LIVE mode) and set these Netlify env vars.',
      }),
    };
  }
  if (!priceIds.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No billable recurring tools in this request.' }) };
  }

  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('payment_method_types[]', 'card');
  priceIds.forEach((pid, i) => {
    params.append(`line_items[${i}][price]`,    pid);
    params.append(`line_items[${i}][quantity]`, '1');
  });
  // Promo codes are created/expired in the Stripe dashboard — single source of truth.
  params.append('allow_promotion_codes', 'true');
  params.append('success_url', `${siteUrl}/portal.html?sub=success`);
  params.append('cancel_url',  `${siteUrl}/portal.html#subs`);
  if (email) params.append('customer_email', email);
  // Metadata so stripe-webhook.js can mark the right tools active for the right
  // account once the subscription is confirmed.
  const toolList = billed.join(',');
  params.append('metadata[user_id]', userId);
  params.append('metadata[tools]',   toolList);
  params.append('subscription_data[metadata][user_id]', userId);
  params.append('subscription_data[metadata][tools]',   toolList);

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
