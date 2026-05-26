const { deploySite } = require('../lib/deploy-site');

// SEC6: 60-second cooldown between deploys for the same lead. Cloudflare
// Workers + domain registration aren't free of side effects, and a rapid
// retry loop can easily burn through API quota or rate-limit the registrar.
// One-time SQL migration:
//   alter table leads add column if not exists last_deployed_at timestamptz;
const DEPLOY_COOLDOWN_MS = 60 * 1000;

async function getLastDeployedAt(supabaseUrl, supabaseKey, leadId) {
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=last_deployed_at&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows.length ? rows[0].last_deployed_at : null;
  } catch (_) { return null; }
}

async function markDeployed(supabaseUrl, supabaseKey, leadId) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'return=minimal',
      },
      body: JSON.stringify({ last_deployed_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.warn('[deploy-customer-site] mark last_deployed_at failed:', e && e.message);
  }
}

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

  // SEC6: enforce per-lead cooldown. If the column doesn't exist yet (pre-migration)
  // getLastDeployedAt returns null and the cooldown is effectively skipped — safe.
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (supabaseUrl && supabaseKey) {
    const last = await getLastDeployedAt(supabaseUrl, supabaseKey, leadId);
    if (last) {
      const ageMs = Date.now() - new Date(last).getTime();
      if (ageMs < DEPLOY_COOLDOWN_MS) {
        const retryAfter = Math.ceil((DEPLOY_COOLDOWN_MS - ageMs) / 1000);
        return {
          statusCode: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
          body: JSON.stringify({ error: `Deploy in cooldown — try again in ${retryAfter}s.` }),
        };
      }
    }
  }

  try {
    const result = await deploySite(leadId);
    if (supabaseUrl && supabaseKey) {
      await markDeployed(supabaseUrl, supabaseKey, leadId);
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, url: result.url }) };
  } catch (err) {
    console.error('deploy-customer-site error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
