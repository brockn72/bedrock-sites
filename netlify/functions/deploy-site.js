const { createHash } = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { siteHTML, businessName } = body;
  if (!siteHTML || !businessName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing siteHTML or businessName' }) };
  }

  const token = process.env.NETLIFY_API_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not configured' }) };
  }

  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  const siteName = `jpb-${slug}-${Date.now()}`;

  const jsonHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // 1. Create the Netlify site
  const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name: siteName }),
  });
  if (!siteRes.ok) {
    const err = await siteRes.text();
    return { statusCode: 502, body: JSON.stringify({ error: `Could not create site: ${err}` }) };
  }
  const site = await siteRes.json();

  // 2. Create a deploy using the file-digest API
  const htmlBuf = Buffer.from(siteHTML, 'utf8');
  const sha1 = createHash('sha1').update(htmlBuf).digest('hex');

  const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ files: { '/index.html': sha1 } }),
  });
  if (!deployRes.ok) {
    const err = await deployRes.text();
    return { statusCode: 502, body: JSON.stringify({ error: `Could not create deploy: ${err}` }) };
  }
  const deploy = await deployRes.json();

  // 3. Upload the HTML file (only needed if Netlify hasn't seen this exact content before)
  if (deploy.required && deploy.required.includes(sha1)) {
    const uploadRes = await fetch(
      `https://api.netlify.com/api/v1/deploys/${deploy.id}/files/index.html`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/html; charset=utf-8',
        },
        body: htmlBuf,
      }
    );
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: `Could not upload site: ${err}` }) };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `https://${siteName}.netlify.app`,
      siteId: site.id,
      deployId: deploy.id,
    }),
  };
};
