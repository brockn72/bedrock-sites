// Bedrock Optimizer — site audit engine.
// Fetches a URL, runs Google PageSpeed + HTML checks, returns a 0–100 score,
// category breakdown, per-check tier (good/warn/bad) + plain-English education,
// and scraped data for the builder handoff. Zero npm deps (Node 18 fetch).
// Rubric: bedrock-vault/06-SEO-AUDIT-TOOL.md. Standards: seo_guide.md, geo_guide.md.
// Scoring is deterministic — same site always yields the same score.

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

// warn (yellow) earns half the points, rounded. bad earns nothing.
function award(points, tier) {
  if (tier === 'good') return points;
  if (tier === 'warn') return Math.round(points * 0.5);
  return 0;
}

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
  const metaDesc =
    firstMatch(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ||
    firstMatch(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, html);

  const localBiz = jsonld.find((n) => typeMatches(n, LOCALBUSINESS_TYPES));
  const anySchema  = jsonld.length > 0;
  const faqSchema = jsonld.find((n) => typeMatches(n, ['faqpage']));

  const hasTelLink = /href=["']tel:/i.test(html);
  const phoneInText = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text);

  const addrSchema =
    localBiz &&
    (localBiz.address?.streetAddress ||
      (typeof localBiz.address === 'string' && localBiz.address));
  const addrText = /\d{1,6}\s+([A-Za-z0-9.'-]+\s){1,4}(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|hwy|highway|pkwy|suite|ste)\b/i.test(text);
  const zipText = /\b[A-Z]{2}\s?\d{5}(-\d{4})?\b/.test(text);

  const cityStateRe = /\b([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+)*),\s*([A-Z]{2})\b/;
  const cityInTitle = cityStateRe.test(titleTag);
  const cityInH1 =
    cityStateRe.test(h1) ||
    (localBiz?.address?.addressLocality &&
      (titleTag + ' ' + h1)
        .toLowerCase()
        .includes(String(localBiz.address.addressLocality).toLowerCase()));

  const isHttps = url.protocol === 'https:';

  const faqTextSignals =
    /frequently asked|\bf\.?a\.?q\b/i.test(text) &&
    (text.match(/\?/g) || []).length >= 3;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const mentionsTrade = TRADES.some((t) => text.toLowerCase().includes(t));

  // WEB4 2026-05-25: detect whether this site is actually a local-business
  // site. We were scoring the whole world against a contractor rubric, which
  // is why polished generic sites (apple.com, microsoft.com) landed in the 40s
  // — they fail "city in title" + "LocalBusiness schema" through no fault of
  // their own. Sites that fail this detection are scored on UNIVERSAL checks
  // only (speed, https, meta, title, OG); contractor checks are marked 'n/a'
  // and contribute zero to denominator.
  const localSignals = [
    !!localBiz,
    hasTelLink,
    addrText,
    mentionsTrade,
    cityInTitle || cityInH1,
  ].filter(Boolean).length;
  const isLocalBusinessSite = localSignals >= 2;

  // WEB4: universal best-practice signals (apply to every site type).
  const hasTitle = !!(titleTag && titleTag.length >= 10);
  const hasOgTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  const hasOgDesc  = /<meta[^>]+property=["']og:description["']/i.test(html);
  const hasOgImage = /<meta[^>]+property=["']og:image["']/i.test(html);
  const hasOg = hasOgTitle && hasOgDesc;

  // WEB8: GEO / AI-answer-engine readiness signals (clear pricing + detailed
  // service area). These help contractor sites rank in Perplexity / ChatGPT /
  // Google AI Overviews — the things people actually search now.
  const hasPricingSignal = /\$\s?\d{2,}\b|\bstarts?\s+at\b|\bstarting\s+(?:at|from)\b|\bpricing\b|\bprice list\b|\bflat rate\b|\bhourly\s+rate\b/i.test(text);
  const cityListMatches = text.match(cityStateRe);
  const areaListMatches = (text.match(/\b(?:we serve|service area|areas served|serving)\b/gi) || []).length;
  const hasServiceAreaDetail = areaListMatches > 0 && (cityListMatches || zipText);

  const schemaName = (localBiz?.name || '').toLowerCase();
  const cleanTitle = titleTag.toLowerCase().split(/[|\-–—:·]/)[0].trim();
  const nameConsistent =
    !!schemaName &&
    !!cleanTitle &&
    (schemaName.includes(cleanTitle) ||
      cleanTitle.includes(schemaName) ||
      (h1 && h1.toLowerCase().includes(schemaName)));

  const psKnown = ps && ps.ok;
  const def = (cond) => (cond ? 'good' : 'bad');

  // ---- Performance ----
  let speedTier, speedResult;
  if (!psKnown) {
    speedTier = 'warn';
    speedResult = "We couldn't measure your speed automatically this time — it's worth a manual check.";
  } else if (ps.perfScore >= 70) {
    speedTier = 'good';
    speedResult = `Google scores your mobile speed at ${ps.perfScore}/100 — that's solid.`;
  } else if (ps.perfScore >= 40) {
    speedTier = 'warn';
    speedResult = `Google scores your mobile speed at ${ps.perfScore}/100 — okay, but slow enough to lose impatient visitors.`;
  } else {
    speedTier = 'bad';
    speedResult = `Google scores your mobile speed at ${ps.perfScore}/100. This is slow enough that people leave before it loads.`;
  }

  let fcpTier, fcpResult;
  if (!psKnown || ps.fcpSeconds == null) {
    fcpTier = 'warn';
    fcpResult = "Couldn't measure load time automatically this time.";
  } else if (ps.fcpSeconds < 3) {
    fcpTier = 'good';
    fcpResult = `Your page starts showing in ${ps.fcpSeconds.toFixed(1)} seconds.`;
  } else if (ps.fcpSeconds < 5) {
    fcpTier = 'warn';
    fcpResult = `Your page takes ${ps.fcpSeconds.toFixed(1)} seconds to start showing — past the point most people wait.`;
  } else {
    fcpTier = 'bad';
    fcpResult = `Your page takes ${ps.fcpSeconds.toFixed(1)} seconds to start showing. Most visitors are long gone.`;
  }

  // ---- Local SEO ----
  let phoneTier, phoneResult;
  if (hasTelLink) {
    phoneTier = 'good';
    phoneResult = 'Your phone number is a tap-to-call link — exactly right for mobile.';
  } else if (phoneInText) {
    phoneTier = 'warn';
    phoneResult = 'A phone number is on the page, but it isn\'t a tap-to-call link, so mobile visitors have to copy it.';
  } else {
    phoneTier = 'bad';
    phoneResult = "We couldn't find a phone number. If someone can't call you in one tap, you lose the job.";
  }

  let addrTier, addrResult;
  if (addrSchema || addrText) {
    addrTier = 'good';
    addrResult = 'A physical address is present on the page.';
  } else if (zipText) {
    addrTier = 'warn';
    addrResult = 'We found a city/ZIP but not a full address. Google trusts a complete address more.';
  } else {
    addrTier = 'bad';
    addrResult = 'No address or service area found. Google needs to know where you are to rank you locally.';
  }

  let cityTier, cityResult;
  if (cityInTitle) {
    cityTier = 'good';
    cityResult = 'Your service area is in the page title — the strongest local-search signal.';
  } else if (cityInH1) {
    cityTier = 'warn';
    cityResult = 'Your city is in the headline but not the page title. The title carries more weight.';
  } else {
    cityTier = 'bad';
    cityResult = 'Your city isn\'t in your title or headline — the #1 thing Google uses for "near me" searches.';
  }

  const httpsTier = def(isHttps);

  // ---- Schema & Structure ----
  const lbTier = def(!!localBiz);

  let metaTier, metaResult;
  if (metaDesc && metaDesc.length >= 50 && metaDesc.length <= 165) {
    metaTier = 'good';
    metaResult = 'You have a well-sized description for search results.';
  } else if (metaDesc && metaDesc.length > 10) {
    metaTier = 'warn';
    metaResult = `Your search description is ${metaDesc.length} characters — present, but ${metaDesc.length < 50 ? 'too short to be compelling' : 'long enough that Google will cut it off'}.`;
  } else {
    metaTier = 'bad';
    metaResult = 'No description tag. Google is guessing what to show under your name in search results.';
  }

  let faqTier, faqResult;
  if (faqSchema) {
    faqTier = 'good';
    faqResult = 'You have FAQ content with proper schema — ideal for both Google and AI.';
  } else if (faqTextSignals) {
    faqTier = 'warn';
    faqResult = 'You have FAQ-style content but no FAQ schema, so AI engines may miss it.';
  } else {
    faqTier = 'bad';
    faqResult = 'No FAQ content. FAQs are the single highest-impact thing for showing up in AI answers.';
  }

  // ---- GEO Readiness ----
  let geoFaqTier, geoFaqResult;
  if (faqSchema) {
    geoFaqTier = 'good';
    geoFaqResult = 'Your Q&A is structured so ChatGPT, Siri, and Google AI can quote it directly.';
  } else if (faqTextSignals) {
    geoFaqTier = 'warn';
    geoFaqResult = 'You have some Q&A content, but without schema AI engines often skip it.';
  } else {
    geoFaqTier = 'bad';
    geoFaqResult = "When someone asks ChatGPT for a contractor in your area, there's nothing here for it to quote.";
  }

  let svcTier, svcResult;
  if (wordCount >= 500 && mentionsTrade) {
    svcTier = 'good';
    svcResult = 'Your services are described in real detail — enough for AI to understand what you do.';
  } else if (wordCount >= 250 && mentionsTrade) {
    svcTier = 'warn';
    svcResult = 'You have some service content, but more specific detail would help Google and AI.';
  } else {
    svcTier = 'bad';
    svcResult = 'Your service descriptions are thin. "We do plumbing" tells Google and AI almost nothing.';
  }

  let nameTier, nameResult;
  if (nameConsistent) {
    nameTier = 'good';
    nameResult = 'Your business name is consistent across title, headline, and code.';
  } else if (schemaName || cleanTitle) {
    nameTier = 'warn';
    nameResult = 'Your business name isn\'t identical across your title, headline, and code — AI may read those as different businesses.';
  } else {
    nameTier = 'bad';
    nameResult = "We couldn't pin down a consistent business name anywhere on the page.";
  }

  // WEB4: universal best-practice checks.
  const titleTier = hasTitle ? 'good' : 'bad';
  const titleResult = hasTitle
    ? 'Your page has a real <title> tag — the line Google shows in search results.'
    : 'Your page is missing a meaningful <title> tag — Google has nothing to show in search results.';
  const ogTier = hasOg && hasOgImage ? 'good' : (hasOg || hasOgImage ? 'warn' : 'bad');
  const ogResult = hasOg && hasOgImage
    ? 'Open Graph tags are in place — links you share on social media show a real preview.'
    : (hasOg || hasOgImage
      ? 'Some Open Graph tags are set but not all — your shared links may show an incomplete preview.'
      : 'No Open Graph tags. When someone shares your link, it shows a plain URL instead of a real preview card.');

  // WEB8: GEO / AI-answer-engine readiness — clear pricing + service area detail.
  const pricingTier = hasPricingSignal ? 'good' : 'warn';
  const pricingResult = hasPricingSignal
    ? 'You give the visitor a concrete pricing signal — AI answer engines love this.'
    : 'No pricing detail on the page. AI answers favor businesses that say "starts at $X" or list a flat rate.';
  const areaDetailTier = hasServiceAreaDetail ? 'good' : (areaListMatches || cityListMatches ? 'warn' : 'bad');
  const areaDetailResult = hasServiceAreaDetail
    ? 'Your service area is spelled out clearly with cities or ZIP codes — exactly what AI search needs.'
    : (areaListMatches || cityListMatches
      ? 'You mention a service area but not in detail — listing specific cities or ZIP codes helps Google + AI rank you for those areas.'
      : 'No clear service area listed. "We serve all of Wisconsin" is much weaker than naming the specific cities or ZIPs.');

  const INFO = {
    mobile_speed: {
      why: 'Over half of local searches happen on a phone. A slow site loses the customer before they ever see your work.',
      measures: "Google PageSpeed's mobile performance score for your page (0–100).",
      fix: 'Compress big images, remove unused plugins/widgets, and use a fast host. Every Bedrock site is a lightweight static page on a global CDN.',
    },
    load_under_3s: {
      why: 'Most people abandon a page that takes more than 3 seconds to start showing. That is a lost lead, every time.',
      measures: 'Time until the first real content appears on screen (First Contentful Paint), on mobile.',
      fix: 'Cut heavy scripts and oversized images, and serve the page from a CDN. Bedrock sites typically paint in under a second.',
    },
    phone_visible: {
      why: 'The whole point of a contractor site is getting the call. A buried or un-clickable number costs you jobs.',
      measures: "Whether a phone number is on the page, and whether it's a one-tap 'tel:' link.",
      fix: 'Put a tap-to-call number in the header and hero. Every Bedrock layout has tap-to-call built in.',
    },
    address_present: {
      why: 'Google ranks you for "near me" searches partly on a clear, consistent address or service area.',
      measures: 'Whether a street address or service-area location appears in the page text or schema.',
      fix: 'Show your full address or the cities you serve in the footer and contact section. Bedrock builds this in.',
    },
    city_in_title: {
      why: 'The single biggest local-ranking lever: matching the city in the search ("plumber Milwaukee").',
      measures: 'Whether your service-area city appears in the page <title> or main headline.',
      fix: 'Use a title like "Service + City | Business Name." Bedrock writes your city into the title during the build.',
    },
    https: {
      why: 'Browsers flag non-HTTPS sites as "Not secure," which scares off customers, and Google ranks them lower.',
      measures: 'Whether your site loads over a secure HTTPS connection.',
      fix: 'Install an SSL certificate (most hosts offer it free). Every Bedrock site gets automatic SSL.',
    },
    localbusiness_schema: {
      why: 'Schema is the invisible code that tells Google and AI exactly what your business is, where, and what you do.',
      measures: 'Whether valid LocalBusiness structured data (JSON-LD) is present on the page.',
      fix: 'Add LocalBusiness JSON-LD with your name, phone, address, and hours. Bedrock generates it automatically.',
    },
    meta_description: {
      why: "It's the sentence people read under your name in Google. A good one gets the click; a missing one gets skipped.",
      measures: 'Whether a meta description exists and is a useful length (roughly 50–165 characters).',
      fix: 'Write a one-line pitch with your service and city, ending in a reason to call. Bedrock writes this for you.',
    },
    faq_present: {
      why: 'A real FAQ answers buyer questions and is the highest-impact content for both Google rich results and AI.',
      measures: 'Whether FAQ content exists, and whether it has proper FAQPage schema.',
      fix: 'Add 3–5 real customer questions with clear answers, plus FAQ schema. Built into every Bedrock template.',
    },
    faq_for_ai: {
      why: 'AI search (ChatGPT, Siri, Google AI) quotes structured Q&A. No Q&A means you simply do not show up in the answer.',
      measures: 'Whether your Q&A content is structured (FAQPage schema) so AI can lift and cite it.',
      fix: 'Phrase headings as the exact questions customers ask and answer them directly, with schema. Bedrock does this by default.',
    },
    service_detail: {
      why: 'Thin content ("we do plumbing") gives Google and AI nothing to match a searcher to. Detail wins the ranking.',
      measures: 'How much specific, trade-relevant service content is on the page.',
      fix: 'Describe each service: what it includes, common problems, your process. Bedrock builds detailed service sections.',
    },
    name_consistent: {
      why: 'AI systems treat inconsistent names as different businesses, splitting your credibility and hiding you from answers.',
      measures: 'Whether your business name matches across the title, headline, and schema.',
      fix: 'Use the exact same business name everywhere — site, Google profile, directories. Bedrock keeps it consistent.',
    },
    // WEB4 new universal checks
    page_title: {
      why: 'The <title> tag is the line Google shows in search results. Without one, Google fills it in for you — and never as well as you would.',
      measures: 'Whether the page has a meaningful <title> tag (at least 10 characters).',
      fix: 'Write a title like "Service + City | Business Name." Bedrock generates this automatically.',
    },
    open_graph: {
      why: "When someone shares your site in Messages / Facebook / LinkedIn, Open Graph tags decide whether the link shows a real preview or a plain URL. Real previews get clicked far more.",
      measures: 'Whether og:title, og:description, and og:image are present.',
      fix: 'Add Open Graph meta tags with a title, description, and hero image. Bedrock writes these for you.',
    },
    any_schema: {
      why: 'Structured data (Schema.org) is how a search result becomes a "rich" result with extra info like ratings, FAQ snippets, or product details.',
      measures: 'Whether the page exposes any JSON-LD structured data.',
      fix: 'Add Organization / Product / Article schema depending on what the page is. Bedrock injects the right schema by default.',
    },
    // WEB8 new GEO checks
    clear_pricing: {
      why: 'AI answer engines (Perplexity, ChatGPT, Google AI Overviews) preferentially quote businesses that show a concrete pricing signal — "starts at $X," "$Y flat rate," etc.',
      measures: 'Whether a real pricing signal appears in the page text.',
      fix: 'Show a starting price, hourly rate, or flat-rate range next to each service. Bedrock surfaces a Pricing section by default.',
    },
    service_area_detail: {
      why: '"We serve the entire state" is far weaker than "We serve Milwaukee, Brookfield, Waukesha, and Wauwatosa." Specific cities + ZIPs win local + AI ranking.',
      measures: 'Whether you spell out specific cities / ZIPs in a Service Area section.',
      fix: 'List 5–15 specific cities or ZIPs you serve. Bedrock includes a Service Areas section that uses your real list.',
    },
  };

  // WEB4 2026-05-25: rubric is now split into UNIVERSAL checks (every site)
  // + LOCAL-BUSINESS-ONLY checks. When detection says the audited site isn't
  // a local business, the local checks become n/a (zero points, zero
  // denominator) so a clean generic site can score in the 80s/90s instead of
  // 40s through no fault of its own.
  const universalChecks = [
    ['Performance', 'mobile_speed',     'Loads fast on a phone',           15, speedTier,    speedResult],
    ['Performance', 'load_under_3s',    'First content in under 3 seconds', 10, fcpTier,      fcpResult],
    ['Security',    'https',            'Secure (HTTPS) connection',         5, httpsTier,
      isHttps ? 'Your site loads securely over HTTPS.' : 'Your site is not secure (no HTTPS). Browsers warn visitors and Google ranks you lower.'],
    ['Discoverability', 'page_title',   'Real <title> tag in the head',      5, titleTier,    titleResult],
    ['Discoverability', 'meta_description', 'Search-result description',     8, metaTier,     metaResult],
    ['Discoverability', 'open_graph',   'Open Graph link preview tags',      5, ogTier,       ogResult],
  ];
  const localBusinessChecks = isLocalBusinessSite ? [
    ['Local SEO', 'phone_visible',       'Phone number is tap-to-call',     10, phoneTier,   phoneResult],
    ['Local SEO', 'address_present',     'Address or service area shown',    8, addrTier,    addrResult],
    ['Local SEO', 'city_in_title',       'Your city is in the page title',   7, cityTier,    cityResult],
    ['Schema',    'localbusiness_schema','LocalBusiness schema markup',     10, lbTier,
      localBiz ? 'Your site has LocalBusiness structured data.' : 'No LocalBusiness markup — the code that tells Google and AI what your business is.'],
    ['Schema',    'faq_present',         'FAQ section or FAQ schema',        7, faqTier,     faqResult],
    ['GEO',       'faq_for_ai',          'Q&A content for AI search',        8, geoFaqTier,  geoFaqResult],
    ['GEO',       'service_detail',      'Detailed service descriptions',    7, svcTier,     svcResult],
    ['GEO',       'name_consistent',     'Business name consistent',         5, nameTier,    nameResult],
    // WEB8 NEW GEO checks: pricing + service-area detail.
    ['GEO',       'clear_pricing',       'Clear pricing on the page',        5, pricingTier, pricingResult],
    ['GEO',       'service_area_detail', 'Service area listed in detail',    7, areaDetailTier, areaDetailResult],
  ] : [];

  // For general sites, also score "structured data of any kind" (rich-result
  // potential, e.g. Article / Organization / Product schemas).
  if (!isLocalBusinessSite) {
    universalChecks.push(['Discoverability', 'any_schema', 'Structured data on the page', 7,
      anySchema ? 'good' : 'warn',
      anySchema ? 'Your page exposes structured data — search engines can build a richer result for you.'
                : 'No structured data on the page. Adding Schema.org markup unlocks richer Google results.']);
  }

  const raw = universalChecks.concat(localBusinessChecks);

  const checks = raw.map(([cat, key, label, points, tier, result]) => ({
    cat,
    key,
    label,
    points,
    tier, // good | warn | bad
    result,
    info: INFO[key],
  }));

  return {
    checks,
    siteContext: isLocalBusinessSite ? 'local_business' : 'general',
    scraped: scrape({ html, text, titleTag, h1, localBiz, url })
  };
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

  const tel = firstMatch(/href=["']tel:([^"']+)["']/i, html);
  const phoneRe = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const phone = (tel || firstMatch(phoneRe, text) || '').trim();

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

  const hay = `${titleTag} ${h1} ${localBiz?.['@type'] || ''}`.toLowerCase();
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
  return 'Critical problems — this site is costing you customers';
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

  // PageSpeed runs but is allowed to fail without blocking the audit.
  let ps = { ok: false };
  try {
    const r = await withTimeout(getPageSpeed(url.href), 9500, 'PageSpeed');
    ps = { ok: true, ...r };
  } catch {
    ps = { ok: false };
  }

  const text = stripTags(html).slice(0, 200000);
  const jsonld = extractJsonLd(html);
  const { checks, scraped, siteContext } = buildChecks({ html, text, url, ps, jsonld });

  let earned = 0;
  let possible = 0;
  const cats = {};
  for (const c of checks) {
    const got = award(c.points, c.tier);
    earned += got;
    possible += c.points;
    if (!cats[c.cat]) cats[c.cat] = { earned: 0, possible: 0 };
    cats[c.cat].earned += got;
    cats[c.cat].possible += c.points;
  }
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const categories = Object.entries(cats).map(([name, v]) => ({
    name,
    pct: Math.round((v.earned / v.possible) * 100),
  }));

  // WEB4 + WEB8: TOP 3 FIXES only, each with a plain-English next step.
  // We sort bad > warn, then by points (biggest needle-movers first). The
  // `fix` line on the INFO entry is the actionable plain-English sentence.
  const rank = { bad: 0, warn: 1, good: 2 };
  const topIssues = checks
    .filter((c) => c.tier !== 'good')
    .sort((a, b) => rank[a.tier] - rank[b.tier] || b.points - a.points)
    .slice(0, 3)
    .map((c) => ({
      label:  c.label,
      result: c.result,
      tier:   c.tier,
      // The plain-English "do this" — from INFO[c.key].fix when available.
      next_step: c.info && c.info.fix ? c.info.fix : ''
    }));

  // WEB4: human-readable context line for the UI.
  const siteContextLabel = siteContext === 'local_business'
    ? 'Looks like a local-business site — scored against the full contractor rubric.'
    : 'Doesn\'t look like a local-business site — scored against universal best practices only (no penalty for missing LocalBusiness schema, FAQ schema, etc.).';

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
      siteContext,
      siteContextLabel,
      pageSpeedMeasured: ps.ok,
      fetchOk,
    }),
  };
};
