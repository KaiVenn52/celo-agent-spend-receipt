import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
mkdirSync('evidence', { recursive: true });
const files = readdirSync('test')
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => 'test/' + f);
const tests = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
  encoding: 'utf8',
});
writeFileSync('evidence/tests.txt', tests);
const build = execFileSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
const passed = Number(tests.match(/^# pass (\d+)/m)?.[1]),
  failed = Number(tests.match(/^# fail (\d+)/m)?.[1]);
if (!Number.isFinite(passed) || failed !== 0) throw Error('Test result could not be validated');
writeFileSync(
  'evidence/validation.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      clientReviewDate: '2026-10-23',
      node: process.version,
      testsPassed: passed,
      testsFailed: failed,
      build: 'passed',
      runtimeDependencies: JSON.parse(readFileSync('package.json', 'utf8')).dependencies,
      realPayments: 0,
      uiReport: 'submission/assets/ui-qa.json',
      injectedBrowserReport: 'evidence/ui-live-injected.json',
    },
    null,
    2,
  ),
);
console.log(`${passed} tests passed; ${failed} failed. Full output: evidence/tests.txt\n${build}`);
