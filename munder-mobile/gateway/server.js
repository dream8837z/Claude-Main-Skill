'use strict';
/**
 * Munder Difflin mobile gateway — runs on a VM (no display, no Electron) and
 * lets a phone drive the office: spawn agent CLIs, watch/type into their
 * terminals, talk to Michael (god) through the hive mailbox, answer ASK ME
 * questions on the task board.
 *
 *   HTTP  /            mobile PWA (static, no auth needed to load the shell)
 *   HTTP  /api/*       JSON API, `Authorization: Bearer <MD_TOKEN>`
 *   WS    /ws          terminal stream; first frame must be {t:'auth',token}
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { PtyHub } = require('./ptyHub');
const { Hive, AGENT_ID_RE } = require('./hive');
const { listProviders, resolveProvider } = require('./providers');

const WAKE_NUDGE = 'You have new hive inbox message(s) — read your inbox, act on them now, and move handled ones to inbox/.done/. Act autonomously; only message god if you genuinely need a decision.';
const WEB_DIR = path.join(__dirname, '..', 'web');
const VENDOR = {
  '/vendor/xterm.js': require.resolve('@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': require.resolve('@xterm/xterm/css/xterm.css'),
  '/vendor/addon-fit.js': require.resolve('@xterm/addon-fit/lib/addon-fit.js')
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function tokenEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Hash first so the compare is constant-time regardless of length.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Fixed-window limiter on FAILED auth per IP — a guessed token costs time. */
function makeAuthLimiter(maxFails = 10, windowMs = 60_000) {
  const map = new Map();
  return {
    blocked(ip) { const e = map.get(ip); return !!e && e.until > Date.now() && e.n >= maxFails; },
    fail(ip) {
      const now = Date.now();
      const e = map.get(ip);
      if (!e || e.until <= now) map.set(ip, { n: 1, until: now + windowMs });
      else e.n++;
    }
  };
}

function createGateway(opts = {}) {
  const token = opts.token || process.env.MD_TOKEN || randomBytes(24).toString('base64url');
  const workspace = path.resolve(opts.workspace || process.env.MD_WORKSPACE || os.homedir());
  const hive = new Hive(opts.hiveRoot || process.env.MD_HIVE || path.join(os.homedir(), '.munder-difflin-mobile', 'hive')).ensure();
  const hub = opts.hub || new PtyHub();
  const routerOn = (opts.router ?? process.env.MD_ROUTER ?? '1') !== '0';
  const limiter = makeAuthLimiter();
  const sockets = new Set();

  const broadcast = (frame) => {
    const s = JSON.stringify(frame);
    for (const ws of sockets) if (ws.authed && ws.readyState === 1) ws.send(s);
  };

  const agentList = () => {
    const reg = hive.registry();
    return hub.list().map((a) => ({
      ...a,
      isGod: reg.godId === a.id,
      role: reg.agents[a.id]?.role || null,
      unread: hive.unreadCount(a.id)
    }));
  };
  hub.on('change', () => broadcast({ t: 'agents', agents: agentList() }));
  hub.on('exit', (id, code) => {
    broadcast({ t: 'exit', id, code });
    try { hive.setStatus(id, { status: 'gone', archived: true }); } catch { /* not a hive agent */ }
  });

  /** Type the wake nudge into an idle gateway-owned agent with unread mail.
   *  Never types into a PTY that printed in the last few seconds (mid-stream). */
  const pendingWake = new Set();
  const wake = (id) => {
    if (!hub.has(id) || pendingWake.has(id)) return;
    pendingWake.add(id);
    const tryWake = (attempt) => {
      if (!hub.has(id)) return pendingWake.delete(id);
      if ((hub.idleFor(id) ?? 0) < 4000 && attempt < 30) return setTimeout(() => tryWake(attempt + 1), 2000).unref();
      pendingWake.delete(id);
      hub.write(id, WAKE_NUDGE);
      setTimeout(() => hub.write(id, '\r'), 300).unref();
    };
    tryWake(0);
  };

  let routerTimer = null;
  if (routerOn) {
    routerTimer = setInterval(() => {
      let routed = [];
      try { routed = hive.route(); } catch (e) { console.error('[router]', e.message); }
      if (!routed.length) return;
      for (const { targets } of routed) for (const t of targets) wake(t);
      broadcast({ t: 'hive' });
    }, opts.routerIntervalMs || 2000);
    routerTimer.unref();
  }

  // ---------- HTTP ----------
  const send = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 256 * 1024) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
  const ipOf = (req) => req.socket.remoteAddress || '?';

  const resolveCwd = (cwd) => {
    const p = path.resolve(workspace, cwd || '.');
    if (p !== workspace && !p.startsWith(workspace + path.sep)) return null;
    try { if (!fs.statSync(p).isDirectory()) return null; } catch { return null; }
    return p;
  };

  async function api(req, res, url) {
    const m = req.method;
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop 'api'

    if (m === 'GET' && parts[0] === 'status') {
      return send(res, 200, { ok: true, host: os.hostname(), workspace, hive: hive.root, router: routerOn, agents: hub.list().length });
    }
    if (m === 'GET' && parts[0] === 'providers') return send(res, 200, { providers: listProviders() });

    if (parts[0] === 'agents') {
      const id = parts[1];
      if (m === 'GET' && !id) return send(res, 200, { agents: agentList() });
      if (m === 'POST' && !id) {
        const b = await readBody(req);
        const prov = resolveProvider(String(b.provider || ''));
        if (!prov) return send(res, 400, { error: 'unknown or disallowed provider' });
        const agentId = String(b.id || `${b.provider}-${randomBytes(2).toString('hex')}`).toLowerCase();
        if (!AGENT_ID_RE.test(agentId)) return send(res, 400, { error: 'id must match [A-Za-z0-9._-]{1,64}' });
        const cwd = resolveCwd(b.cwd);
        if (!cwd) return send(res, 400, { error: `cwd must be an existing directory inside ${workspace}` });
        if (hub.has(agentId)) return send(res, 409, { error: `agent "${agentId}" already running` });
        const isGod = Boolean(b.isGod);
        hive.register({ id: agentId, name: String(b.name || agentId).slice(0, 40), provider: prov.id, role: b.role ? String(b.role).slice(0, 200) : undefined, cwd, isGod, status: 'working', archived: false, cwdValid: true });
        const r = hub.spawn({
          id: agentId, name: String(b.name || agentId).slice(0, 40), provider: prov.id,
          command: prov.command, args: prov.args, cwd,
          cols: Number(b.cols) || 80, rows: Number(b.rows) || 30,
          env: { HIVE_ROOT: hive.root, MD_AGENT_ID: agentId }
        });
        if (!r.ok) {
          hive.setStatus(agentId, { status: 'gone', archived: true });
          return send(res, 500, { error: r.error });
        }
        return send(res, 201, { ok: true, id: agentId });
      }
      if (!id || !hub.has(id)) return send(res, 404, { error: 'agent not found' });
      if (m === 'DELETE' && !parts[2]) {
        hub.kill(id);
        try { hive.setStatus(id, { status: 'gone', archived: true }); } catch { /* noop */ }
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && parts[2] === 'interrupt') return send(res, 200, { ok: hub.interrupt(id) });
      if (m === 'POST' && parts[2] === 'input') {
        const b = await readBody(req);
        return send(res, 200, { ok: hub.write(id, String(b.data ?? '')) });
      }
    }

    if (parts[0] === 'hive') {
      if (m === 'GET' && parts[1] === 'summary') {
        const reg = hive.registry();
        return send(res, 200, { godId: reg.godId, agents: Object.values(reg.agents), tasks: hive.tasks() });
      }
      if (m === 'GET' && parts[1] === 'messages') {
        const agent = url.searchParams.get('agent') || undefined;
        if (agent && !AGENT_ID_RE.test(agent)) return send(res, 400, { error: 'bad agent id' });
        return send(res, 200, { messages: hive.messages({ agentId: agent, limit: Number(url.searchParams.get('limit')) || 100 }) });
      }
      if (m === 'POST' && parts[1] === 'message') {
        const b = await readBody(req);
        if (!String(b.body || '').trim()) return send(res, 400, { error: 'body required' });
        const to = String(b.to || 'god');
        if (to !== 'god' && to !== 'broadcast' && !AGENT_ID_RE.test(to)) return send(res, 400, { error: 'bad recipient' });
        const msg = hive.send({ to, act: b.act || 'request', subject: b.subject || String(b.body).slice(0, 60), body: b.body }, 'human');
        for (const t of msg.delivered) wake(t);
        broadcast({ t: 'hive' });
        return send(res, 200, { ok: true, message: msg });
      }
      if (m === 'POST' && parts[1] === 'tasks' && parts[2] && parts[3] === 'answer') {
        const b = await readBody(req);
        if (!String(b.answer || '').trim()) return send(res, 400, { error: 'answer required' });
        const r = hive.answerTask(decodeURIComponent(parts[2]), String(b.answer));
        if (!r.ok) return send(res, 404, r);
        for (const t of r.message.delivered) wake(t);
        broadcast({ t: 'hive' });
        return send(res, 200, r);
      }
    }
    return send(res, 404, { error: 'not found' });
  }

  function serveStatic(req, res, url) {
    if (VENDOR[url.pathname]) {
      res.writeHead(200, { 'content-type': MIME[path.extname(url.pathname)], 'cache-control': 'public, max-age=86400' });
      return fs.createReadStream(VENDOR[url.pathname]).pipe(res);
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(WEB_DIR, rel);
    if (!file.startsWith(WEB_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    const ip = ipOf(req);
    if (limiter.blocked(ip)) return send(res, 429, { error: 'too many failed attempts' });
    const auth = req.headers.authorization || '';
    if (!tokenEquals(auth.replace(/^Bearer\s+/i, ''), token)) { limiter.fail(ip); return send(res, 401, { error: 'unauthorized' }); }
    try { await api(req, res, url); } catch (e) { send(res, 400, { error: e.message }); }
  });

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    const ip = ipOf(req);
    ws.authed = false;
    const attached = new Map(); // agentId -> unsubscribe
    const authTimer = setTimeout(() => { if (!ws.authed) ws.close(4001, 'auth timeout'); }, 5000);
    ws.on('message', (raw) => {
      let f; try { f = JSON.parse(raw.toString()); } catch { return; }
      if (!ws.authed) {
        if (f.t !== 'auth' || limiter.blocked(ip) || !tokenEquals(f.token, token)) {
          limiter.fail(ip);
          return ws.close(4003, 'unauthorized');
        }
        ws.authed = true; clearTimeout(authTimer); sockets.add(ws);
        return ws.send(JSON.stringify({ t: 'ready', agents: agentList() }));
      }
      const id = typeof f.id === 'string' ? f.id : '';
      switch (f.t) {
        case 'attach': {
          if (attached.has(id)) attached.get(id)();
          const a = hub.attach(id, (d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'data', id, d })); });
          if (!a) return ws.send(JSON.stringify({ t: 'error', id, error: 'agent not found' }));
          attached.set(id, a.unsubscribe);
          if (f.cols && f.rows) hub.resize(id, f.cols, f.rows);
          return ws.send(JSON.stringify({ t: 'snapshot', id, d: a.snapshot }));
        }
        case 'detach': { const u = attached.get(id); if (u) { u(); attached.delete(id); } return; }
        case 'input': if (typeof f.d === 'string') hub.write(id, f.d); return;
        case 'resize': hub.resize(id, f.cols, f.rows); return;
        case 'ping': return ws.send(JSON.stringify({ t: 'pong' }));
      }
    });
    ws.on('close', () => { clearTimeout(authTimer); sockets.delete(ws); for (const u of attached.values()) u(); });
  });

  const close = () => new Promise((resolve) => {
    if (routerTimer) clearInterval(routerTimer);
    for (const ws of sockets) ws.terminate();
    hub.killAll();
    wss.close();
    server.close(() => resolve());
  });

  return { server, hub, hive, token, workspace, close };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  const gw = createGateway();
  gw.server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? (Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address || 'localhost') : host;
    console.log(`Munder Difflin mobile gateway on http://${host}:${port}`);
    console.log(`  hive:      ${gw.hive.root}`);
    console.log(`  workspace: ${gw.workspace}`);
    console.log(`  pair URL:  http://${shown}:${port}/#t=${gw.token}`);
    console.log('  (the token rides the URL fragment, which browsers never send to the server)');
  });
  const stop = () => gw.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

module.exports = { createGateway, tokenEquals };
