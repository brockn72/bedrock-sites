// google-business-callback.js
// Compatibility shim. The Netlify env var GOOGLE_BUSINESS_REDIRECT_URI was
// originally registered pointing at this filename. The real Google OAuth
// callback logic lives in google-oauth-callback.js — this re-exports it so the
// flow works whether the redirect URI ends in /google-business-callback or
// /google-oauth-callback. Keep both deployed.
module.exports = require('./google-oauth-callback');
