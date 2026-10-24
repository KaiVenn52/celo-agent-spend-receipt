import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData } from 'viem';
import {
  identityRequest,
  reviewIdentityRegistration,
  IDENTITY_ABI,
  IDENTITY_REGISTRY,
} from '../src/identity.mjs';
test('identity transaction review pins registry, owner and metadata without signing', () => {
  const owner = '0x' + '1'.repeat(40),
    uri = 'https://example.com/agent.json',
    tx = identityRequest(owner, uri);
  assert.equal(tx.to, IDENTITY_REGISTRY);
  assert.equal(tx.chainId, '0xa4ec');
  assert.equal(tx.from, owner);
  assert.equal(tx.value, '0x0');
  assert.deepEqual(decodeFunctionData({ abi: IDENTITY_ABI, data: tx.data }).args, [uri]);
});

const identityClient = (overrides = {}) => ({
  getChainId: async () => 42220,
  getCode: async () => '0x1234',
  estimateGas: async () => 100001n,
  getGasPrice: async () => 200n,
  getBalance: async () => 0n,
  ...overrides,
});
test('identity review does not expose credential-bearing RPC errors', async () => {
  await assert.rejects(
    reviewIdentityRegistration(
      '0x' + '1'.repeat(40),
      'https://example.com/agent.json',
      identityClient({
        getChainId: async () => {
          throw Error('https://rpc.example/secret-api-key');
        },
      }),
    ),
    (error) => !error.message.includes('secret-api-key') && error.message.includes('no transaction was sent'),
  );
});
test('identity gas review keeps a zero-balance owner unsigned and applies rounded headroom', async () => {
  const result = await reviewIdentityRegistration(
    '0x' + '1'.repeat(40),
    'https://example.com/agent.json',
    identityClient(),
  );
  assert.equal(result.canAfford, false);
  assert.equal(result.gasLimit, '120002');
  assert.equal(result.transaction.gas, '0x1d4c2');
  assert.equal(result.signaturesCreated, 0);
  assert.equal(result.broadcasts, 0);
});
test('identity gas review accepts adequate balance without sending a transaction', async () => {
  const result = await reviewIdentityRegistration(
    '0x' + '1'.repeat(40),
    'https://example.com/agent.json',
    identityClient({ getBalance: async () => 10n ** 18n }),
  );
  assert.equal(result.canAfford, true);
  assert.equal(result.transaction.value, '0x0');
});
test('identity gas review refuses a different chain or absent registry code', async () => {
  await assert.rejects(
    reviewIdentityRegistration(
      '0x' + '1'.repeat(40),
      'https://example.com/agent.json',
      identityClient({ getChainId: async () => 1 }),
    ),
    /Celo/,
  );
  await assert.rejects(
    reviewIdentityRegistration(
      '0x' + '1'.repeat(40),
      'https://example.com/agent.json',
      identityClient({ getCode: async () => '0x' }),
    ),
    /registry/,
  );
});
test('identity review refuses absent owner, insecure metadata or embedded credentials', () => {
  for (const [owner, uri] of [
    ['bad', 'https://example.com'],
    ['0x' + '1'.repeat(40), 'http://example.com'],
    ['0x' + '1'.repeat(40), 'https://user:password@example.com'],
  ])
    assert.throws(() => identityRequest(owner, uri));
});
test('inline registration metadata does not require buying a hosting plan', () => {
  const data = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Agent Spend Receipt',
    services: [],
    active: false,
  };
  const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(data)).toString('base64');
  assert.equal(
    decodeFunctionData({ abi: IDENTITY_ABI, data: identityRequest('0x' + '1'.repeat(40), uri).data }).args[0],
    uri,
  );
  assert.throws(() => identityRequest('0x' + '1'.repeat(40), 'data:application/json;base64,e30='), /Invalid/);
});
