import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Ledger } from '../src/ledger.mjs';
import { createApp } from '../src/server.mjs';
async function app(options = {}) {
  const ledger = new Ledger(),
    server = createApp(ledger, options);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    ledger,
    server,
    base,
    close: async () => {
      await new Promise((r) => server.close(r));
      ledger.close();
    },
  };
}
function client(base) {
  let cookie = '';
  return async (path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return r;
  };
}
const body = { address: '0x' + '1'.repeat(40), budget: '20000', taskId: 'demo' };

test('local HTTP flow, replay, export and budget rejection', async () => {
  const a = await app(),
    request = client(a.base);
  try {
    const health = await (await request('/api/health')).json();
    assert.equal(health.paymentsEnabled, false);
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    for (const path of ['/app.js', '/style.css']) assert.equal((await request(path)).status, 200);
    const first = await (await request('/api/demo', body)).json();
    assert.equal(first.spent, 10000);
    assert.equal((await (await request('/api/demo', body)).json()).calls.length, 1);
    assert.equal((await (await request('/api/task?id=demo')).json()).id, 'demo');
    assert.equal((await request('/api/demo', { ...body, taskId: 'low', budget: '1' })).status, 400);
    assert.equal((await request('/api/demo', { ...body, address: 'bad' })).status, 400);
    assert.equal((await request('/api/pay', {})).status, 404);
  } finally {
    await a.close();
  }
});

test('session owners cannot view, replay or list another browser task', async () => {
  const a = await app(),
    alice = client(a.base),
    bob = client(a.base);
  try {
    await alice('/api/demo', body);
    assert.equal((await bob('/api/task?id=demo')).status, 400);
    assert.deepEqual(await (await bob('/api/tasks')).json(), []);
    assert.equal((await bob('/api/demo', body)).status, 400);
    assert.equal((await (await alice('/api/tasks')).json()).length, 1);
  } finally {
    await a.close();
  }
});

test('external origins, forged Host and live execution are refused', async () => {
  const a = await app(),
    request = client(a.base);
  try {
    assert.equal((await request('/api/demo', body, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/demo', body, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await request('/api/live/pay', { id: 'fake', signature: 'fake' })).status, 403);
    const status = await new Promise((resolve) => {
      http.get(a.base, { headers: { Host: 'evil.example' } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      });
    });
    assert.equal(status, 403);
  } finally {
    await a.close();
  }
});
