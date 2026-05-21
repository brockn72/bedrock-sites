// Analyzes an uploaded brand asset (logo, flyer, business card, etc.)
// using Claude Sonnet vision and returns suggested brand kit defaults:
//   { colors: { primary, secondary, accent }, fonts: { display, body },
//     tone, style, tagline_idea, notes }
// Requires env var: ANTHROPIC_API_KEY
const MODEL = 'claude-sonnet-4-6';  // vision-capable
const MAX_TOKENS = 600;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'AI brand analysis not configured yet — set your brand kit manually.' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // image_base64 is a data URL like "data:image/jpeg;base64,/9j/..."
  const imageDataUrl = body.image_base64 || '';
  if (!imageDataUrl || !imageDataUrl.startsWith('data:')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'image_base64 (data URL) required' }) };
  }
  const m = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) {
    return { statusCode: 400, body: JSON.stringify({ error: 'image_base64 must be a base64 data URL' }) };
  }
  const mediaType = m[1];
  const b64       = m[2];

  // Only allow common image types — Anthropic vision supports these
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (!allowed.includes(mediaType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Image must be PNG, JPG, GIF, or WebP. Convert PDFs to image first.' }) };
  }

  const businessContext = body.context || {};

  const prompt = `You are analyzing a contractor's existing marketing material (logo, flyer, business card, sign, or similar) to extract their brand identity.

The contractor's business context: ${JSON.stringify(businessContext)}

Analyze the image and return ONLY a JSON object — no preamble, no markdown — with these fields:
{
  "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
  "fonts": { "display": "best guess: classic|modern|bold|rugged", "body": "best guess: classic|modern|bold|rugged" },
  "tone": "best guess: Bold|Friendly|Premium|Family-owned|Industrial|Emergency-focused|Modern|Rugged|Luxury",
  "style": "1-2 sentence summary of the visual style",
  "tagline_idea": "if a tagline appears in the image, copy it verbatim; otherwise null",
  "notes": "1-2 sentences with anything else useful (logo style, typography, suggested improvements)"
}

Rules:
- Use 6-digit hex codes with leading #
- "primary" should be the dominant brand color
- "secondary" should be the supporting background or text color
- "accent" should be the highlight color used for CTAs or emphasis
- Pick from the exact tone list above
- font picks must be one of: classic, modern, bold, rugged
- If the image is too generic or empty to analyze, return defaults (e.g. primary #1B3557, accent #C9922A) and explain in notes
- NEVER output anything except the JSON object`;

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
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text',  text: prompt },
          ],
        }],
      }),
    });
  } catch (e) {
    console.error('[analyze-brand-materials] network', e);
    return { statusCode: 502, body: JSON.stringify({ error: 'AI service unreachable' }) };
  }

  if (!aiRes.ok) {
    const text = await aiRes.text();
    console.error(`[analyze-brand-materials] ${aiRes.status} — ${text}`);
    return { statusCode: 502, body: JSON.stringify({ error: 'AI analysis failed' }) };
  }

  const data = await aiRes.json();
  const raw  = data && data.content && data.content[0] && data.content[0].text || '';
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed = null;
  if (match) { try { parsed = JSON.parse(match[0]); } catch {} }

  if (!parsed) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis: null, raw, warning: 'AI returned unparseable output' }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis: parsed }),
  };
};
