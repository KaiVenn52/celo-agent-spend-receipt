import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import { Ledger, digest } from '../src/ledger.mjs';
import { Payments, assertRequirement } from '../src/payments.mjs';
import { ENDPOINT, USDC } from '../src/providers.mjs';
// Ephemeral test account. Never funded, persisted, or used with a live transport.
const account = privateKeyToAccount('0x' + randomBytes(32).toString('hex'));
const payTo = '0x2222222222222222222222222222222222222222';
const quote = async (request, payer) => ({
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
});
function setup(
  fetcher = async () => {
    throw Error('injected timeout');
  },
) {
  const ledger = new Ledger(),
    payments = new Payments(ledger, { quote, fetcher, readBalance: async () => 1000000n });
  return { ledger, payments };
}
const input = { address: payTo, payer: account.address, budget: '20000' };
test('official SDK prepares exact unsigned EIP-3009 and reserves atomic budget', async () => {
  const { ledger, payments } = setup();
  const p = await payments.create(input, 'alice');
  const prepared = await payments.prepare(p.id, 'alice');
  assert.equal(prepared.typedData.message.to.toLowerCase(), payTo.toLowerCase());
  assert.equal(prepared.typedData.message.value, '10000');
  assert.equal(prepared.typedData.domain.chainId, 42220);
  assert.equal(prepared.typedData.domain.verifyingContract.toLowerCase(), USDC.toLowerCase());
  assert.equal(prepared.task.reserved, 10000);
  assert.equal(prepared.task.calls[0].state, 'AWAITING_SIGNATURE');
  assert.equal(
    ledger.db.prepare('SELECT payload FROM proposals').get().payload.includes('"signature":"0x"'),
    true,
  );
  ledger.close();
});
test('repeated and concurrent prepares preserve one authorization nonce', async () => {
  const { ledger, payments } = setup();
  const p = await payments.create(input, 'alice');
  const [a, b] = await Promise.all([payments.prepare(p.id, 'alice'), payments.prepare(p.id, 'alice')]);
  assert.equal(a.typedData.message.nonce, b.typedData.message.nonce);
  assert.equal(ledger.snapshot(p.id).calls.length, 1);
  ledger.close();
});
test('real SDK signature is recovered and signed transport is invoked exactly once', async () => {
  let count = 0;
  const { ledger, payments } = setup(async (url, options) => {
    count++;
    assert.equal(url, ENDPOINT);
    const payload = JSON.parse(Buffer.from(options.headers['X-PAYMENT'], 'base64').toString());
    assert.equal(payload.payload.authorization.nonce, prepared.typedData.message.nonce);
    assert.equal(payload.payload.authorization.value, '10000');
    const signer = await recoverTypedDataAddress({
      ...prepared.typedData,
      signature: payload.payload.signature,
    });
    assert.equal(signer.toLowerCase(), account.address.toLowerCase());
    return new Response(JSON.stringify([{ id: 1, result: '0xa4ec' }]), {
      status: 200,
      headers: {
        'x-payment-response': Buffer.from(
          JSON.stringify({ success: true, transaction: '0x' + 'a'.repeat(64) }),
        ).toString('base64'),
      },
    });
  });
  const p = await payments.create(input, 'alice');
  const prepared = await payments.prepare(p.id, 'alice');
  const signature = await account.signTypedData(prepared.typedData);
  const result = await payments.submit(p.id, 'alice', signature);
  assert.equal(count, 1);
  assert.equal(result.calls[0].state, 'UNKNOWN');
  assert.equal(result.spent, 0);
  assert.equal(result.reserved, 10000);
  await assert.rejects(payments.submit(p.id, 'alice', signature), /already used/);
  assert.equal(count, 1);
  ledger.close();
});
test('wrong signer never reaches payment transport', async () => {
  let count = 0;
  const { ledger, payments } = setup(async () => count++);
  const p = await payments.create(input, 'alice'),
    prepared = await payments.prepare(p.id, 'alice');
  const other = privateKeyToAccount('0x' + randomBytes(32).toString('hex'));
  await assert.rejects(
    payments.submit(p.id, 'alice', await other.signTypedData(prepared.typedData)),
    /approved payer/,
  );
  assert.equal(count, 0);
  ledger.close();
});
test('timeout after signed request retains full budget and cannot be replayed', async () => {
  let count = 0;
  const { ledger, payments } = setup(async () => {
    count++;
    throw Error('injected timeout after possible settlement');
  });
  const p = await payments.create(input, 'alice'),
    prepared = await payments.prepare(p.id, 'alice'),
    signature = await account.signTypedData(prepared.typedData);
  const result = await payments.submit(p.id, 'alice', signature);
  assert.equal(result.calls[0].state, 'UNKNOWN');
  assert.equal(result.reserved, 10000);
  await assert.rejects(payments.submit(p.id, 'alice', signature));
  assert.equal(count, 1);
  assert.ok(result.calls[0].evidence.authorization.nonce);
  ledger.close();
});
test('unsigned cancellation releases budget and prevents later submission', async () => {
  const { ledger, payments } = setup();
  const p = await payments.create(input, 'alice'),
    prepared = await payments.prepare(p.id, 'alice');
  const result = payments.cancel(p.id, 'alice');
  assert.equal(result.reserved, 0);
  assert.equal(result.calls[0].state, 'CANCELLED');
  await assert.rejects(payments.submit(p.id, 'alice', await account.signTypedData(prepared.typedData)));
  ledger.close();
});
test('cross-session proposal reads and insufficient budget are refused', async () => {
  const { ledger, payments } = setup();
  const p = await payments.create(input, 'alice');
  assert.throws(() => payments.proposal(p.id, 'bob'), /not found/);
  await assert.rejects(payments.create({ ...input, budget: '1' }, 'alice'), /Budget exceeded/);
  ledger.close();
});
test('quote drift is rejected before any wallet signing', async () => {
  const { ledger } = setup();
  let calls = 0;
  const payments = new Payments(ledger, {
    quote: async (...args) => {
      const q = await quote(...args);
      if (calls++) q.payTo = '0x3333333333333333333333333333333333333333';
      return q;
    },
  });
  const p = await payments.create(input, 'alice');
  await assert.rejects(payments.prepare(p.id, 'alice'), /changed/);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n, 0);
  ledger.close();
});
test('malformed token domains, alternative resources and long authorizations fail closed', async () => {
  const q = await quote({ url: ENDPOINT }, account.address);
  for (const change of [
    { network: 'base' },
    { resource: 'https://evil.example' },
    { maxTimeoutSeconds: 3600 },
    { extra: { name: 'USD Coin', version: '2' } },
  ])
    assert.throws(() => assertRequirement({ ...q, requirements: { ...q.requirements, ...change } }));
});
test('insufficient token balance fails before authorization or reservation', async () => {
  const ledger = new Ledger(),
    payments = new Payments(ledger, { quote, readBalance: async () => 0n });
  const p = await payments.create(input, 'alice');
  await assert.rejects(payments.prepare(p.id, 'alice'), /Insufficient Celo USDC balance/);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n, 0);
  assert.equal(payments.proposal(p.id, 'alice').typed, null);
  ledger.close();
});
test('simultaneous signed submissions send at most once across the async verifier', async () => {
  let count = 0;
  const { ledger, payments } = setup(async () => {
    count++;
    return new Response('{}', { status: 500 });
  });
  const p = await payments.create(input, 'alice'),
    prepared = await payments.prepare(p.id, 'alice'),
    signature = await account.signTypedData(prepared.typedData);
  const results = await Promise.allSettled([
    payments.submit(p.id, 'alice', signature),
    payments.submit(p.id, 'alice', signature),
  ]);
  assert.equal(count, 1);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(ledger.snapshot(p.id).reserved, 10000);
  ledger.close();
});
