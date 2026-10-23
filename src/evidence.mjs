import { isAddress, parseEventLogs, keccak256, toHex } from 'viem';
import { IDENTITY_REGISTRY } from './identity.mjs';
import { digest } from './ledger.mjs';
import { walletRequest, USDC, TRANSFER } from './providers.mjs';

export const REGISTERED_EVENT = {
  type: 'event',
  name: 'Registered',
  inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'agentURI', type: 'string', indexed: false },
    { name: 'owner', type: 'address', indexed: true },
  ],
};
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hash = (value) => /^0x[0-9a-fA-F]{64}$/.test(value || '');
function invalid(message) {
  const error = Error(message);
  error.safe = true;
  throw error;
}

export async function verifyIdentityEvidence(client, record) {
  if (
    !hash(record.transaction) ||
    !isAddress(record.owner || '') ||
    typeof record.agentURI !== 'string' ||
    !record.agentURI ||
    !/^\d+$/.test(String(record.agentId ?? ''))
  )
    invalid('Provide the actual identity transaction, owner, numeric Agent ID and approved metadata URI');
  if ((await client.getChainId()) !== 42220) invalid('Identity proof is not on Celo mainnet');
  const receipt = await client.getTransactionReceipt({ hash: record.transaction });
  if (receipt.status !== 'success' || !same(receipt.transactionHash, record.transaction))
    invalid('Identity registration did not succeed');
  const tip = await client.getBlockNumber();
  if (tip - receipt.blockNumber < 2n) invalid('Identity transaction needs three confirmations');
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (!same(block.hash, receipt.blockHash)) invalid('Identity receipt is not in the canonical block');
  const logs = receipt.logs.filter((log) => !log.removed && same(log.address, IDENTITY_REGISTRY));
  const events = parseEventLogs({ abi: [REGISTERED_EVENT], eventName: 'Registered', logs, strict: true });
  const found = events.find(
    (event) => event.args.agentId === BigInt(record.agentId) && same(event.args.owner, record.owner),
  );
  if (!found) invalid('Agent ID and owner do not match a Registered event from the official registry');
  if (found.args.agentURI !== record.agentURI)
    invalid('Registered metadata URI differs from the approved project identity');
  const currentOwner = await client.readContract({
    address: IDENTITY_REGISTRY,
    abi: [
      {
        type: 'function',
        name: 'ownerOf',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [{ name: 'owner', type: 'address' }],
      },
    ],
    functionName: 'ownerOf',
    args: [BigInt(record.agentId)],
  });
  if (!same(currentOwner, record.owner)) invalid('Agent identity has a different current owner');
  return {
    verified: true,
    level: 'rpc-registry-event-and-current-owner',
    chainId: 42220,
    registry: IDENTITY_REGISTRY,
    agentId: String(record.agentId),
    owner: record.owner,
    transaction: record.transaction,
    agentURI: found.args.agentURI,
    blockHash: receipt.blockHash,
    confirmations: Number(tip - receipt.blockNumber + 1n),
  };
}

export async function verifyPaymentArtifact(record, artifact, verifier) {
  if (
    !hash(record.transaction) ||
    !isAddress(record.payer || '') ||
    !isAddress(record.providerPayTo || '') ||
    !hash(record.authorizationNonce)
  )
    invalid('Provide the actual payment transaction, payer, provider PayTo and task nonce');
  if (artifact.mode !== 'live' || !Array.isArray(artifact.calls))
    invalid('Fixture exports cannot be used as mainnet payment evidence');
  const matches = artifact.calls.filter((call) =>
    same(call.quote?.authorizationNonce, record.authorizationNonce),
  );
  if (matches.length !== 1) invalid('Exactly one exported task call must match the authorization nonce');
  const call = matches[0],
    quote = call.quote;
  if (
    quote.mode !== 'live' ||
    quote.chainId !== 42220 ||
    quote.token !== 'USDC' ||
    !same(quote.asset, USDC) ||
    !same(quote.payer, record.payer) ||
    !same(quote.payTo, record.providerPayTo)
  )
    invalid('Payment manifest differs from the exported approved quote');
  if (call.tx && !same(call.tx, record.transaction))
    invalid('Exported settlement transaction differs from the manifest');
  if (call.evidence?.claimedTx && !same(call.evidence.claimedTx, record.transaction))
    invalid('Provider transaction claim differs from the manifest');
  if (quote.requestHash !== digest(walletRequest(quote.target)))
    invalid('Exported request fingerprint does not match the nominated wallet operation');
  const payment = await verifier(record.transaction.toLowerCase(), quote);
  if (
    payment.verified !== true ||
    payment.chainId !== 42220 ||
    !same(payment.authorizationNonce, record.authorizationNonce)
  )
    invalid('Independent payment verifier did not confirm this task nonce');
  const result = call.result?.rpc || call.result;
  const resultShapeValid =
    Array.isArray(result) &&
    [1, 2, 3].every((id) =>
      result.some((row) => row.id === id && /^0x[0-9a-fA-F]+$/.test(row.result || '') && !row.error),
    ) &&
    BigInt(result.find((row) => row.id === 1)?.result || '0x0') === 42220n;
  return {
    verified: true,
    level: 'export-bound-transfer-and-task-nonce',
    artifactHash: digest(artifact),
    taskId: artifact.id,
    requestHash: quote.requestHash,
    payment,
    providerResultShapeValid: resultShapeValid,
    limitation:
      'Result structure is not proof of useful delivery. Independent-user status and user benefit still require separate reviewed evidence.',
  };
}

export async function verifyIndependentUserEvidence(client, user, payment, builderWallets = []) {
  if (
    !isAddress(user.wallet || '') ||
    ![user.preEventTransaction, user.firstFundingTransaction, user.usageTransaction].every(hash)
  )
    invalid('Independent-user review needs a wallet and three real evidence transactions');
  if (builderWallets.some((address) => same(address, user.wallet)))
    invalid('Builder-controlled wallets cannot count as independent users');
  if (!same(payment.payer, user.wallet) || !same(payment.transaction, user.usageTransaction))
    invalid('Usage must match this product payment authorized by the participant wallet');
  if ((await client.getChainId()) !== 42220) invalid('Participant proof is not on Celo mainnet');
  const [prior, priorReceipt, funding, fundingReceipt] = await Promise.all([
    client.getTransaction({ hash: user.preEventTransaction }),
    client.getTransactionReceipt({ hash: user.preEventTransaction }),
    client.getTransaction({ hash: user.firstFundingTransaction }),
    client.getTransactionReceipt({ hash: user.firstFundingTransaction }),
  ]);
  if (priorReceipt.status !== 'success' || fundingReceipt.status !== 'success')
    invalid('Prior activity and funding evidence must be successful');
  const block = await client.getBlock({ blockNumber: priorReceipt.blockNumber });
  if (
    !same(block.hash, priorReceipt.blockHash) ||
    block.timestamp >= BigInt(Date.parse('2026-10-06T00:00:00Z') / 1000)
  )
    invalid('Participant activity is not canonical activity before the event');
  const topicAddress = (topic) => '0x' + String(topic).slice(-40);
  const authorized = priorReceipt.logs.some(
    (log) =>
      !log.removed &&
      same(log.address, USDC) &&
      log.topics[0] === keccak256(toHex('AuthorizationUsed(address,bytes32)')) &&
      same(topicAddress(log.topics[1]), user.wallet),
  );
  if (!same(prior.from, user.wallet) && !authorized)
    invalid('The pre-event transaction does not show this wallet signing or authorizing activity');
  const sources = [];
  if (same(funding.to, user.wallet) && funding.value > 0n) sources.push(funding.from);
  for (const log of fundingReceipt.logs) {
    if (
      !log.removed &&
      same(log.address, USDC) &&
      log.topics[0] === TRANSFER &&
      same(topicAddress(log.topics[2]), user.wallet) &&
      BigInt(log.data) > 0n
    )
      sources.push(topicAddress(log.topics[1]));
  }
  if (!sources.length)
    invalid('Funding record does not show positive native CELO or supported USDC reaching this wallet');
  if (sources.some((source) => builderWallets.some((builder) => same(source, builder))))
    invalid('Recorded funding came from a builder or main-funder wallet');
  const humanReview =
    user.reviewed === true &&
    user.consent === true &&
    user.relationshipDeclaration === 'independent' &&
    user.firstFundingReviewed === true;
  return {
    onchainChecksPassed: true,
    humanReviewComplete: humanReview,
    wallet: user.wallet,
    preEventTransaction: user.preEventTransaction,
    preEventTimestamp: String(block.timestamp),
    fundingSources: [...new Set(sources)],
    usageTransaction: user.usageTransaction,
    limitation:
      'RPC proves the supplied transactions, not that the selected funding transaction was the first or that people are unrelated. Human review and organizer eligibility judgment remain necessary.',
  };
}
