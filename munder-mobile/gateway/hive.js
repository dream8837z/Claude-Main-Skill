'use strict';
/**
 * Minimal, format-compatible view of Munder Difflin's on-disk hive (see HIVE.md
 * in the upstream repo). The gateway reads registry.json / tasks.json /
 * log.jsonl and writes messages as one JSON file per message via temp-file +
 * atomic rename — the same contract the desktop app's router uses — so a hive
 * folder can be shared with (or moved from) the desktop app.
 *
 * The optional router drains each agent's outbox/ into the recipients' inbox/.
 * Run it ONLY when no desktop app is routing the same hive (MD_ROUTER=0
 * otherwise), since upstream assumes a single router/committer.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const ACTS = new Set(['request', 'inform', 'propose', 'query', 'agree', 'refuse', 'done']);
const HOP_CAP = 6;
const AGENT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

function newMsgId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(2).toString('hex')}`;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const PROTOCOL = `# Hive protocol (Munder Difflin — mobile gateway)

You are one agent in a team. Your folder is $HIVE_ROOT/agents/$MD_AGENT_ID/.

1. At the START of every task read memory.md and EVERY file in inbox/.
   Move handled messages into inbox/.done/.
2. To message another agent (or "god" / "human"), write ONE JSON file into
   your outbox/ (write to a .tmp file first, then rename to <id>.json):
   {"id":"<unique>","conversation":"<thread>","in_reply_to":null,
    "from":"<your id>","to":"<agent id | god | human | broadcast>",
    "act":"request|inform|propose|query|agree|refuse|done",
    "subject":"<short>","body":"<markdown>","hops":0,
    "requires_reply":false,"needs_human":false,"created_at":"<ISO-8601>"}
3. NEVER write into another agent's folder. The harness delivers your outbox.
4. Append what you learn to memory.md.
`;

class Hive {
  constructor(root) {
    this.root = path.resolve(root);
  }

  /** Create the minimal skeleton if this hive is new. Never overwrites. */
  ensure() {
    fs.mkdirSync(path.join(this.root, 'agents'), { recursive: true });
    const reg = path.join(this.root, 'registry.json');
    if (!fs.existsSync(reg)) atomicWriteJson(reg, { godId: 'god', agents: {} });
    const tasks = path.join(this.root, 'tasks.json');
    if (!fs.existsSync(tasks)) atomicWriteJson(tasks, []);
    const proto = path.join(this.root, 'PROTOCOL.md');
    if (!fs.existsSync(proto)) fs.writeFileSync(proto, PROTOCOL);
    const board = path.join(this.root, 'board.md');
    if (!fs.existsSync(board)) fs.writeFileSync(board, '# Board\n');
    this.ensureAgentDir(this.registry().godId || 'god');
    return this;
  }

  agentDir(id) {
    if (!AGENT_ID_RE.test(id)) throw new Error(`invalid agent id: ${id}`);
    return path.join(this.root, 'agents', id);
  }

  ensureAgentDir(id) {
    const dir = this.agentDir(id);
    for (const sub of ['inbox/.done', 'outbox/.sent']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const mem = path.join(dir, 'memory.md');
    if (!fs.existsSync(mem)) fs.writeFileSync(mem, `# Memory of ${id}\n`);
    return dir;
  }

  registry() {
    const r = readJson(path.join(this.root, 'registry.json'), null);
    return r && typeof r === 'object' ? { godId: r.godId ?? 'god', agents: r.agents ?? {} } : { godId: 'god', agents: {} };
  }

  /** Upsert one roster entry (gateway-spawned agents become visible to god). */
  register(meta) {
    const reg = this.registry();
    const prev = reg.agents[meta.id] || {};
    reg.agents[meta.id] = { ...prev, ...meta, lastSeen: Date.now() };
    if (meta.isGod) reg.godId = meta.id;
    atomicWriteJson(path.join(this.root, 'registry.json'), reg);
    this.ensureAgentDir(meta.id);
  }

  setStatus(id, patch) {
    const reg = this.registry();
    if (!reg.agents[id]) return;
    reg.agents[id] = { ...reg.agents[id], ...patch, lastSeen: Date.now() };
    atomicWriteJson(path.join(this.root, 'registry.json'), reg);
  }

  tasks() {
    const t = readJson(path.join(this.root, 'tasks.json'), []);
    return Array.isArray(t) ? t : Array.isArray(t && t.tasks) ? t.tasks : [];
  }

  /** Record the human's answer on a blocked card AND mail it to god, exactly
   *  as the desktop ASK ME board does. */
  answerTask(taskId, answer) {
    const file = path.join(this.root, 'tasks.json');
    const raw = readJson(file, []);
    const list = Array.isArray(raw) ? raw : raw.tasks;
    const task = Array.isArray(list) && list.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: 'task not found' };
    const qa = Array.isArray(task.humanQA) ? task.humanQA : [];
    const open = [...qa].reverse().find((e) => !e.a && !e.dismissedAt);
    if (!open) return { ok: false, error: 'no open question on this task' };
    open.a = answer;
    open.answeredAt = new Date().toISOString();
    atomicWriteJson(file, raw);
    const msg = this.send({
      to: 'god', act: 'inform',
      subject: `Human answered on task ${taskId}: ${task.title}`,
      body: `**Q:** ${open.q}\n\n**A:** ${answer}`
    }, 'human');
    return { ok: true, message: msg };
  }

  normalize(p, from) {
    const act = ACTS.has(p.act) ? p.act : 'inform';
    return {
      id: typeof p.id === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(p.id) ? p.id : newMsgId(),
      conversation: typeof p.conversation === 'string' && p.conversation ? p.conversation : `conv-${randomBytes(3).toString('hex')}`,
      in_reply_to: p.in_reply_to ?? null,
      from: typeof p.from === 'string' && p.from ? p.from : from,
      to: typeof p.to === 'string' && p.to ? p.to : 'god',
      act,
      subject: String(p.subject ?? '').slice(0, 300),
      body: String(p.body ?? '').slice(0, 64 * 1024),
      hops: Math.max(0, Math.min(HOP_CAP, Number(p.hops) || 0)),
      requires_reply: p.requires_reply ?? (act === 'request' || act === 'query' || act === 'propose'),
      needs_human: Boolean(p.needs_human),
      created_at: p.created_at ?? new Date().toISOString()
    };
  }

  resolveTargets(msg) {
    const reg = this.registry();
    const godId = reg.godId || 'god';
    if (msg.to === 'broadcast') {
      return Object.values(reg.agents)
        .filter((a) => a && a.id !== msg.from && !a.archived && !a.isAssistant)
        .map((a) => a.id);
    }
    const t = msg.to === 'human' || msg.to === 'god' ? godId : msg.to;
    return t === msg.from ? [] : [t];
  }

  /** Inject a message (mobile → hive). Returns the delivered message. */
  send(partial, from = 'human') {
    const msg = this.normalize(partial, from);
    const delivered = [];
    for (const t of this.resolveTargets(msg)) {
      if (!AGENT_ID_RE.test(t)) continue;
      const inbox = path.join(this.agentDir(t), 'inbox');
      if (!fs.existsSync(inbox)) continue;
      atomicWriteJson(path.join(inbox, `${msg.id}.json`), msg);
      delivered.push(t);
    }
    this.appendLog({ kind: 'msg', id: msg.id, from: msg.from, to: msg.to, act: msg.act, delivered });
    return { ...msg, delivered };
  }

  /** Drain every outbox into recipients' inboxes. Returns [{msg, targets}]. */
  route() {
    const out = [];
    const agentsDir = path.join(this.root, 'agents');
    let ids = [];
    try { ids = fs.readdirSync(agentsDir); } catch { return out; }
    for (const id of ids) {
      if (!AGENT_ID_RE.test(id)) continue;
      const outbox = path.join(agentsDir, id, 'outbox');
      let files = [];
      try { files = fs.readdirSync(outbox).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const f of files) {
        const full = path.join(outbox, f);
        fs.mkdirSync(path.join(outbox, '.sent'), { recursive: true });
        const raw = readJson(full, null);
        if (!raw || typeof raw !== 'object') {
          try { fs.renameSync(full, path.join(outbox, '.sent', `bad-${f}`)); } catch { /* noop */ }
          continue;
        }
        // The sender is the folder owner — an agent can't spoof another's id.
        const sent = this.send({ ...raw, from: id }, id);
        // Archive the NORMALIZED message (id, created_at…) so the feed can show
        // it even when it had no recipient — e.g. god → "human" resolves to god
        // itself, and the phone is where the human reads it.
        const { delivered, ...normalized } = sent;
        try { atomicWriteJson(path.join(outbox, '.sent', f), normalized); fs.unlinkSync(full); } catch { /* noop */ }
        out.push({ msg: sent, targets: sent.delivered });
      }
    }
    return out;
  }

  /** Messages across every mailbox, newest first (for the mobile feed). */
  messages({ agentId, limit = 100 } = {}) {
    const out = [];
    const agentsDir = path.join(this.root, 'agents');
    let ids = [];
    try { ids = agentId ? [agentId] : fs.readdirSync(agentsDir); } catch { return out; }
    const seen = new Set();
    for (const id of ids) {
      if (!AGENT_ID_RE.test(id)) continue;
      for (const [sub, direction, archived] of [['inbox', 'inbox', false], ['inbox/.done', 'inbox', true], ['outbox/.sent', 'outbox', true]]) {
        const dir = path.join(agentsDir, id, sub);
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
        for (const f of files) {
          const m = readJson(path.join(dir, f), null);
          if (!m || !m.id || seen.has(`${m.id}:${direction}`)) continue;
          seen.add(`${m.id}:${direction}`);
          out.push({ ...m, owner: id, direction, archived });
        }
      }
    }
    out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    // A routed message exists as the sender's outbox/.sent copy AND the
    // recipient's inbox copy; keep one per id for the feed.
    const byId = new Map();
    for (const m of out) if (!byId.has(m.id) || m.direction === 'inbox') byId.set(m.id, m);
    return [...byId.values()]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, Math.max(1, Math.min(500, limit)));
  }

  unreadCount(id) {
    try {
      return fs.readdirSync(path.join(this.agentDir(id), 'inbox')).filter((f) => f.endsWith('.json')).length;
    } catch { return 0; }
  }

  appendLog(entry) {
    try {
      fs.appendFileSync(path.join(this.root, 'log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    } catch { /* log is best-effort */ }
  }
}

module.exports = { Hive, newMsgId, AGENT_ID_RE, PROTOCOL };
