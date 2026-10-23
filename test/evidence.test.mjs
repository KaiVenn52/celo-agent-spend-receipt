import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import {
  verifyIdentityEvidence,
  verifyPaymentArtifact,
  verifyIndependentUserEvidence,
  REGISTERED_EVENT,
} from '../src/evidence.mjs';
import { IDENTITY_REGISTRY } from '../src/identity.mjs';
import { walletRequest, USDC } from '../src/providers.mjs';
import { digest } from '../src/ledger.mjs';
const owner = '0x' + '1'.repeat(40),
  provider = '0x' + '2'.repeat(40),
  participant = '0x' + '3'.repeat(40),
  external = '0x' + '9'.repeat(40);
const tx = '0x' + 'a'.repeat(64),
  fundTx = '0x' + 'b'.repeat(64),
  nonce = '0x' + 'c'.repeat(64),
  blockHash = '0x' + 'd'.repeat(64);
function identityClient(change = {}) {
  const log = {
    address: IDENTITY_REGISTRY,
    topics: encodeEventTopics({
      abi: [REGISTERED_EVENT],
      eventName: 'Registered',
      args: { agentId: 7n, owner },
    }),
    data: encodeAbiParameters([{ type: 'string' }], ['https://example.com/agent.json']),
  };
  return {
    getChainId: async () => 42220,
    getBlockNumber: async () => 102n,
    getBlock: async () => ({ hash: blockHash }),
    getTransactionReceipt: async () => ({
      status: 'success',
      transactionHash: tx,
      blockNumber: 100n,
      blockHash,
      logs: [log],
    }),
    readContract: async () => owner,
    ...change,
  };
}
test('identity evidence checks official event, canonical block and current owner', async () => {
  const result = await verifyIdentityEvidence(identityClient(), {
    agentId: '7',
    owner,
    transaction: tx,
    agentURI: 'https://example.com/agent.json',
  });
  assert.equal(result.verified, true);
  assert.equal(result.agentId, '7');
  assert.equal(result.confirmations, 3);
});
test('identity evidence rejects wrong registry, changed ownership and pending confirmations', async () => {
  const base = identityClient(),
    receipt = await base.getTransactionReceipt();
  await assert.rejects(
    verifyIdentityEvidence(
      identityClient({
        getTransactionReceipt: async () => ({
          ...receipt,
          logs: receipt.logs.map((l) => ({ ...l, address: external })),
        }),
      }),
      { agentId: '7', owner, transaction: tx, agentURI: 'https://example.com/agent.json' },
    ),
    /Registered event/,
  );
  await assert.rejects(
    verifyIdentityEvidence(identityClient({ readContract: async () => external }), {
      agentId: '7',
      owner,
      transaction: tx,
      agentURI: 'https://example.com/agent.json',
    }),
    /current owner/,
  );
  await assert.rejects(
    verifyIdentityEvidence(identityClient({ getBlockNumber: async () => 100n }), {
      agentId: '7',
      owner,
      transaction: tx,
      agentURI: 'https://example.com/agent.json',
    }),
    /confirmations/,
  );
});
function paymentFixture() {
  const request = walletRequest(participant),
    quote = {
      mode: 'live',
      chainId: 42220,
      token: 'USDC',
      asset: USDC,
      payer: participant,
      payTo: provider,
      target: participant,
      amount: '10000',
      authorizationNonce: nonce,
      requestHash: digest(request),
    };
  return {
    record: { transaction: tx, payer: participant, providerPayTo: provider, authorizationNonce: nonce },
    artifact: {
      id: 'task',
      mode: 'live',
      calls: [
        {
          quote,
          result: [
            { id: 1, result: '0xa4ec' },
            { id: 2, result: '0x0' },
            { id: 3, result: '0x1' },
          ],
          evidence: { claimedTx: tx },
        },
      ],
    },
    verifier: async (hash, q) => ({
      verified: true,
      tx: hash,
      chainId: 42220,
      authorizationNonce: q.authorizationNonce,
    }),
  };
}
test('payment evidence binds real chain verification to one exported task and request', async () => {
  const { record, artifact, verifier } = paymentFixture();
  const result = await verifyPaymentArtifact(record, artifact, verifier);
  assert.equal(result.verified, true);
  assert.equal(result.artifactHash, digest(artifact));
  assert.equal(result.providerResultShapeValid, true);
});
test('fixture export and modified request cannot pass as mainnet evidence', async () => {
  const { record, artifact, verifier } = paymentFixture();
  await assert.rejects(verifyPaymentArtifact(record, { ...artifact, mode: 'fixture' }, verifier), /Fixture/);
  artifact.calls[0].quote.requestHash = 'changed';
  await assert.rejects(verifyPaymentArtifact(record, artifact, verifier), /fingerprint/);
});
test('wrong manifest payer, transaction or nonce is rejected', async () => {
  const { record, artifact, verifier } = paymentFixture();
  await assert.rejects(verifyPaymentArtifact({ ...record, payer: owner }, artifact, verifier), /differs/);
  await assert.rejects(
    verifyPaymentArtifact({ ...record, transaction: fundTx }, artifact, verifier),
    /differs/,
  );
  await assert.rejects(
    verifyPaymentArtifact({ ...record, authorizationNonce: fundTx }, artifact, verifier),
    /one exported task/,
  );
});
test('a structurally valid result cannot replace independent nonce verification', async () => {
  const { record, artifact } = paymentFixture();
  await assert.rejects(
    verifyPaymentArtifact(record, artifact, async () => ({
      verified: true,
      chainId: 42220,
      authorizationNonce: fundTx,
    })),
    /did not confirm/,
  );
});
const user = {
  wallet: participant,
  preEventTransaction: tx,
  firstFundingTransaction: fundTx,
  usageTransaction: tx,
  consent: true,
  relationshipDeclaration: 'independent',
  reviewed: true,
  firstFundingReviewed: true,
};
function userClient(change = {}) {
  return {
    getChainId: async () => 42220,
    getTransaction: async ({ hash }) =>
      hash === tx
        ? { hash, from: participant, to: provider, value: 0n }
        : { hash, from: external, to: participant, value: 1n },
    getTransactionReceipt: async ({ hash }) => ({
      transactionHash: hash,
      status: 'success',
      blockNumber: 100n,
      blockHash,
      logs: [],
    }),
    getBlock: async () => ({ hash: blockHash, timestamp: 1700000000n }),
    ...change,
  };
}
test('participant evidence keeps onchain facts and human independence review separate', async () => {
  const payment = { payer: participant, transaction: tx };
  const result = await verifyIndependentUserEvidence(userClient(), user, payment, [owner]);
  assert.equal(result.onchainChecksPassed, true);
  assert.equal(result.humanReviewComplete, true);
  const pending = await verifyIndependentUserEvidence(
    userClient(),
    { ...user, firstFundingReviewed: false },
    payment,
    [owner],
  );
  assert.equal(pending.onchainChecksPassed, true);
  assert.equal(pending.humanReviewComplete, false);
});
test('self wallets, builder funding and post-event activity cannot count', async () => {
  const payment = { payer: participant, transaction: tx };
  await assert.rejects(
    verifyIndependentUserEvidence(userClient(), user, payment, [participant]),
    /Builder-controlled/,
  );
  await assert.rejects(
    verifyIndependentUserEvidence(
      userClient({
        getTransaction: async ({ hash }) =>
          hash === tx ? { from: participant } : { from: owner, to: participant, value: 1n },
      }),
      user,
      payment,
      [owner],
    ),
    /funding came from/,
  );
  await assert.rejects(
    verifyIndependentUserEvidence(
      userClient({ getBlock: async () => ({ hash: blockHash, timestamp: 1900000000n }) }),
      user,
      payment,
      [owner],
    ),
    /before the event/,
  );
});
