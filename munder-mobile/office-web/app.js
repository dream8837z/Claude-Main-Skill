/* Munder Office — app: Linux VM (v86) + office floor + Claude agents. */
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const enc = new TextEncoder(), dec = new TextDecoder();
const HOME = '/home/agent', KEY = 'munder-office-v2';
const uid = () => Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { Floor, desks, portrait, CAST } = window.MunderOffice;

/* ================= state ================= */
const SEED_FILES = {
  'README.md': '# 예시 프로젝트: 종이 주문 집계\n\n이 폴더는 오피스 VM(리눅스)의 /home/agent 입니다.\n에이전트가 여기서 명령을 실행하고 파일을 씁니다.\n',
  'work/todo.md': '- [x] 주문 데이터 정리 (orders.csv)\n- [ ] 합계 스크립트 검증 (total.sh)\n- [ ] 릴리스 노트 작성\n',
  'work/orders.csv': 'item,qty,price\nA4 용지,10,4500\n복사지 B5,4,3900\n봉투,25,120\n',
  'work/total.sh': '#!/bin/sh\n# orders.csv 합계 계산\nawk -F, \'NR>1 { s += $2 * $3 } END { print "합계:", s }\' "${1:-orders.csv}"\n'
};
function seed() {
  return {
    agents: [
      { id: 'michael', name: 'Michael', cast: 'michael', engine: 'ai', role: '오케스트레이터 (god)', seat: 'ceo', god: true, log: [] },
      { id: 'pam', name: 'Pam', cast: 'pam', engine: 'shell', role: '내가 직접 쓰는 VM 터미널', seat: 'b1', port: 1, log: [] },
      { id: 'jim', name: 'Jim', cast: 'jim', engine: 'ai', role: '스크립트·문서 담당', seat: 'b3', log: [] },
      { id: 'dwight', name: 'Dwight', cast: 'dwight', engine: 'ai', role: '검증·테스트 담당', seat: 'c2', log: [] }
    ],
    tasks: [
      { id: 't1', title: '주문 데이터 정리', assignee: 'pam', status: 'done' },
      { id: 't2', title: '합계 스크립트 검증', assignee: 'dwight', status: 'doing' },
      { id: 't3', title: '배포 대상 결정', assignee: 'michael', status: 'blocked', qa: [{ q: '스테이징에 먼저 배포할까요, 바로 프로덕션으로 갈까요?' }] }
    ],
    messages: [
      { id: 'm1', from: 'michael', to: 'human', body: '안녕하세요, Michael입니다. (예시 대화) 지시를 주시면 일을 나눠 Jim·Dwight에게 맡기고, 그들은 오피스 VM에서 실제로 명령을 실행합니다.', at: now(), read: true },
      { id: 'm2', from: 'michael', to: 'dwight', body: 'work/total.sh를 실행해서 orders.csv 합계가 맞는지 손으로 검산하고, 결과를 work/VERIFY.md에 적어 주세요.', at: now(), read: false, task: 't2' }
    ],
    files: SEED_FILES,
    current: 'michael'
  };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
if (!S || !Array.isArray(S.agents)) S = seed();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage blocked */ } };
const agentById = (id) => S.agents.find((a) => a.id === id);
const busy = new Map(); // id -> phase text
const lastOut = {};    // port -> ts

/* ================= VM ================= */
const VM = { state: 'off', emu: null, ports: [[], [], []], sinks: [null, null, null], error: '' };
function vmSetState(st, err) { VM.state = st; VM.error = err || ''; floor.vmState = st === 'ready' ? 'on' : st; renderVmTab(); renderAll(); }
async function fetchBuf(url, onBytes) {
  // Binary images ship as base64 text (.b64.txt): artifacts only serve web media types.
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const reader = r.body.getReader(), chunks = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); onBytes(value.length); }
  const text = chunks.map((c) => dec.decode(c, { stream: true })).join('') + dec.decode();
  const bin = atob(text.trim()), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function bootVM() {
  if (VM.state === 'boot' || VM.state === 'ready') return;
  vmSetState('boot'); vmLine('[office] VM 이미지 내려받는 중…\r\n');
  try {
    if (!window.V86) throw new Error('v86 엔진을 불러오지 못했습니다');
    let got = 0; const total = Math.ceil((2350720 + 131072 + 36352) * 4 / 3); const tick = (n) => { got += n; $('#vmProg').textContent = `${Math.min(100, Math.round(got / total * 100))}%`; };
    const [bios, vga, kernel] = await Promise.all([fetchBuf('vm/seabios.b64.txt', tick), fetchBuf('vm/vgabios.b64.txt', tick), fetchBuf('vm/linux-bzimage.b64.txt', tick)]);
    vmLine('[office] 리눅스 부팅 중…\r\n');
    const emu = new window.V86({
      wasm_path: 'vm/v86.wasm', memory_size: 96 * 1024 * 1024, vga_memory_size: 2 * 1024 * 1024,
      bios: { buffer: bios }, vga_bios: { buffer: vga }, bzimage: { buffer: kernel },
      cmdline: 'console=ttyS0 tsc=reliable mitigations=off random.trust_cpu=on loglevel=5',
      filesystem: {}, uart1: true, uart2: true, autostart: true,
      disable_keyboard: true, disable_mouse: true, disable_speaker: true, screen_container: null
    });
    VM.emu = emu;
    let text0 = '';
    for (let p = 0; p < 3; p++) {
      emu.add_listener(`serial${p}-output-byte`, (b) => {
        const q = VM.ports[p]; q.push(b); if (q.length > 300000) q.splice(0, 100000);
        lastOut[p] = Date.now();
        if (VM.sinks[p]) VM.sinks[p].push(b);
        if (p === 0 && VM.state === 'boot') text0 += String.fromCharCode(b);
      });
    }
    const t0 = Date.now();
    while (!text0.includes('VM ready')) { if (Date.now() - t0 > 90000) throw new Error('부팅 시간이 초과됐습니다'); await sleep(150); }
    await exec('mkdir -p .munder/tmp', 15000);
    await restoreFiles();
    vmSetState('ready');
    for (const a of S.agents) if (a.engine === 'shell' && a.port) VM.emu.serial_send_bytes(a.port, enc.encode('\n'));
  } catch (e) {
    vmSetState('error', String(e && e.message || e));
    vmLine(`\r\n[office] VM을 시작하지 못했습니다: ${VM.error}\r\n`);
  }
}
function vmLine(s) { const bytes = enc.encode(s); for (const b of bytes) VM.ports[0].push(b); if (VM.sinks[0]) VM.sinks[0].push(...bytes); }
function flushSinks() { for (let p = 0; p < 3; p++) { const s = VM.sinks[p]; if (s && s.length) { terms[p].write(new Uint8Array(s)); s.length = 0; } } }
const p9 = (vmPath) => { const p = vmPath.startsWith(HOME) ? vmPath.slice(HOME.length) : vmPath; return p.startsWith('/') ? p : '/' + p; };
function normPath(p, cwd = HOME) {
  const parts = (String(p).startsWith('/') ? String(p) : cwd + '/' + p).split('/'); const out = [];
  for (const x of parts) { if (!x || x === '.') continue; if (x === '..') out.pop(); else out.push(x); }
  const r = '/' + out.join('/');
  if (r !== HOME && !r.startsWith(HOME + '/')) throw new Error(`${p}: ${HOME} 밖에는 접근할 수 없습니다`);
  return r;
}
let lastJob = null;
async function exec(cmd, timeoutMs = 60000) {
  if (!VM.emu) throw new Error('VM이 아직 준비되지 않았습니다');
  const id = 'j' + uid(), dir = '/.munder/run/';
  const pre = lastJob ? `rm -f ${HOME}/.munder/run/${lastJob}.out ${HOME}/.munder/run/${lastJob}.code\n` : '';
  lastJob = id;
  await VM.emu.create_file(dir + id + '.sh', enc.encode(pre + `cd ${HOME}\n` + cmd + '\n'));
  const t0 = Date.now();
  for (;;) {
    await sleep(200);
    let code = null; try { code = parseInt(dec.decode(await VM.emu.read_file(dir + id + '.code')), 10); } catch { /* not done */ }
    if (code !== null && !Number.isNaN(code)) {
      let out = ''; try { out = dec.decode(await VM.emu.read_file(dir + id + '.out')); } catch { out = ''; }
      return { code, out };
    }
    if (Date.now() - t0 > timeoutMs) return { code: 124, out: `(시간 초과: ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다)` };
  }
}
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
async function writeVmFile(vmPath, content) {
  const tmp = '/.munder/tmp/' + uid();
  await VM.emu.create_file(tmp, enc.encode(content));
  const r = await exec(`mkdir -p ${shq(vmPath.replace(/\/[^/]*$/, '') || HOME)} && mv ${shq(HOME + tmp)} ${shq(vmPath)}`, 15000);
  if (r.code !== 0) throw new Error(r.out.trim() || '파일을 쓰지 못했습니다');
}
async function readVmFile(vmPath) { return dec.decode(await VM.emu.read_file(p9(vmPath))); }
async function restoreFiles() {
  const files = S.files || {}; const dirs = new Set();
  for (const p of Object.keys(files)) { const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; if (d) dirs.add(d); }
  if (dirs.size) await exec('mkdir -p ' + [...dirs].map(shq).join(' '), 15000);
  for (const [p, c] of Object.entries(files)) { try { await VM.emu.create_file('/' + p, enc.encode(c)); } catch { /* skip */ } }
  if (Object.keys(files).some((p) => p.endsWith('.sh'))) await exec("find . -name '*.sh' ! -path './.munder/*' -exec chmod +x {} +", 15000);
}
let snapBusy = false;
async function snapshotFiles() {
  if (VM.state !== 'ready' || snapBusy) return; snapBusy = true;
  try {
    const r = await exec("find . -type f ! -path './.munder/*' -size -48k | head -80", 15000);
    const files = {};
    for (const line of r.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const p = line.replace(/^\.\//, ''); try { files[p] = await readVmFile(HOME + '/' + p); } catch { /* vanished */ }
    }
    S.files = files; save();
  } catch { /* VM busy */ } finally { snapBusy = false; }
}
setInterval(snapshotFiles, 45000);
window.addEventListener('pagehide', save);

/* ================= terminals ================= */
setInterval(() => flushSinks(), 30);
const TERM_THEME = { background: '#15111A', foreground: '#EDE5DE', cursor: '#F4D35E', selectionBackground: '#6E142380', black: '#2B2530', red: '#FF8A80', green: '#7FD8A2', yellow: '#F4D35E', blue: '#7FB2F0', magenta: '#D59AE8', cyan: '#76D3D6', white: '#EDE5DE' };
const terms = [0, 1, 2].map((p) => {
  const t = new window.Terminal({ fontSize: 13, fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace', theme: TERM_THEME, cursorBlink: true, scrollback: 4000, convertEol: false });
  const fit = new window.FitAddon.FitAddon(); t.loadAddon(fit);
  const host = el('div', 'xhost'); host.hidden = true; t._host = host; t._fit = fit; t._opened = false; t._port = p;
  t.onData((d) => { if (VM.emu && VM.state === 'ready') VM.emu.serial_send_bytes(p, enc.encode(d)); });
  return t;
});
function showTerm(p, container) {
  const t = terms[p];
  for (const x of terms) if (x !== t) x._host.hidden = true;
  if (t._host.parentNode !== container) container.append(t._host);
  t._host.hidden = false;
  if (!t._opened) { t.open(t._host); t._opened = true; t.write(new Uint8Array(VM.ports[p])); VM.sinks[p] = []; }
  requestAnimationFrame(() => { try { t._fit.fit(); } catch { /* hidden */ } });
  return t;
}
new ResizeObserver(() => { for (const t of terms) if (t._opened && !t._host.hidden) { try { t._fit.fit(); } catch { /* noop */ } } }).observe(document.body);

/* ================= Claude ================= */
let sample = null, aiState = 'loading', toolsOk = false;
const AI_COPY = {
  not_granted: 'Claude 사용이 허용되지 않아 AI 에이전트가 쉬고 있습니다. VM 터미널은 그대로 쓸 수 있습니다.',
  sampling_disabled: '이 계정에서는 Claude를 쓸 수 없어 AI 에이전트가 쉬고 있습니다.',
  rate_limited: '요청이 많아 잠시 쉬어야 합니다. 조금 뒤 다시 시도하세요.',
  session_expired: '다시 로그인한 뒤 시도하세요.', invalid_json: 'Claude 답을 읽지 못했습니다. 다시 시도하세요.',
  refused: 'Claude가 이 요청을 거절했습니다. 요청을 바꿔 보세요.', prompt_too_large: '보낼 내용이 너무 큽니다. 요청을 줄여 주세요.',
  default: '연결 문제로 답을 받지 못했습니다. 다시 시도하세요.'
};
const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
function aiError(e) { const code = e && e.code || 'upstream_error'; if (PERMANENT.has(code)) { aiState = 'off'; setAiNote(AI_COPY[code] || AI_COPY.not_granted); } return AI_COPY[code] || AI_COPY.default; }
function setAiNote(t) { for (const n of document.querySelectorAll('.ai-note')) { n.hidden = !t; n.textContent = t || ''; } }
async function initAI() {
  try { sample = window.claude ? await window.claude.use('sample') : null; } catch { sample = null; }
  aiState = sample ? 'on' : 'off';
  if (sample) { try { const l = await sample.limits(); toolsOk = !!(l && l.tools); } catch { toolsOk = false; } }
  else setAiNote('이 화면에서는 Claude에 연결할 수 없어 AI 에이전트가 쉬고 있습니다. VM 터미널과 보드는 그대로 동작합니다.');
  renderAll();
}

const roster = () => S.agents.map((a) => `- ${a.id} (${a.name}, ${a.engine === 'ai' ? 'Claude 에이전트: VM에서 명령 실행 가능' : '사람이 직접 쓰는 VM 터미널'}): ${a.role || ''}`).join('\n');
const taskList = () => S.tasks.map((t) => `- ${t.id} [${t.status}] ${t.title} (담당: ${t.assignee || '없음'})`).join('\n') || '(없음)';
async function tree() { if (VM.state !== 'ready') return '(VM 부팅 전)'; try { return (await exec("find . ! -path './.munder*' ! -name . | head -60", 15000)).out.trim() || '(비어 있음)'; } catch { return '(읽지 못함)'; } }

function postMsg(from, to, body, extra = {}) {
  const m = { id: 'm' + uid(), from, to, body: String(body).slice(0, 4000), at: now(), read: false, ...extra };
  S.messages.push(m); if (S.messages.length > 300) S.messages.splice(0, S.messages.length - 300);
  if (from !== 'human' && to !== 'human') floor.fly(from, to);
  return m;
}
const say = (a, kind, text) => { a.log.push([kind, String(text)]); if (a.log.length > 500) a.log.splice(0, a.log.length - 500); };

async function sendToMichael(text) {
  const god = agentById('michael');
  postMsg('human', 'michael', text);
  if (aiState !== 'on') { postMsg('michael', 'human', '(Claude 연결이 꺼져 있어 Michael이 답할 수 없습니다. 메시지는 받은 메일에 남겨 두었습니다.)'); save(); renderAll(); return; }
  busy.set('michael', 'thinking'); say(god, 'in', `› ${text}`); renderAll();
  try {
    const recent = S.messages.slice(-12).map((m) => `${m.from} → ${m.to}: ${m.body}`).join('\n');
    const r = await sample.json(`너는 Munder Difflin 오피스의 오케스트레이터 Michael(god)이다. 사람(human)의 지시를 받아 일을 쪼개고 팀원에게 위임한다. 직접 구현하지 않는다.
오피스에는 진짜 리눅스 VM(busybox, sh, awk, sed, grep, vi 등; 인터넷·패키지 설치 없음)이 있고 작업 폴더는 ${HOME} 이다.
팀원:
${roster()}
태스크:
${taskList()}
작업 폴더:
${await tree()}
최근 메시지:
${recent}

사람의 새 메시지: """${text}"""

규칙: 실제 작업은 Claude 에이전트에게만 위임하라(터미널 팀원은 사람이 조작한다). 지시는 자기완결적으로 쓰고 파일 경로를 포함하라. 사람만 정할 수 있는 것은 ask로 물어라. 한국어로 짧게.
JSON 하나로만 답하라:
{"reply":"사람에게 할 말","new_tasks":[{"title":"...","assignee":"agent id 또는 null"}],"delegate":[{"to":"agent id","body":"작업 지시","task_title":"연결할 태스크 제목 또는 null"}],"ask":[{"task_title":"...","q":"질문"}],"update":[{"id":"t1","status":"todo|doing|blocked|done"}]}`, { cache: false });
    applyMichael(r);
  } catch (e) { postMsg('michael', 'human', `⚠ ${aiError(e)}`); }
  finally { busy.delete('michael'); S.messages.filter((m) => m.to === 'michael').forEach((m) => { m.read = true; }); save(); renderAll(); }
}
function applyMichael(r) {
  const god = agentById('michael'), titleToId = {};
  for (const nt of Array.isArray(r.new_tasks) ? r.new_tasks : []) {
    if (!nt || !nt.title) continue;
    const as = agentById(String(nt.assignee || '')) ? String(nt.assignee) : null;
    const t = { id: 't' + uid(), title: String(nt.title).slice(0, 120), assignee: as, status: as ? 'doing' : 'todo' };
    S.tasks.push(t); titleToId[t.title] = t.id; say(god, 'sys', `＋ 태스크: ${t.title}${as ? ` → ${as}` : ''}`);
  }
  for (const up of Array.isArray(r.update) ? r.update : []) { const t = S.tasks.find((x) => x.id === up.id); if (t && ['todo', 'doing', 'blocked', 'done'].includes(up.status)) t.status = up.status; }
  for (const dg of Array.isArray(r.delegate) ? r.delegate : []) {
    const target = agentById(String(dg.to || '')); if (!target || target.god || !dg.body) continue;
    const tid = titleToId[dg.task_title] || (S.tasks.find((t) => t.title === dg.task_title) || {}).id;
    postMsg('michael', target.id, dg.body, tid ? { task: tid } : {}); say(god, 'sys', `✉ ${target.name}: ${String(dg.body).slice(0, 90)}`);
  }
  for (const ask of Array.isArray(r.ask) ? r.ask : []) {
    if (!ask || !ask.q) continue;
    let t = S.tasks.find((x) => x.title === ask.task_title);
    if (!t) { t = { id: 't' + uid(), title: String(ask.task_title || '결정 필요').slice(0, 120), assignee: 'michael', status: 'blocked' }; S.tasks.push(t); }
    t.status = 'blocked'; (t.qa ||= []).push({ q: String(ask.q) });
  }
  postMsg('michael', 'human', r.reply || '처리했습니다.');
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…(${s.length - n}자 생략)` : s);
function agentTools(a, ctx) {
  return [
    { name: 'run_command', description: `오피스 리눅스 VM에서 셸 명령을 실행한다(busybox sh, 작업 폴더 ${HOME}). 종료 코드와 출력(stdout+stderr)을 돌려준다. 인터넷과 패키지 설치는 없다.`,
      inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      async execute(i) { const cmd = String(i.command || ''); busy.set(a.id, 'running'); say(a, 'cmd', `$ ${cmd}`); renderAgentLive(a);
        const r = await exec(cmd, 60000); say(a, r.code ? 'err' : 'out', clip(r.out.replace(/\s+$/, ''), 1500) || `(출력 없음, 종료 코드 ${r.code})`); busy.set(a.id, 'thinking'); renderAgentLive(a);
        return { exit_code: r.code, output: clip(r.out, 6000) }; } },
    { name: 'write_file', description: `VM의 파일을 통째로 쓴다(없으면 만들고 폴더도 만든다). 경로는 ${HOME} 아래.`,
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute(i) { const p = normPath(String(i.path || '')); busy.set(a.id, 'writing'); await writeVmFile(p, String(i.content ?? '')); say(a, 'ok', `✎ ${p.replace(HOME, '~')} 저장 (${String(i.content ?? '').length}자)`); busy.set(a.id, 'thinking'); renderAgentLive(a); return 'saved'; } },
    { name: 'read_file', description: 'VM의 파일 내용을 읽는다.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute(i) { const p = normPath(String(i.path || '')); say(a, 'sys', `읽기 ${p.replace(HOME, '~')}`); renderAgentLive(a); return clip(await readVmFile(p), 12000); } },
    { name: 'send_message', description: '다른 에이전트나 michael에게 하이브 메시지를 보낸다. 작업을 마치면 michael에게 짧게 보고한다.',
      inputSchema: { type: 'object', properties: { to: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'body'] },
      async execute(i) { const to = String(i.to || 'michael'); if (!agentById(to)) throw new Error(`${to}: 없는 에이전트`); postMsg(a.id, to, String(i.body || '')); ctx.reported = true; say(a, 'ok', `✉ → ${to}`); renderAll(); return 'sent'; } }
  ];
}
async function runAgent(a, request, inbox) {
  if (aiState !== 'on') { say(a, 'err', 'Claude 연결이 꺼져 있어 이 에이전트는 일할 수 없습니다.'); renderAll(); return; }
  if (VM.state !== 'ready') { say(a, 'err', 'VM이 아직 부팅 중입니다. 잠시 뒤 다시 시도하세요.'); renderAll(); return; }
  busy.set(a.id, 'thinking'); renderAll();
  const ctx = { reported: false };
  const base = `너는 Munder Difflin 오피스의 에이전트 ${a.name}(id: ${a.id})이다. 역할: ${a.role || '일반'}.
오피스의 진짜 리눅스 VM(busybox: sh, awk, sed, grep, find, vi 등; 인터넷·패키지 설치 없음)에서 일한다. 작업 폴더는 ${HOME}.
팀원:
${roster()}
작업 폴더:
${await tree()}

할 일:
${request}
`;
  try {
    let summary;
    if (toolsOk) {
      const r = await sample(base + `\n도구로 VM에서 실제로 실행·확인하며 일을 끝내라. 끝나면 send_message로 michael에게 결과를 보고하고, 마지막에 한국어로 2~4줄 요약을 써라.`,
        { tools: agentTools(a, ctx), onText: () => {} });
      summary = r.text.trim().split('\n\n').pop();
    } else {
      const r = await sample.json(base + `\nJSON 하나로만 답하라: {"commands":["VM에서 차례로 실행할 셸 명령"],"files":[{"path":"...","content":"..."}],"report":"michael에게 보낼 보고","say":"요약"}`, { cache: false });
      const tools = agentTools(a, ctx);
      for (const f of Array.isArray(r.files) ? r.files : []) if (f && f.path) await tools[1].execute(f);
      for (const c of Array.isArray(r.commands) ? r.commands.slice(0, 8) : []) await tools[0].execute({ command: c });
      if (r.report) await tools[3].execute({ to: 'michael', body: r.report });
      summary = r.say;
    }
    if (summary) say(a, 'ai', summary);
    if (!ctx.reported && summary) postMsg(a.id, 'michael', summary);
    for (const m of inbox || []) { m.read = true; const t = S.tasks.find((x) => x.id === m.task); if (t) t.status = 'done'; }
  } catch (e) { say(a, 'err', `⚠ ${aiError(e)}`); }
  finally { busy.delete(a.id); save(); renderAll(); snapshotFiles(); }
}

/* ================= UI ================= */
const floor = new Floor($('#floor'), { onPick: (h) => { if (h.type === 'vm') openTab('vm'); else { S.current = h.id; save(); openTab(agentById(h.id).god ? 'michael' : 'agent'); } } });
function layoutFloor() { const box = $('#floorWrap').getBoundingClientRect(); floor.resize(box.width, box.height); }
new ResizeObserver(layoutFloor).observe($('#floorWrap'));

const unread = (id) => S.messages.filter((m) => m.to === id && !m.read).length;
function bubbleFor(a, p) {
  if (p && p.route && p.route.length) return 'starting up';
  if (a.engine === 'shell') { if (VM.state !== 'ready') return 'starting up'; return Date.now() - (lastOut[a.port] || 0) < 2500 ? 'working' : 'idle'; }
  const b = busy.get(a.id); if (b) return b;
  if (a.god) return S.tasks.some((t) => (t.qa || []).some((q) => !q.a)) ? 'awaiting you' : 'idle';
  return unread(a.id) ? `awaiting (${unread(a.id)})` : 'idle';
}
function syncFloor() {
  const ids = new Set(S.agents.map((a) => a.id));
  for (const id of [...floor.people.keys()]) if (!ids.has(id)) floor.remove(id);
  for (const a of S.agents) {
    const p = floor.people.get(a.id), bubble = bubbleFor(a, p);
    floor.upsert({ id: a.id, name: a.name, cast: a.cast, seat: a.seat, god: a.god, bubble, active: !['idle', 'awaiting you'].includes(bubble) && !bubble.startsWith('awaiting') });
  }
  floor.selected = S.current;
}
setInterval(syncFloor, 400);

let tab = 'michael';
function openTab(t) { tab = t; renderAll(); if (matchMedia('(max-width: 900px)').matches) $('#panel').scrollIntoView({ block: 'nearest' }); }
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => openTab(b.dataset.tab));

function renderAll() {
  syncFloor();
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const v of document.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== tab;
  const chatU = S.messages.filter((m) => m.to === 'human' && !m.read).length, asks = S.tasks.filter((t) => (t.qa || []).some((q) => !q.a)).length;
  $('#chatBadge').hidden = !chatU; $('#chatBadge').textContent = chatU;
  $('#boardBadge').hidden = !asks; $('#boardBadge').textContent = asks;
  $('#vmChip').textContent = { off: 'VM 꺼짐', boot: 'VM 부팅 중', ready: 'VM 실행 중 · Linux 6.6 i686', error: 'VM 오류' }[VM.state];
  $('#vmChip').dataset.st = VM.state;
  if (tab === 'agent') renderAgent(); if (tab === 'michael') renderChat(); if (tab === 'board') renderBoard(); if (tab === 'vm') renderVmTab();
  renderRoster();
}
function renderRoster() {
  const ul = $('#roster'); ul.textContent = '';
  for (const a of S.agents) {
    const b = el('button', 'who'); b.type = 'button'; b.setAttribute('aria-current', String(a.id === S.current && tab === 'agent'));
    b.append(portrait(a.cast, 2), el('span', null, a.name));
    const u = unread(a.id); if (u && !a.god) b.append(el('b', 'dot', String(u)));
    b.addEventListener('click', () => { S.current = a.id; save(); openTab(a.god ? 'michael' : 'agent'); });
    ul.append(b);
  }
  const add = el('button', 'who add', '+ 고용'); add.type = 'button'; add.addEventListener('click', openHire); ul.append(add);
}
function renderAgent() {
  const a = agentById(S.current) || S.agents.find((x) => !x.god);
  if (!a || a.god) { tab = 'michael'; return renderAll(); }
  S.current = a.id;
  const head = $('#agentHead'); head.textContent = '';
  const info = el('div', 'ainfo'); info.append(el('strong', null, a.name), el('span', 'pill' + (a.engine === 'ai' ? ' ai' : ''), a.engine === 'ai' ? 'Claude 에이전트' : `VM 터미널 ttyS${a.port}`), el('div', 'muted', a.role || ''));
  head.append(portrait(a.cast, 2), info);
  const acts = el('div', 'acts');
  const ms = S.messages.filter((m) => m.to === a.id && !m.read);
  if (a.engine === 'ai') {
    const ib = el('button', 'btn', ms.length ? `받은 메일 ${ms.length}건 처리` : '받은 메일 없음'); ib.type = 'button'; ib.disabled = !ms.length || busy.has(a.id);
    ib.addEventListener('click', () => { say(a, 'in', `› 받은 메일 ${ms.length}건 처리`); runAgent(a, ms.map((m) => `[${m.from}의 메시지] ${m.body}`).join('\n\n'), ms); });
    acts.append(ib);
  }
  const fire = el('button', 'btn ghost', '퇴사'); fire.type = 'button'; fire.addEventListener('click', () => fireAgent(a)); acts.append(fire);
  head.append(acts);
  $('#aiBody').hidden = a.engine !== 'ai'; $('#shellBody').hidden = a.engine !== 'shell';
  if (a.engine === 'shell') { showTerm(a.port, $('#shellHost')); renderKeybar(a.port); }
  else renderAgentLive(a);
}
function renderAgentLive(a) {
  if (tab !== 'agent' || S.current !== a.id) { syncFloor(); return; }
  const log = $('#aiLog'); log.textContent = '';
  if (!a.log.length) log.append(el('div', 'sys', `${a.name}에게 할 일을 문장으로 입력하세요. Claude가 오피스 VM에서 명령을 실행하고 파일을 써서 처리합니다.\n예: work/orders.csv에 품목 3개를 추가하고 total.sh로 합계를 다시 계산해줘`));
  for (const [k, s] of a.log) log.append(el('div', k, s));
  if (busy.has(a.id)) log.append(el('div', 'sys', `● ${busy.get(a.id)}…`));
  log.scrollTop = log.scrollHeight;
  $('#aiIn').disabled = busy.has(a.id); $('#aiSend').disabled = busy.has(a.id);
  syncFloor();
}
$('#aiForm').addEventListener('submit', (e) => { e.preventDefault(); const a = agentById(S.current); const v = $('#aiIn').value.trim(); if (!v || !a || busy.has(a.id)) return; $('#aiIn').value = ''; say(a, 'in', `› ${v}`); runAgent(a, v); });

const KEYS = { esc: '\x1b', tab: '\t', ctrlc: '\x03', ctrld: '\x04', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', pipe: '|', tilde: '~', slash: '/', dash: '-' };
function renderKeybar(port) {
  const kb = $('#keybar'); kb.textContent = '';
  for (const [k, label] of [['esc', 'Esc'], ['tab', 'Tab'], ['ctrlc', '^C'], ['ctrld', '^D'], ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'], ['pipe', '|'], ['tilde', '~'], ['slash', '/'], ['dash', '-']]) {
    const b = el('button', null, label); b.type = 'button';
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (VM.state === 'ready') VM.emu.serial_send_bytes(port, enc.encode(KEYS[k])); terms[port].focus(); });
    kb.append(b);
  }
}
function renderVmTab() {
  if (tab !== 'vm') return;
  const st = $('#vmStatus');
  st.textContent = { off: 'VM이 꺼져 있습니다.', boot: '리눅스를 부팅하는 중입니다…', ready: 'Linux 6.6 (i686) · busybox · 메모리 96MB · /home/agent는 오피스와 9p로 공유됩니다.', error: `VM을 시작하지 못했습니다: ${VM.error}` }[VM.state];
  $('#vmProgWrap').hidden = VM.state !== 'boot';
  showTerm(0, $('#vmHost'));
}
function renderChat() {
  const ul = $('#feed'); ul.textContent = '';
  const nameOf = (id) => id === 'human' ? '나' : (agentById(id) || { name: id }).name;
  for (const m of S.messages.filter((m) => [m.from, m.to].some((x) => x === 'human' || x === 'michael')).slice(-80)) {
    const li = el('li', 'msg' + (m.from === 'human' ? ' me' : ''));
    li.append(el('div', 'h', `${nameOf(m.from)} → ${nameOf(m.to)} · ${new Date(m.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`), el('div', 'b', m.body));
    ul.append(li);
  }
  if (busy.has('michael')) { const li = el('li', 'msg thinking'); li.append(el('div', 'h', 'Michael'), el('div', 'b', '생각 중… 일을 나누고 있습니다')); ul.append(li); }
  S.messages.forEach((m) => { if (m.to === 'human') m.read = true; });
  $('#chatBadge').hidden = true;
  const sc = $('#feedScroll'); sc.scrollTop = sc.scrollHeight;
  $('#chatSend').disabled = busy.has('michael');
}
const chatIn = $('#chatIn');
chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
$('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); const v = chatIn.value.trim(); if (!v || busy.has('michael')) return; chatIn.value = ''; sendToMichael(v); });

const COLS = [['blocked', '막힘'], ['doing', '진행 중'], ['todo', '할 일'], ['done', '완료']];
function renderBoard() {
  const b = $('#board'); b.textContent = '';
  const asks = S.tasks.filter((t) => (t.qa || []).some((q) => !q.a));
  if (asks.length) {
    const col = el('section', 'col'); col.append(el('h3', null, `ASK ME · ${asks.length}`));
    for (const t of asks) {
      const q = t.qa.find((x) => !x.a), c = el('div', 'card ask'); c.append(el('div', 't', t.title), el('div', 'q', q.q));
      const f = el('form'), inp = el('input'); inp.required = true; inp.placeholder = '답변'; inp.id = 'ans-' + t.id; inp.setAttribute('aria-label', '답변');
      const btn = el('button', 'btn primary', '답변'); btn.type = 'submit'; f.append(inp, btn);
      f.addEventListener('submit', (e) => { e.preventDefault(); q.a = inp.value; t.status = 'doing'; save(); openTab('michael'); sendToMichael(`[ASK ME 답변] ${t.title}\nQ: ${q.q}\nA: ${inp.value}`); });
      c.append(f); col.append(c);
    }
    b.append(col);
  }
  for (const [st, label] of COLS) {
    const items = S.tasks.filter((t) => t.status === st); if (!items.length) continue;
    const col = el('section', 'col'); col.append(el('h3', null, `${label} · ${items.length}`));
    for (const t of items) { const c = el('div', 'card'); c.append(el('div', 't', t.title), el('div', 'muted', `담당: ${t.assignee ? (agentById(t.assignee) || { name: t.assignee }).name : '미정'}`)); col.append(c); }
    b.append(col);
  }
  if (!S.tasks.length) b.append(el('p', 'muted', '태스크가 없습니다. Michael에게 일을 맡기면 여기에 쌓입니다.'));
}

/* hire / fire / reset */
function freePorts() { const used = new Set(S.agents.filter((a) => a.engine === 'shell').map((a) => a.port)); return [1, 2].filter((p) => !used.has(p)); }
function openHire() {
  const sel = $('#hCast'); sel.textContent = '';
  const used = new Set(S.agents.map((a) => a.cast));
  for (const c of CAST) { if (used.has(c)) continue; const o = el('option', null, c[0].toUpperCase() + c.slice(1)); o.value = c; sel.append(o); }
  const eng = $('#hEngine'); eng.querySelector('[value=shell]').disabled = !freePorts().length;
  eng.querySelector('[value=shell]').textContent = freePorts().length ? `VM 터미널 (남은 포트 ${freePorts().length}개)` : 'VM 터미널 (포트 없음)';
  eng.value = 'ai'; $('#hRole').value = ''; previewCast(); $('#hireDlg').showModal();
}
function previewCast() { const v = $('#hCast').value; const p = $('#hPortrait'); p.textContent = ''; if (v) p.append(portrait(v, 3)); }
$('#hCast').addEventListener('change', previewCast);
$('#hireCancel').addEventListener('click', () => $('#hireDlg').close());
$('#hireForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const cast = $('#hCast').value; if (!cast) return;
  const free = desks.filter((d) => !d.boss && !S.agents.some((a) => a.seat === d.id));
  if (!free.length) { $('#hireErr').textContent = '빈 책상이 없습니다. 누군가 퇴사해야 합니다.'; return; }
  let id = cast; while (agentById(id)) id = cast + '-' + uid().slice(0, 2);
  const engine = $('#hEngine').value, a = { id, name: cast[0].toUpperCase() + cast.slice(1), cast, engine, role: $('#hRole').value.trim(), seat: free[0].id, log: [] };
  if (engine === 'shell') { a.port = freePorts()[0]; if (!a.port) { $('#hireErr').textContent = '남은 VM 터미널 포트가 없습니다.'; return; } }
  S.agents.push(a); S.current = id; $('#hireDlg').close(); save(); openTab('agent');
  if (engine === 'shell' && VM.state === 'ready') VM.emu.serial_send_bytes(a.port, enc.encode('\n'));
});
function confirmBox(title, body) {
  return new Promise((res) => {
    $('#cfTitle').textContent = title; $('#cfBody').textContent = body; const d = $('#confirmDlg');
    const done = (v) => { d.close(); $('#cfYes').onclick = $('#cfNo').onclick = null; res(v); };
    $('#cfYes').onclick = () => done(true); $('#cfNo').onclick = () => done(false); d.showModal();
  });
}
async function fireAgent(a) {
  if (a.god || !(await confirmBox(`${a.name} 퇴사`, `${a.name}이(가) 사무실을 떠납니다. VM의 파일은 남습니다.`))) return;
  S.agents = S.agents.filter((x) => x.id !== a.id); S.current = 'michael'; save(); openTab('michael');
}
$('#resetBtn').addEventListener('click', async () => {
  if (!(await confirmBox('오피스 초기화', '이 브라우저에 저장된 에이전트, 대화, 보드, 작업 파일이 예시 상태로 돌아갑니다. 실행 중인 VM의 파일은 새로고침하면 초기화됩니다.'))) return;
  S = seed(); save(); location.reload();
});

/* boot */
layoutFloor(); renderAll(); initAI(); bootVM();
})();
