import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { reviewDate } from './review-date.mjs';
const out = resolve(process.env.DELIVERY_DIR || 'submission/assets');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32'
    ? { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto((process.env.APP_URL || 'http://127.0.0.1:4318') + '/identity');
  await page.getByRole('heading', { name: 'Register the agent', exact: true }).waitFor();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/identity/prepare'));
  await page.getByRole('button', { name: 'Review current gas', exact: true }).click();
  const review = await (await response).json();
  assert.equal(review.status, 'UNSIGNED REVIEW ONLY');
  assert.equal(review.signaturesCreated, 0);
  assert.equal(review.broadcasts, 0);
  assert.equal(review.transaction.chainId, '0xa4ec');
  await page.getByRole('heading', { name: 'Unsigned transaction review', exact: true }).waitFor();
  await page.locator('#identity-consent').check();
  assert.equal(await page.locator('#identity-register').isDisabled(), true);
  await page.screenshot({ path: join(out, 'identity-review.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(out, 'identity-review-375.png'), fullPage: true });
  await page.getByRole('button', { name: 'Connect owner wallet', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'EVM wallet extension' }).waitFor();
  assert.deepEqual(errors, []);
  const report = {
    checkedAt: new Date().toISOString(),
    clientReviewDate: reviewDate(),
    passed: true,
    checks: [
      'Approved owner and fixed Celo registry review',
      'Real read-only gas and balance query',
      'Unconnected wallet cannot register even after consent',
      '375px layout without overflow',
      'Missing wallet extension error is visible',
    ],
    signaturesCreated: 0,
    broadcasts: 0,
    observedOwnerBalanceCELO: review.balanceCELO,
    scope: 'Unsigned registration review only; no wallet or mainnet broadcast was tested',
  };
  writeFileSync(join(out, 'identity-ui-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
