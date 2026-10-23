import { reviewDate } from './review-date.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { identityRequest } from '../src/identity.mjs';
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf('=');
    return [s.slice(0, i), s.slice(i + 1)];
  }),
);
if (!args['--owner'] || (!args['--uri'] && !args['--metadata-file']))
  throw Error(
    'Usage: node scripts/identity-review.mjs --owner=0xPUBLIC_ADDRESS --uri=https://HOST/agent.json OR --metadata-file=submission/agent-registration.draft.json',
  );
const uri =
  args['--uri'] ||
  'data:application/json;base64,' +
    Buffer.from(JSON.stringify(JSON.parse(readFileSync(args['--metadata-file'], 'utf8')))).toString('base64');
const transaction = identityRequest(args['--owner'], uri);
const review = {
  generatedAt: new Date().toISOString(),
  clientReviewDate: reviewDate(),
  status: 'UNSIGNED REVIEW ONLY',
  transaction,
  registeredAgentId: null,
  signaturesCreated: 0,
  broadcasts: 0,
};
try {
  const response = await fetch(process.env.CELO_RPC_URL || 'https://forno.celo.org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_estimateGas',
      params: [
        { from: transaction.from, to: transaction.to, data: transaction.data, value: transaction.value },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  review.gasEstimate = await response.json();
} catch (e) {
  review.gasEstimate = { error: e.message };
}
mkdirSync('private', { recursive: true });
writeFileSync('private/identity-review.json', JSON.stringify(review, null, 2));
console.log(JSON.stringify(review, null, 2));
