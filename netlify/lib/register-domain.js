const CF_BASE     = 'https://api.cloudflare.com/client/v4';
const NAMECOM_BASE = 'https://api.name.com/v4';

function cfHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function namecomAuth() {
  const b = Buffer.from(`${process.env.NAMECOM_USERNAME}:${process.env.NAMECOM_TOKEN}`);
  return 'Basic ' + b.toString('base64');
}

async function checkAvailability(domain) {
  const res = await fetch(`${NAMECOM_BASE}/domains:checkAvailability`, {
    method: 'POST',
    headers: { Authorization: namecomAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ domainNames: [domain] }),
  });
  if (!res.ok) throw new Error(`Name.com availability check failed: ${res.status}`);
  const data = await res.json();
  const result = data.results?.[0];
  return {
    available: result?.purchasable === true,
    price: result?.purchasePrice || null,
  };
}

async function createCloudflareZone(domain) {
  const cfToken     = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  const res = await fetch(`${CF_BASE}/zones`, {
    method: 'POST',
    headers: cfHeaders(cfToken),
    body: JSON.stringify({
      name:    domain,
      account: { id: cfAccountId },
      jump_start: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cloudflare zone creation failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    zoneId:      data.result.id,
    nameservers: data.result.name_servers,
  };
}

async function wireWorkerToZone(zoneId, domain, scriptName) {
  const cfToken  = process.env.CLOUDFLARE_API_TOKEN;
  const headers  = cfHeaders(cfToken);
  const dnsBase  = `${CF_BASE}/zones/${zoneId}/dns_records`;
  const routeBase = `${CF_BASE}/zones/${zoneId}/workers/routes`;

  // AAAA 100:: proxied → traffic goes through Cloudflare to the Worker
  await fetch(dnsBase, { method:'POST', headers, body: JSON.stringify({ type:'AAAA', name:'@',   content:'100::', proxied:true }) }).catch(()=>{});
  await fetch(dnsBase, { method:'POST', headers, body: JSON.stringify({ type:'AAAA', name:'www', content:'100::', proxied:true }) }).catch(()=>{});

  // Worker routes for root and www
  await fetch(routeBase, { method:'POST', headers, body: JSON.stringify({ pattern:`${domain}/*`,     script:scriptName }) }).catch(()=>{});
  await fetch(routeBase, { method:'POST', headers, body: JSON.stringify({ pattern:`www.${domain}/*`, script:scriptName }) }).catch(()=>{});
}

async function registerAtNamecom(domain, nameservers) {
  const reg = {
    firstName:   process.env.NAMECOM_REG_FIRST   || 'Bedrock',
    lastName:    process.env.NAMECOM_REG_LAST    || 'Sites',
    companyName: process.env.NAMECOM_REG_COMPANY || 'Bedrock Sites LLC',
    address1:    process.env.NAMECOM_REG_ADDRESS || '',
    city:        process.env.NAMECOM_REG_CITY    || 'Rexburg',
    state:       process.env.NAMECOM_REG_STATE   || 'ID',
    zip:         process.env.NAMECOM_REG_ZIP     || '83440',
    country:     'US',
    phone:       process.env.NAMECOM_REG_PHONE   || '+1.2085550100',
    email:       process.env.NAMECOM_REG_EMAIL   || 'hello@bedrock-sites.com',
  };

  const res = await fetch(`${NAMECOM_BASE}/domains`, {
    method: 'POST',
    headers: { Authorization: namecomAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain:      { domainName: domain },
      registrant:  reg,
      admin:       reg,
      tech:        reg,
      billing:     reg,
      nameservers,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Name.com registration failed (${res.status}): ${err.slice(0, 300)}`);
  }

  return await res.json();
}

// Full flow: CF zone → Name.com registration with CF nameservers → wire Worker
async function registerAndDeployDomain(domain, scriptName) {
  const { zoneId, nameservers } = await createCloudflareZone(domain);
  await registerAtNamecom(domain, nameservers);
  await wireWorkerToZone(zoneId, domain, scriptName);
  return { customDomain: `https://${domain}`, zoneId };
}

module.exports = { checkAvailability, registerAndDeployDomain };
