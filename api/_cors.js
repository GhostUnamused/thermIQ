/**
 * _cors.js — shared CORS helper for Vercel functions
 * Files prefixed with _ are NOT exposed as endpoints by Vercel.
 */
module.exports = function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Ingest-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
};
