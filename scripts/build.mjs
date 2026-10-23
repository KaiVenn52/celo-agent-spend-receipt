import { mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = [
  'src/ledger.mjs',
  'src/providers.mjs',
  'src/payments.mjs',
  'src/sessions.mjs',
  'src/identity.mjs',
  'src/evidence.mjs',
  'src/server.mjs',
  'public/app.js',
];
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
mkdirSync('dist', { recursive: true });
for (const path of ['src', 'public', 'scripts']) cpSync(path, 'dist/' + path, { recursive: true });
for (const path of ['package.json', 'package-lock.json', 'README.md']) cpSync(path, 'dist/' + path);
writeFileSync(
  'dist/BUILD.json',
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      clientReviewDate: '2026-10-23',
      node: process.version,
      mode: 'fixture-and-pinned-x402-wallet-flow',
      sdk: '@celo/buy-core@0.8.3',
      signedExecutionDefault: false,
      checks: files,
    },
    null,
    2,
  ),
);
console.log('Build complete: dist/ (Node 24 server + static assets; no bundler required)');
