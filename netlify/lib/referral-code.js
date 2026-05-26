// G5 (Batch G, 2026-05-26): referral code generator + uniqueness checker.
//
// Format per 07-REFERRAL-PROGRAM.md:
//   <BUSINESS_SLUG><2-digit-number>
// Examples: SMITH10, DAVISELECTRIC22, JONESPLUMB05.
//
// The business slug is uppercase A–Z only, max 14 chars, derived from the
// business name (spaces/punctuation stripped). If no business name is on
// file we fall back to "BEDROCK" so the code is still issuable. The 2-digit
// suffix is zero-padded random 00–99; on collision we retry with a fresh
// suffix, falling back to a 4-digit suffix if 99 isn't enough breathing room.
//
// Uniqueness is checked against profiles.referral_code in Supabase. The
// caller passes a `findExisting(code)` async fn so this file can be unit-
// tested without a network dependency. Callers in /netlify/functions/
// will pass a closure that queries the profiles table via the service role.

const MAX_SLUG = 14;
const SLUG_FALLBACK = 'BEDROCK';
const TWO_DIGIT_RETRIES  = 6;
const FOUR_DIGIT_RETRIES = 6;

function slugifyBusinessName(businessName) {
  if (!businessName) return SLUG_FALLBACK;
  const upper = String(businessName).toUpperCase();
  // Strip everything except A-Z. Drops &, ',', spaces, accents, digits.
  const cleaned = upper.replace(/[^A-Z]/g, '');
  if (!cleaned) return SLUG_FALLBACK;
  return cleaned.slice(0, MAX_SLUG);
}

function twoDigitSuffix() {
  return String(Math.floor(Math.random() * 100)).padStart(2, '0');
}
function fourDigitSuffix() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// Public API.
//
//   businessName: arbitrary string (e.g. "Davis Electric")
//   findExisting: async (code: string) => boolean   true if code is taken
//
// Resolves to a code that is NOT in use, or throws if we couldn't find one
// after the retry budget (extremely unlikely given the 4-digit fallback).
async function generateReferralCode(businessName, findExisting) {
  const slug = slugifyBusinessName(businessName);

  // First pass: 2-digit suffix per spec.
  for (let i = 0; i < TWO_DIGIT_RETRIES; i++) {
    const code = slug + twoDigitSuffix();
    const taken = await findExisting(code);
    if (!taken) return code;
  }
  // Fallback: 4-digit suffix so the namespace is 100x larger.
  for (let i = 0; i < FOUR_DIGIT_RETRIES; i++) {
    const code = slug + fourDigitSuffix();
    const taken = await findExisting(code);
    if (!taken) return code;
  }
  throw new Error('Could not allocate a unique referral code after retries');
}

// Light-weight validator — used at signup time so we don't accept obviously
// malformed codes before hitting the DB. Does NOT confirm the code exists.
function looksLikeReferralCode(code) {
  if (typeof code !== 'string') return false;
  return /^[A-Z]{1,14}\d{2,4}$/.test(code);
}

module.exports = { generateReferralCode, slugifyBusinessName, looksLikeReferralCode };
