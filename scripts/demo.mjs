import { mkdirSync, writeFileSync } from 'node:fs';
import { Ledger } from '../src/ledger.mjs';
import { walletRequest, fixtureQuote, fixtureProvider } from '../src/providers.mjs';
const ledger = new Ledger();
const request = walletRequest('0x' + '1'.repeat(40));
ledger.task('demo', '20000');
const quote = fixtureQuote(request);
await ledger.execute('demo', 'wallet-check', quote, request, fixtureProvider);
await ledger.execute('demo', 'wallet-check', quote, request, fixtureProvider);
const result = ledger.snapshot('demo');
mkdirSync('evidence', { recursive: true });
writeFileSync('evidence/demo-fixture.json', JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    mode: 'fixture',
    calls: result.calls.length,
    spent: result.spent,
    available: result.available,
    noRealPayment: true,
  }),
);
ledger.close();
