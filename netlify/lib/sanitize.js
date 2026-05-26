// netlify/lib/sanitize.js
// SEC9: strip <script> tags and inline event-handler attributes from any
// string value before we write user-provided data to a JSONB column. The
// values still get HTML-escaped at render time, but stripping here is a
// belt-and-suspenders defense in case any downstream code ever renders
// the raw value (e.g. a builder preview that uses innerHTML).
//
// Usage:
//   const { sanitizeJsonb } = require('../lib/sanitize');
//   const clean = sanitizeJsonb(body.siteData);
//
// Notes:
//   - Walks objects + arrays recursively (with a depth guard).
//   - Leaves non-string scalars (numbers, booleans, null) untouched.
//   - Does NOT escape HTML — caller still escapes for rendering.

const MAX_DEPTH = 12;

// Greedy <script>…</script> and lone <script ...> / </script>. We don't try
// to be a full HTML sanitizer here — the policy is "any string going into
// JSONB must be neutered of script tags and JS event handlers".
const SCRIPT_TAG_RE   = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const ORPHAN_SCRIPT   = /<\s*\/?\s*script\b[^>]*>/gi;
// on*="..." or on*='...' or on*=value (no quotes)
const EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
// javascript:… inside href/src — flatten the protocol so it can't fire.
const JS_URI_RE        = /\bjavascript\s*:/gi;

function cleanString(s) {
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(SCRIPT_TAG_RE, '')
    .replace(ORPHAN_SCRIPT, '')
    .replace(EVENT_HANDLER_RE, '')
    .replace(JS_URI_RE, 'javascript-blocked:');
}

function sanitizeJsonb(value, depth) {
  const d = depth || 0;
  if (d > MAX_DEPTH) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cleanString(value);
  if (typeof value !== 'object') return value;          // number, boolean
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeJsonb(v, d + 1));
  }
  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = sanitizeJsonb(value[k], d + 1);
  }
  return out;
}

module.exports = { sanitizeJsonb, cleanString };
