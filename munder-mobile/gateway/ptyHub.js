'use strict';
/**
 * PtyHub — headless replacement for Munder Difflin's Electron PtyManager.
 *
 * The desktop app routes each PTY's bytes to ONE BrowserWindow (`pty:data:<id>`).
 * On a VM there is no window: any number of phones/tabs may attach and detach,
 * and the agent must keep running in between. So each session keeps a bounded
 * scrollback ring that is replayed on attach, and output fans out to every
 * current subscriber.
 */
const pty = require('node-pty');
const { EventEmitter } = require('node:events');
const { randomBytes } = require('node:crypto');

/** Scrollback kept per session for replay when a phone (re)attaches. */
const RING_MAX = 256 * 1024;

class PtyHub extends EventEmitter {
  constructor({ spawnImpl = pty.spawn } = {}) {
    super();
    this.spawnImpl = spawnImpl;
    /** @type {Map<string, any>} */
    this.sessions = new Map();
  }

  spawn({ id, name, provider, command, args = [], cwd, env = {}, cols = 80, rows = 30 }) {
    id = id || `a-${randomBytes(4).toString('hex')}`;
    if (this.sessions.has(id)) return { ok: false, error: `agent "${id}" already running` };
    let proc;
    try {
      proc = this.spawnImpl(command, args, {
        name: 'xterm-256color',
        cols, rows, cwd,
        env: { LANG: 'C.UTF-8', ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...env }
      });
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
    const s = {
      id, name: name || id, provider, command, args, cwd, proc,
      ring: '', startedAt: Date.now(), lastOutputAt: Date.now(),
      cols, rows, exited: false, exitCode: null, subscribers: new Set()
    };
    proc.onData((d) => {
      s.lastOutputAt = Date.now();
      s.ring += d;
      if (s.ring.length > RING_MAX) s.ring = s.ring.slice(s.ring.length - RING_MAX);
      for (const fn of s.subscribers) fn(d);
    });
    proc.onExit(({ exitCode }) => {
      s.exited = true;
      s.exitCode = exitCode;
      this.emit('exit', id, exitCode);
      this.emit('change');
    });
    this.sessions.set(id, s);
    this.emit('change');
    return { ok: true, id };
  }

  /** Subscribe to output. Returns { snapshot, unsubscribe } so the caller can
   *  paint the scrollback first and then stream live bytes without a gap. */
  attach(id, onData) {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.subscribers.add(onData);
    return { snapshot: s.ring, unsubscribe: () => s.subscribers.delete(onData) };
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return false;
    s.proc.write(data);
    return true;
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return false;
    cols = Math.max(20, Math.min(500, cols | 0));
    rows = Math.max(5, Math.min(300, rows | 0));
    try { s.proc.resize(cols, rows); s.cols = cols; s.rows = rows; } catch { return false; }
    return true;
  }

  /** Send Ctrl-C — the mobile equivalent of the desktop "interrupt" button. */
  interrupt(id) { return this.write(id, '\x03'); }

  kill(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (!s.exited) { try { s.proc.kill(); } catch { /* already gone */ } }
    s.subscribers.clear();
    this.sessions.delete(id);
    this.emit('change');
    return true;
  }

  idleFor(id) {
    const s = this.sessions.get(id);
    return s ? Date.now() - s.lastOutputAt : undefined;
  }

  has(id) { return this.sessions.has(id); }

  list() {
    return [...this.sessions.values()].map((s) => ({
      id: s.id, name: s.name, provider: s.provider, cwd: s.cwd,
      pid: s.proc.pid, startedAt: s.startedAt, lastOutputAt: s.lastOutputAt,
      exited: s.exited, exitCode: s.exitCode, viewers: s.subscribers.size
    }));
  }

  killAll() { for (const id of [...this.sessions.keys()]) this.kill(id); }
}

module.exports = { PtyHub, RING_MAX };
