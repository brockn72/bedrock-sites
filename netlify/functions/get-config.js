exports.handler = async () => {
  const url  = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server config missing' }) };
  }
  // Public client-side bot-check key. Safe to expose; the secret is server-only.
  // If unset, the client-side widget simply doesn't render and submit handlers
  // send an empty turnstileToken (server's verifyTurnstile degrades open).
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || null;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ url, anon, turnstileSiteKey }),
  };
};
