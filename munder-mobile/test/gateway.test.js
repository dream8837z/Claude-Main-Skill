'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createGateway } = require('../gateway/server');
const { Hive } = require('../gateway/hive');

const TOKEN = 'test-token-123';

async function boot(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-'));
  const ws = path.join(dir, 'ws'); fs.mkdirSync(path.join(ws, 'proj'), { recursive: true });
  const gw = createGateway({ token: TOKEN, workspace: ws, hiveRoot: path.join(dir, 'hive'), routerIntervalMs: 100, ...extra });
  await new Promise((r) => gw.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${gw.server.address().port}`;
  t.after(async () => { await gw.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = async (method, p, body, token = TOKEN) => {
    const r = await fetch(`${base}/api/${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { gw, base, call, dir, ws };
}

function openWs(base, token = TOKEN) {
  const sock = new WebSocket(base.replace('http', 'ws') + '/ws');
  const frames = [];
  const waiters = [];
  sock.on('message', (m) => {
    const f = JSON.parse(m.toString()); frames.push(f);
    for (const w of [...waiters]) if (w.pred(f, frames)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(f); }
  });
  const until = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const hit = frames.find((f) => pred(f, frames)); if (hit) return resolve(hit);
    const w = { pred, resolve }; waiters.push(w);
    setTimeout(() => reject(new Error('timeout waiting for frame')), ms).unref();
  });
  const closed = new Promise((r) => sock.on('close', (code) => r(code)));
  sock.on('open', () => sock.send(JSON.stringify({ t: 'auth', token })));
  return { sock, frames, until, closed, send: (f) => sock.send(JSON.stringify(f)) };
}

test('REST rejects missing/wrong token, serves app shell without one', async (t) => {
  const { call, base } = await boot(t);
  assert.strictEqual((await call('GET', 'status', null, 'nope')).status, 401);
  assert.strictEqual((await call('GET', 'status')).status, 200);
  const shell = await fetch(`${base}/`); assert.strictEqual(shell.status, 200);
  assert.match(await shell.text(), /Munder Mobile/);
  assert.strictEqual((await fetch(`${base}/vendor/xterm.js`)).status, 200);
  assert.strictEqual((await fetch(`${base}/..%2Fgateway%2Fserver.js`)).status, 404, 'no path traversal out of web/');
});

test('failed auth is rate limited per IP', async (t) => {
  const { call } = await boot(t);
  for (let i = 0; i < 10; i++) await call('GET', 'status', null, 'bad');
  assert.strictEqual((await call('GET', 'status')).status, 429, 'even the right token waits out the window');
});

test('WebSocket closes 4003 on a wrong token', async (t) => {
  const { base } = await boot(t);
  const c = openWs(base, 'wrong');
  assert.strictEqual(await c.closed, 4003);
});

test('spawn a shell agent, stream output, type input, replay scrollback on re-attach', async (t) => {
  const { call, base, ws } = await boot(t);
  const r = await call('POST', 'agents', { provider: 'shell', id: 'pam', name: 'Pam', cwd: 'proj' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const c = openWs(base);
  await c.until((f) => f.t === 'ready');
  c.send({ t: 'attach', id: 'pam', cols: 80, rows: 24 });
  await c.until((f) => f.t === 'snapshot');
  c.send({ t: 'input', id: 'pam', d: 'echo "MOBILE_$((40+2))" && pwd\r' });
  await c.until((_, all) => all.filter((f) => f.t === 'data' || f.t === 'snapshot').map((f) => f.d).join('').includes('MOBILE_42'));
  const out = c.frames.filter((f) => f.t === 'data').map((f) => f.d).join('');
  assert.ok(out.includes(path.join(ws, 'proj')), 'runs in the requested cwd');
  c.sock.close();

  const c2 = openWs(base);
  await c2.until((f) => f.t === 'ready');
  c2.send({ t: 'attach', id: 'pam' });
  const snap = await c2.until((f) => f.t === 'snapshot');
  assert.ok(snap.d.includes('MOBILE_42'), 'scrollback replayed to a phone that reconnects');
  c2.sock.close();

  const list = await call('GET', 'agents');
  assert.strictEqual(list.body.agents[0].id, 'pam');
  assert.strictEqual((await call('DELETE', 'agents/pam')).status, 200);
  assert.strictEqual((await call('GET', 'agents')).body.agents.length, 0);
});

test('spawn guards: provider allowlist, cwd confined to workspace, duplicate id', async (t) => {
  const { call } = await boot(t);
  assert.strictEqual((await call('POST', 'agents', { provider: 'rm -rf /' })).status, 400);
  assert.strictEqual((await call('POST', 'agents', { provider: 'shell', cwd: '../../etc' })).status, 400);
  assert.strictEqual((await call('POST', 'agents', { provider: 'shell', id: '../x' })).status, 400);
  assert.strictEqual((await call('POST', 'agents', { provider: 'shell', id: 'dup' })).status, 201);
  assert.strictEqual((await call('POST', 'agents', { provider: 'shell', id: 'dup' })).status, 409);
});

test('human → god message lands in god inbox in the upstream hive format', async (t) => {
  const { call, gw } = await boot(t);
  const r = await call('POST', 'hive/message', { body: '랜딩 페이지 리뷰해줘' });
  assert.strictEqual(r.status, 200);
  const inbox = path.join(gw.hive.root, 'agents', 'god', 'inbox');
  const files = fs.readdirSync(inbox).filter((f) => f.endsWith('.json'));
  assert.strictEqual(files.length, 1);
  const msg = JSON.parse(fs.readFileSync(path.join(inbox, files[0]), 'utf8'));
  for (const k of ['id', 'conversation', 'in_reply_to', 'from', 'to', 'act', 'subject', 'body', 'hops', 'requires_reply', 'needs_human', 'created_at']) assert.ok(k in msg, k);
  assert.strictEqual(msg.from, 'human');
  assert.strictEqual(msg.act, 'request');
  const feed = await call('GET', 'hive/messages');
  assert.strictEqual(feed.body.messages[0].body, '랜딩 페이지 리뷰해줘');
});

test('router drains an agent outbox to the human feed and stamps the real sender', async (t) => {
  const { call, gw } = await boot(t);
  gw.hive.register({ id: 'jim', name: 'Jim', cwd: '/', status: 'idle' });
  const outbox = path.join(gw.hive.root, 'agents', 'god', 'outbox');
  fs.writeFileSync(path.join(outbox, 'x.json'), JSON.stringify({ from: 'jim', to: 'jim', act: 'request', subject: 's', body: 'do it' }));
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(fs.existsSync(path.join(outbox, '.sent', 'x.json')));
  const inbox = fs.readdirSync(path.join(gw.hive.root, 'agents', 'jim', 'inbox')).filter((f) => f.endsWith('.json'));
  assert.strictEqual(inbox.length, 1);
  const m = JSON.parse(fs.readFileSync(path.join(gw.hive.root, 'agents', 'jim', 'inbox', inbox[0]), 'utf8'));
  assert.strictEqual(m.from, 'god', 'sender is the outbox owner, not the claimed "from"');
  assert.ok((await call('GET', 'hive/messages')).body.messages.length >= 1);
});

test('ASK ME: answering a blocked card records the answer and mails god', async (t) => {
  const { call, gw } = await boot(t);
  fs.writeFileSync(path.join(gw.hive.root, 'tasks.json'), JSON.stringify([
    { id: 'T1', title: 'Pick DB', status: 'blocked', dependsOn: [], priority: 1, createdAt: 'x', humanQA: [{ q: '**Postgres or SQLite?**' }] }
  ]));
  assert.strictEqual((await call('GET', 'hive/summary')).body.tasks.length, 1);
  const r = await call('POST', 'hive/tasks/T1/answer', { answer: 'SQLite' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const tasks = JSON.parse(fs.readFileSync(path.join(gw.hive.root, 'tasks.json'), 'utf8'));
  assert.strictEqual(tasks[0].humanQA[0].a, 'SQLite');
  assert.strictEqual((await call('POST', 'hive/tasks/T1/answer', { answer: 'again' })).status, 404, 'no open question left');
  const inbox = fs.readdirSync(path.join(gw.hive.root, 'agents', 'god', 'inbox')).filter((f) => f.endsWith('.json'));
  assert.strictEqual(inbox.length, 1);
});

test('Hive.ensure never clobbers an existing desktop hive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdh-'));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ godId: 'michael', agents: { michael: { id: 'michael' } } }));
  fs.writeFileSync(path.join(dir, 'board.md'), 'existing plan');
  const h = new Hive(dir).ensure();
  assert.strictEqual(h.registry().godId, 'michael');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'board.md'), 'utf8'), 'existing plan');
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'michael', 'inbox')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('god → human reply (no deliverable recipient) still reaches the phone feed', async (t) => {
  const { call, gw } = await boot(t);
  fs.writeFileSync(path.join(gw.hive.root, 'agents', 'god', 'outbox', 'r.json'), JSON.stringify({ to: 'human', act: 'inform', subject: 'ok', body: '접수했습니다' }));
  await new Promise((r) => setTimeout(r, 400));
  const feed = (await call('GET', 'hive/messages')).body.messages;
  const m = feed.find((x) => x.body === '접수했습니다');
  assert.ok(m, 'reply visible');
  assert.strictEqual(m.from, 'god'); assert.strictEqual(m.to, 'human'); assert.ok(m.id && m.created_at);
});
