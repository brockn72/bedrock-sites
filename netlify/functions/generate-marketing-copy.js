// One stateless call to Anthropic per generation. Returns {headline, subheadline, cta}.
// Requires env var: ANTHROPIC_API_KEY
const MAX_TOKENS = 200;
const MODEL      = 'claude-haiku-4-5-20251001';  // fast + cheap for short copy

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
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const brandKit       = body.brand_kit       || {};
  const selectedFormat = body.format          || 'Social Media Post';
  const campaignNote   = body.campaign_note   || '';

  const prompt =
`You are writing marketing copy for a contractor business.

Business profile:
- Name: ${brandKit.business_name || '(not set)'}
- Trade: ${brandKit.trade || '(not set)'}
- City: ${brandKit.city || '(not set)'}
- Tagline: ${brandKit.tagline || '(none)'}
- Tone: ${brandKit.tone || 'Friendly'}
- Target customer: ${brandKit.target_customer || 'homeowners'}

Output format: ${selectedFormat}
Campaign context: ${campaignNote || 'General marketing'}

Generate marketing copy. Respond ONLY with a JSON object, no markdown, no preamble:
{
  "headline": "...",
  "subheadline": "...",
  "cta": "..."
}

Rules:
- Headline: 4–8 words, bold, punchy
- Subheadline: 8–14 words, supports the headline
- CTA: 2–5 words (e.g., "Call Today", "Free Estimates", "Book Online")
- Match the tone exactly: ${brandKit.tone || 'Friendly'}
- Never use generic phrases like "Your Trusted Partner" or "Quality You Can Count On"`;

  let aiRes;
  try {
    aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    console.error('[generate-marketing-copy] network', e);
    return { statusCode: 502, body: JSON.stringify({ error: 'AI service unreachable' }) };
  }

  if (!aiRes.ok) {
    const text = await aiRes.text();
    console.error(`[generate-marketing-copy] ${aiRes.status} — ${text}`);
    return { statusCode: 502, body: JSON.stringify({ error: 'AI generation failed' }) };
  }

  const data = await aiRes.json();
  const raw  = data && data.content && data.content[0] && data.content[0].text || '';

  // Tolerate stray prose around the JSON — extract the first {...} block
  let copy = null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { copy = JSON.parse(match[0]); } catch {}
  }

  if (!copy || !copy.headline) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        copy: { headline: '', subheadline: '', cta: '' },
        warning: 'AI returned unparseable output — type copy manually.',
        raw,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ copy }),
  };
};
