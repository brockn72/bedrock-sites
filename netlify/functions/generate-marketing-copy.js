// One stateless call to Anthropic per generation. Returns {headline, subheadline, cta}.
//
// Batch D2 (MKT2 + MKT3): the AI now writes inside hard rails. Output is parsed
// as JSON only, every field is word-count validated against a per-format budget,
// and a banned-phrase filter rejects generic puffery ("Your Trusted Partner",
// "Quality You Can Count On", etc.). If validation fails on the first pass we
// re-prompt the model up to MAX_RETRIES with the failure reason inlined so it
// can fix the specific problem. Over-length copy never reaches the renderer —
// it would break the locked recipe layout.
//
// Required env var: ANTHROPIC_API_KEY

const MAX_TOKENS  = 220;
const MODEL       = 'claude-haiku-4-5-20251001';   // fast + cheap for short copy
const MAX_RETRIES = 2;                              // up to 3 total attempts (initial + 2 retries)

// MKT3 — banned generic-puffery phrases. Case-insensitive substring match.
// Add to this list whenever a new cliché shows up in real generations.
const BANNED_PHRASES = [
  'your trusted partner', 'trusted partner',
  'quality you can count on', 'quality you can trust',
  'world-class', 'world class',
  'cutting edge', 'cutting-edge',
  'second to none',
  'go above and beyond',
  'exceeding expectations',
  'satisfaction guaranteed', 'your satisfaction is our',
  'one stop shop', 'one-stop shop', 'one-stop-shop',
  'best in the business', 'best in town', 'best in class',
  'unmatched quality', 'unparalleled service',
  'attention to detail',
  'state of the art', 'state-of-the-art',
  'industry leading', 'industry-leading',
  "we've got you covered", 'we have got you covered',
  'rest assured',
  'peace of mind',
];

// MKT2 — per-field word budgets. CTA is also validated against a recommended
// short-phrase enum (model is encouraged to pick from this list).
const FIELD_LIMITS = {
  headline:    { min: 2, max: 8 },
  subheadline: { min: 0, max: 14 },
  cta:         { min: 2, max: 5 },
};

const CTA_ENUM = [
  'Call Today', 'Call Now', 'Text Us', 'Book Online',
  'Get a Quote', 'Free Estimates', 'Get Started', 'Schedule Now',
  'Learn More', 'Visit Our Site', 'See Our Work', 'Leave a Review',
  'Reserve Your Spot', 'Hiring Now', 'Apply Now',
];

function countWords(s) {
  if (typeof s !== 'string') return 0;
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function truncateWords(s, max) {
  if (typeof s !== 'string') return s;
  const words = s.trim().split(/\s+/);
  if (words.length <= max) return s.trim();
  return words.slice(0, max).join(' ');
}

function hasBannedPhrase(s) {
  if (typeof s !== 'string' || !s) return null;
  const lower = s.toLowerCase();
  for (const p of BANNED_PHRASES) {
    if (lower.indexOf(p) !== -1) return p;
  }
  return null;
}

// Returns { ok, issues } where issues is an array of human-readable problems
// to feed back to the model on retry.
function validateCopy(copy) {
  const issues = [];
  if (!copy || typeof copy !== 'object') return { ok: false, issues: ['Output was not a JSON object.'] };

  for (const f of ['headline', 'subheadline', 'cta']) {
    const v = copy[f];
    if (typeof v !== 'string' || !v.trim()) {
      // Subhead may be empty for some recipes; allow it.
      if (f === 'subheadline') continue;
      issues.push(`Field "${f}" is missing or empty.`);
      continue;
    }
    const wc = countWords(v);
    const lim = FIELD_LIMITS[f];
    if (wc > lim.max) issues.push(`"${f}" is ${wc} words; max ${lim.max}. Rewrite shorter.`);
    if (wc < lim.min) issues.push(`"${f}" is ${wc} words; min ${lim.min}. Be more specific.`);
    const bad = hasBannedPhrase(v);
    if (bad) issues.push(`"${f}" contains the banned phrase "${bad}". Rewrite without it.`);
  }
  return { ok: issues.length === 0, issues };
}

function buildPrompt(brandKit, selectedFormat, campaignNote, retryFeedback) {
  const tone = brandKit.tone || 'Friendly';
  let p =
`You are writing marketing copy for a trade contractor.

Business profile:
- Name: ${brandKit.business_name || '(not set)'}
- Trade: ${brandKit.trade || '(not set)'}
- City: ${brandKit.city || '(not set)'}
- Tagline: ${brandKit.tagline || '(none)'}
- Tone: ${tone}
- Target customer: ${brandKit.target_customer || 'homeowners'}

Output format: ${selectedFormat}
Campaign context: ${campaignNote || 'General marketing'}

Respond with ONLY a JSON object — no markdown fence, no preamble, no explanation:
{"headline":"...","subheadline":"...","cta":"..."}

HARD RULES (output is validated server-side; non-compliant output is rejected):
- headline: ${FIELD_LIMITS.headline.min}–${FIELD_LIMITS.headline.max} words, concrete, no fluff
- subheadline: 0–${FIELD_LIMITS.subheadline.max} words, supports the headline
- cta: ${FIELD_LIMITS.cta.min}–${FIELD_LIMITS.cta.max} words. Prefer one of: ${CTA_ENUM.slice(0, 8).join(', ')}.
- Match the tone exactly: ${tone}.
- Concrete > clever. Trade words OK. Local + specific.
- NEVER use generic puffery. Do not output any of these phrases or close variations: ${BANNED_PHRASES.slice(0, 10).join('; ')}, etc.`;

  if (retryFeedback && retryFeedback.length) {
    p += `\n\nYour previous output FAILED validation:\n- ${retryFeedback.join('\n- ')}\nRespond again with ONLY the corrected JSON object. Same structure.`;
  }
  return p;
}

async function callAnthropic(apiKey, prompt) {
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  if (!aiRes.ok) {
    // Status only — body echoes prompt + brand-kit fields.
    console.error('[generate-marketing-copy] anthropic status=', aiRes.status);
    throw new Error('AI status ' + aiRes.status);
  }
  const data = await aiRes.json();
  return (data && data.content && data.content[0] && data.content[0].text) || '';
}

function extractJson(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'AI copy generation not configured yet — type your headline manually.' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const brandKit       = body.brand_kit       || {};
  const selectedFormat = body.format          || 'Social Media Post';
  const campaignNote   = body.campaign_note   || '';

  let copy = null;
  let issues = [];
  let attempts = 0;
  try {
    while (attempts <= MAX_RETRIES) {
      const prompt = buildPrompt(brandKit, selectedFormat, campaignNote, attempts > 0 ? issues : null);
      const raw    = await callAnthropic(apiKey, prompt);
      const parsed = extractJson(raw);
      const check  = validateCopy(parsed);
      if (check.ok) { copy = parsed; break; }
      copy = parsed; issues = check.issues; attempts += 1;
    }
  } catch (_) {
    return { statusCode: 502, body: JSON.stringify({ error: 'AI service unreachable' }) };
  }

  // Final safety net — if the model still over-shot on a length, hard-truncate
  // so the renderer always gets compliant copy. (Banned-phrase failures fall
  // through here as a generic warning — the contractor sees it in the UI.)
  if (copy && typeof copy === 'object') {
    copy.headline    = truncateWords(copy.headline    || '', FIELD_LIMITS.headline.max);
    copy.subheadline = truncateWords(copy.subheadline || '', FIELD_LIMITS.subheadline.max);
    copy.cta         = truncateWords(copy.cta         || '', FIELD_LIMITS.cta.max);
  }

  if (!copy || !copy.headline) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        copy:    { headline: '', subheadline: '', cta: '' },
        warning: 'AI returned copy that didn’t fit the rules — type your own headline below.',
        attempts,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      copy,
      attempts,
      validation_issues: issues.length ? issues : undefined,
    }),
  };
};
