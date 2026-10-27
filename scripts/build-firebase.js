'use strict';
const esbuild = require('esbuild');

try {
  esbuild.buildSync({
    entryPoints: ['src/firebase-auth-client.js'],
    bundle: true,
    minify: true,
    outfile: 'public/firebase-auth.js',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  console.log('✓ Firebase Auth bundle built: public/firebase-auth.js');
} catch (err) {
  console.error('Failed to build Firebase Auth bundle:', err);
  process.exit(1);
}
