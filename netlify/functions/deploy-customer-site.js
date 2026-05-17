const { deploySite } = require('../lib/deploy-site');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Require a secret header so this endpoint can't be triggered by anyone who finds the URL
  const deploySecret = process.env.DEPLOY_SECRET;
  const providedSecret = event.headers['x-deploy-secret'] || event.headers['X-Deploy-Secret'];
  if (!deploySecret || providedSecret !== deploySecret) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let leadId;
  try {
    ({ leadId } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!leadId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'leadId required' }) };
  }

  try {
    const result = await deploySite(leadId);
    return { statusCode: 200, body: JSON.stringify({ success: true, url: result.url }) };
  } catch (err) {
    console.error('deploy-customer-site error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
