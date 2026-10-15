'use strict';
// Vercel serverless entry: every request is handled by the normal LinguaFlow server instance.
// Vercel has no persistent disk, so the database lives in /tmp and is rebuilt (with demo content) on a cold start.
const path = require('node:path');

process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/linguaflow';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
process.env.FIRST_USER_ADMIN = process.env.FIRST_USER_ADMIN || '0'; // admin only via ADMIN_EMAILS (admins skip AI limits)

const { createApp } = require('../src/app');
const { seedDemo } = require('../src/demo');

if (!process.env.SESSION_SECRET) console.warn('[linguaflow] SESSION_SECRET is not set: logins will break between serverless instances. Set it in Vercel > Settings > Environment Variables.');

let app;
function get() {
  if (!app) {
    const dataDir = path.resolve(process.env.DATA_DIR);
    app = createApp({ dataDir, dbFile: path.join(dataDir, 'linguaflow.db') });
    if (process.env.DEMO_MODE !== '0') seedDemo(app.db);
  }
  return app;
}

module.exports = (req, res) => { get().server.emit('request', req, res); };
