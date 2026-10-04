/* Munder Office floor — procedural pixel-art office (16px tiles) with walking cast.
 * Tiles are drawn here from scratch; the cast sprites come from sprites.js (MIT port). */
(() => {
'use strict';
const T = 16, W = 40, H = 27;
const C = {
  floor: '#93A99B', floorLine: '#83998B', floorDot: '#6F877A', outline: '#262229',
  wall: '#EEE9E4', wallShade: '#D8D1CA', wallTop: '#F8F5F1',
  glass: '#A9C7DE', glassHi: '#D6E7F3', frame: '#4A4F5C',
  wood: '#C89558', woodTop: '#DDB06E', woodDark: '#8D6234',
  chair: '#B4844C', chairDark: '#7E5730', conf: '#8E2E4A', confHi: '#B0466A',
  monitor: '#2D2F38', screenOff: '#3C4250', screenOn: '#5DA9E9', screenGlow: 'rgba(93,169,233,.28)',
  key: '#D7D7DA', paper: '#F4F1EA', plantPot: '#E2DCD6', leaf: '#4E9A55', leafHi: '#72BC6A',
  cabinet: '#C8A47A', label1: '#E79AA8', label2: '#F0D46A', label3: '#B79AD8',
  steel: '#C9CDD2', steelDark: '#9AA0A8', fridge: '#E3E6EA', vend: '#9BE29B', rack: '#2B2F3A', led: '#7FD8A2', ledOff: '#3A4A3F'
};

// ---- static layout (tile units) ----
const walls = [];   // [x,y,w,h] solid white wall blocks
const solid = [];   // furniture footprints (blocked for walking)
const desks = [];   // seats agents can occupy
function wall(x, y, w, h) { walls.push([x, y, w, h]); }
function block(x, y, w, h) { solid.push([x, y, w, h]); }

// outer top wall band + partitions
wall(0, 0, W, 3);
wall(10, 3, 1, 7); wall(12, 3, 1, 7);              // pillars between Michael's office and conference
wall(25, 3, 1, 4);                                  // conference / annex
wall(0, 10, 4, 3); wall(6, 10, 7, 3); wall(15, 10, 9, 3); wall(26, 10, 2, 3); wall(30, 10, 10, 3); // mid wall with doors at x=4-5,13-14,24-25,28-29
wall(30, 13, 1, 6); wall(30, 21, 1, 6);             // break-room partition with door y=19-20

// Michael's desk (front-facing seat above the desk)
desks.push({ id: 'ceo', x: 3, y: 6, w: 4, seat: { x: 4.5, y: 5.6 }, facing: 'front', boss: true });
// top-right annex desks
desks.push({ id: 'a1', x: 26, y: 5, w: 3, seat: { x: 27, y: 7.3 }, facing: 'back' });
desks.push({ id: 'a2', x: 32, y: 5, w: 3, seat: { x: 33, y: 7.3 }, facing: 'back' });
// bullpen: two rows of five
for (const [i, x] of [2, 8, 14, 20, 25].entries()) desks.push({ id: 'b' + i, x, y: 15, w: 3, seat: { x: x + 1, y: 17.3 }, facing: 'back' });
for (const [i, x] of [2, 8, 14, 20, 25].entries()) desks.push({ id: 'c' + i, x, y: 21, w: 3, seat: { x: x + 1, y: 23.3 }, facing: 'back' });
for (const d of desks) block(d.x, d.y, d.w, 2);
block(14, 5, 9, 3);   // conference table (+chairs)
block(32, 22, 7, 2); block(37, 14, 2, 4); block(33, 14, 3, 2); // kitchen counter, fridge/vending, rack

const SERVER = { x: 33, y: 14, w: 3, h: 2 }; // the VM rack (clickable)

function blocked(tx, ty) {
  if (tx < 0 || ty < 3 || tx >= W || ty >= H) return true;
  for (const [x, y, w, h] of walls) if (tx >= x && tx < x + w && ty >= y && ty < y + h) return true;
  for (const [x, y, w, h] of solid) if (tx >= x && tx < x + w && ty >= y && ty < y + h) return true;
  return false;
}
function path(from, to) {
  const sx = Math.round(from.x), sy = Math.round(from.y), gx = Math.round(to.x), gy = Math.round(to.y);
  const key = (x, y) => y * W + x, prev = new Map([[key(sx, sy), null]]), q = [[sx, sy]];
  const goalOk = (x, y) => x === gx && y === gy;
  while (q.length) {
    const [x, y] = q.shift();
    if (goalOk(x, y)) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || (blocked(nx, ny) && !goalOk(nx, ny))) continue;
      prev.set(k, [x, y]); q.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return [to];
  const out = []; let c = [gx, gy];
  while (c) { out.push({ x: c[0], y: c[1] }); c = prev.get(key(c[0], c[1])); }
  out.reverse(); out[out.length - 1] = { x: to.x, y: to.y };
  return out;
}

// ---- background painter ----
function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function box(g, x, y, w, h, fill, line = C.outline) { px(g, x, y, w, h, line); px(g, x + 1, y + 1, w - 2, h - 2, fill); }
function plant(g, x, y) {
  box(g, x + 4, y + 9, 8, 7, C.plantPot);
  px(g, x + 5, y + 10, 6, 1, '#F1ECE7');
  for (const [lx, ly, c] of [[3, 3, C.leaf], [8, 1, C.leafHi], [10, 4, C.leaf], [5, 6, C.leafHi], [9, 7, C.leaf], [2, 7, C.leaf]]) px(g, x + lx, y + ly, 4, 3, c);
  px(g, x + 7, y + 4, 2, 6, '#3C7A42');
}
function chair(g, x, y, c = C.chair, cd = C.chairDark) { box(g, x, y, 12, 9, c); px(g, x + 1, y + 6, 10, 2, cd); px(g, x + 2, y + 9, 2, 3, C.outline); px(g, x + 8, y + 9, 2, 3, C.outline); }
function deskTop(g, d) {
  const x = d.x * T, y = d.y * T, w = d.w * T;
  box(g, x, y + 4, w, 22, C.wood); px(g, x + 1, y + 5, w - 2, 4, C.woodTop); px(g, x + 1, y + 22, w - 2, 3, C.woodDark);
  px(g, x + 3, y + 26, 3, 4, C.outline); px(g, x + w - 6, y + 26, 3, 4, C.outline);
  box(g, x + w / 2 - 8, y + 15, 16, 5, C.key); for (let i = 0; i < 6; i++) px(g, x + w / 2 - 6 + i * 2, y + 17, 1, 1, '#9EA0A6');
  if (d.boss) { box(g, x + 8, y + 12, 9, 7, C.paper); px(g, x + w - 18, y + 11, 10, 8, '#59A86A'); px(g, x + w - 16, y + 13, 6, 4, '#7FD07F'); }
}
function monitor(g, d, on) {
  const x = d.x * T + d.w * T / 2 - 9, y = d.y * T - 7;
  box(g, x, y, 18, 14, C.monitor); px(g, x + 2, y + 2, 14, 9, on ? C.screenOn : C.screenOff);
  if (on) { px(g, x + 3, y + 3, 8, 1, '#CDE6FA'); px(g, x + 3, y + 5, 10, 1, '#9FCBF0'); px(g, x + 3, y + 7, 6, 1, '#CDE6FA'); }
  px(g, x + 7, y + 14, 4, 3, C.monitor); px(g, x + 4, y + 17, 10, 2, C.monitor);
}
function windowAt(g, x, y) { box(g, x, y, 30, 18, C.frame); px(g, x + 2, y + 2, 12, 14, C.glass); px(g, x + 16, y + 2, 12, 14, C.glass); px(g, x + 3, y + 3, 4, 8, C.glassHi); px(g, x + 17, y + 3, 4, 8, C.glassHi); }

function paintBackground() {
  const cv = document.createElement('canvas'); cv.width = W * T; cv.height = H * T;
  const g = cv.getContext('2d');
  // floor tiles with grid + dots at intersections
  px(g, 0, 0, W * T, H * T, C.floor);
  for (let x = 0; x <= W; x++) px(g, x * T, 0, 1, H * T, C.floorLine);
  for (let y = 0; y <= H; y++) px(g, 0, y * T, W * T, 1, C.floorLine);
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) { px(g, x * T - 1, y * T - 1, 3, 3, C.floorDot); px(g, x * T + 7, y * T + 7, 2, 2, C.floorLine); }
  // walls
  for (const [x, y, w, h] of walls) {
    px(g, x * T, y * T, w * T, h * T, C.outline);
    px(g, x * T + 2, y * T + 2, w * T - 4, h * T - 4, C.wall);
    if (h > 1) px(g, x * T + 2, (y + h) * T - 6, w * T - 4, 4, C.wallShade);
    if (w === 1 && h > 3) { px(g, x * T + 5, y * T + 2, 6, h * T - 4, C.wallTop); px(g, x * T + 2, y * T + 2, 3, h * T - 4, C.wallShade); }
  }
  // top wall decor
  windowAt(g, 4 * T, 12); windowAt(g, 21 * T, 12); windowAt(g, 29 * T, 12);
  g.fillStyle = '#C0392B'; g.beginPath(); g.arc(2 * T, 30, 7, 0, Math.PI * 2); g.fill(); px(g, 2 * T - 4, 25, 8, 9, '#F7F2EE'); px(g, 2 * T, 26, 1, 4, C.outline); px(g, 2 * T, 30, 3, 1, C.outline);
  box(g, 9 * T, 14, 18, 20, '#F7F2EE'); px(g, 9 * T + 1, 15, 16, 5, '#C0392B'); for (let i = 0; i < 9; i++) px(g, 9 * T + 3 + (i % 3) * 5, 23 + Math.floor(i / 3) * 4, 3, 2, '#D9A28A');
  box(g, 15 * T, 16, 40, 20, '#FBFBF8'); px(g, 15 * T + 4, 20, 22, 2, '#5B8BD9'); px(g, 15 * T + 4, 25, 30, 2, '#E07070'); px(g, 15 * T + 4, 30, 16, 2, '#62B07A'); // whiteboard
  plant(g, 13 * T, 3 * T + 2); plant(g, 23 * T + 4, 3 * T + 2); plant(g, 1 * T, 8 * T); plant(g, 28 * T, 25 * T - 4);
  // conference room
  for (let i = 0; i < 4; i++) { chair(g, (15 + i * 2) * T + 2, 4 * T + 6, C.conf, C.confHi); }
  box(g, 14 * T, 5 * T + 4, 9 * T, 2 * T + 4, C.wood); px(g, 14 * T + 1, 5 * T + 5, 9 * T - 2, 5, C.woodTop); px(g, 14 * T + 1, 7 * T + 4, 9 * T - 2, 3, C.woodDark);
  for (let i = 0; i < 4; i++) { chair(g, (15 + i * 2) * T + 2, 8 * T + 2, C.conf, C.confHi); }
  plant(g, 15 * T, 5 * T + 4); box(g, 21 * T, 5 * T + 6, 14, 10, '#C7D3E0'); px(g, 21 * T + 2, 5 * T + 8, 10, 6, '#7FA6CF');
  chair(g, 23 * T + 4, 6 * T, C.conf, C.confHi);
  // cabinets in the mid wall
  for (const [x, lab] of [[7, C.label1], [9, C.label2], [16, C.label3], [19, C.label2]]) { box(g, x * T + 2, 10 * T + 10, 26, 28, C.cabinet); for (let i = 0; i < 3; i++) px(g, x * T + 5 + i * 8, 10 * T + 14, 5, 3, lab); }
  box(g, 12 * T - 4, 10 * T + 14, 14, 24, '#B9906A'); for (let i = 0; i < 4; i++) px(g, 12 * T - 2, 10 * T + 16 + i * 5, 10, 3, '#8FD19E');
  // break room
  box(g, 32 * T, 22 * T + 4, 7 * T, 28, C.steel); px(g, 32 * T + 1, 22 * T + 5, 7 * T - 2, 5, '#E1E4E8');
  box(g, 33 * T + 6, 22 * T + 8, 20, 12, '#AEB6C0'); px(g, 33 * T + 9, 22 * T + 11, 14, 6, '#8FB8D8'); // sink
  box(g, 36 * T, 21 * T + 6, 14, 20, '#3B3F48'); px(g, 36 * T + 3, 21 * T + 10, 8, 5, '#E7C77A'); // coffee machine
  box(g, 37 * T + 2, 14 * T, 28, 40, C.fridge); px(g, 37 * T + 4, 14 * T + 20, 24, 1, C.steelDark); px(g, 37 * T + 24, 14 * T + 6, 2, 8, C.steelDark);
  box(g, 38 * T + 6, 18 * T, 26, 44, '#2E6B3A'); px(g, 38 * T + 9, 18 * T + 4, 16, 26, C.vend);
  box(g, 34 * T, 18 * T + 4, 2 * T, 2 * T, C.wood); chair(g, 33 * T, 19 * T, C.chair, C.chairDark); chair(g, 36 * T + 4, 19 * T, C.chair, C.chairDark);
  return cv;
}
function paintRackStatic(g) {
  const x = SERVER.x * T, y = SERVER.y * T;
  box(g, x, y - 6, SERVER.w * T, SERVER.h * T + 6, C.rack);
  for (let i = 0; i < 4; i++) px(g, x + 3, y - 2 + i * 9, SERVER.w * T - 6, 7, '#3C4252');
}

// ---- sprites ----
const spriteCache = new Map();
function frames(cast) {
  if (spriteCache.has(cast)) return spriteCache.get(cast);
  const S = window.OfficeSprites, f = S.sceneFrameBufs(cast);
  const toCanvas = (buf) => { const c = document.createElement('canvas'); c.width = S.SCENE_W; c.height = S.SCENE_H; const g = c.getContext('2d'); const img = g.createImageData(S.SCENE_W, S.SCENE_H); img.data.set(buf); g.putImageData(img, 0, 0); return c; };
  const out = { front: f.front.map(toCanvas), back: f.back.map(toCanvas) };
  spriteCache.set(cast, out); return out;
}
function portrait(cast, scale = 2) {
  const S = window.OfficeSprites, c = document.createElement('canvas');
  c.width = S.PORTRAIT_W * scale; c.height = S.PORTRAIT_H * scale; S.paintPortrait(c.getContext('2d'), cast, scale); return c;
}

// ---- runtime ----
class Floor {
  constructor(canvas, { onPick }) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.onPick = onPick;
    this.bg = paintBackground(); this.people = new Map(); this.flyers = []; this.scale = 2; this.selected = null;
    this.vmState = 'off'; this.t = 0;
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('mousemove', (e) => { const h = this.hit(e); canvas.style.cursor = h ? 'pointer' : 'default'; });
    const loop = (ts) => { this.t = ts; if (!document.hidden) this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  resize(viewW, viewH) {
    const fit = Math.min(viewW / (W * T), viewH / (H * T));
    const s = Math.max(viewW < 700 ? 1 : 0.6, fit);
    this.scale = s; const dpr = window.devicePixelRatio || 1;
    this.cv.style.width = Math.floor(W * T * s) + 'px'; this.cv.style.height = Math.floor(H * T * s) + 'px';
    this.cv.width = Math.floor(W * T * s * dpr); this.cv.height = Math.floor(H * T * s * dpr); this.dpr = dpr;
  }
  upsert(a) {
    let p = this.people.get(a.id);
    const desk = desks.find((d) => d.id === a.seat) || desks[1];
    if (!p) {
      const start = { x: 4.5, y: 25.5 };
      p = { id: a.id, x: start.x, y: start.y, route: path(start, desk.seat), dir: 'back', phase: 0, desk };
      this.people.set(a.id, p);
    } else if (p.desk !== desk) { p.desk = desk; p.route = path(p, desk.seat); }
    Object.assign(p, { name: a.name, cast: a.cast, bubble: a.bubble, active: a.active, god: a.god });
  }
  remove(id) { this.people.delete(id); }
  fly(fromId, toId) {
    const a = this.people.get(fromId), b = this.people.get(toId); if (!a || !b) return;
    this.flyers.push({ x0: a.x, y0: a.y - 1.4, x1: b.x, y1: b.y - 1.4, t0: performance.now() });
  }
  step(p, dt) {
    if (!p.route || !p.route.length) { p.dir = p.desk.facing; p.phase = 0; return; }
    const tgt = p.route[0], dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy), sp = 4.2 * dt;
    if (d <= sp) { p.x = tgt.x; p.y = tgt.y; p.route.shift(); }
    else { p.x += dx / d * sp; p.y += dy / d * sp; }
    p.dir = dy > 0.01 && Math.abs(dy) >= Math.abs(dx) ? 'front' : 'back';
    p.phase = Math.floor(this.t / 140) % 2 + 1;
  }
  draw() {
    const g = this.g, s = this.scale * this.dpr, now = performance.now();
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
    g.drawImage(this.bg, 0, 0, this.cv.width, this.cv.height);
    g.setTransform(s, 0, 0, s, 0, 0); g.imageSmoothingEnabled = false;
    // server rack + LEDs (VM status)
    paintRackStatic(g);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
      const on = this.vmState === 'on' ? ((Math.floor(this.t / (120 + j * 37)) + i + j) % 3 !== 0) : this.vmState === 'boot' ? (Math.floor(this.t / 300) + j) % 2 === 0 : false;
      px(g, SERVER.x * T + 6 + j * 7, SERVER.y * T + i * 9, 3, 2, on ? (this.vmState === 'boot' ? '#F4D35E' : C.led) : C.ledOff);
    }
    // occupied/active monitors behind people at their desks
    const seated = new Map(); for (const p of this.people.values()) if (!p.route || !p.route.length) seated.set(p.desk.id, p);
    for (const p of this.people.values()) this.step(p, dt);
    const ordered = [...this.people.values()].sort((a, b) => a.y - b.y);
    // draw desks + people in y order so the boss sits behind his desk and bullpen people in front
    const items = [];
    for (const d of desks) {
      items.push({ y: d.y + 1.6, draw: () => { deskTop(g, d); monitor(g, d, !!(seated.get(d.id) && seated.get(d.id).active)); } });
      items.push({ y: d.boss ? d.seat.y - 0.2 : d.seat.y - 0.3, draw: () => chair(g, d.seat.x * T - 6, d.seat.y * T - (d.boss ? 14 : 10)) });
    }
    for (const p of ordered) items.push({ y: p.y + (p.desk.boss && (!p.route || !p.route.length) ? 0 : 0.1), draw: () => this.drawPerson(g, p) });
    items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());
    // flying envelopes
    this.flyers = this.flyers.filter((f) => {
      const k = Math.min(1, (now - f.t0) / 900), x = (f.x0 + (f.x1 - f.x0) * k) * T, y = (f.y0 + (f.y1 - f.y0) * k) * T - Math.sin(k * Math.PI) * 28;
      box(g, x - 6, y - 4, 12, 9, '#FFFFFF'); px(g, x - 5, y - 3, 1, 1, C.outline); px(g, x - 4, y - 2, 8, 1, '#C9C2B8');
      return k < 1;
    });
    // bubbles last, crisp, at device resolution
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const p of ordered) if (p.bubble) this.drawBubble(g, p);
    if (this.vmState !== 'on') this.drawBubble(g, { x: SERVER.x + 1.5, y: SERVER.y + 0.4, bubble: this.vmState === 'boot' ? 'VM booting' : this.vmState === 'error' ? 'VM error' : 'VM off' }, true);
  }
  drawPerson(g, p) {
    const f = frames(p.cast)[p.dir === 'front' ? 'front' : 'back'][p.phase || 0];
    const x = Math.round(p.x * T - 9), y = Math.round(p.y * T - 30);
    if (this.selected === p.id || p.active) {
      g.fillStyle = this.selected === p.id ? 'rgba(244,211,94,.55)' : 'rgba(127,216,162,.35)';
      g.beginPath(); g.ellipse(p.x * T, p.y * T, 12, 5, 0, 0, Math.PI * 2); g.fill();
    }
    g.drawImage(f, x, y);
  }
  drawBubble(g, p, rack) {
    const s = this.scale, text = p.bubble; g.font = `600 ${Math.max(10, Math.round(9 * s))}px "JetBrains Mono", ui-monospace, monospace`;
    const w = g.measureText(text).width + 12 * Math.max(1, s / 1.5), h = Math.max(16, 15 * s);
    let cx = p.x * T * s, top = (p.y - (rack ? 0.9 : 2.75)) * T * s - h;
    const x = Math.max(2, Math.min(cx - w / 2, W * T * s - w - 2));
    g.fillStyle = '#FFFFFF'; g.strokeStyle = C.outline; g.lineWidth = Math.max(1.5, s);
    g.beginPath(); g.roundRect(x, top, w, h, 3 * s); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(cx - 3 * s, top + h); g.lineTo(cx, top + h + 4 * s); g.lineTo(cx + 3 * s, top + h); g.fill();
    g.fillStyle = C.outline; g.textBaseline = 'middle'; g.fillText(text, x + (w - g.measureText(text).width) / 2, top + h / 2 + 1);
  }
  hit(e) {
    const r = this.cv.getBoundingClientRect(), x = (e.clientX - r.left) / this.scale / T, y = (e.clientY - r.top) / this.scale / T;
    for (const p of [...this.people.values()].sort((a, b) => b.y - a.y)) if (Math.abs(x - p.x) < 0.75 && y > p.y - 2.1 && y < p.y + 0.3) return { type: 'agent', id: p.id };
    for (const p of this.people.values()) { const d = p.desk; if (x >= d.x && x < d.x + d.w && y >= d.y - 0.5 && y < d.y + 2) return { type: 'agent', id: p.id }; }
    if (x >= SERVER.x && x < SERVER.x + SERVER.w && y >= SERVER.y - 0.5 && y < SERVER.y + SERVER.h) return { type: 'vm' };
    return null;
  }
  click(e) { const h = this.hit(e); if (h) this.onPick(h); }
}
window.MunderOffice = { Floor, desks, portrait, CAST: ['michael', 'pam', 'jim', 'dwight', 'angela', 'kevin', 'oscar', 'stanley', 'phyllis', 'andy', 'kelly', 'ryan', 'toby', 'creed', 'meredith'] };
})();
