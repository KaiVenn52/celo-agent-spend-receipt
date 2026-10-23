import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const dir = resolve('submission/assets');
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32'
    ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: join(dir, 'recordings'), size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const start = Date.now(),
  scenes = [];
const scene = (label) => scenes.push({ seconds: Math.round((Date.now() - start) / 1000), label });
let failure;
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:4318');
  scene('Local demo. No payment or user data.');
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await page.getByText('Demo settled', { exact: true }).waitFor();
  scene('A wallet snapshot and its synthetic cost are shown separately.');
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: 'Replay task', exact: true }).click();
  await page.getByText('Demo settled', { exact: true }).waitFor();
  scene('Replay preserves one service call.');
  await page.waitForTimeout(4000);
  await page.locator('#budget').fill('0.005');
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Budget exceeded' }).waitFor();
  scene('An insufficient budget prevents the service call.');
  await page.waitForTimeout(5000);
  await page.locator('#budget').fill('0.02');
  await page.locator('#scenario').selectOption('uncertain');
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await page.getByRole('heading', { name: 'Payment needs a closer look' }).waitFor();
  scene('A simulated timeout holds the budget. No automatic second payment.');
  await page.waitForTimeout(6000);
  await page.locator('#mode').selectOption('live');
  await page.getByRole('button', { name: 'Get service quote' }).click();
  await page.getByRole('dialog').waitFor();
  scene('This is a real unpaid provider quote. Signing is disabled; no funds move.');
  await page.waitForTimeout(7000);
  writeFileSync(
    join(dir, 'demo-scenes.json'),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        scenes,
        realPayments: 0,
        realWalletSignatures: 0,
        disclosure:
          'Fixture product flow followed by real unsigned quote. Not evidence of mainnet settlement.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  failure = error;
  console.error('Demo recording failed; do not treat the partial recording as a complete walkthrough.');
} finally {
  const video = page.video();
  await context.close();
  if (video) await video.saveAs(join(dir, 'product-demo.webm'));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(failure ? 1 : 0);
}
