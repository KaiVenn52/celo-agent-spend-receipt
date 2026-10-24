import { createPublicClient, encodeFunctionData, formatEther, http, isAddress } from 'viem';
export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
];
export function identityRequest(owner, uri) {
  if (!isAddress(owner)) throw Error('A valid owner public address is required');
  const url = new URL(uri);
  if (url.protocol === 'data:') {
    const match = uri.match(/^data:application\/json;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw Error('Use canonical base64 JSON metadata');
    if (Buffer.from(match[1], 'base64').toString('base64') !== match[1])
      throw Error('Use canonical base64 JSON metadata');
    const metadata = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    if (
      metadata.type !== 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1' ||
      typeof metadata.name !== 'string' ||
      !Array.isArray(metadata.services)
    )
      throw Error('Invalid ERC-8004 registration metadata');
  } else if (url.protocol !== 'https:' || url.username || url.password)
    throw Error('Use reviewed HTTPS or inline base64 JSON metadata');
  return {
    from: owner,
    to: IDENTITY_REGISTRY,
    chainId: '0xa4ec',
    value: '0x0',
    data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: 'register', args: [uri] }),
  };
}

export async function reviewIdentityRegistration(owner, uri, client) {
  const transaction = identityRequest(owner, uri);
  client ||= createPublicClient({
    transport: http(process.env.CELO_RPC_URL || 'https://forno.celo.org', { timeout: 15000, retryCount: 0 }),
  });
  const query = async (request) => {
    try {
      return await request;
    } catch {
      throw Error('Celo identity RPC review failed; no transaction was sent');
    }
  };
  if ((await query(client.getChainId())) !== 42220) throw Error('Identity review requires Celo mainnet');
  const code = await query(client.getCode({ address: IDENTITY_REGISTRY }));
  if (!code || code === '0x') throw Error('Identity registry code is unavailable');
  const [gas, gasPrice, balance] = await Promise.all([
    query(client.estimateGas({ account: owner, to: transaction.to, data: transaction.data, value: 0n })),
    query(client.getGasPrice()),
    query(client.getBalance({ address: owner })),
  ]);
  const gasLimit = (gas * 120n + 99n) / 100n;
  return {
    transaction: { ...transaction, gas: '0x' + gasLimit.toString(16) },
    agentURI: uri,
    gasEstimate: gas.toString(),
    gasLimit: gasLimit.toString(),
    gasPriceWei: gasPrice.toString(),
    estimatedFeeCELO: formatEther(gas * gasPrice),
    bufferedFeeCELO: formatEther(gasLimit * gasPrice),
    balanceCELO: formatEther(balance),
    canAfford: balance >= gasLimit * gasPrice,
    expiresAt: Date.now() + 60000,
    status: 'UNSIGNED REVIEW ONLY',
    signaturesCreated: 0,
    broadcasts: 0,
  };
}
