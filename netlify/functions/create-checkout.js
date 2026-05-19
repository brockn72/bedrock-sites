exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const stripeKey  = process.env.STRIPE_SECRET_KEY;
  const priceId    = process.env.STRIPE_SETUP_PRICE_ID;  // $200 one-time setup fee
  const siteUrl    = process.env.SITE_URL || 'https://bedrock-sites.netlify.app';

  if (!stripeKey || !priceId) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Stripe not configured — set STRIPE_SETUP_PRICE_ID in Netlify env vars' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { leadId, businessName, email } = body;

  // Build the Stripe Checkout session via the REST API (no SDK needed)
  const params = new URLSearchParams();
  params.append('payment_method_types[]', 'card');
  params.append('line_items[0][price]',    priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('mode',                    'payment');
  params.append('success_url',             `${siteUrl}?payment=success`);
  params.append('cancel_url',             `${siteUrl}/#builder`);
  // Save payment method so the webhook can create the $20/mo subscription automatically
  params.append('payment_intent_data[setup_future_usage]', 'off_session');
  if (email)        params.append('customer_email',          email);
  if (leadId)       params.append('metadata[lead_id]',       leadId);
  if (businessName) params.append('metadata[business_name]', businessName);

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
