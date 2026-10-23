import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Ledger } from './ledger.mjs';
import { walletRequest, fixtureQuote, fixtureProvider, chainVerifier } from './providers.mjs';
import { Payments } from './payments.mjs';
import { sessionOwner } from './sessions.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function createApp(ledger, options = {}) {
  const origin = options.origin || null,
    secret = options.secret || randomBytes(32).toString('hex');
  const payments = options.payments || new Payments(ledger),
    enabled = options.paymentsEnabled ?? process.env.ENABLE_MAINNET_PAYMENTS === '1';
  const verify = options.verifier || chainVerifier(process.env.CELO_RPC_URL || 'https://forno.celo.org');
  const rate = new Map();
  const send = (res, status, data, type = 'application/json') => {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  const own = (id, owner) => {
    const row = ledger.db.prepare('SELECT owner FROM tasks WHERE id=?').get(id);
    if (!row || row.owner !== owner) throw Error('Task not found');
    return ledger.snapshot(id);
  };
  return http.createServer(async (req, res) => {
    try {
      const allowed = origin ? new URL(origin).host : req.headers.host;
      if (origin ? req.headers.host !== allowed : !/^127\.0\.0\.1:\d+$/.test(req.headers.host || ''))
        return send(res, 403, { error: 'Untrusted Host' });
      const expectedOrigin = origin || `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin)
        return send(res, 403, { error: 'Same-origin access required' });
      const url = new URL(req.url, expectedOrigin);
      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        return send(
          res,
          200,
          readFileSync(join(root, 'public', file)),
          file.endsWith('html')
            ? 'text/html; charset=utf-8'
            : file.endsWith('css')
              ? 'text/css'
              : 'text/javascript',
        );
      }
      const owner = sessionOwner(req, res, secret, expectedOrigin.startsWith('https:'));
      if (req.method === 'GET' && url.pathname === '/api/health')
        return send(res, 200, {
          mode: 'fixture-and-live-quote',
          paymentsEnabled: enabled,
          chainId: 42220,
          sdk: '@celo/buy-core@0.8.3',
        });
      if (req.method === 'GET' && url.pathname === '/api/task')
        return send(res, 200, own(url.searchParams.get('id'), owner));
      if (req.method === 'GET' && url.pathname === '/api/tasks')
        return send(
          res,
          200,
          ledger.db
            .prepare('SELECT id,mode,budget FROM tasks WHERE owner=? ORDER BY rowid DESC LIMIT 30')
            .all(owner)
            .map((t) => {
              const s = ledger.snapshot(t.id);
              return {
                ...t,
                state: s.calls.at(-1)?.state || 'EMPTY',
                address: s.calls.at(-1)?.quote?.target || null,
              };
            }),
        );
      if (req.method !== 'POST') return send(res, 404, { error: 'Route not found' });
      if (
        ![
          '/api/demo',
          '/api/live/quote',
          '/api/live/prepare',
          '/api/live/pay',
          '/api/live/cancel',
          '/api/live/reconcile',
        ].includes(url.pathname)
      )
        return send(res, 404, { error: 'Route not found' });
      if (req.headers['content-type'] !== 'application/json')
        return send(res, 415, { error: 'JSON required' });
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return send(res, 403, { error: 'Cross-site mutation refused' });
      if (rate.size > 1000) rate.clear();
      const minute = Math.floor(Date.now() / 60000),
        usage = rate.get(owner);
      const count = usage?.minute === minute ? usage.count + 1 : 1;
      rate.set(owner, { minute, count });
      if (count > 30) return send(res, 429, { error: 'Too many requests; wait a minute' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16384) return send(res, 413, { error: 'Request too large' });
      }
      const input = JSON.parse(body);
      if (url.pathname === '/api/demo') {
        const request = walletRequest(input.address),
          id = input.taskId || randomUUID();
        ledger.task(id, input.budget, 'fixture', owner);
        const key = 'check_' + id,
          quote = ledger.get(key)?.quote || { ...fixtureQuote(request), target: input.address };
        const provider =
          input.scenario === 'uncertain'
            ? {
                pay: async () => {
                  throw Error('Simulated timeout after possible settlement');
                },
              }
            : fixtureProvider;
        await ledger.execute(id, key, quote, request, provider);
        return send(res, 200, ledger.snapshot(id));
      }
      if (url.pathname === '/api/live/quote') return send(res, 200, await payments.create(input, owner));
      if (url.pathname === '/api/live/prepare')
        return send(res, 200, await payments.prepare(input.id, owner));
      if (url.pathname === '/api/live/cancel') return send(res, 200, payments.cancel(input.id, owner));
      if (url.pathname === '/api/live/pay') {
        if (!enabled)
          return send(res, 403, {
            error: 'Mainnet execution is disabled by the owner. Quote and unsigned review remain available.',
          });
        return send(res, 200, await payments.submit(input.id, owner, input.signature));
      }
      if (url.pathname === '/api/live/reconcile') {
        const task = own(input.id, owner),
          call = task.calls.find((c) => c.state === 'UNKNOWN');
        if (!call) throw Error('No unresolved payment');
        const tx = input.tx || call.evidence?.claimedTx;
        if (!tx) throw Error('Enter the original transaction hash; no new payment will be sent');
        await ledger.reconcile(call.id, tx, verify);
        return send(res, 200, ledger.snapshot(input.id));
      }
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = process.env.DATA_DIR || join(root, 'data');
  mkdirSync(data, { recursive: true });
  const origin = process.env.PUBLIC_ORIGIN || null;
  if (
    origin &&
    (!origin.startsWith('https://') || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  )
    throw Error('Hosted mode requires HTTPS PUBLIC_ORIGIN and SESSION_SECRET of at least 32 characters');
  const secretPath = join(data, 'session-secret');
  if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  const ledger = new Ledger(join(data, 'ledger.db')),
    server = createApp(ledger, {
      origin,
      secret: process.env.SESSION_SECRET || readFileSync(secretPath, 'utf8'),
    });
  server.listen(Number(process.env.PORT || 4318), origin ? '0.0.0.0' : '127.0.0.1', () =>
    console.log(
      `Agent Spend Receipt listening on ${server.address().port}; paid execution ${process.env.ENABLE_MAINNET_PAYMENTS === '1' ? 'enabled by owner' : 'disabled'}`,
    ),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () =>
      server.close(() => {
        ledger.close();
        process.exit(0);
      }),
    );
}
