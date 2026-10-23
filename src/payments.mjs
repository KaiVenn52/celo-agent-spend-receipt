import { buildPayment, encodePaymentHeader, decodePaymentResponseHeader } from '@celo/buy-core/x402';
import { recoverTypedDataAddress, createPublicClient, http } from 'viem';
import { randomUUID } from 'node:crypto';
import { digest, atomic } from './ledger.mjs';
import { ENDPOINT, USDC, walletRequest, unpaidQuote } from './providers.mjs';
const serialize = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
export async function celoUsdcBalance(payer) {
  const client = createPublicClient({
    transport: http(process.env.CELO_RPC_URL || 'https://forno.celo.org', { timeout: 15000, retryCount: 0 }),
  });
  try {
    if ((await client.getChainId()) !== 42220) throw Error('wrong-chain');
    return await client.readContract({
      address: USDC,
      abi: [
        {
          type: 'function',
          name: 'balanceOf',
          stateMutability: 'view',
          inputs: [{ name: 'owner', type: 'address' }],
          outputs: [{ name: 'balance', type: 'uint256' }],
        },
      ],
      functionName: 'balanceOf',
      args: [payer],
    });
  } catch {
    // viem errors can include a credential-bearing RPC URL. Do not send them to a browser.
    throw Error('Celo USDC balance preflight failed; check the RPC configuration before signing');
  }
}
export function assertRequirement(q) {
  const r = q.requirements;
  if (
    q.mode !== 'live' ||
    q.chainId !== 42220 ||
    q.token !== 'USDC' ||
    q.asset?.toLowerCase() !== USDC.toLowerCase() ||
    q.expiresAt <= Date.now()
  )
    throw Error('Quote is invalid or expired; request a new quote');
  if (
    !r ||
    r.scheme !== 'exact' ||
    r.network !== 'celo' ||
    r.resource !== ENDPOINT ||
    r.asset?.toLowerCase() !== USDC.toLowerCase() ||
    r.payTo?.toLowerCase() !== q.payTo.toLowerCase() ||
    r.maxAmountRequired !== q.amount ||
    r.extra?.name !== 'USDC' ||
    r.extra?.version !== '2' ||
    r.extra?.selfRequirements ||
    !Number.isInteger(r.maxTimeoutSeconds) ||
    r.maxTimeoutSeconds < 1 ||
    r.maxTimeoutSeconds > 120
  )
    throw Error('Unsupported or changed payment requirement');
  atomic(q.amount);
}
export class Payments {
  constructor(
    ledger,
    {
      quote = unpaidQuote,
      fetcher = fetch,
      verifySignature = recoverTypedDataAddress,
      readBalance = celoUsdcBalance,
    } = {},
  ) {
    this.ledger = ledger;
    this.quote = quote;
    this.fetcher = fetcher;
    this.verifySignature = verifySignature;
    this.readBalance = readBalance;
  }
  proposal(id, owner) {
    const p = this.ledger.db.prepare('SELECT * FROM proposals WHERE id=? AND owner=?').get(id, owner);
    if (!p) throw Error('Proposal not found');
    return {
      ...p,
      request: JSON.parse(p.request),
      quote: JSON.parse(p.quote),
      typed: p.typed ? JSON.parse(p.typed) : null,
      payload: p.payload ? JSON.parse(p.payload) : null,
    };
  }
  async create({ address, payer, budget }, owner) {
    atomic(budget);
    const request = walletRequest(address),
      quote = { ...(await this.quote(request, payer)), target: address };
    assertRequirement(quote);
    if (atomic(quote.amount) > atomic(budget)) throw Error('Budget exceeded; no signature requested');
    const id = randomUUID();
    this.ledger.db
      .prepare('INSERT INTO proposals(id,owner,request,quote,budget) VALUES(?,?,?,?,?)')
      .run(id, owner, serialize(request), serialize(quote), budget);
    return { id, quote, request, budget };
  }
  async prepare(id, owner) {
    let p = this.proposal(id, owner);
    assertRequirement(p.quote);
    if (p.callid) {
      const row = this.ledger.get(p.callid);
      if (row.state !== 'AWAITING_SIGNATURE')
        throw Error('This request has already been sent or cancelled; do not pay again');
      return { id, typedData: p.typed, quote: p.quote, task: this.ledger.snapshot(id) };
    }
    // Free re-quote, checked BEFORE the user's wallet is asked to sign.
    const current = await this.quote(p.request, p.quote.payer);
    assertRequirement(current);
    for (const key of ['amount', 'payer', 'payTo', 'asset', 'requestHash'])
      if (current[key]?.toLowerCase() !== p.quote[key]?.toLowerCase())
        throw Error('Quote changed before signing; create a new review');
    if (digest(current.requirements) !== digest(p.quote.requirements))
      throw Error('Payment requirements changed before signing');
    if ((await this.readBalance(p.quote.payer)) < BigInt(p.quote.amount))
      throw Error('Insufficient Celo USDC balance; no signature requested');
    let typed;
    const payload = await buildPayment({
      account: {
        address: p.quote.payer,
        signTypedData: async (data) => {
          typed = JSON.parse(serialize(data));
          return '0x';
        },
      },
      requirements: p.quote.requirements,
      chainId: 42220,
      x402Version: 1,
    });
    // Another prepare can finish while the free quote or SDK promise is pending.
    // Reuse its one nonce rather than replacing an authorization already shown to a user.
    if (this.proposal(id, owner).callid) return this.prepare(id, owner);
    this.ledger.task(id, p.budget, 'live', owner);
    const callid = 'live_' + id;
    const quote = { ...p.quote, authorizationNonce: payload.payload.authorization.nonce };
    this.ledger.reserve(id, callid, quote, p.request);
    this.ledger.transition(callid, 'AWAITING_SIGNATURE', {
      level: 'unsigned-authorization',
      reason: 'Budget reserved; user has not submitted a signature',
      authorization: payload.payload.authorization,
    });
    this.ledger.db
      .prepare('UPDATE proposals SET typed=?,payload=?,callid=?,quote=? WHERE id=?')
      .run(serialize(typed), serialize(payload), callid, serialize(quote), id);
    return { id, typedData: typed, quote, task: this.ledger.snapshot(id) };
  }
  async submit(id, owner, signature) {
    const p = this.proposal(id, owner);
    if (!p.callid || !p.typed || this.ledger.get(p.callid).state !== 'AWAITING_SIGNATURE')
      throw Error('Authorization was already used, cancelled, or not prepared');
    assertRequirement(p.quote);
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
      throw Error('Expected an EOA EIP-712 signature');
    const recovered = await this.verifySignature({ ...p.typed, signature });
    if (recovered.toLowerCase() !== p.quote.payer.toLowerCase())
      throw Error('Signature is not from the approved payer');
    assertRequirement(p.quote);
    // Compare-and-set is the last synchronous step before network I/O. A replay, even
    // from another process, cannot submit a second paid request.
    const changed = this.ledger.db
      .prepare("UPDATE calls SET state='PENDING' WHERE id=? AND state='AWAITING_SIGNATURE'")
      .run(p.callid);
    if (changed.changes !== 1) throw Error('Payment already in flight; reconcile the original');
    this.ledger.event(p.callid, 'PENDING');
    const payload = { ...p.payload, payload: { ...p.payload.payload, signature } };
    try {
      const response = await this.fetcher(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-PAYMENT': encodePaymentHeader(payload) },
        body: JSON.stringify(p.request.body),
        redirect: 'error',
        signal: AbortSignal.timeout(70000),
      });
      const settlement = decodePaymentResponseHeader(response.headers.get('x-payment-response') || '');
      const text = await response.text();
      if (text.length > 262144) throw Error('Provider response exceeded limit; reconcile payment');
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        result = { error: 'Provider returned non-JSON data' };
      }
      this.ledger.transition(
        p.callid,
        'UNKNOWN',
        {
          level: 'provider-response',
          httpStatus: response.status,
          claimedTx: /^0x[0-9a-fA-F]{64}$/.test(settlement?.transaction || '')
            ? settlement.transaction.toLowerCase()
            : null,
          settlement: settlement ? { success: settlement.success, network: settlement.network } : null,
          authorization: p.payload.payload.authorization,
          reason: 'Transfer and authorization nonce require independent chain verification',
        },
        result,
      );
    } catch (e) {
      this.ledger.transition(p.callid, 'UNKNOWN', {
        level: 'unresolved',
        authorization: p.payload.payload.authorization,
        reason: 'Possible settlement; never retry payment automatically',
        error: e.message,
      });
    }
    return this.ledger.snapshot(id);
  }
  cancel(id, owner) {
    const p = this.proposal(id, owner);
    const changed = this.ledger.db
      .prepare("UPDATE calls SET state='CANCELLED' WHERE id=? AND state='AWAITING_SIGNATURE'")
      .run(p.callid || '');
    if (changed.changes !== 1) throw Error('Cannot cancel a sent authorization; reconcile the original');
    this.ledger.event(p.callid, 'CANCELLED');
    return this.ledger.snapshot(id);
  }
}
