// Full browser -> SDK -> signature -> ledger -> provider -> reconcile flow.
// Every provider/RPC response is injected; the ephemeral test signer is never funded.
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Ledger, digest } from '../src/ledger.mjs';
import { createApp } from '../src/server.mjs';
import { Payments } from '../src/payments.mjs';
import { ENDPOINT, USDC } from '../src/providers.mjs';
const account = privateKeyToAccount('0x' + randomBytes(32).toString('hex')),
  tx = '0x' + 'a'.repeat(64),
  payTo = '0x2222222222222222222222222222222222222222';
const ledger = new Ledger();
let sends = 0;
const payments = new Payments(ledger, {
  readBalance: async () => 1000000n,
  quote: async (request, payer) => ({
    mode: 'live',
    chainId: 42220,
    token: 'USDC',
    asset: USDC,
    amount: '10000',
    payer,
    payTo,
    expiresAt: Date.now() + 60000,
    requestHash: digest(request),
    requirements: {
      scheme: 'exact',
      network: 'celo',
      maxAmountRequired: '10000',
      resource: ENDPOINT,
      payTo,
      asset: USDC,
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' },
    },
  }),
  fetcher: async (url, options) => {
    sends++;
    assert.equal(url, ENDPOINT);
    const payload = JSON.parse(Buffer.from(options.headers['X-PAYMENT'], 'base64').toString());
    assert.equal(payload.payload.authorization.from.toLowerCase(), account.address.toLowerCase());
    return new Response(
      JSON.stringify([
        { id: 1, result: '0xa4ec' },
        { id: 2, result: '0x16345785d8a0000' },
        { id: 3, result: '0x2a' },
      ]),
      {
        status: 200,
        headers: {
          'x-payment-response': Buffer.from(JSON.stringify({ transaction: tx, success: true })).toString(
            'base64',
          ),
        },
      },
    );
  },
});
const server = createApp(ledger, {
  payments,
  paymentsEnabled: true,
  verifier: async (hash, quote) => {
    assert.equal(hash, tx);
    assert.ok(quote.authorizationNonce);
    return {
      verified: true,
      tx: hash,
      chainId: 42220,
      level: 'injected-browser-test-only',
      authorizationNonce: quote.authorizationNonce,
    };
  },
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32'
    ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }
    : {}),
});
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.exposeFunction('__signFixture', async (data) => account.signTypedData(JSON.parse(data)));
await page.addInitScript(
  ({ address }) => {
    window.ethereum = {
      on() {},
      async request({ method, params }) {
        if (method === 'eth_requestAccounts') return [address];
        if (method === 'eth_chainId') return '0xa4ec';
        if (method === 'eth_signTypedData_v4') return window.__signFixture(params[1]);
        throw Error('Unexpected test wallet method ' + method);
      },
    };
  },
  { address: account.address },
);
let failure;
try {
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.locator('#mode').selectOption('live');
  await page.getByRole('button', { name: 'Get service quote' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Sign & pay with wallet' }).click();
  await page.getByText('TRANSFER + NONCE VERIFIED', { exact: true }).waitFor();
  assert.equal(sends, 1);
  assert.equal(await page.locator('#spent').textContent(), '0.010000');
  assert.equal(await page.locator('#reserved').textContent(), '0.000000');
  assert.deepEqual(errors, []);
  const id = new URL(page.url()).searchParams.get('task');
  assert.equal(ledger.snapshot(id).calls.length, 1);
  assert.equal(ledger.snapshot(id).calls[0].evidence.level, 'injected-browser-test-only');
  mkdirSync('evidence', { recursive: true });
  writeFileSync(
    'evidence/ui-live-injected.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        passed: true,
        transport: 'injected provider and verifier only',
        signer: 'ephemeral test account, never funded',
        signedRequestsToInjectedProvider: sends,
        mainnetPayments: 0,
        realUsers: 0,
        checks: [
          'Wallet connection',
          'Fixed quote review',
          'Official SDK unsigned payload',
          'Browser EIP-712 signature',
          'Server signer recovery',
          'Single paid transport invocation',
          'Independent reconciliation route',
          'Budget movement',
        ],
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('Injected browser signing flow passed; zero live network payments.');
} catch (e) {
  failure = e;
  console.error(e);
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  await new Promise((r) => server.close(r));
  ledger.close();
  process.exit(failure ? 1 : 0);
}
