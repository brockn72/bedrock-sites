// Creates a Stripe Checkout Session (subscription mode) for Bedrock's recurring
// tools — Website, Marketing, and Finance & Operations (and the Full Ecosystem
// bundle that combines all three).
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   STRIPE_SECRET_KEY            — already set (LIVE)
//   SITE_URL                     — already set (https://bedrock-sites.com)
//   STRIPE_WEBSITE_PRICE_ID      — Bedrock Website recurring price ($20/mo)        ← G4e: add this
//   STRIPE_MARKETING_PRICE_ID    — Bedrock Marketing recurring price ($30/mo)
//   STRIPE_FINOPS_PRICE_ID       — Finance & Operations recurring price ($70/mo)
//   STRIPE_BUNDLE_ALL_PRICE_ID   — Full Ecosystem bundle ($100/mo, optional)       ← single-line-item bundle
// Create those products in the Stripe dashboard (LIVE mode), copy each recurring
// price ID (price_...), and add them as Netlify env vars.
//
// Request body: { tools: ['website','marketing','cfo'], email, userId }
// Response:     { url: 'https://checkout.stripe.com/...' }
//
// G4e fix: previously the Full Ecosystem checkout only billed Marketing + FinOps
// because PRICE_ENV had no entry for "website". Now Website is included as its
// own recurring price; if STRIPE_BUNDLE_ALL_PRICE_ID is set and the request
// contains the full set, we use the single bundle price instead.

const PRICE_ENV = {
  website:            'STRIPE_WEBSITE_PRICE_ID',
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

  // G4e: If the request contains all three SKUs (Full Ecosystem) and a bundle price
  // is configured in Stripe, use that single line item ($100/mo) instead of summing
  // three individual prices. Stripe checkout shows one line; the webhook marks all
  // four user-facing tools active via the metadata.tools list below.
  const hasAllThree = ['website','marketing','cfo'].every(function(t){ return tools.indexOf(t) !== -1; })
                   || ['website','marketing','finance_operations'].every(function(t){ return tools.indexOf(t) !== -1; });
  const bundlePid = process.env.STRIPE_BUNDLE_ALL_PRICE_ID;

  // Resolve each requested tool to its configured Stripe price ID.
  const priceIds = [];
  const missing  = [];
  const billed   = [];
  if (hasAllThree && bundlePid) {
    priceIds.push(bundlePid);
    billed.push('website', 'marketing', 'finance_operations');
  } else {
    for (const t of tools) {
      const envName = PRICE_ENV[t];
      if (!envName) continue;                       // unknown SKU — skip
      const pid = process.env[envName];
      if (pid) { priceIds.push(pid); billed.push(t); }
      else     { missing.push(envName); }
    }
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
