// Build the AKG ESS PWA bundle.
//
// The /ess app is a set of plain (non-module) JSX files that share one global
// scope and rely on a global `React` / `ReactDOM`. Historically the browser
// compiled them at runtime with @babel/standalone (~3 MB) on every load. This
// script does that compile ONCE, ahead of time, with esbuild:
//
//   - transpiles JSX -> React.createElement(...)
//   - concatenates the sources IN ORDER into a single classic script
//   - strips whitespace/comments (but keeps identifier names, since these
//     files reference each other by top-level name and expose a few globals)
//
// Output: public/ess.bundle.js  (committed; served at /assets/akg_ess/).
// Run:    npm run build      (from the akg_ess/ app directory)
//
// NOTE: data.js and api.js are intentionally NOT bundled — they are plain JS,
// already same-origin, and must run before this bundle (they populate
// window.STRINGS / window.frappe). index.html loads them first.

import { transformSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dirname, 'public');

// Order matches the old <script type="text/babel"> order in
// www/ess/index.html. app.jsx is LAST: it defines App and calls
// ReactDOM.render once every component/helper above it exists.
const SOURCES = [
  'ui.jsx',
  'attendance.jsx',
  'monthly-report.jsx',
  'leaves.jsx',
  'petty.jsx',
  'profile.jsx',
  'notifications.jsx',
  'missed-checkout.jsx',
  'app.jsx',
];

let combined = '';
for (const f of SOURCES) {
  combined += `\n// ===== ${f} =====\n${readFileSync(join(PUB, f), 'utf8')}\n`;
}

let result;
try {
  result = transformSync(combined, {
    loader: 'jsx',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    target: 'es2019',
    charset: 'utf8',            // keep Arabic / UTF-8 string literals intact
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,   // these files share a global scope — don't rename
    legalComments: 'none',
  });
} catch (err) {
  console.error('Build failed:\n', err.message || err);
  process.exit(1);
}

const banner =
  '/* AKG ESS - generated bundle. DO NOT EDIT.\n' +
  '   Source: public/*.jsx  |  Rebuild: npm run build (in akg_ess/)\n' +
  '   Requires globals React, ReactDOM (vendored in www/ess/index.html). */\n';

writeFileSync(join(PUB, 'ess.bundle.js'), banner + result.code, 'utf8');

const kb = (Buffer.byteLength(banner + result.code) / 1024).toFixed(1);
console.log(`ess.bundle.js written - ${kb} KB from ${SOURCES.length} sources`);
