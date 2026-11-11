// Vercel adapter: runs the same Node server as a serverless function.
// DEMO ONLY — Vercel has no persistent disk, so the SQLite database lives in /tmp and resets on cold starts.
// For a real deployment use a host with a persistent disk (Render, Railway, Fly, VPS) — see README.
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/toropinto';
process.env.DISABLE_JOBS = '1';
const app = require('../platform');
let ready;
module.exports = async (req, res) => {
  try {
    ready ||= require('../lib/seed').seedIfEmpty();
    await ready;
  } catch (e) { ready = null; console.error(e); res.statusCode = 500; return res.end('Server error'); }
  app.server.emit('request', req, res);
};
