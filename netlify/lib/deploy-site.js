const { generateCustomerSite }        = require('./generate-html');
const { registerAndDeployDomain } = require('./register-domain');

const CF_BASE = 'https://api.cloudflare.com/client/v4';
const CRLF = '\r\n';
const BOUNDARY = 'BedrockWorkerUpload';

function cfHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function buildWorkerMultipart(scriptContent) {
  const metadata = JSON.stringify({ main_module: 'index.js', compatibility_date: '2024-01-01' });
  return [
    `--${BOUNDARY}${CRLF}`,
    `Content-Disposition: form-data; name="metadata"${CRLF}`,
    `Content-Type: application/json${CRLF}`,
    CRLF,
    metadata,
    CRLF,
    `--${BOUNDARY}${CRLF}`,
    `Content-Disposition: form-data; name="index.js"; filename="index.js"${CRLF}`,
    `Content-Type: application/javascript+module${CRLF}`,
    CRLF,
    scriptContent,
    CRLF,
    `--${BOUNDARY}--${CRLF}`,
  ].join('');
}

function slugify(name) {
  return (name || 'business')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

async function deploySite(leadId) {
  const cfToken     = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!cfToken || !cfAccountId) throw new Error('Cloudflare not configured');
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase not configured');

  // --- Fetch lead ---
  const leadRes = await fetch(
    `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=*`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!leadRes.ok) throw new Error(`Supabase fetch failed: ${leadRes.status}`);
  const leads = await leadRes.json();
  const lead  = leads[0];
  if (!lead) throw new Error('Lead not found');

  // --- Generate HTML ---
  const html = generateCustomerSite(lead);

  const slug       = slugify(lead.business_name);
  const scriptName = `bedrock-${slug}`;
  const subdomain  = `${slug}.bedrock-sites.com`;
  const siteUrl    = `https://${subdomain}`;

  // Worker script: serves the full HTML page
  const workerScript = `const H=${JSON.stringify(html)};export default{async fetch(r){return new Response(H,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=3600'}});}}`;

  // --- Upload Worker ---
  const workerRes = await fetch(
    `${CF_BASE}/accounts/${cfAccountId}/workers/scripts/${scriptName}`,
    {
      method: 'PUT',
      headers: {
        ...cfHeaders(cfToken),
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      body: buildWorkerMultipart(workerScript),
    }
  );
  if (!workerRes.ok) {
    const detail = await workerRes.text();
    throw new Error(`Worker upload failed (${workerRes.status}): ${detail.slice(0, 300)}`);
  }

  // --- Look up Zone ID for bedrock-sites.com ---
  const zoneRes  = await fetch(`${CF_BASE}/zones?name=bedrock-sites.com`, { headers: cfHeaders(cfToken) });
  const zoneData = await zoneRes.json();
  const zoneId   = zoneData.result?.[0]?.id;

  if (zoneId) {
    // DNS record — AAAA 100:: proxied routes the subdomain through Cloudflare to the Worker.
    // Ignore failure: record may already exist on re-deploy.
    await fetch(`${CF_BASE}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      headers: { ...cfHeaders(cfToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'AAAA', name: slug, content: '100::', proxied: true }),
    }).catch(() => {});

    // Worker route — binds the subdomain pattern to this Worker script.
    // On re-deploy the route already exists and points to the same script name,
    // so a duplicate error is harmless — the updated Worker is already live.
    await fetch(`${CF_BASE}/zones/${zoneId}/workers/routes`, {
      method: 'POST',
      headers: { ...cfHeaders(cfToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: `${subdomain}/*`, script: scriptName }),
    }).catch(() => {});
  }

  // --- Register custom domain if one was selected ---
  let customDomainUrl = '';
  const selectedDomain = lead.site_data?._selectedDomain;
  if (selectedDomain && process.env.NAMECOM_USERNAME && process.env.NAMECOM_TOKEN) {
    try {
      const domainResult = await registerAndDeployDomain(selectedDomain, scriptName);
      customDomainUrl = domainResult.customDomain;
    } catch (domainErr) {
      // Domain failure doesn't block the site — it's live on subdomain
      console.error('[deploy-site] Domain registration failed:', domainErr.message);
    }
  }

  const liveUrl = customDomainUrl || siteUrl;

  // --- Mark lead as deployed in Supabase ---
  await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey:         supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer:        'return=minimal',
    },
    body: JSON.stringify({
      status:        'deployed',
      site_url:      liveUrl,
      subdomain_url: siteUrl,
    }),
  });

  return { url: liveUrl, subdomainUrl: siteUrl };
}

module.exports = { deploySite };
