import { encodeFunctionData, isAddress } from 'viem';
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
