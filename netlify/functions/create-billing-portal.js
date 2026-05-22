// create-billing-portal.js
// Opens the Stripe-hosted Customer Portal so a contractor can update their
// payment method, change or cancel their plan, and view past invoices.
// Called from portal.html → My Account → My Subscriptions → "Manage Billing".
//
// Finds the contractor's Stripe customer id — first from the subscriptions
// table (saved by stripe-webhook.js), then by email lookup as a fallback —
// and returns a one-time billing-portal URL.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   STRIPE_SECRET_KEY, SITE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  const siteUrl     = process.env.SITE_URL || 'https://bedrock-sites.com';
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!stripeKey || !supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Billing isn’t configured yet.' }) };
  }

  // Identify the contractor from their Supabase session.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const user   = await userRes.json();
  const userId = user.id;
  const email  = (user.email || '').toLowerCase();

  // 1. Preferred — the Stripe customer id stripe-webhook.js stored on the
  //    contractor's subscription rows.
  let customerId = null;
  try {
    const sRes = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=stripe_customer_id&stripe_customer_id=not.is.null&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (sRes.ok) {
      const rows = await sRes.json();
      if (rows.length && rows[0].stripe_customer_id) customerId = rows[0].stripe_customer_id;
    }
  } catch (_) { /* non-fatal — fall through to the email lookup */ }

  // 2. Fallback — look the customer up in Stripe by email.
  if (!customerId && email) {
    try {
      const cRes = await fetch(
        'https://api.stripe.com/v1/customers?email=' + encodeURIComponent(email) + '&limit=1',
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      );
      if (cRes.ok) {
        const cj = await cRes.json();
        if (cj.data && cj.data.length) customerId = cj.data[0].id;
      }
    } catch (_) { /* non-fatal */ }
  }

  if (!customerId) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No billing account yet — you’ll have one once you start a paid subscription.' }),
    };
  }

  // Create the billing-portal session.
  const params = new URLSearchParams();
  params.append('customer',   customerId);
  params.append('return_url', `${siteUrl}/portal.html#subs`);

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[create-billing-portal]', res.status, err);
    // The most common live-mode failure: the Customer Portal hasn't been
    // activated in the Stripe dashboard yet (Settings → Billing → Customer portal).
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not open the billing portal. Try again in a moment.' }) };
  }

  const session = await res.json();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
