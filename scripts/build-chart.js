'use strict';
const esbuild = require('esbuild');

try {
  esbuild.buildSync({
    entryPoints: ['src/components/LanguageProficiencyProgress.jsx'],
    bundle: true,
    minify: true,
    outfile: 'public/proficiency-chart.js',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  console.log('✓ Recharts LanguageProficiencyProgress bundle built: public/proficiency-chart.js');
} catch (err) {
  console.error('Failed to build Recharts bundle:', err);
  process.exit(1);
}
