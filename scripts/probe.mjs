import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { walletRequest, unpaidQuote, ENDPOINT, USDC } from '../src/providers.mjs';
import { createPublicClient, http } from 'viem';
import { IDENTITY_REGISTRY } from '../src/identity.mjs';
const output = { checkedAt: new Date().toISOString(), paymentsMade: 0, signaturesCreated: 0 };
try {
  const response = await fetch('https://gateway.usebuy.ai/v1/catalog', {
    signal: AbortSignal.timeout(20000),
  });
  const catalog = await response.json();
  output.catalog = {
    status: response.status,
    payment: catalog.payment,
    service: catalog.capabilities?.find((s) => s.url === ENDPOINT),
  };
} catch (e) {
  output.catalog = { error: e.message };
}
try {
  output.unpaidQuote = await unpaidQuote(walletRequest('0x' + '1'.repeat(40)), '0x' + '1'.repeat(40));
  output.unpaidQuote.note =
    'Public placeholder used only for unsigned quoting. This program did not create, fund, control or sign for it; it is not a project wallet or independent user.';
} catch (e) {
  output.unpaidQuote = { error: e.message };
}
try {
  const response = await fetch('https://forno.celo.org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(15000),
  });
  output.publicRpc = {
    status: response.status,
    response: await response.json(),
    note: 'Read-only chain identification is not paid provider or payment proof.',
  };
} catch (e) {
  output.publicRpc = { error: e.message };
}
try {
  const client = createPublicClient({
    transport: http('https://forno.celo.org', { timeout: 15000, retryCount: 0 }),
  });
  const textFunction = (name) => [
    { type: 'function', name, stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  ];
  const reads = await Promise.allSettled([
    client.getChainId(),
    client.getCode({ address: IDENTITY_REGISTRY }),
    client.readContract({ address: USDC, abi: textFunction('name'), functionName: 'name' }),
    client.readContract({ address: USDC, abi: textFunction('version'), functionName: 'version' }),
    client.readContract({
      address: USDC,
      abi: [
        {
          type: 'function',
          name: 'decimals',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'uint8' }],
        },
      ],
      functionName: 'decimals',
    }),
  ]);
  const fields = ['chainId', 'registryCode', 'tokenName', 'tokenVersionGetter', 'tokenDecimals'];
  const observations = Object.fromEntries(
    reads.map((result, index) => [
      fields[index],
      result.status === 'fulfilled'
        ? {
            observed:
              index === 1
                ? { present: !!result.value && result.value !== '0x', bytes: (result.value?.length - 2) / 2 }
                : result.value,
          }
        : { error: 'Read failed or getter is unsupported', errorType: result.reason?.name || 'Error' },
    ]),
  );
  output.publicContractReads = {
    observations,
    identityRegistry: IDENTITY_REGISTRY,
    token: USDC,
    note: 'Public read-only contract observations. A missing version() getter does not establish the EIP-712 domain version; the published 402 requirement remains separately recorded. No identity was registered and no provider was paid.',
  };
} catch {
  output.publicContractReads = {
    error:
      'Public contract read failed; do not infer token metadata or registry availability from this probe.',
  };
}
mkdirSync('evidence', { recursive: true });
if (existsSync('evidence/provider-probe.json')) {
  const previous = JSON.parse(readFileSync('evidence/provider-probe.json', 'utf8'));
  mkdirSync('evidence/probe-history', { recursive: true });
  writeFileSync(
    'evidence/probe-history/' + previous.checkedAt.replaceAll(':', '-') + '.json',
    JSON.stringify(previous, null, 2),
  );
}
writeFileSync('evidence/provider-probe.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
