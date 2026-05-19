// Bedrock Optimizer — site audit engine.
// Fetches a URL, runs Google PageSpeed + HTML checks, returns a 0–100 score,
// category breakdown, per-check plain-English results, and scraped data for
// the builder handoff. Zero npm deps (Node 18 global fetch on Netlify).
// Scoring rubric: bedrock-vault/06-SEO-AUDIT-TOOL.md. Standards: seo_guide.md, geo_guide.md.

const TRADES = [
  'plumb', 'electric', 'hvac', 'heating', 'cooling', 'roof', 'landscap',
  'paint', 'concrete', 'remodel', 'contractor', 'construction', 'flooring',
  'fence', 'deck', 'masonry', 'drywall', 'handyman', 'excavat', 'septic',
  'garage door', 'gutter', 'pest', 'tree', 'lawn', 'cleaning', 'pool',
  'window', 'siding', 'insulation', 'pressure wash', 'snow removal',
];

const LOCALBUSINESS_TYPES = [
  'localbusiness', 'plumber', 'electrician', 'hvacbusiness', 'roofingcontractor',
  'generalcontractor', 'housepainter', 'homeandconstructionbusiness',
  'professionalservice', 'contractor', 'movingcompany', 'locksmith',
];

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes('.')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function stripTags(html) {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(re, str) {
  const m = re.exec(str || '');
  return m ? m[1].trim() : '';
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed['@graph']) blocks.push(...[].concat(parsed['@graph']));
      else blocks.push(parsed);
    } catch {
      /* malformed JSON-LD — ignore, it just won't count toward schema checks */
    }
  }
  return blocks;
}

function typeMatches(node, wanted) {
  if (!node || !node['@type']) return false;
  const types = [].concat(node['@type']).map((t) => String(t).toLowerCase());
  return types.some((t) => wanted.includes(t));
}

async function getPageSpeed(url) {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  let api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance`;
  if (key) api += `&key=${key}`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`PageSpeed ${res.status}`);
  const data = await res.json();
  const lh = data.lighthouseResult;
  const perfScore = Math.round((lh?.categories?.performance?.score ?? 0) * 100);
  const fcpMs = lh?.audits?.['first-contentful-paint']?.numericValue ?? null;
  return { perfScore, fcpSeconds: fcpMs != null ? fcpMs / 1000 : null };
}

function buildChecks({ html, text, url, ps, jsonld }) {
  const titleTag = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const h1 = stripTags(firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html));
  const metaDesc = firstMatch(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    html
  ) || firstMatch(
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    html
  );

  const localBiz = jsonld.find((n) => typeMatches(n, LOCALBUSINESS_TYPES));
  const faqSchema = jsonld.find((n) => typeMatches(n, ['faqpage']));

  const phoneRe = /(?:tel:\s*)?(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const hasTelLink = /href=["']tel:/i.test(html);
  const hasPhone = hasTelLink || phoneRe.test(text);

  const addrSchema =
    localBiz &&
    (localBiz.address?.streetAddress ||
      (typeof localBiz.address === 'string' && localBiz.address));
  const addrText =
    /\d{1,6}\s+([A-Za-z0-9.'-]+\s){1,4}(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|hwy|highway|pkwy|suite|ste)\b/i.test(
      text
    );
  const zipText = /\b[A-Z]{2}\s?\d{5}(-\d{4})?\b/.test(text);
  const hasAddress = !!addrSchema || addrText || zipText;

  const cityStateRe = /\b([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+)*),\s*([A-Z]{2})\b/;
  const cityInTitleOrH1 =
    cityStateRe.test(titleTag) ||
    cityStateRe.test(h1) ||
    (localBiz?.address?.addressLocality &&
      (titleTag + ' ' + h1)
        .toLowerCase()
        .includes(String(localBiz.address.addressLocality).toLowerCase()));

  const isHttps = url.protocol === 'https:';

  const faqTextSignals =
    /frequently asked|\bf\.?a\.?q\b/i.test(text) &&
    (text.match(/\?/g) || []).length >= 3;
  const hasFaq = !!faqSchema || faqTextSignals;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const mentionsTrade = TRADES.some((t) => text.toLowerCase().includes(t));
  const serviceDetail = wordCount >= 350 && mentionsTrade;

  const schemaName = (localBiz?.name || '').toLowerCase();
  const cleanTitle = titleTag
    .toLowerCase()
    .split(/[|\-–—:·]/)[0]
    .trim();
  const nameConsistent =
    !!schemaName &&
    !!cleanTitle &&
    (schemaName.includes(cleanTitle) ||
      cleanTitle.includes(schemaName) ||
      (h1 && h1.toLowerCase().includes(schemaName)));

  const psKnown = ps && ps.ok;
  const fastEnough = psKnown && ps.fcpSeconds != null ? ps.fcpSeconds < 3 : null;
  const speedOk = psKnown ? ps.perfScore >= 70 : null;

  // status: pass | fail | unknown. unknown = couldn't measure (PageSpeed down).
  const checks = [
    {
      cat: 'Performance',
      key: 'mobile_speed',
      label: 'Loads fast on a phone',
      points: 15,
      status: speedOk == null ? 'unknown' : speedOk ? 'pass' : 'fail',
      detail:
        speedOk == null
          ? "We couldn't measure your speed automatically this time."
          : speedOk
          ? `Google scores your mobile speed at ${ps.perfScore}/100 — that's solid.`
          : `Google scores your mobile speed at ${ps.perfScore}/100. Slow sites lose customers before the page even loads.`,
    },
    {
      cat: 'Performance',
      key: 'load_under_3s',
      label: 'First content shows in under 3 seconds',
      points: 10,
      status: fastEnough == null ? 'unknown' : fastEnough ? 'pass' : 'fail',
      detail:
        fastEnough == null
          ? "Couldn't measure load time automatically this time."
          : fastEnough
          ? `Your page starts showing in ${ps.fcpSeconds.toFixed(1)}s.`
          : `Your page takes ${ps.fcpSeconds ? ps.fcpSeconds.toFixed(1) + 's' : 'over 3s'} to start showing. Most people leave by then.`,
    },
    {
      cat: 'Local SEO',
      key: 'phone_visible',
      label: 'Phone number is on the page',
      points: 10,
      status: hasPhone ? 'pass' : 'fail',
      detail: hasPhone
        ? 'A phone number is visible on your site.'
        : "We couldn't find a phone number. If a customer can't call you in one tap, you lose the job.",
    },
    {
      cat: 'Local SEO',
      key: 'address_present',
      label: 'Physical address or service area shown',
      points: 8,
      status: hasAddress ? 'pass' : 'fail',
      detail: hasAddress
        ? 'An address or service area is present.'
        : 'No address found. Google needs to know where you are to show you in local results.',
    },
    {
      cat: 'Local SEO',
      key: 'city_in_title',
      label: 'Your city is in the page title or headline',
      points: 7,
      status: cityInTitleOrH1 ? 'pass' : 'fail',
      detail: cityInTitleOrH1
        ? 'Your service area appears in the title or main headline.'
        : 'Your city isn\'t in your title or headline. That\'s the #1 thing Google uses to match "plumber near me" searches.',
    },
    {
      cat: 'Local SEO',
      key: 'https',
      label: 'Secure (HTTPS) connection',
      points: 5,
      status: isHttps ? 'pass' : 'fail',
      detail: isHttps
        ? 'Your site loads securely over HTTPS.'
        : 'Your site is not secure (no HTTPS). Browsers warn visitors, and Google ranks you lower.',
    },
    {
      cat: 'Schema',
      key: 'localbusiness_schema',
      label: 'LocalBusiness schema markup',
      points: 10,
      status: localBiz ? 'pass' : 'fail',
      detail: localBiz
        ? 'Your site has LocalBusiness structured data.'
        : 'No LocalBusiness markup — the invisible code that tells Google and AI exactly what your business does and where.',
    },
    {
      cat: 'Schema',
      key: 'meta_description',
      label: 'Search-result description (meta description)',
      points: 8,
      status: metaDesc && metaDesc.length > 10 ? 'pass' : 'fail',
      detail:
        metaDesc && metaDesc.length > 10
          ? 'You have a meta description for search results.'
          : 'No description tag. Google is guessing what to show under your name in search results.',
    },
    {
      cat: 'Schema',
      key: 'faq_present',
      label: 'FAQ section or FAQ schema',
      points: 7,
      status: hasFaq ? 'pass' : 'fail',
      detail: hasFaq
        ? 'You have FAQ content or FAQ schema.'
        : 'No FAQ content. FAQs are the single highest-impact thing for showing up in AI answers.',
    },
    {
      cat: 'GEO',
      key: 'faq_for_ai',
      label: 'Question-and-answer content for AI search',
      points: 8,
      status: hasFaq ? 'pass' : 'fail',
      detail: hasFaq
        ? 'Your Q&A content can be quoted by ChatGPT, Siri, and Google AI.'
        : "When someone asks ChatGPT for a contractor in your area, there's nothing here for it to quote.",
    },
    {
      cat: 'GEO',
      key: 'service_detail',
      label: 'Detailed service descriptions',
      points: 7,
      status: serviceDetail ? 'pass' : 'fail',
      detail: serviceDetail
        ? 'Your services are described in enough detail for AI to understand them.'
        : 'Your service descriptions are thin. "We do plumbing" tells Google and AI almost nothing.',
    },
    {
      cat: 'GEO',
      key: 'name_consistent',
      label: 'Business name consistent across the page',
      points: 5,
      status: nameConsistent ? 'pass' : 'fail',
      detail: nameConsistent
        ? 'Your business name is consistent across title, headline, and schema.'
        : "Your business name doesn't match across your title, headline, and code. AI treats inconsistent names as different businesses.",
    },
  ];

  return { checks, scraped: scrape({ html, text, titleTag, h1, localBiz, url }) };
}

function scrape({ html, text, titleTag, h1, localBiz, url }) {
  const ogName = firstMatch(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    html
  );
  const ogImg = firstMatch(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    html
  );
  const cleanTitle = (titleTag || '').split(/[|\-–—:·]/)[0].trim();
  const businessName = localBiz?.name || ogName || cleanTitle || h1 || '';

  let phone = '';
  const tel = firstMatch(/href=["']tel:([^"']+)["']/i, html);
  const phoneRe = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  phone = (tel || firstMatch(phoneRe, text) || '').trim();

  let city = '';
  if (localBiz?.address?.addressLocality) {
    city =
      localBiz.address.addressLocality +
      (localBiz.address.addressRegion ? `, ${localBiz.address.addressRegion}` : '');
  } else {
    const m = /\b([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+)*),\s*([A-Z]{2})\b/.exec(
      `${titleTag} ${h1} ${text}`
    );
    if (m) city = `${m[1]}, ${m[2]}`;
  }

  const hay = `${titleTag} ${h1} ${(localBiz?.['@type'] || '')}`.toLowerCase();
  let trade = '';
  for (const t of TRADES) {
    if (hay.includes(t)) {
      trade = t.replace(/^./, (c) => c.toUpperCase());
      break;
    }
  }

  let logo = firstMatch(
    /<img[^>]+(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/i,
    html
  );
  logo = firstMatch(/src=["']([^"']+)["']/i, logo || '');

  const abs = (src) => {
    if (!src) return '';
    try {
      return new URL(src, url.origin).href;
    } catch {
      return '';
    }
  };

  return {
    businessName: businessName.slice(0, 120),
    phone,
    city,
    trade,
    heroImage: abs(ogImg),
    logo: abs(logo),
    sourceUrl: url.href,
  };
}

function scoreLabel(score) {
  if (score >= 80) return 'Solid foundation — a few things to improve';
  if (score >= 60) return 'Falling behind — missing key signals Google and AI use';
  if (score >= 40) return "Significant issues — you're likely invisible in local search";
  return "Critical problems — this site is costing you customers";
}

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

  const url = normalizeUrl(body.url);
  if (!url) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        reason: 'bad_url',
        message: "That doesn't look like a website address. Try something like yourbusiness.com",
      }),
    };
  }

  // Fetch the HTML. Never hard-fail — a site we can't read still gets a
  // forward path (the spec's no-dead-ends rule).
  let html = '';
  let fetchOk = false;
  try {
    const res = await withTimeout(
      fetch(url.href, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; BedrockOptimizer/1.0; +https://bedrock-sites.com)',
        },
      }),
      9000,
      'Site fetch'
    );
    fetchOk = res.ok;
    html = await res.text();
  } catch {
    fetchOk = false;
  }

  if (!html) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        reason: 'unreadable',
        message:
          "We couldn't read your site automatically — a lot of older or builder-made sites block scans. That itself is usually a sign it's costing you visibility. You can still build a faster one in under 15 minutes.",
        scraped: { sourceUrl: url.href },
      }),
    };
  }

  // PageSpeed runs in parallel but is allowed to fail without blocking the audit.
  let ps = { ok: false };
  try {
    const r = await withTimeout(getPageSpeed(url.href), 9500, 'PageSpeed');
    ps = { ok: true, ...r };
  } catch {
    ps = { ok: false };
  }

  const text = stripTags(html).slice(0, 200000);
  const jsonld = extractJsonLd(html);
  const { checks, scraped } = buildChecks({ html, text, url, ps, jsonld });

  // Unknown (unmeasured) checks get neutral half-credit so the 0–100 scale
  // stays stable and honest — we neither punish nor reward what we couldn't see.
  let earned = 0;
  let possible = 0;
  for (const c of checks) {
    possible += c.points;
    if (c.status === 'pass') earned += c.points;
    else if (c.status === 'unknown') earned += c.points / 2;
  }
  const score = Math.round((earned / possible) * 100);

  const cats = {};
  for (const c of checks) {
    if (!cats[c.cat]) cats[c.cat] = { earned: 0, possible: 0 };
    cats[c.cat].possible += c.points;
    if (c.status === 'pass') cats[c.cat].earned += c.points;
    else if (c.status === 'unknown') cats[c.cat].earned += c.points / 2;
  }
  const categories = Object.entries(cats).map(([name, v]) => ({
    name,
    pct: Math.round((v.earned / v.possible) * 100),
  }));

  const topIssues = checks
    .filter((c) => c.status === 'fail')
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((c) => ({ label: c.label, detail: c.detail }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      url: url.href,
      score,
      label: scoreLabel(score),
      categories,
      checks,
      topIssues,
      scraped,
      pageSpeedMeasured: ps.ok,
      fetchOk,
    }),
  };
};
