import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, atomic, decimal } from '../src/ledger.mjs';
import { walletRequest, fixtureQuote, fixtureProvider } from '../src/providers.mjs';
const address = '0x1111111111111111111111111111111111111111';
function setup(mode = 'fixture', budget = '20000') {
  const l = new Ledger();
  l.task('task', budget, mode);
  const r = walletRequest(address),
    q = { ...fixtureQuote(r), mode };
  return { l, r, q };
}
test('integer units reject decimals, negatives, zero, overflow and coercion', () => {
  for (const n of ['0', '-1', '1.2', '1e3', '1000000000000', 10000, null]) assert.throws(() => atomic(n));
  assert.equal(atomic('10000'), 10000);
  assert.equal(decimal('10000'), '0.010000');
});
test('wallet request validates addresses', () => assert.throws(() => walletRequest('bad')));
test('settled fixture consumes budget and labels its evidence', async () => {
  const { l, r, q } = setup();
  await l.execute('task', 'call', q, r, fixtureProvider);
  assert.equal(l.snapshot('task').available, 10000);
  assert.equal(l.get('call').evidence.verifiedOnchain, false);
  l.close();
});
test('same idempotency key executes provider once', async () => {
  const { l, r, q } = setup();
  let count = 0;
  const p = {
    pay: async () => {
      count++;
      return fixtureProvider.pay(r);
    },
  };
  await l.execute('task', 'call', q, r, p);
  await l.execute('task', 'call', q, r, p);
  assert.equal(count, 1);
  l.close();
});
test('changed quote on same idempotency key is rejected', async () => {
  const { l, r, q } = setup();
  await l.execute('task', 'call', q, r, fixtureProvider);
  assert.throws(() => l.reserve('task', 'call', { ...q, amount: '9999' }, r), /conflict/);
  l.close();
});
test('new id cannot bypass request deduplication', async () => {
  const { l, r, q } = setup();
  await l.execute('task', 'call', q, r, fixtureProvider);
  assert.throws(() => l.reserve('task', 'second', q, r), /UNIQUE/);
  l.close();
});
test('insufficient budget prevents provider execution', async () => {
  const { l, r, q } = setup('fixture', '9999');
  let count = 0;
  await assert.rejects(
    l.execute('task', 'call', q, r, {
      pay: async () => {
        count++;
      },
    }),
    /Budget/,
  );
  assert.equal(count, 0);
  l.close();
});
test('exact budget is accepted', async () => {
  const { l, r, q } = setup('fixture', '10000');
  await l.execute('task', 'call', q, r, fixtureProvider);
  assert.equal(l.snapshot('task').available, 0);
  l.close();
});
test('expired quote is rejected', () => {
  const { l, r, q } = setup();
  assert.throws(() => l.reserve('task', 'call', { ...q, expiresAt: 0 }, r), /expired/);
  l.close();
});
test('an identical completed request is recoverable after its quote expires', async () => {
  const { l, r, q } = setup();
  await l.execute('task', 'call', q, r, fixtureProvider);
  const recovered = l.reserve('task', 'call', q, r, q.expiresAt + 10000);
  assert.equal(recovered.created, false);
  assert.equal(recovered.call.state, 'SETTLED');
  assert.equal(l.snapshot('task').calls.length, 1);
  l.close();
});
test('modified request cannot reuse quote', () => {
  const { l, r, q } = setup();
  assert.throws(() => l.reserve('task', 'call', q, { ...r, body: [] }), /exact request/);
  l.close();
});
test('wrong chain and token are refused', () => {
  const { l, r, q } = setup();
  for (const change of [{ chainId: 1 }, { token: 'USDT' }, { payTo: 'invalid' }])
    assert.throws(() => l.reserve('task', 'call', { ...q, ...change }, r));
  l.close();
});
test('fixture evidence cannot enter a live task', () => {
  const { l, r, q } = setup('live');
  assert.throws(() => l.reserve('task', 'call', { ...q, mode: 'fixture' }, r), /mode mismatch/);
  l.close();
});
test('timeout reserves full budget and replay does not retry', async () => {
  const { l, r, q } = setup();
  let count = 0;
  const p = {
    pay: async () => {
      count++;
      throw Error('timeout');
    },
  };
  await l.execute('task', 'call', q, r, p);
  await l.execute('task', 'call', q, r, p);
  assert.equal(count, 1);
  assert.equal(l.snapshot('task').reserved, 10000);
  assert.equal(l.snapshot('task').spent, 0);
  l.close();
});
test('explicit unsettled failure releases budget but remains deduplicated', async () => {
  const { l, r, q } = setup();
  await l.execute('task', 'call', q, r, { pay: async () => ({ paymentSettled: false, definitive: true }) });
  assert.equal(l.get('call').state, 'FAILED');
  assert.equal(l.snapshot('task').available, 20000);
  l.close();
});
test('non-definitive rejection does not release budget', async () => {
  const { l, r, q } = setup('live');
  await l.execute('task', 'call', q, r, { pay: async () => ({ paymentSettled: false }) });
  assert.equal(l.get('call').state, 'UNKNOWN');
  l.close();
});
test('live provider claim is never automatically verified', async () => {
  const { l, r, q } = setup('live');
  await l.execute('task', 'call', q, r, { pay: async () => ({ tx: '0x123', result: 'OK' }) });
  assert.equal(l.get('call').state, 'UNKNOWN');
  l.close();
});
test('concurrent distinct calls cannot overrun a budget', async () => {
  const { l, r, q } = setup('fixture', '10000');
  let finish;
  const pending = l.execute('task', 'one', q, r, { pay: () => new Promise((resolve) => (finish = resolve)) });
  const other = walletRequest('0x2222222222222222222222222222222222222222');
  await assert.rejects(l.execute('task', 'two', fixtureQuote(other), other, fixtureProvider), /Budget/);
  finish({ fixture: true, result: 'ok' });
  await pending;
  l.close();
});
test('restart converts in-flight payment to UNKNOWN and retains budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asr-'));
  try {
    const path = join(dir, 'ledger.db');
    let l = new Ledger(path);
    l.task('task', '10000');
    const r = walletRequest(address);
    l.reserve('task', 'call', fixtureQuote(r), r);
    l.close();
    l = new Ledger(path);
    assert.equal(l.get('call').state, 'UNKNOWN');
    assert.equal(l.snapshot('task').available, 0);
    l.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('task policy cannot be enlarged after creation', () => {
  const { l } = setup();
  assert.throws(() => l.task('task', '999999'), /another policy/);
  l.close();
});
test('forged reconciliation fails closed', async () => {
  const { l, r, q } = setup('live');
  await l.execute('task', 'call', q, r, { pay: async () => ({}) });
  await assert.rejects(
    l.reconcile('call', '0xabc', async () => ({ verified: false })),
    /verification failed/,
  );
  assert.equal(l.snapshot('task').reserved, 10000);
  l.close();
});
test('verified transfer consumes reserved budget; same tx cannot be reused', async () => {
  const { l, r, q } = setup('live');
  const tx = '0x' + 'a'.repeat(64);
  await l.execute('task', 'call', q, r, { pay: async () => ({}) });
  const verify = async (t) => ({ verified: true, chainId: 42220, tx: t });
  await l.reconcile('call', tx, verify);
  assert.equal(l.snapshot('task').spent, 10000);
  l.task('other', '20000', 'live');
  await l.execute('other', 'second', q, r, { pay: async () => ({}) });
  await assert.rejects(l.reconcile('second', tx, verify), /UNIQUE/);
  assert.equal(l.get('second').state, 'UNKNOWN');
  l.close();
});
