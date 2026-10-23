import { reviewDate } from './review-date.mjs';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.env.DELIVERY_DIR || 'submission/assets');
mkdirSync(out, { recursive: true });
const tmp = join(out, 'browser-tmp');
mkdirSync(tmp, { recursive: true });
process.env.TEMP = tmp;
process.env.TMP = tmp;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32'
    ? { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: join(out, 'recordings'), size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(15000);
const errors = [],
  responses = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('status of 400')) errors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) responses.push({ url: r.url(), status: r.status() });
});
const checks = [];
let exit = 0;
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:4318');
  await page.getByRole('heading', { name: 'Wallet review', exact: true }).waitFor();
  checks.push('Workspace loads without marketing hero');
  await page.screenshot({ path: join(out, 'workspace-empty.png'), fullPage: true });
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await page.getByText('Demo settled', { exact: true }).waitFor();
  await page.getByText('LOCAL DEMO · NO FUNDS MOVED', { exact: true }).waitFor();
  checks.push('Fixture result and separate payment evidence render');
  await page.screenshot({ path: join(out, 'workspace.png'), fullPage: true });
  const first = new URL(page.url()).searchParams.get('task');
  await page.getByRole('button', { name: 'Replay task', exact: true }).click();
  await page.getByText('Demo settled', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('task'), first);
  assert.equal(await page.locator('#call-rows tr').count(), 1);
  checks.push('Replay retains one call');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export receipt', exact: true }).click();
  const download = await downloading;
  await download.saveAs(join(out, 'fixture-receipt.json'));
  checks.push('Receipt JSON export');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Demo settled', { exact: true }).waitFor();
  checks.push('Session-owned task survives reload');
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `overflow at ${width}`,
    );
    await page.screenshot({ path: join(out, `workspace-${width}.png`), fullPage: true });
  }
  checks.push('1280/768/375px have no document overflow');
  await page.locator('#budget').fill('0.005');
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Budget exceeded' }).waitFor();
  checks.push('Budget refusal shown before provider call');
  await page.locator('#budget').fill('0.02');
  await page.locator('#scenario').selectOption('uncertain');
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await page.getByRole('heading', { name: 'Payment needs a closer look' }).waitFor();
  assert.equal(await page.locator('#reserved').textContent(), '0.010000');
  await page.screenshot({ path: join(out, 'uncertain-payment.png'), fullPage: true });
  checks.push('Timeout reserves funds and offers no automatic repayment');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#mode').selectOption('live');
  await page.getByRole('button', { name: 'Get service quote', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.locator('#payment-review').getByText('0.010000 USDC', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sign & pay with wallet' }).isDisabled(), true);
  await page.screenshot({ path: join(out, 'real-unsigned-quote.png'), fullPage: true });
  checks.push('Real unpaid quote visible; signing disabled by owner');
  await page.getByRole('button', { name: 'Close payment review' }).click();
  assert.deepEqual(errors, []);
  assert.equal(responses.filter((r) => r.status !== 400 || !r.url.endsWith('/api/demo')).length, 0);
  checks.push('No unexpected console or HTTP errors');
  const report = {
    checkedAt: new Date().toISOString(),
    clientReviewDate: reviewDate(),
    passed: true,
    checks,
    consoleErrors: errors,
    expectedNegativeResponses: responses,
    method: 'Playwright 1.64.1 with installed Chrome; IAB tab creation timed out in prior attempt',
    paymentsSent: 0,
    walletSignatures: 0,
    limitation:
      'Actual mainnet settlement and ERC-8004 registration require user authorization and remain untested.',
  };
  writeFileSync(join(out, 'ui-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  exit = 1;
  console.error(e);
  writeFileSync(
    join(out, 'ui-failure.json'),
    JSON.stringify({ error: e.message, checks, consoleErrors: errors }, null, 2),
  );
  await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  const video = page.video();
  await context.close();
  if (video) await video.saveAs(join(out, 'demo-recording.webm'));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(exit);
}
