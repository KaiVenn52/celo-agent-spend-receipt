import test from 'node:test';
import assert from 'node:assert/strict';
import { walletRequest, unpaidQuote, chainVerifier, USDC, TRANSFER } from '../src/providers.mjs';
import { keccak256, toHex } from 'viem';
const payer = '0x1111111111111111111111111111111111111111',
  payTo = '0x2222222222222222222222222222222222222222',
  tx = '0x' + 'a'.repeat(64);
const requirement = { scheme: 'exact', network: 'celo', asset: USDC, payTo, maxAmountRequired: '10000' };
test('unpaid quote reads real x402 v1 shape without signing', async () => {
  let request;
  const q = await unpaidQuote(walletRequest(payer), payer, async (url, opts) => {
    request = opts;
    return { status: 402, json: async () => ({ x402Version: 1, accepts: [requirement] }) };
  });
  assert.equal(q.amount, '10000');
  assert.equal(q.payer, payer);
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(Object.keys(request.headers).length, 1);
});
test('unpaid quote refuses wrong network, token, version and HTTP status', async () => {
  for (const data of [
    { x402Version: 2, accepts: [requirement] },
    { x402Version: 1, accepts: [{ ...requirement, network: 'base' }] },
    { x402Version: 1, accepts: [{ ...requirement, asset: payTo }] },
  ])
    await assert.rejects(
      unpaidQuote(walletRequest(payer), payer, async () => ({ status: 402, json: async () => data })),
    );
  await assert.rejects(unpaidQuote(walletRequest(payer), payer, async () => ({ status: 200 })));
});
function fixture(overrides = {}) {
  const log = {
    address: USDC,
    topics: [TRANSFER, '0x' + payer.slice(2).padStart(64, '0'), '0x' + payTo.slice(2).padStart(64, '0')],
    data: '0x2710',
    logIndex: '0x0',
  };
  const receipt = {
    transactionHash: tx,
    status: '0x1',
    blockNumber: '0x64',
    blockHash: '0xblock',
    logs: [log],
    ...overrides,
  };
  return async (url, options) => {
    const { method } = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        result: {
          eth_chainId: '0xa4ec',
          eth_getTransactionReceipt: receipt,
          eth_blockNumber: '0x66',
          eth_getBlockByNumber: { hash: '0xblock' },
        }[method],
      }),
    };
  };
}
const q = { asset: USDC, payer, payTo, amount: '10000' };
test('verifier checks exact transfer and canonical confirmations', async () => {
  const evidence = await chainVerifier('https://example.com', fixture())(tx, q);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.confirmations, 3);
  assert.equal(evidence.level, 'rpc-observed-transfer');
});
test('verifier refuses failed tx, wrong recipient, sender and amount', async () => {
  await assert.rejects(chainVerifier('https://example.com', fixture({ status: '0x0' }))(tx, q));
  for (const change of [{ payTo: payer }, { payer: payTo }, { amount: '10001' }, { asset: payTo }])
    await assert.rejects(chainVerifier('https://example.com', fixture())(tx, { ...q, ...change }));
});
test('verifier refuses pending and reorganized transactions', async () => {
  await assert.rejects(
    chainVerifier('https://example.com', fixture({ blockNumber: '0x66' }))(tx, q),
    /confirmations/,
  );
  await assert.rejects(
    chainVerifier('https://example.com', fixture({ blockHash: '0xwrong' }))(tx, q),
    /canonical/,
  );
});
test('verifier rejects wrong chain and RPC errors', async () => {
  await assert.rejects(
    chainVerifier('https://example.com', async () => ({ ok: true, json: async () => ({ result: '0x1' }) }))(
      tx,
      q,
    ),
    /Wrong chain/,
  );
  await assert.rejects(chainVerifier('https://example.com', async () => ({ ok: false }))(tx, q), /HTTP/);
});
test('a transfer from another task cannot pass without the exact authorization nonce', async () => {
  const nonce = '0x' + 'b'.repeat(64);
  await assert.rejects(
    chainVerifier('https://example.com', fixture())(tx, { ...q, authorizationNonce: nonce }),
    /task authorization nonce/,
  );
  const mock = fixture(),
    fetcher = async (url, options) => {
      const r = await mock(url, options);
      const data = await r.json();
      if (JSON.parse(options.body).method === 'eth_getTransactionReceipt')
        data.result.logs.push({
          address: USDC,
          topics: [
            keccak256(toHex('AuthorizationUsed(address,bytes32)')),
            '0x' + payer.slice(2).padStart(64, '0'),
            nonce,
          ],
        });
      return { ok: true, json: async () => data };
    };
  const result = await chainVerifier('https://example.com', fetcher)(tx, { ...q, authorizationNonce: nonce });
  assert.equal(result.level, 'rpc-transfer-and-task-nonce');
});
