'use strict';
// Vercel serverless entry: every request is handled by the normal LinguaFlow server instance.
// Vercel has no persistent disk, so the database lives in /tmp and is rebuilt (with demo content) on a cold start.
const path = require('node:path');

process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/linguaflow';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
process.env.FIRST_USER_ADMIN = process.env.FIRST_USER_ADMIN || '0'; // admin only via ADMIN_EMAILS (admins skip AI limits)

if (!process.env.SESSION_SECRET) console.warn('[linguaflow] SESSION_SECRET is not set: logins will break between serverless instances. Set it in Vercel > Settings > Environment Variables.');

let app;
let initError;
function get() {
  if (initError) throw initError;
  if (!app) {
    try {
      // required lazily so that a missing module / unsupported Node is reported instead of crashing the function
      const { createApp } = require('../src/app');
      const { seedDemo } = require('../src/demo');
      const dataDir = path.resolve(process.env.DATA_DIR);
      app = createApp({ dataDir, dbFile: path.join(dataDir, 'linguaflow.db') });
      if (process.env.DEMO_MODE !== '0') seedDemo(app.db);
    } catch (e) { initError = e; console.error('[linguaflow] startup failed:', e && e.stack ? e.stack : e); throw e; }
  }
  return app;
}

module.exports = (req, res) => {
  try {
    get().server.emit('request', req, res);
  } catch (e) {
    // shown in the browser too, so the cause is visible without opening the Vercel logs (message only, no stack)
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`LinguaFlow ishga tushmadi.\nXato: ${e && e.message ? e.message : e}\nNode: ${process.version}\nDATA_DIR: ${process.env.DATA_DIR}\nSESSION_SECRET: ${process.env.SESSION_SECRET ? 'bor' : "YO'Q"}\n`);
  }
};
