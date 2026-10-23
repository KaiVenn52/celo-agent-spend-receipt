import { digest, atomic } from './ledger.mjs';
import { keccak256, toHex } from 'viem';
export const ENDPOINT = 'https://gateway.usebuy.ai/chainstack/celo';
export const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const fixtureProvider = {
  async pay(request) {
    return {
      fixture: true,
      result: {
        summary: 'Fixture wallet check completed. No provider was called and no payment was made.',
        rpc: request.body.map((item) => ({
          id: item.id,
          result:
            item.method === 'eth_chainId'
              ? '0xa4ec'
              : item.method === 'eth_getBalance'
                ? '0x16345785d8a0000'
                : '0x2a',
        })),
      },
    };
  },
};
export function walletRequest(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw Error('Enter a valid EVM wallet address');
  return {
    url: ENDPOINT,
    method: 'POST',
    body: [
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: [address, 'latest'] },
      { jsonrpc: '2.0', id: 3, method: 'eth_getTransactionCount', params: [address, 'latest'] },
    ],
  };
}
export function fixtureQuote(request) {
  return {
    amount: '10000',
    token: 'USDC',
    chainId: 42220,
    payTo: '0x1111111111111111111111111111111111111111',
    mode: 'fixture',
    requestHash: digest(request),
    expiresAt: Date.now() + 300000,
  };
}
export async function unpaidQuote(request, payer, fetcher = fetch) {
  if (request.url !== ENDPOINT || request.method !== 'POST' || !/^0x[0-9a-fA-F]{40}$/.test(payer))
    throw Error('Unsupported request or missing payer');
  const response = await fetcher(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (response.status !== 402) throw Error('Expected an unpaid HTTP 402 challenge');
  const envelope = await response.json();
  if (envelope.x402Version !== 1 || !Array.isArray(envelope.accepts))
    throw Error('Unsupported x402 challenge version');
  const selected = envelope.accepts.find(
    (r) =>
      r.scheme === 'exact' &&
      ['celo', 'eip155:42220'].includes(r.network) &&
      r.asset?.toLowerCase() === USDC.toLowerCase(),
  );
  if (!selected || !/^0x[0-9a-fA-F]{40}$/.test(selected.payTo))
    throw Error('No supported Celo USDC requirement');
  atomic(selected.maxAmountRequired);
  return {
    amount: selected.maxAmountRequired,
    token: 'USDC',
    asset: USDC,
    chainId: 42220,
    payTo: selected.payTo,
    payer,
    mode: 'live',
    requestHash: digest(request),
    expiresAt: Date.now() + 60000,
    challengeHash: digest(envelope),
    requirements: selected,
  };
}
export function chainVerifier(rpc, fetcher = fetch) {
  if (new URL(rpc).protocol !== 'https:') throw Error('HTTPS RPC required');
  let seq = 0;
  async function call(method, params = []) {
    const r = await fetcher(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error('RPC HTTP failure');
    const data = await r.json();
    if (data.error || data.result === undefined) throw Error('RPC rejected verification');
    return data.result;
  }
  return async (tx, quote) => {
    if (
      !/^0x[0-9a-fA-F]{64}$/.test(tx) ||
      !/^0x[0-9a-fA-F]{40}$/.test(quote.payer || '') ||
      quote.asset?.toLowerCase() !== USDC.toLowerCase()
    )
      throw Error('Invalid receipt binding');
    if (BigInt(await call('eth_chainId')) !== 42220n) throw Error('Wrong chain');
    const receipt = await call('eth_getTransactionReceipt', [tx]);
    if (!receipt || receipt.status !== '0x1' || receipt.transactionHash.toLowerCase() !== tx.toLowerCase())
      throw Error('Transaction pending, failed, or mismatched');
    const tip = BigInt(await call('eth_blockNumber'));
    if (tip - BigInt(receipt.blockNumber) < 2n) throw Error('Wait for three block confirmations');
    const block = await call('eth_getBlockByNumber', [receipt.blockNumber, false]);
    if (!block || block.hash !== receipt.blockHash) throw Error('Receipt is not in the canonical block');
    const topicAddress = (t) => '0x' + t.slice(-40).toLowerCase();
    const log = receipt.logs.find(
      (l) =>
        !l.removed &&
        l.address.toLowerCase() === USDC.toLowerCase() &&
        l.topics.length === 3 &&
        l.topics[0] === TRANSFER &&
        topicAddress(l.topics[1]) === quote.payer.toLowerCase() &&
        topicAddress(l.topics[2]) === quote.payTo.toLowerCase() &&
        BigInt(l.data) === BigInt(quote.amount),
    );
    if (!log) throw Error('No exact USDC transfer from approved payer to provider');
    if (quote.authorizationNonce) {
      const used = receipt.logs.some(
        (l) =>
          !l.removed &&
          l.address.toLowerCase() === USDC.toLowerCase() &&
          l.topics[0] === keccak256(toHex('AuthorizationUsed(address,bytes32)')) &&
          l.topics.length === 3 &&
          topicAddress(l.topics[1]) === quote.payer.toLowerCase() &&
          l.topics[2].toLowerCase() === quote.authorizationNonce.toLowerCase(),
      );
      if (!used) throw Error('Transaction does not contain this task authorization nonce');
    }
    return {
      verified: true,
      level: quote.authorizationNonce ? 'rpc-transfer-and-task-nonce' : 'rpc-observed-transfer',
      authorizationNonce: quote.authorizationNonce || null,
      chainId: 42220,
      tx: tx.toLowerCase(),
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      logIndex: log.logIndex,
      confirmations: Number(tip - BigInt(receipt.blockNumber) + 1n),
      limitation: 'Payment evidence does not prove useful service delivery or independent-user eligibility.',
    };
  };
}
