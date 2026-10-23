import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData } from 'viem';
import { identityRequest, IDENTITY_ABI, IDENTITY_REGISTRY } from '../src/identity.mjs';
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
