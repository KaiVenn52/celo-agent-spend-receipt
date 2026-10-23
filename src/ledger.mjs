import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function atomic(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,11}$/.test(value))
    throw Error('Amount must be a positive atomic-unit integer string');
  return Number(value);
}
export function decimal(value) {
  return BigInt(value) / 1000000n + '.' + (BigInt(value) % 1000000n).toString().padStart(6, '0');
}
export class Ledger {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, budget INTEGER NOT NULL, mode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, task TEXT REFERENCES tasks(id), fingerprint TEXT NOT NULL, requesthash TEXT NOT NULL, quote TEXT NOT NULL, amount INTEGER NOT NULL, state TEXT NOT NULL, evidence TEXT, result TEXT, tx TEXT UNIQUE, UNIQUE(task,requesthash));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, call TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL);`);
    if (
      !this.db
        .prepare('PRAGMA table_info(tasks)')
        .all()
        .some((c) => c.name === 'owner')
    )
      this.db.exec("ALTER TABLE tasks ADD COLUMN owner TEXT NOT NULL DEFAULT 'local'");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,owner TEXT NOT NULL,request TEXT NOT NULL,quote TEXT NOT NULL,budget TEXT NOT NULL,typed TEXT,payload TEXT,callid TEXT);`,
    );
    // A crash after reservation may have happened after signing. Never replay it.
    const stale = this.db.prepare("SELECT id FROM calls WHERE state='PENDING'").all();
    for (const row of stale)
      this.transition(row.id, 'UNKNOWN', {
        reason: 'Process restarted during payment; reconcile before proceeding',
      });
  }
  close() {
    this.db.close();
  }
  task(id, budget, mode = 'fixture', owner = 'local') {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !['fixture', 'live'].includes(mode)) throw Error('Invalid task');
    const amount = atomic(budget);
    const old = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (old && (old.budget !== amount || old.mode !== mode || old.owner !== owner))
      throw Error('Task already exists with another policy');
    this.db
      .prepare('INSERT OR IGNORE INTO tasks(id,budget,mode,owner) VALUES(?,?,?,?)')
      .run(id, amount, mode, owner);
    return this.snapshot(id);
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM calls WHERE id=?').get(id);
    if (!row) return null;
    return {
      ...row,
      quote: JSON.parse(row.quote),
      evidence: row.evidence ? JSON.parse(row.evidence) : null,
      result: row.result ? JSON.parse(row.result) : null,
    };
  }
  snapshot(id) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!task) throw Error('Task not found');
    const rows = this.db
      .prepare('SELECT id FROM calls WHERE task=? ORDER BY rowid')
      .all(id)
      .map((r) => this.get(r.id));
    const spent = rows.filter((r) => r.state === 'SETTLED').reduce((s, r) => s + r.amount, 0);
    const reserved = rows
      .filter((r) => ['PENDING', 'UNKNOWN', 'AWAITING_SIGNATURE'].includes(r.state))
      .reduce((s, r) => s + r.amount, 0);
    const { owner, ...publicTask } = task;
    return { ...publicTask, spent, reserved, available: task.budget - spent - reserved, calls: rows };
  }
  reserve(task, id, quote, request, now = Date.now()) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw Error('Invalid idempotency key');
    const amount = atomic(quote.amount);
    if (quote.chainId !== 42220 || quote.token !== 'USDC' || !/^0x[0-9a-fA-F]{40}$/.test(quote.payTo))
      throw Error('Unsupported payment route');
    if (quote.requestHash !== digest(request)) throw Error('Quote does not match exact request');
    const fingerprint = digest({ task, request, quote });
    const old = this.get(id);
    if (old) {
      if (old.fingerprint !== fingerprint) throw Error('Idempotency conflict');
      return { created: false, call: old };
    }
    if (!Number.isFinite(quote.expiresAt) || quote.expiresAt <= now) throw Error('Quote expired');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const policy = this.snapshot(task);
      if (policy.mode !== quote.mode) throw Error('Evidence mode mismatch');
      if (policy.available < amount) throw Error('Budget exceeded');
      this.db
        .prepare(
          'INSERT INTO calls(id,task,fingerprint,requesthash,quote,amount,state) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, task, fingerprint, digest(request), JSON.stringify(quote), amount, 'PENDING');
      this.event(id, 'PENDING');
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { created: true, call: this.get(id) };
  }
  event(id, state) {
    this.db
      .prepare('INSERT INTO events(call,state,at) VALUES(?,?,?)')
      .run(id, state, new Date().toISOString());
  }
  transition(id, state, evidence, result = null, tx = null) {
    this.db
      .prepare('UPDATE calls SET state=?,evidence=?,result=?,tx=? WHERE id=?')
      .run(state, JSON.stringify(evidence), JSON.stringify(result), tx, id);
    this.event(id, state);
    return this.get(id);
  }
  async execute(task, id, quote, request, provider) {
    const reservation = this.reserve(task, id, quote, request);
    if (!reservation.created) return reservation.call;
    try {
      const outcome = await provider.pay(request, quote);
      // Provider claims are not chain evidence. Only the independent verifier settles live calls.
      if (outcome.paymentSettled === false && outcome.definitive === true)
        return this.transition(id, 'FAILED', {
          reason: outcome.reason || 'Explicit rejection before settlement',
        });
      if (quote.mode === 'fixture' && outcome.fixture === true)
        return this.transition(id, 'SETTLED', { level: 'fixture', verifiedOnchain: false }, outcome.result);
      return this.transition(
        id,
        'UNKNOWN',
        {
          level: 'provider-claim',
          reason: 'Awaiting independent Celo transfer verification',
          claimedTx: outcome.tx || null,
        },
        outcome.result,
      );
    } catch (e) {
      return this.transition(id, 'UNKNOWN', {
        reason: 'Payment outcome unknown; no automatic retry',
        error: String(e.message).slice(0, 200),
      });
    }
  }
  async reconcile(id, tx, verifier) {
    tx = tx.toLowerCase();
    const row = this.get(id);
    if (!row || row.quote.mode !== 'live' || row.state !== 'UNKNOWN')
      throw Error('Only unresolved live calls can reconcile');
    const evidence = await verifier(tx, row.quote);
    if (evidence.verified !== true || evidence.chainId !== 42220 || evidence.tx !== tx)
      throw Error('Receipt verification failed');
    return this.transition(id, 'SETTLED', evidence, row.result, tx);
  }
}
