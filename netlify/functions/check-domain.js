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
