const { checkAvailability } = require('../lib/register-domain');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let domain;
  try {
    ({ domain } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!domain || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.com$/.test(domain)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid domain name' }) };
  }

  // If Name.com credentials aren't set yet, optimistically return available
  if (!process.env.NAMECOM_USERNAME || !process.env.NAMECOM_TOKEN) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available: true, price: 12.99 }),
    };
  }

  try {
    const result = await checkAvailability(domain);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('[check-domain]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Domain check failed' }) };
  }
};
