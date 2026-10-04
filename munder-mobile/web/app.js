/* Munder Mobile — phone client for the VM gateway. No build step. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }
  };

  // ---- pairing: token arrives in the URL fragment (#t=...), never in a request ----
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('t')) { store.set('md.token', hash.get('t')); history.replaceState(null, '', location.pathname); }
  let token = store.get('md.token');

  const state = { agents: [], current: store.get('md.current') || null, godId: 'god', tasks: [], messages: [], lastSeenMsg: store.get('md.lastSeenMsg') || '', tab: 'floor' };

  async function api(method, path, body) {
    const r = await fetch(`api/${path}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { logout('토큰이 올바르지 않습니다.'); throw new Error('unauthorized'); }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function logout(msg) {
    store.set('md.token', null); token = null;
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    $('#app').hidden = true; $('#pair').hidden = false; $('#pair-error').textContent = msg || '';
  }

  $('#pair-form').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('#pair-token').value.trim();
    store.set('md.token', token);
    start();
  });

  // ---- tabs ----
  function showTab(name) {
    state.tab = name;
    for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('active', b.dataset.tab === name);
    for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${name}`;
    if (name === 'term') requestAnimationFrame(fitTerm);
    if (name === 'chat') { loadMessages(); }
    if (name === 'board') loadBoard();
  }
  for (const b of document.querySelectorAll('.tabbar button')) b.addEventListener('click', () => showTab(b.dataset.tab));

  // ---- websocket ----
  let ws = null, backoff = 500, pingTimer = null;
  function setConn(on, text) {
    const c = $('#conn'); c.classList.toggle('on', on); c.classList.toggle('off', !on); c.querySelector('span').textContent = text;
  }
  function wsSend(f) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(f)); }
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`);
    setConn(false, '연결 중…');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
    ws.onmessage = (ev) => {
      const f = JSON.parse(ev.data);
      switch (f.t) {
        case 'ready':
          backoff = 500; setConn(true, 'VM 연결됨');
          setAgents(f.agents);
          if (state.current) attach(state.current);
          clearInterval(pingTimer); pingTimer = setInterval(() => wsSend({ t: 'ping' }), 25000);
          break;
        case 'agents': setAgents(f.agents); break;
        case 'snapshot': if (f.id === state.current) { term.reset(); term.write(f.d); } break;
        case 'data': if (f.id === state.current) term.write(f.d); break;
        case 'exit': if (f.id === state.current) term.write(`\r\n\x1b[33m[프로세스 종료: code ${f.code}]\x1b[0m\r\n`); break;
        case 'hive': loadMessages(); if (state.tab === 'board') loadBoard(); break;
      }
    };
    ws.onclose = (ev) => {
      clearInterval(pingTimer);
      if (ev.code === 4003) return logout('토큰이 올바르지 않습니다.');
      setConn(false, '재연결 대기…');
      setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 10000);
    };
  }
  document.addEventListener('visibilitychange', () => {
    // Phones freeze background tabs; reconnect promptly when we come back.
    if (!document.hidden && token && (!ws || ws.readyState > 1)) { backoff = 500; connect(); }
  });

  // ---- floor ----
  function initials(n) { return (n || '?').trim().slice(0, 1).toUpperCase(); }
  function ago(ms) { const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.round(s / 60)}분 전` : `${Math.round(s / 3600)}시간 전`; }
  function setAgents(list) {
    state.agents = list;
    const god = list.find((a) => a.isGod); if (god) state.godId = god.id;
    const ul = $('#agent-list'); ul.textContent = '';
    $('#agents-empty').hidden = list.length > 0;
    for (const a of list) {
      const idle = Date.now() - a.lastOutputAt > 8000;
      const li = el('li', `agent${a.isGod ? ' god' : ''}${a.exited ? ' exited' : idle ? ' idle' : ''}`);
      li.append(el('div', 'avatar', initials(a.name)));
      const meta = el('div', 'meta');
      const name = el('div', 'name', a.name);
      if (a.isGod) name.append(el('span', 'chip', 'Michael'));
      if (a.unread) name.append(el('span', 'chip mail', `✉ ${a.unread}`));
      meta.append(name, el('div', 'sub', `${a.provider} · ${a.exited ? '종료됨' : idle ? `대기 · ${ago(a.lastOutputAt)}` : '작업 중'} · ${a.cwd}`));
      if (a.role) meta.append(el('div', 'sub', a.role));
      const open = el('button', 'btn sm open', '열기');
      open.addEventListener('click', () => { attach(a.id); showTab('term'); });
      li.append(meta, open);
      ul.append(li);
    }
    const sel = $('#term-select'); sel.textContent = '';
    for (const a of list) { const o = el('option', null, `${a.name} (${a.provider})`); o.value = a.id; sel.append(o); }
    if (state.current) sel.value = state.current;
    const to = $('#chat-to'); const prev = to.value; to.textContent = '';
    const godOpt = el('option', null, 'Michael (god)'); godOpt.value = 'god'; to.append(godOpt);
    const all = el('option', null, '전체 방송'); all.value = 'broadcast'; to.append(all);
    for (const a of list) if (!a.isGod) { const o = el('option', null, a.name); o.value = a.id; to.append(o); }
    to.value = prev && [...to.options].some((o) => o.value === prev) ? prev : 'god';
    if (state.current && !list.some((a) => a.id === state.current)) detach();
  }

  // ---- terminal ----
  const term = new window.Terminal({
    fontSize: Number(store.get('md.font')) || 12, cursorBlink: true, convertEol: false, scrollback: 5000,
    fontFamily: 'ui-monospace, Menlo, "SF Mono", "Noto Sans Mono CJK KR", monospace',
    theme: { background: '#16121a', foreground: '#efe7dc', cursor: '#F4D35E', selectionBackground: '#6E142388' }
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('#term'));
  term.onData((d) => { if (state.current) wsSend({ t: 'input', id: state.current, d }); });
  function fitTerm() {
    if ($('#tab-term').hidden) return;
    try { fit.fit(); } catch { return; }
    if (state.current) wsSend({ t: 'resize', id: state.current, cols: term.cols, rows: term.rows });
  }
  new ResizeObserver(() => fitTerm()).observe($('#term-wrap'));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitTerm);

  function attach(id) {
    if (state.current && state.current !== id) wsSend({ t: 'detach', id: state.current });
    state.current = id; store.set('md.current', id);
    $('#term-empty').hidden = true; $('#term-select').value = id;
    term.reset();
    fitTerm();
    wsSend({ t: 'attach', id, cols: term.cols, rows: term.rows });
  }
  function detach() {
    if (state.current) wsSend({ t: 'detach', id: state.current });
    state.current = null; store.set('md.current', null); term.reset(); $('#term-empty').hidden = false;
  }
  $('#term-select').addEventListener('change', (e) => attach(e.target.value));
  const setFont = (d) => { term.options.fontSize = Math.max(8, Math.min(22, term.options.fontSize + d)); store.set('md.font', String(term.options.fontSize)); fitTerm(); };
  $('#font-dec').addEventListener('click', () => setFont(-1));
  $('#font-inc').addEventListener('click', () => setFont(1));
  $('#term-kill').addEventListener('click', async () => {
    if (!state.current) return;
    const a = state.agents.find((x) => x.id === state.current);
    if (!confirm(`${a ? a.name : state.current} 에이전트를 종료할까요? (VM의 프로세스가 종료됩니다)`)) return;
    try { await api('DELETE', `agents/${encodeURIComponent(state.current)}`); detach(); } catch (e) { alert(e.message); }
  });
  const KEYS = { esc: '\x1b', tab: '\t', ctrlc: '\x03', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', enter: '\r', y: 'y', n: 'n' };
  for (const b of document.querySelectorAll('#keybar button')) {
    // pointerdown + preventDefault keeps the soft keyboard from closing.
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (state.current) wsSend({ t: 'input', id: state.current, d: KEYS[b.dataset.k] }); });
  }
  function sendLine(text) {
    if (!state.current) return;
    // Type the text, then Enter separately: TUIs treat a pasted "\r" as part of a
    // bracketed paste rather than a submit (same reason the desktop app splits it).
    wsSend({ t: 'input', id: state.current, d: text });
    setTimeout(() => wsSend({ t: 'input', id: state.current, d: '\r' }), 120);
  }
  bindComposer('#term-form', '#term-input', (v) => sendLine(v));

  function bindComposer(formSel, inputSel, onSend) {
    const form = $(formSel), input = $(inputSel);
    const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; if (!v.trim()) return; input.value = ''; grow(); onSend(v); });
  }

  /** Tiny SAFE markdown: **bold**, `code`, line breaks. Builds DOM nodes, never innerHTML. */
  function md(text) {
    const frag = document.createDocumentFragment();
    for (const part of String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (!part) continue;
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) frag.append(el('strong', null, part.slice(2, -2)));
      else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) frag.append(el('code', null, part.slice(1, -1)));
      else frag.append(document.createTextNode(part));
    }
    return frag;
  }

  // ---- Michael chat (hive mailbox) ----
  async function loadMessages() {
    let j; try { j = await api('GET', 'hive/messages?limit=150'); } catch { return; }
    const mine = j.messages.filter((m) => m.from === 'human' || m.to === 'human' || m.to === 'god' || m.from === state.godId || m.owner === state.godId);
    state.messages = mine;
    const ul = $('#msg-list'); ul.textContent = '';
    for (const m of mine) {
      const li = el('li', `msg${m.from === 'human' ? ' me' : ''}`);
      li.append(el('div', 'h', `${m.from} → ${m.to} · ${m.act} · ${new Date(m.created_at).toLocaleTimeString()}`));
      if (m.subject && m.subject !== m.body.slice(0, 60)) li.append(el('div', 'h', m.subject));
      const b = el('div', 'b'); b.append(md(m.body)); li.append(b);
      ul.append(li);
    }
    const toMe = mine.filter((m) => m.to === 'human');
    const newest = toMe[0] ? toMe[0].created_at : '';
    if (state.tab === 'chat' && newest) { state.lastSeenMsg = newest; store.set('md.lastSeenMsg', newest); }
    const unseen = toMe.filter((m) => m.created_at > state.lastSeenMsg).length;
    $('#chat-badge').hidden = !unseen; $('#chat-badge').textContent = unseen;
  }
  bindComposer('#chat-form', '#chat-input', async (v) => {
    try { await api('POST', 'hive/message', { to: $('#chat-to').value, body: v }); loadMessages(); }
    catch (e) { alert(`전송 실패: ${e.message}`); }
  });

  // ---- board ----
  const COLS = [['blocked', '막힘'], ['doing', '진행 중'], ['todo', '할 일'], ['done', '완료']];
  async function loadBoard() {
    let j; try { j = await api('GET', 'hive/summary'); } catch { return; }
    state.tasks = j.tasks; if (j.godId) state.godId = j.godId;
    const asks = j.tasks.filter((t) => Array.isArray(t.humanQA) && t.humanQA.some((q) => !q.a && !q.dismissedAt));
    $('#board-badge').hidden = !asks.length; $('#board-badge').textContent = asks.length;
    const askBox = $('#askme'); askBox.textContent = '';
    if (asks.length) askBox.append(el('div', 'col', null));
    for (const t of asks) {
      const q = [...t.humanQA].reverse().find((x) => !x.a && !x.dismissedAt);
      const card = el('div', 'card ask');
      const qd = el('div', 'q'); qd.append(md(q.q));
      card.append(el('div', 't', `❓ ${t.title}`), qd);
      const f = el('form'); const inp = el('input'); inp.placeholder = '답변'; inp.required = true;
      f.append(inp, el('button', 'btn primary sm', '답변'));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('POST', `hive/tasks/${encodeURIComponent(t.id)}/answer`, { answer: inp.value }); loadBoard(); }
        catch (err) { alert(err.message); }
      });
      card.append(f); askBox.append(card);
    }
    const board = $('#board'); board.textContent = '';
    if (!j.tasks.length) board.append(el('p', 'empty', 'tasks.json이 비어 있습니다. Michael이 작업을 배분하면 여기에 표시됩니다.'));
    for (const [st, label] of COLS) {
      const items = j.tasks.filter((t) => t.status === st);
      if (!items.length) continue;
      const col = el('div', 'col'); col.append(el('h3', null, `${label} · ${items.length}`));
      for (const t of items) {
        const c = el('div', 'card'); c.append(el('div', 't', t.title));
        if (t.assignee) c.append(el('div', 'a', `담당: ${t.assignee}`));
        col.append(c);
      }
      board.append(col);
    }
  }
  $('#board-refresh').addEventListener('click', loadBoard);

  // ---- hire dialog ----
  $('#hire-open').addEventListener('click', async () => {
    $('#hire-error').textContent = '';
    const sel = $('#hire-provider'); sel.textContent = '';
    try {
      const { providers } = await api('GET', 'providers');
      for (const p of providers) { const o = el('option', null, `${p.label}${p.installed ? '' : ' (VM에 미설치)'}`); o.value = p.id; o.disabled = !p.installed; sel.append(o); }
      const first = providers.find((p) => p.installed); if (first) sel.value = first.id;
    } catch (e) { $('#hire-error').textContent = e.message; }
    $('#hire-god').checked = !state.agents.some((a) => a.isGod);
    $('#hire').showModal();
  });
  $('#hire-form').addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const body = {
      provider: $('#hire-provider').value, name: $('#hire-name').value.trim() || undefined,
      id: ($('#hire-name').value.trim() || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || undefined,
      role: $('#hire-role').value.trim() || undefined, cwd: $('#hire-cwd').value.trim() || undefined,
      isGod: $('#hire-god').checked, cols: term.cols, rows: term.rows
    };
    if (body.isGod) { body.id = 'god'; body.name = body.name || 'Michael'; }
    try {
      const r = await api('POST', 'agents', body);
      $('#hire').close(); $('#hire-form').reset();
      attach(r.id); showTab('term');
    } catch (err) { $('#hire-error').textContent = err.message; }
  });

  // ---- boot ----
  async function start() {
    if (!token) { $('#pair').hidden = false; return; }
    try {
      const s = await api('GET', 'status');
      $('#host-line').textContent = `VM ${s.host} · 워크스페이스 ${s.workspace}`;
    } catch (e) { if (token) { $('#pair').hidden = false; $('#pair-error').textContent = `게이트웨이 연결 실패: ${e.message}`; } return; }
    $('#pair').hidden = true; $('#app').hidden = false;
    connect(); loadMessages(); loadBoard();
    setInterval(() => { if (!document.hidden) { loadMessages(); if (state.tab === 'floor') setAgents(state.agents); } }, 15000);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();
