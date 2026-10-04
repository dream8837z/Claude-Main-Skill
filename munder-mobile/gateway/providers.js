'use strict';
/**
 * The agent CLIs the gateway may launch — the same set Munder Difflin wraps.
 * The phone picks a provider ID, never a raw command line, so a leaked token
 * can't be turned into an arbitrary `command` string in one request (though a
 * `shell` agent is, by design, a full shell: the token is the real boundary).
 */
const { spawnSync } = require('node:child_process');

const HIVE_HINT = 'You are part of a Munder Difflin hive. Read $HIVE_ROOT/PROTOCOL.md now and follow it: your agent id is $MD_AGENT_ID.';

const PROVIDERS = {
  claude:   { label: 'Claude Code', command: 'claude', args: (hint) => ['--append-system-prompt', hint] },
  codex:    { label: 'Codex',       command: 'codex' },
  gemini:   { label: 'Gemini CLI',  command: 'gemini' },
  qwen:     { label: 'Qwen',        command: 'qwen' },
  opencode: { label: 'OpenCode',    command: 'opencode' },
  crush:    { label: 'Crush',       command: 'crush' },
  copilot:  { label: 'Copilot CLI', command: 'copilot' },
  cursor:   { label: 'Cursor',      command: 'cursor-agent' },
  grok:     { label: 'Grok',        command: 'grok' },
  kimi:     { label: 'Kimi Code',   command: 'kimi' },
  shell:    { label: 'Shell',       command: process.env.SHELL || 'bash', args: () => ['-l'] }
};

function isInstalled(command) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [command] : ['-c', `command -v "${command}"`], { stdio: 'ignore' });
  return r.status === 0;
}

/** Providers with an `installed` flag, filtered by MD_PROVIDERS if set. */
function listProviders(allow = process.env.MD_PROVIDERS) {
  const allowed = allow ? new Set(allow.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  return Object.entries(PROVIDERS)
    .filter(([id]) => !allowed || allowed.has(id))
    .map(([id, p]) => ({ id, label: p.label, command: p.command, installed: isInstalled(p.command) }));
}

function resolveProvider(id, allow = process.env.MD_PROVIDERS) {
  const p = PROVIDERS[id];
  if (!p) return null;
  if (allow && !allow.split(',').map((s) => s.trim()).includes(id)) return null;
  return { id, command: p.command, args: p.args ? p.args(HIVE_HINT) : [] };
}

module.exports = { PROVIDERS, listProviders, resolveProvider, HIVE_HINT };
