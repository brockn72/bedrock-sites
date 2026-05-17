exports.handler = async () => {
  const url  = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server config missing' }) };
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ url, anon }),
  };
};
