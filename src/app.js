(function () {
'use strict';
const $ = s => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

/*__ENGINE__*/

/* ---------- constants ---------- */
const COLORS = { I: '#2fb8cc', O: '#e9b92c', T: '#9a4fd0', S: '#58b342', Z: '#dc3f4a', J: '#4561d6', L: '#ec8226' };
const GLYPH = { CW: '↻', CCW: '↺', R180: '180', L: '←', R: '→', DL: 'DAS ←', DR: 'DAS →', SD: '↓', HL: 'held ←', HR: 'held →', PL: 'slide ←', PR: 'slide →' };
const ACTS = ['left', 'right', 'soft', 'hard', 'ccw', 'cw', 'r180', 'hold', 'retry'];
const ACT_NAME = { left: 'Move left', right: 'Move right', soft: 'Soft drop', hard: 'Hard drop', ccw: 'Rotate CCW', cw: 'Rotate CW', r180: 'Rotate 180', hold: 'Hold (Sprint)', retry: 'Restart (Sprint)' };
const DEFAULT_KEYS = { left: ['ArrowLeft'], right: ['ArrowRight'], soft: ['ArrowDown'], hard: ['Space'], ccw: ['KeyZ'], cw: ['ArrowUp', 'KeyX'], r180: ['KeyA'], hold: ['KeyC', 'ShiftLeft'], retry: ['KeyR'] };
const fr = f => f * 1000 / 60;

/* ---------- settings ---------- */
function sanitizeKeys(k) {
  const out = {};
  for (const a of ACTS) if (k && Array.isArray(k[a])) out[a] = k[a].filter(x => typeof x === 'string').slice(0, 2);
  // Actions added later get their defaults, minus any key the player already uses elsewhere.
  const used = new Set(Object.values(out).flat());
  for (const a of ACTS) if (!out[a]) out[a] = DEFAULT_KEYS[a].filter(c => !used.has(c));
  return out;
}
let keys = sanitizeKeys(LS.get('sl.keys', null));
const PRESETS = { mine: { das: 10, arr: 2, dcd: 1 }, zero: { das: 7, arr: 0, dcd: 0 } };
let handling = Object.assign({}, PRESETS.mine, LS.get('sl.handling', {}));
let opts = Object.assign({ pieces: PIECES.slice(), weak: true, repeat: true, hints: false, use180: false, flagSlides: true, coach: true, coachKeys: false, fx: true }, LS.get('sl.opts', {}));
opts.pieces = (opts.pieces || []).filter(p => PIECES.includes(p));
if (!opts.pieces.length) opts.pieces = PIECES.slice();
let weak = LS.get('sl.weak', {});
let codeMap = {};
function rebuildCodeMap() { codeMap = {}; for (const a of ACTS) for (const c of keys[a]) codeMap[c] = a; }
rebuildCodeMap();

function keyName(c) {
  if (!c) return '—';
  const m = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Meta', MetaRight: 'R Meta', Enter: 'Enter', Backquote: '`', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Tab: 'Tab', CapsLock: 'Caps' };
  if (m[c]) return m[c];
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad')) return 'Num ' + c.slice(6);
  return c;
}

/* ---------- targets ---------- */
const ORIENT = {
  T: ['nub up', 'nub right', 'nub down', 'nub left'],
  J: ['flat', 'CW', 'flipped', 'CCW'],
  L: ['flat', 'CW', 'flipped', 'CCW'],
};
function orientName(p, r) {
  if (p === 'O') return 'flat';
  if (p === 'I') return r % 2 ? 'vertical' : 'flat';
  if (p === 'S' || p === 'Z') return r % 2 ? 'upright' : 'flat';
  return ORIENT[p][r];
}
function makeTarget(p, key, v) {
  const cells = key.split(';').map(s => s.split(',').map(Number));
  const xs = cells.map(c => c[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const t = { p, key, cells, path: v.path, r: v.r, minX, maxX, orient: orientName(p, v.r) };
  t.label = p + ' · ' + t.orient + ' · ' + (minX === maxX ? 'col ' + (minX + 1) : 'cols ' + (minX + 1) + '–' + (maxX + 1));
  return t;
}
let targets = {};
function rebuildTargets() {
  for (const p of PIECES) {
    const best = solve(p, opts.use180);
    targets[p] = [...best.entries()].map(([key, v]) => makeTarget(p, key, v));
  }
}
rebuildTargets();
function findTarget(p, key) { return targets[p].find(t => t.key === key); }

let bag = [];
function nextPiece() {
  if (!bag.length) {
    bag = opts.pieces.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  }
  return bag.pop();
}
// Mastery: a placement is down pat after 3+ tries with few recent mistakes and an average clean time under its target.
function targetTime(t) {
  const das = t.path.filter(a => a === 'DL' || a === 'DR').length;
  return 0.35 + 0.12 * t.path.length + das * (fr(handling.das) + 5 * fr(handling.arr)) / 1000;
}
function masteryOf(t) {
  const s = weak[t.p + ':' + t.key];
  if (!s || !s.n) return 'new';
  if (s.e >= 0.25) return 'miss';
  if (s.n < 3) return 'learning';
  if (!s.tn || s.ts > targetTime(t)) return 'slow';
  return 'mastered';
}
function weightOf(t) {
  if (!opts.weak) return 1;
  const s = weak[t.p + ':' + t.key];
  if (!s || !s.n) return 3;
  if (masteryOf(t) === 'mastered') return 0.5;
  const slow = s.tn ? Math.min(1.5, Math.max(0, s.ts / targetTime(t) - 1)) : 0.6;
  return 1 + 8 * s.e + 5 * slow;
}
function pickTarget() {
  const p = nextPiece();
  const list = targets[p];
  const w = list.map(weightOf);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return { ...list[i], repeat: false }; }
  return { ...list[list.length - 1], repeat: false };
}

/* ---------- game state ---------- */
const G = { cur: null, tgt: null, queue: [], presses: 0, seq: [], spawnAt: 0, flash: null, slide: false };
const S = { pieces: 0, clean: 0, faults: 0, misses: 0, presses: 0, opt: 0, time: 0, streak: 0, best: 0 };
let feed = [];
const held = { left: false, right: false };
let dasDir = 0, dasStart = 0, charged = false, lastShift = 0, dcdUntil = 0;
let weakTimer = 0;

function spawn(now) {
  while (G.queue.length < 2) G.queue.push(pickTarget());
  G.tgt = G.queue.shift();
  G.cur = { p: G.tgt.p, ...SPAWN };
  G.presses = 0;
  G.seq = [];
  G.slide = false;
  G.spawnAt = now;
  if (dasDir && charged) {
    G.seq.push(dasDir < 0 ? 'HL' : 'HR');
    dcdUntil = now + fr(handling.dcd);
    lastShift = dcdUntil;
  }
  renderNow();
}

// A slide that stops before the wall (released, or dropped mid-slide) only exists when ARR > 0.
function markSlide() {
  if (!(dasDir && charged && handling.arr > 0 && G.cur && moveH(G.cur, dasDir))) return;
  G.slide = true;
  for (let i = G.seq.length - 1; i >= 0; i--) {
    const t = G.seq[i];
    if (t === 'DL' || t === 'HL') { G.seq[i] = 'PL'; break; }
    if (t === 'DR' || t === 'HR') { G.seq[i] = 'PR'; break; }
  }
}
function place(now) {
  markSlide();
  const s = G.cur, t = G.tgt;
  const cells = cellsOf(s.p, s.x, dropY(s), s.r);
  addFx('tr', 'trail', now, 150, { color: COLORS[s.p], cols: trailOf(s.p, cellsOf(s.p, s.x, s.y, s.r), cells) });
  const key = cellsKey(cells);
  const opt = t.path.length;
  let result = key !== t.key ? 'miss' : (G.presses > opt ? 'fault' : 'clean');
  if (result === 'clean' && G.slide && opts.flagSlides) result = 'slide';
  const dt = Math.min(Math.max((now - G.spawnAt) / 1000, 0), 4);
  S.pieces++; S.presses += G.presses; S.opt += opt; S.time += dt;
  if (result === 'clean') { S.clean++; S.streak++; S.best = Math.max(S.best, S.streak); }
  else { S.streak = 0; if (result === 'miss') S.misses++; else S.faults++; }
  const wk = t.p + ':' + t.key;
  const before = masteryOf(t);
  const prev = weak[wk] || { n: 0, e: 0.3, ts: 0, tn: 0 };
  const ent = { n: prev.n + 1, e: +(prev.e * 0.6 + (result === 'clean' ? 0 : 0.4)).toFixed(3), ts: prev.ts || 0, tn: prev.tn || 0 };
  // time only counts toward mastery on clean placements (a 4 s cap keeps a distraction from skewing it)
  if (result === 'clean' && dt < 4) { ent.ts = +(ent.tn ? ent.ts * 0.6 + dt * 0.4 : dt).toFixed(3); ent.tn++; }
  weak[wk] = ent;
  const after = masteryOf(t);
  clearTimeout(weakTimer); weakTimer = setTimeout(() => LS.set('sl.weak', weak), 800);
  feed.unshift({ p: t.p, label: t.label, presses: G.presses, opt, result, slide: G.slide, you: G.seq.slice(), best: t.path, dt, target: targetTime(t), downPat: after === 'mastered' && before !== 'mastered' });
  feed = feed.slice(0, 6);
  G.flash = { cells, result, at: now };
  if (result !== 'clean' && opts.repeat && !t.repeat) G.queue.unshift({ ...t, repeat: true });
  renderStats(); renderFeed();
  spawn(now);
}

function rot(turn, tok, now) {
  const n = rotate(G.cur, turn);
  if (n) G.cur = n;
  G.presses++; G.seq.push(tok);
  if (dasDir && charged && handling.dcd > 0) { dcdUntil = now + fr(handling.dcd); lastShift = dcdUntil; }
}
function press(a, now) {
  if (!G.cur) return;
  if (a === 'left' || a === 'right') {
    const d = a === 'left' ? -1 : 1;
    held[a] = true; dasDir = d; charged = false; dasStart = now; dcdUntil = 0;
    const n = moveH(G.cur, d); if (n) G.cur = n;
    G.presses++; G.seq.push(d < 0 ? 'L' : 'R');
  } else if (a === 'cw') rot(1, 'CW', now);
  else if (a === 'ccw') rot(3, 'CCW', now);
  else if (a === 'r180') rot(2, 'R180', now);
  else if (a === 'soft') { G.cur = { ...G.cur, y: dropY(G.cur) }; G.presses++; G.seq.push('SD'); }
  else if (a === 'hard') place(now);
}
function release(a, now) {
  if (a !== 'left' && a !== 'right') return;
  held[a] = false;
  const d = a === 'left' ? -1 : 1;
  if (dasDir !== d) return;
  markSlide();
  const other = a === 'left' ? 'right' : 'left';
  if (held[other]) { dasDir = -d; charged = false; dasStart = now; }
  else { dasDir = 0; charged = false; }
}
function releaseAll() { held.left = held.right = false; dasDir = 0; charged = false; }
function autoStep() {
  if (handling.arr <= 0) G.cur = shiftWall(G.cur, dasDir);
  else { const n = moveH(G.cur, dasDir); if (n) G.cur = n; }
}
function tick(now) {
  if (!dasDir || !G.cur || now < dcdUntil) return;
  if (!charged) {
    if (now - dasStart < fr(handling.das)) return;
    charged = true; lastShift = now;
    const last = G.seq.length - 1, tap = dasDir < 0 ? 'L' : 'R';
    if (last >= 0 && G.seq[last] === tap) G.seq[last] = dasDir < 0 ? 'DL' : 'DR';
    autoStep();
  } else if (handling.arr <= 0) {
    autoStep();
  } else {
    const step = fr(handling.arr);
    let guard = 0;
    while (now - lastShift >= step && guard++ < 12) { lastShift += step; const n = moveH(G.cur, dasDir); if (!n) { lastShift = now; break; } G.cur = n; }
  }
}

/* ---------- drawing ---------- */
const field = $('#field'), cv = $('#board'), ctx = cv.getContext('2d');
let theme = {}, themeVer = 0;
const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => cs.getPropertyValue(n).trim();
  theme = { well: g('--well'), grid: g('--well-grid'), good: g('--good'), warn: g('--warn'), bad: g('--bad') };
  themeVer++;
}
readTheme();
// canvas text uses the web fonts, so redraw the cached backgrounds once they arrive
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { themeVer++; });

// Static board backgrounds (well, grid, column numbers) are drawn once per size and theme, then blitted.
const bgCache = {};
function boardBg(kind, w, h, cs, paint) {
  const key = w + 'x' + h + ':' + themeVer;
  const hit = bgCache[kind];
  if (hit && hit.key === key) return hit.cv;
  const cv2 = document.createElement('canvas');
  cv2.width = w; cv2.height = h;
  paint(cv2.getContext('2d'), w, h, cs);
  bgCache[kind] = { key, cv: cv2 };
  return cv2;
}

// Short visual effects: drop trails, lock flashes and line-clear flashes. Purely cosmetic: the game
// state has already moved on, so they never delay a piece.
const FX = [];
const fxOn = () => opts.fx !== false && !RM.matches;
function addFx(board, kind, now, dur, data) { if (fxOn()) FX.push(Object.assign({ board, kind, at: now, dur }, data)); }
function trailOf(p, fromCells, toCells) {
  const cols = {};
  for (const [x, y] of fromCells) cols[x] = Math.min(cols[x] == null ? Infinity : cols[x], y);
  const out = [];
  for (const [x, y] of toCells) if (cols[x] != null && y > cols[x]) out.push({ x, y0: Math.max(0, cols[x]), y1: y });
  const best = {};
  for (const c of out) if (!best[c.x] || c.y1 < best[c.x].y1) best[c.x] = c;
  return Object.values(best).filter(c => c.y1 > c.y0);
}
function drawFx(c, board, cs, w, now) {
  let live = false;
  for (let i = FX.length - 1; i >= 0; i--) {
    const f = FX[i];
    if (f.board !== board) continue;
    const k = (now - f.at) / f.dur;
    if (k >= 1) { FX.splice(i, 1); continue; }
    if (k < 0) { live = true; continue; }   // starts later this frame
    live = true;
    const e = 1 - k, ease = e * e;
    if (f.kind === 'trail') {
      for (const t of f.cols) {
        const y0 = t.y0 * cs, y1 = t.y1 * cs;
        const g = c.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, rgba(f.color, 0));
        g.addColorStop(1, rgba(f.color, 0.42 * ease));
        c.fillStyle = g;
        c.fillRect(t.x * cs + cs * 0.12, y0, cs * 0.76, y1 - y0);
      }
    } else if (f.kind === 'lock') {
      c.fillStyle = 'rgba(255,255,255,' + (0.34 * ease).toFixed(3) + ')';
      const g = Math.max(1, Math.round(cs * 0.04));
      for (const [x, y] of f.cells) if (y >= 0) c.fillRect(x * cs + g, y * cs + g, cs - 2 * g, cs - 2 * g);
    } else if (f.kind === 'clear') {
      const grow = (1 - e) * cs * 0.35;
      c.fillStyle = 'rgba(255,255,255,' + ((f.rows.length >= 4 ? 0.7 : 0.5) * ease).toFixed(3) + ')';
      for (const y of f.rows) c.fillRect(0, y * cs - grow, w, cs + 2 * grow);
    }
  }
  return live;
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme); } catch (e) { /* older browser */ }
new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

function rgba(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
  const n = parseInt(h.slice(1), 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function sizeCanvas() {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}
new ResizeObserver(sizeCanvas).observe(field);

function drawBlock(c, x, y, cs, color, alpha) {
  const g = Math.max(1, Math.round(cs * 0.04));
  const s = cs - 2 * g, X = x * cs + g, Y = y * cs + g;
  c.globalAlpha = alpha == null ? 1 : alpha;
  c.fillStyle = color;
  c.fillRect(X, Y, s, s);
  c.fillStyle = 'rgba(255,255,255,.28)';
  c.fillRect(X, Y, s, Math.max(2, cs * 0.16));
  c.fillStyle = 'rgba(0,0,0,.22)';
  c.fillRect(X, Y + s - Math.max(2, cs * 0.12), s, Math.max(2, cs * 0.12));
  const lw = Math.max(1, cs * 0.04);
  c.lineWidth = lw; c.strokeStyle = 'rgba(255,255,255,.55)';
  c.strokeRect(X + lw / 2, Y + lw / 2, s - lw, s - lw);
  c.globalAlpha = 1;
}
// Outline of a set of cells (outer edge only), pulled inward by `inset` so it sits inside the shape.
function perimeter(c, cells, cs, inset) {
  const has = new Set(cells.map(([x, y]) => x + ',' + y));
  const h = (x, y) => has.has(x + ',' + y);
  const edges = [
    { n: [0, -1], s: [-1, 0], e: [1, 0], horiz: true, at: 0 },
    { n: [0, 1], s: [-1, 0], e: [1, 0], horiz: true, at: 1 },
    { n: [-1, 0], s: [0, -1], e: [0, 1], horiz: false, at: 0 },
    { n: [1, 0], s: [0, -1], e: [0, 1], horiz: false, at: 1 },
  ];
  c.beginPath();
  for (const [x, y] of cells) {
    for (const E of edges) {
      if (h(x + E.n[0], y + E.n[1])) continue;
      const off = k => !h(x + E[k][0], y + E[k][1]) ? inset : (h(x + E[k][0] + E.n[0], y + E[k][1] + E.n[1]) ? -inset : 0);
      const a = off('s'), b = off('e');
      if (E.horiz) {
        const yy = (y + E.at) * cs + (E.at ? -inset : inset);
        c.moveTo(x * cs + a, yy); c.lineTo((x + 1) * cs - b, yy);
      } else {
        const xx = (x + E.at) * cs + (E.at ? -inset : inset);
        c.moveTo(xx, y * cs + a); c.lineTo(xx, (y + 1) * cs - b);
      }
    }
  }
  c.stroke();
}
let trSig = '', trFxLive = false;
function paintTrainerBg(c, w, h, cs) {
  c.fillStyle = theme.well; c.fillRect(0, 0, w, h);
  c.strokeStyle = theme.grid; c.lineWidth = 1; c.beginPath();
  for (let x = 1; x < W; x++) { const X = Math.round(x * cs) + 0.5; c.moveTo(X, 0); c.lineTo(X, h); }
  for (let y = 1; y < H; y++) { const Y = Math.round(y * cs) + 0.5; c.moveTo(0, Y); c.lineTo(w, Y); }
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,.22)';
  c.font = '500 ' + Math.round(cs * 0.32) + 'px "IBM Plex Mono", monospace';
  c.textAlign = 'center'; c.textBaseline = 'bottom';
  for (let x = 0; x < W; x++) c.fillText(String(x + 1), x * cs + cs / 2, h - cs * 0.08);
}
function draw(now) {
  const w = cv.width, h = cv.height, cs = w / W, dpr = window.devicePixelRatio || 1;
  // only repaint when something visible changed (or an animation is running)
  const s = G.cur;
  const sig = w + ',' + h + ',' + themeVer + ',' + (s ? s.p + s.x + ',' + s.y + ',' + s.r : '-') + ',' + (G.tgt ? G.tgt.key : '-');
  if (sig === trSig && !G.flash && !trFxLive) return;
  trSig = sig;
  ctx.drawImage(boardBg('tr', w, h, cs, paintTrainerBg), 0, 0);

  let gc = null, onTarget = false;
  if (G.cur) {
    gc = cellsOf(G.cur.p, G.cur.x, dropY(G.cur), G.cur.r);
    onTarget = !!G.tgt && cellsKey(gc) === G.tgt.key;
  }
  // Ghost: a soft tint of the piece colour where it would land.
  if (gc) {
    const g = Math.max(1, Math.round(cs * 0.04));
    ctx.fillStyle = rgba(COLORS[G.cur.p], onTarget ? 0.5 : 0.26);
    for (const [x, y] of gc) ctx.fillRect(x * cs + g, y * cs + g, cs - 2 * g, cs - 2 * g);
  }
  // Target: a neutral outline around the shape, dashed until the ghost lines up with it.
  if (G.tgt) {
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    for (const [x, y] of G.tgt.cells) ctx.fillRect(x * cs, y * cs, cs, cs);
    const lw = Math.max(2, (onTarget ? 3 : 2) * dpr);
    ctx.lineWidth = lw; ctx.lineCap = 'butt';
    ctx.strokeStyle = onTarget ? '#ffffff' : 'rgba(255,255,255,.72)';
    ctx.setLineDash(onTarget ? [] : [Math.max(4, cs * 0.17), Math.max(3, cs * 0.083)]);
    perimeter(ctx, G.tgt.cells, cs, lw / 2 + dpr);
    ctx.setLineDash([]);
  }
  trFxLive = drawFx(ctx, 'tr', cs, w, now);
  if (G.flash) {
    const age = now - G.flash.at;
    if (age < 380) {
      const col = G.flash.result === 'clean' ? theme.good : G.flash.result === 'miss' ? theme.bad : theme.warn;
      for (const [x, y] of G.flash.cells) drawBlock(ctx, x, y, cs, col, 0.75 * (1 - age / 380));
    } else G.flash = null;
  }
  // Active piece: fully solid with a light rim so it never blends into the outline.
  if (G.cur) {
    for (const [x, y] of cellsOf(G.cur.p, G.cur.x, G.cur.y, G.cur.r)) if (y >= 0) drawBlock(ctx, x, y, cs, COLORS[G.cur.p], 1);
  }
}
// "Up next" row at the top of the Last pieces card: the next piece and the spot it will ask for.
function drawNext() {
  const el = $('#upNext'), t = G.queue[0];
  if (!el) return;
  if (!t) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<span class="pc" style="--c:' + COLORS[t.p] + '">' + t.p + '</span>' +
    '<div><div class="eyebrow">Up next</div><div class="fi-label">' + t.label + (t.repeat ? ' (again)' : '') + '</div></div>' +
    '<span class="un-shape">' + miniSVG(t.p, t.r) + '</span>';
}
let logicT = 0;
function evT(e) {
  const p = performance.now();
  let t = e && e.timeStamp > 0 && e.timeStamp <= p + 1 && p - e.timeStamp < 1000 ? e.timeStamp : p;
  if (t < logicT) t = logicT;   // never run the clock backwards
  logicT = t;
  return t;
}
function catchUp(t) { tick(t); spTick(t); }
function loop(now) {
  if (now > logicT) logicT = now;
  tick(now);
  if (activeTab === 'trainer') draw(now);
  spTick(now);
  if (activeTab === 'sprint') { spDraw(now); spDrawSide(); spLive(now); }
  requestAnimationFrame(loop);
}

/* ---------- trainer UI ---------- */
const keysHTML = seq => seq.length ? '<span class="keys">' + seq.map(t => '<span class="kc">' + GLYPH[t] + '</span>').join('') + '</span>' : '<span class="keys"><span class="kc">drop</span></span>';
function renderNow() {
  const t = G.tgt;
  if (!t) return;
  $('#tgtLabel').textContent = t.label + (t.repeat ? '  (again)' : '');
  const n = t.path.length;
  $('#optText').innerHTML = 'Optimal: <b>' + n + '</b> ' + (n === 1 ? 'press' : 'presses');
  $('#hintKeys').innerHTML = opts.hints ? keysHTML(t.path) : '';
  drawNext();
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function renderStats() {
  const n = S.pieces;
  setText('stFin', n ? Math.round(100 * S.clean / n) + '%' : '—');
  setText('stFinS', n ? S.clean + ' of ' + n + ' clean · streak ' + S.streak : 'clean pieces');
  setText('stKpp', n ? ((S.presses + n) / n).toFixed(2) : '—');
  setText('stKppS', n ? 'optimal ' + ((S.opt + n) / n).toFixed(2) : 'incl. hard drop');
  setText('stPps', S.time > 0 ? (n / S.time).toFixed(2) : '—');
  setText('stFault', S.faults);
  setText('stMiss', S.misses);
  let mastered = 0, total = 0;
  for (const p of opts.pieces) for (const t of targets[p]) { total++; if (masteryOf(t) === 'mastered') mastered++; }
  setText('stMastered', mastered + '/' + total);
  setText('stMasteredS', 'placements down pat');
}
function renderFeed() {
  const ol = $('#feed');
  if (!feed.length) { ol.innerHTML = '<li class="empty">Each placement shows up here. Anything you miss comes with the optimal inputs.</li>'; return; }
  ol.innerHTML = feed.map(f => {
    let pill, seq;
    if (f.result === 'clean') {
      pill = f.downPat ? '<span class="pill good">Down pat</span>' : f.dt > f.target ? '<span class="pill warn">Clean, slow</span>' : '<span class="pill good">Clean · ' + f.presses + '</span>';
      seq = '<span>You ' + keysHTML(f.you) + '</span>';
    } else if (f.result === 'slide') {
      pill = '<span class="pill warn">Partial slide</span>';
      seq = '<span>You ' + keysHTML(f.you) + '</span><span>At 0 ARR ' + keysHTML(f.best) + '</span>';
    } else if (f.result === 'fault') {
      pill = '<span class="pill warn">+' + (f.presses - f.opt) + ' ' + (f.presses - f.opt === 1 ? 'key' : 'keys') + (f.slide ? ' · slide' : '') + '</span>';
      seq = '<span>You ' + keysHTML(f.you) + '</span><span>Best ' + keysHTML(f.best) + '</span>';
    } else {
      pill = '<span class="pill bad">Misdrop</span>';
      seq = '<span>You ' + keysHTML(f.you) + '</span><span>Best ' + keysHTML(f.best) + '</span>';
    }
    const time = f.dt != null ? '<span class="fi-time">' + f.dt.toFixed(2) + ' s <span class="muted">target ' + f.target.toFixed(2) + '</span></span>' : '';
    return '<li><span class="pc" style="--c:' + COLORS[f.p] + '">' + f.p + '</span><div><div class="fi-label">' + f.label + '</div><div class="fi-seq">' + seq + time + '</div></div>' + pill + '</li>';
  }).join('');
}
function renderOverlayKeys() {
  const k = a => keyName(keys[a][0]);
  $('#ovKeys').textContent = k('left') + ' ' + k('right') + ' move · ' + k('ccw') + ' / ' + k('cw') + ' / ' + k('r180') + ' rotate · ' + k('hard') + ' drop';
}
function resetSession() {
  Object.assign(S, { pieces: 0, clean: 0, faults: 0, misses: 0, presses: 0, opt: 0, time: 0, streak: 0, best: 0 });
  feed = []; G.queue = []; bag = []; releaseAll();
  renderStats(); renderFeed(); spawn(performance.now());
}

// Game keys are read from the whole page while the Trainer tab is open, so play doesn't depend
// on one element keeping focus. The drill only pauses when the page itself loses focus.
let touchMode = false, engaged = false;
const overlay = $('#overlay');
function engage() {
  if (!engaged) { engaged = true; G.spawnAt = performance.now(); }
  overlay.hidden = true; field.classList.add('on');
}
function disengage(title) {
  engaged = false; releaseAll(); field.classList.remove('on');
  $('#ovTitle').textContent = window.matchMedia && matchMedia('(pointer: coarse)').matches ? String(title).replace(/^Click/, 'Tap') : title; overlay.hidden = false;
}
const TEXT_INPUT = /^(text|number|date|search|email|password|url|tel)$/;
function typingTarget(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t.tagName === 'INPUT' && TEXT_INPUT.test(t.type);
}
window.addEventListener('keydown', e => {
  if (listening) return;
  if (e.code === 'Escape' && document.body.classList.contains('focus-mode') && !document.fullscreenElement) { setFocusMode(false); return; }
  if (activeTab === 'sprint') {
    const a = codeMap[e.code];
    if (!a || typingTarget(e.target)) return;
    e.preventDefault();
    if (e.target && e.target !== document.body && typeof e.target.blur === 'function') e.target.blur();
    if (e.repeat) return;
    const t = evT(e); catchUp(t); spPress(a, t);
    return;
  }
  if (activeTab !== 'trainer') return;
  if (e.code === 'Escape' && document.body.classList.contains('focus-mode') && !document.fullscreenElement) { setFocusMode(false); return; }
  const a = codeMap[e.code];
  if (!a || typingTarget(e.target)) return;
  e.preventDefault();
  if (e.target && e.target !== field && e.target !== document.body && typeof e.target.blur === 'function') {
    e.target.blur();
    try { field.focus({ preventScroll: true }); } catch (err) { /* focus refused */ }
  }
  if (e.repeat) return;
  engage();
  const t = evT(e); catchUp(t); press(a, t);
});
window.addEventListener('keyup', e => {
  const a = codeMap[e.code];
  if (!a) return;
  if ((activeTab === 'trainer' || activeTab === 'sprint') && !typingTarget(e.target)) e.preventDefault();
  const t = evT(e); catchUp(t);
  release(a, t);
  spRelease(a, t);
});
window.addEventListener('blur', () => {
  spReleaseAll();
  setTimeout(() => { if (!document.hasFocus() && !touchMode) disengage('Click to resume'); }, 80);
});
window.addEventListener('focus', () => { if (activeTab === 'trainer') engage(); });
field.addEventListener('focus', engage);
field.addEventListener('pointerdown', () => {
  try { window.focus(); } catch (e) { /* not allowed */ }
  if (document.activeElement !== field) { try { field.focus({ preventScroll: true }); } catch (e) { /* focus refused */ } }
  engage();
});
document.querySelectorAll('#touch button').forEach(b => {
  const a = b.dataset.act;
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    touchMode = true; engage();
    const t = evT(e); catchUp(t); press(a, t);
  });
  const up = e => { const t = evT(e); catchUp(t); release(a, t); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
$('#resetSession').addEventListener('click', resetSession);

/* settings UI */
function saveOpts() { LS.set('sl.opts', opts); }
function renderPieceChips() {
  $('#pieceChips').innerHTML = PIECES.map(p => '<button type="button" class="chip" data-p="' + p + '" aria-pressed="' + opts.pieces.includes(p) + '"><span class="sw" style="--c:' + COLORS[p] + '"></span>' + p + '</button>').join('');
}
$('#pieceChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  const p = b.dataset.p;
  if (opts.pieces.includes(p)) { if (opts.pieces.length === 1) return; opts.pieces = opts.pieces.filter(x => x !== p); }
  else opts.pieces = PIECES.filter(x => x === p || opts.pieces.includes(x));
  saveOpts(); renderPieceChips(); bag = []; G.queue = G.queue.filter(t => opts.pieces.includes(t.p)); drawNext();
});
function bindToggle(id, key, after) {
  const el = document.getElementById(id);
  el.checked = !!opts[key];
  el.addEventListener('change', () => { opts[key] = el.checked; saveOpts(); if (after) after(); });
}
bindToggle('optWeak', 'weak');
bindToggle('optRepeat', 'repeat');
bindToggle('optHints', 'hints', renderNow);
bindToggle('optSlides', 'flagSlides');
bindToggle('optCoach', 'coach', () => { if (SP.state === 'playing' && SP.cur) SP.sugg = opts.coach ? spSuggest(SP.cur.p, SP.B, SP.queue[0]) : null; spRenderHint(); });
bindToggle('optCoachKeys', 'coachKeys', () => spRenderHint());
function on180Change() {
  $('#opt180').checked = opts.use180; $('#opt180b').checked = opts.use180;
  rebuildTargets();
  const remap = t => ({ ...findTarget(t.p, t.key), repeat: t.repeat });
  if (G.tgt) G.tgt = remap(G.tgt);
  G.queue = G.queue.map(remap);
  renderNow(); renderFChart();
}
$('#opt180').checked = opts.use180; $('#opt180b').checked = opts.use180;
$('#opt180').addEventListener('change', e => { opts.use180 = e.target.checked; saveOpts(); on180Change(); });
$('#opt180b').addEventListener('change', e => { opts.use180 = e.target.checked; saveOpts(); on180Change(); });

const hIds = { das: 'hDas', arr: 'hArr', dcd: 'hDcd' };
const hLim = { das: [1, 20], arr: [0, 5], dcd: [0, 20] };
function renderPresets() {
  document.querySelectorAll('#presets .chip').forEach(b => {
    const p = PRESETS[b.dataset.preset];
    b.setAttribute('aria-pressed', String(Object.keys(p).every(k => Math.abs(p[k] - handling[k]) < 1e-9)));
  });
}
function setHandling(h) {
  Object.assign(handling, h);
  for (const k of Object.keys(hIds)) document.getElementById(hIds[k]).value = handling[k];
  LS.set('sl.handling', handling); renderPresets();
}
for (const k of Object.keys(hIds)) {
  const el = document.getElementById(hIds[k]);
  el.value = handling[k];
  el.addEventListener('change', () => {
    let v = parseFloat(el.value);
    if (!isFinite(v)) v = PRESETS.mine[k];
    v = Math.round(Math.min(hLim[k][1], Math.max(hLim[k][0], v)) * 10) / 10;
    setHandling({ [k]: v });
  });
}
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  setHandling(PRESETS[b.dataset.preset]);
});
renderPresets();

let listening = null;
function renderBinds() {
  $('#binds').innerHTML = ACTS.map(a => {
    const b = i => {
      const c = keys[a][i];
      const isL = listening && listening.a === a && listening.i === i;
      return '<button type="button" class="bind' + (isL ? ' listening' : '') + (c ? '' : ' empty') + '" data-a="' + a + '" data-i="' + i + '">' + (isL ? 'Press a key…' : (c ? keyName(c) : (i ? 'add' : '—'))) + '</button>';
    };
    return '<span>' + ACT_NAME[a] + '</span>' + b(0) + b(1);
  }).join('');
}
$('#binds').addEventListener('click', e => {
  const b = e.target.closest('.bind'); if (!b) return;
  listening = { a: b.dataset.a, i: +b.dataset.i };
  renderBinds();
});
window.addEventListener('keydown', e => {
  if (!listening) return;
  e.preventDefault(); e.stopPropagation();
  const { a, i } = listening;
  if (e.code === 'Escape') { /* cancel */ }
  else if (e.code === 'Backspace') { if (i === 1) keys[a] = keys[a].slice(0, 1); }
  else {
    for (const x of ACTS) keys[x] = keys[x].filter(c => c !== e.code);
    const arr = keys[a].slice();
    if (i === 0) arr[0] = e.code; else { if (!arr[0]) arr[0] = e.code; else arr[1] = e.code; }
    keys[a] = arr.filter(Boolean).slice(0, 2);
    LS.set('sl.keys', keys);
    rebuildCodeMap(); renderOverlayKeys();
  }
  listening = null; renderBinds();
}, true);
$('#clearWeak').addEventListener('click', () => {
  weak = {}; LS.set('sl.weak', weak);
  const b = $('#clearWeak'); b.textContent = 'Mastery history cleared';
  renderStats();
  setTimeout(() => { b.textContent = 'Clear mastery history'; }, 1800);
});

/* ---------- finesse chart ---------- */
const MASTERY_LABEL = { mastered: 'Down pat', slow: 'Clean but slow', miss: 'Recent mistakes', learning: 'Learning (under 3 tries)', new: 'Not tried yet' };
let chartPiece = 'T';
function miniSVG(p, r) {
  const cells = SHAPES[p][r];
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const mx = Math.min(...xs), my = Math.min(...ys), s = 9;
  const w = (Math.max(...xs) - mx + 1) * s, h = (Math.max(...ys) - my + 1) * s;
  return '<svg class="mini" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
    cells.map(([x, y]) => '<rect x="' + ((x - mx) * s + 0.5) + '" y="' + ((y - my) * s + 0.5) + '" width="' + (s - 1) + '" height="' + (s - 1) + '" rx="1.5" fill="' + COLORS[p] + '"/>').join('') + '</svg>';
}
function renderChartChips() {
  $('#chartChips').innerHTML = PIECES.map(p => '<button type="button" class="chip" data-p="' + p + '" aria-pressed="' + (p === chartPiece) + '"><span class="sw" style="--c:' + COLORS[p] + '"></span>' + p + '</button>').join('');
}
$('#chartChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  chartPiece = b.dataset.p; renderChartChips(); renderFChart();
});
function renderFChart() {
  const p = chartPiece, list = targets[p];
  const rows = new Map();
  for (const t of list) {
    const mx = Math.min(...t.cells.map(c => c[0])), my = Math.min(...t.cells.map(c => c[1]));
    const sig = cellsKey(t.cells.map(([x, y]) => [x - mx, y - my]));
    if (!rows.has(sig)) rows.set(sig, { r: t.r, orient: t.orient, items: {} });
    rows.get(sig).items[t.minX] = t;
  }
  const ordered = [...rows.values()].sort((a, b) => a.r - b.r);
  let html = '<colgroup><col style="width:132px"></colgroup><thead><tr><th scope="col">Orientation</th>';
  for (let c = 1; c <= W; c++) html += '<th scope="col">' + c + '</th>';
  html += '</tr></thead><tbody>';
  let sum = 0, n = 0, max = 0, md = 0;
  for (const row of ordered) {
    html += '<tr><th scope="row"><span class="o">' + miniSVG(p, row.r) + '<span>' + row.orient + '</span></span></th>';
    for (let c = 0; c < W; c++) {
      const t = row.items[c];
      if (!t) { html += '<td class="na"></td>'; continue; }
      const k = t.path.length; sum += k; n++; max = Math.max(max, k);
      const st = masteryOf(t); if (st === 'mastered') md++;
      html += '<td class="c' + k + ' st-' + st + '" title="' + MASTERY_LABEL[st] + '">' + keysHTML(t.path) + '<span class="cnt">' + k + '</span></td>';
    }
    html += '</tr>';
  }
  $('#fchart').innerHTML = html + '</tbody>';
  $('#chartFoot').textContent = p + ': ' + n + ' landing spots, ' + (sum / n).toFixed(2) + ' presses on average, never more than ' + max + (opts.use180 ? ' (with 180)' : ' (without 180)') + '. You have ' + md + ' of ' + n + ' down pat in the Trainer.';
}

/* ---------- run log + plan (TETR.IO data) ---------- */
// Imported runs are kept as { user, source, fetchedAt, progression:[[ts,t]], runs:[[ts,t,pieces,lines,inputs,holds,faults,perfect,s,d,t,q]] }.
const fmtS = v => v.toFixed(2);
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const median = a => { const s = a.filter(v => isFinite(v)).sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = ym => MON[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
const toDate = ts => new Date(ts.length === 16 ? ts + ':00Z' : ts);
const shortDate = dt => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const whenStr = dt => dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const h = Math.round(min / 60);
  if (h < 24) return h + ' h ago';
  return whenStr(new Date(iso));
}
let histData = null, RL = null, logPending = null;

function histPrep(D) {
  const R = (Array.isArray(D.runs) ? D.runs : []).map(a => ({ ts: String(a[0]), t: +a[1], pc: +a[2], ln: +a[3], inp: +a[4], hd: +a[5], ff: +a[6], pp: +a[7], s: +a[8], d: +a[9], tr: +a[10], q: +a[11] }))
    .filter(d => d.t > 0 && d.pc > 0).map(d => ({ ...d, dt: toDate(d.ts) })).filter(d => !isNaN(d.dt)).sort((x, y) => x.dt - y.dt);
  R.forEach(d => { d.kpp = d.inp / d.pc; d.kps = d.inp / d.t; d.pps = d.pc / d.t; });
  // Runs far slower than the runs around them (deliberate slow practice) are left out of the stats.
  R.forEach((d, i) => { d.slow = d.t > 1.35 * median(R.slice(Math.max(0, i - 15), i + 16).map(x => x.t)); });
  return R;
}
function histStats(xs) {
  const m = k => median(xs.map(x => x[k]));
  return { n: xs.length, best: Math.min(...xs.map(x => x.t)), t: m('t'), pps: m('pps'), kps: m('kps'), kpp: m('kpp'), ff: m('ff'), hd: m('hd'), pc: m('pc'), inp: m('inp'),
    perf: median(xs.map(x => x.pp / x.pc)), quad: xs.reduce((s, x) => s + 4 * x.q / Math.max(1, x.ln), 0) / Math.max(1, xs.length) };
}
function corrOf(a, b) {
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  a.forEach((v, i) => { sab += (v - ma) * (b[i] - mb); saa += (v - ma) ** 2; sbb += (b[i] - mb) ** 2; });
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}
function analyse(D) {
  const R = histPrep(D), S = R.filter(d => !d.slow);
  if (S.length < 10) return null;
  const L = S.slice(-150), now = histStats(L);
  const sorted = L.slice().sort((a, b) => a.t - b.t), n = sorted.length;
  const top = sorted.slice(0, Math.max(5, Math.round(n / 10))), mid = sorted.slice(Math.floor(n / 4), Math.ceil(3 * n / 4));
  const T = histStats(top), M = histStats(mid);
  const pbRun = R.reduce((b, d) => (!b || d.t < b.t ? d : b), null);
  const byMonth = {};
  S.forEach(d => { (byMonth[d.ts.slice(0, 7)] = byMonth[d.ts.slice(0, 7)] || []).push(d); });
  const MS = Object.keys(byMonth).sort().map(m => ({ m, ...histStats(byMonth[m]) }));
  const first = MS.find(x => x.n >= 20) || MS[0];
  const typ = median(S.slice(-25).map(d => d.t)), typPrev = S.length >= 50 ? median(S.slice(-50, -25).map(d => d.t)) : NaN;
  const last5 = S.slice(-5);
  const weekAgo = Date.now() - 7 * 864e5, week = R.filter(d => +d.dt >= weekAgo);
  const lev = [
    { key: 'pauses', s: now.t - now.inp / T.kps },
    { key: 'finesse', s: (now.ff / 2) / now.kps },
    { key: 'pieces', s: Math.max(0, now.pc - T.pc) * now.kpp / now.kps },
    { key: 'holds', s: (now.hd / 2) / now.kps },
  ].sort((a, b) => b.s - a.s);
  const comb = (now.inp - now.ff / 2 - now.hd / 2 - Math.max(0, now.pc - T.pc) * now.kpp) / T.kps;
  const lt = L.map(d => Math.log(d.t)), mlt = mean(lt), vt = mean(lt.map(v => (v - mlt) ** 2));
  const share = z => { const mz = mean(z); return 100 * mean(z.map((v, i) => (v - mz) * (lt[i] - mlt))) / vt; };
  const peak = MS.filter(x => x.n >= 20).reduce((b, x) => (!b || x.quad > b.quad ? x : b), null);
  return {
    R, S, L, now, top, T, M, pbRun, MS, first, typ, typPrev, last5, week, lev, comb, peak,
    shKps: share(L.map(d => -Math.log(d.kps))), shPc: share(L.map(d => Math.log(d.pc))), shKpp: share(L.map(d => Math.log(d.kpp))),
    rq: corrOf(L.map(d => d.t), L.map(d => d.q)),
  };
}

/* run log tab */
function renderPbChip() {
  const chip = $('#pbChip');
  chip.innerHTML = RL ? 'PB <b>' + fmtS(RL.pbRun.t) + 's</b> · ' + RL.pbRun.pps.toFixed(2) + ' PPS' : 'PB <b>—</b>';
}
function renderLogTab() {
  const body = $('#logBody'), note = $('#logNote');
  if (!RL) return;
  const D = histData, R = RL.R, S = RL.S;
  note.textContent = R.length + ' 40L runs from TETR.IO user ' + (D.user || '') + ' since ' + shortDate(R[0].dt) + '. Updated ' + (D.fetchedAt ? relTime(D.fetchedAt) : 'on an earlier visit') + '.';
  const first = R[0], wBest = RL.week.length ? Math.min(...RL.week.map(d => d.t)) : null;
  const trend = isFinite(RL.typPrev) ? (RL.typ <= RL.typPrev ? fmtS(RL.typPrev - RL.typ) + ' s faster than the 25 before' : fmtS(RL.typ - RL.typPrev) + ' s slower than the 25 before') : 'median of your last 25 runs';
  const tiles = [
    ['Personal best', fmtS(RL.pbRun.t) + ' s', shortDate(RL.pbRun.dt) + ' · ' + RL.pbRun.pps.toFixed(2) + ' PPS'],
    ['Last 5 average', fmtS(mean(RL.last5.map(d => d.t))) + ' s', 'best of them ' + fmtS(Math.min(...RL.last5.map(d => d.t))) + ' s'],
    ['Typical run', fmtS(RL.typ) + ' s', trend],
    ['Since first log', (RL.pbRun.t <= first.t ? '−' : '+') + fmtS(Math.abs(first.t - RL.pbRun.t)) + ' s', 'PB vs ' + fmtS(first.t) + ' s on ' + shortDate(first.dt)],
    ['This week', RL.week.length + ' ' + plural(RL.week.length, 'run'), wBest ? 'best ' + fmtS(wBest) + ' s' : 'none in the last 7 days'],
    ['Runs logged', String(R.length), (R.length - S.length) + ' slow practice runs not counted'],
  ];
  let h = '<div class="tiles six">' + tiles.map(t => '<div class="card tile"><div class="eyebrow">' + t[0] + '</div><div class="v">' + t[1] + '</div><div class="s">' + t[2] + '</div></div>').join('') + '</div>';
  h += '<div class="card"><div class="card-head"><h3>Every run since ' + shortDate(R[0].dt) + '</h3><span class="muted small">Seconds, lower is better</span></div>' +
    '<div class="hi-chart" id="logChartWrap"><div id="logChart"></div><div class="tip" id="logTip" hidden></div></div>' +
    '<div class="chart-legend"><span><i class="ring"></i>One run</span><span><i class="line"></i>Typical run (median of the last 25)</span><span><i class="step"></i>Personal best</span></div></div>';
  const recent = R.slice(-15).reverse();
  h += '<div class="card"><div class="card-head"><h3>Recent runs</h3><span class="muted small">newest first</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>When</th><th>Time</th><th>PPS</th><th>KPP</th><th>Keys/s</th><th>Faults</th><th>Holds</th><th>Pieces</th><th></th></tr></thead><tbody>' +
    recent.map(d => '<tr><td>' + whenStr(d.dt) + '</td><td class="mono">' + fmtS(d.t) + '</td><td class="mono">' + d.pps.toFixed(2) + '</td><td class="mono">' + d.kpp.toFixed(2) + '</td><td class="mono">' + d.kps.toFixed(2) + '</td><td class="mono">' + d.ff + '</td><td class="mono">' + d.hd + '</td><td class="mono">' + d.pc + '</td><td>' +
      (d === RL.pbRun ? '<span class="pill accent">PB</span>' : d.slow ? '<span class="pill muted-pill">Practice</span>' : '') + '</td></tr>').join('') + '</tbody></table></div></div>';
  h += '<div class="card"><div class="card-head"><h3>Month by month</h3><span class="muted small">medians, practice runs left out</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Month</th><th>Runs</th><th>Best</th><th>Typical</th><th>PPS</th><th>Keys/s</th><th>Keys/piece</th><th>Faults</th><th>Holds</th><th>Pieces</th><th>Tetris lines</th></tr></thead><tbody>' +
    RL.MS.map(x => '<tr><td>' + monLabel(x.m) + '</td><td class="mono">' + x.n + '</td><td class="mono">' + fmtS(x.best) + '</td><td class="mono">' + fmtS(x.t) + '</td><td class="mono">' + x.pps.toFixed(2) + '</td><td class="mono">' + x.kps.toFixed(2) + '</td><td class="mono">' + x.kpp.toFixed(2) + '</td><td class="mono">' + Math.round(x.ff) + '</td><td class="mono">' + Math.round(x.hd) + '</td><td class="mono">' + Math.round(x.pc) + '</td><td class="mono">' + Math.round(100 * x.quad) + '%</td></tr>').join('') +
    '</tbody></table></div><p class="muted small" style="margin-top:10px">Source: the public TETRA CHANNEL API for ' + (D.user || 'your account') + '.</p></div>';
  body.innerHTML = h;
  requestAnimationFrame(logChart);
}
function logChart() {
  const box = $('#logChart');
  if (!box || !RL || activeTab !== 'log') return;
  const R = RL.R, S = RL.S;
  const Wd = Math.max(280, box.clientWidth), Hd = 300, m = { l: 40, r: 64, t: 14, b: 26 };
  const iw = Wd - m.l - m.r, ih = Hd - m.t - m.b;
  const x0 = +S[0].dt, x1 = +S[S.length - 1].dt;
  const X = d => m.l + (x1 > x0 ? (+d - x0) / (x1 - x0) : 0.5) * iw;
  // personal best over time, seeded by any earlier PB from the progression list
  let pb = Infinity;
  (histData.progression || []).forEach(p => { const pd = toDate(String(p[0])); if (+pd <= x0 && +p[1] < pb) pb = +p[1]; });
  const steps = [];
  R.forEach(d => { if (d.t < pb || !steps.length) { pb = Math.min(pb, d.t); steps.push({ dt: d.dt < S[0].dt ? S[0].dt : d.dt, t: pb }); } });
  const lo = Math.floor((Math.min(...steps.map(s => s.t), ...S.map(d => d.t)) - 2) / 10) * 10;
  const hi = Math.ceil(Math.max(...S.map(d => d.t)) / 10) * 10;
  const Y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
  let s = '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="40L time of every logged run over time">';
  for (let v = lo; v <= hi; v += 10) {
    const y = Y(v).toFixed(1);
    s += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/>';
    s += '<text x="' + (m.l - 6) + '" y="' + y + '" dy="0.32em" text-anchor="end" fill="var(--muted)" font-size="10.5" font-family="IBM Plex Mono, monospace">' + v + '</text>';
  }
  const d0 = new Date(x0);
  for (let mth = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); +mth <= x1; mth = new Date(Date.UTC(mth.getUTCFullYear(), mth.getUTCMonth() + 1, 1))) {
    const x = X(mth).toFixed(1);
    s += '<line x1="' + x + '" x2="' + x + '" y1="' + (m.t + ih) + '" y2="' + (m.t + ih + 4) + '" stroke="var(--muted)"/>';
    s += '<text x="' + x + '" y="' + (Hd - 6) + '" text-anchor="middle" fill="var(--muted)" font-size="10.5">' + MON[mth.getUTCMonth()] + '</text>';
  }
  S.forEach(d => { s += '<circle cx="' + X(d.dt).toFixed(1) + '" cy="' + Y(d.t).toFixed(1) + '" r="2.6" fill="var(--accent)" fill-opacity=".32"/>'; });
  const roll = [];
  S.forEach((d, i) => { if (i >= 9) roll.push([X(d.dt), Y(median(S.slice(Math.max(0, i - 24), i + 1).map(x => x.t)))]); });
  s += '<path d="' + roll.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  let sp = '';
  steps.forEach((st, i) => { const x = X(st.dt).toFixed(1), y = Y(st.t).toFixed(1); sp += i ? ' H' + x + ' V' + y : 'M' + x + ' ' + y; });
  sp += ' H' + (Wd - m.r);
  s += '<path d="' + sp + '" fill="none" stroke="var(--ink)" stroke-width="1.5"/>';
  const last = steps[steps.length - 1];
  s += '<text x="' + (Wd - m.r + 6) + '" y="' + Y(last.t).toFixed(1) + '" dy="0.32em" fill="var(--ink)" font-size="11" font-weight="600" font-family="IBM Plex Mono, monospace">PB ' + fmtS(last.t) + '</text>';
  const lastRoll = roll[roll.length - 1];
  if (lastRoll && Math.abs(lastRoll[1] - Y(last.t)) > 14) s += '<text x="' + (Wd - m.r + 6) + '" y="' + lastRoll[1].toFixed(1) + '" dy="0.32em" fill="var(--muted)" font-size="11" font-family="IBM Plex Mono, monospace">' + fmtS(RL.typ) + '</text>';
  s += '<rect id="logHit" x="' + m.l + '" y="0" width="' + iw + '" height="' + Hd + '" fill="transparent"/>';
  box.innerHTML = s + '</svg>';
  const svg = box.querySelector('svg'), tip = $('#logTip'), wrap = $('#logChartWrap');
  const pts = S.map(d => ({ d, x: X(d.dt), y: Y(d.t) }));
  const show = e => {
    const r = svg.getBoundingClientRect(), k = Wd / r.width;
    const sx = (e.clientX - r.left) * k, sy = (e.clientY - r.top) * k;
    let best = null, bd = Infinity;
    pts.forEach(p => { const dd = (p.x - sx) ** 2 + (p.y - sy) ** 2; if (dd < bd) { bd = dd; best = p; } });
    if (!best || bd > 900) { tip.hidden = true; return; }
    const d = best.d;
    tip.innerHTML = '';
    const b = document.createElement('b'); b.textContent = fmtS(d.t) + ' s'; tip.appendChild(b);
    const line = t => { const el = document.createElement('div'); el.className = 'muted'; el.textContent = t; tip.appendChild(el); };
    line(whenStr(d.dt));
    line(d.pps.toFixed(2) + ' PPS · ' + d.kpp.toFixed(2) + ' KPP · ' + d.kps.toFixed(2) + ' keys/s');
    line(d.ff + ' finesse faults · ' + d.hd + ' holds · ' + d.pc + ' pieces');
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const px = r.left - wr.left + best.x / k, py = r.top - wr.top + best.y / k;
    tip.style.left = Math.min(Math.max(4, px - tip.offsetWidth / 2), wr.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = Math.max(0, py - tip.offsetHeight - 12) + 'px';
  };
  const hit = box.querySelector('#logHit');
  hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { tip.hidden = true; });
}
let logRaf = 0;
new ResizeObserver(() => { cancelAnimationFrame(logRaf); logRaf = requestAnimationFrame(logChart); }).observe($('#logBody'));

/* plan tab */
const MILESTONES = [80, 70, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15];
let goalTarget = LS.get('sl.goal2', null);
const LEVER = {
  pauses: n => ({
    title: 'Cut the pauses',
    why: 'Your fastest ' + RL.top.length + ' runs average ' + RL.T.kps.toFixed(2) + ' keys per second; a typical run ' + n.kps.toFixed(2) + ', with almost the same keys per piece (' + RL.T.kpp.toFixed(2) + ' vs ' + n.kpp.toFixed(2) + '). The gap is time spent deciding where pieces go.',
    todo: 'Play Sprint here with the suggested spot showing and never stop moving, even if a placement is imperfect. Pick the next piece\'s spot while the current one is still falling. The Sprint analysis shows exactly which pieces you stalled on.',
    tab: 'sprint', btn: 'Open Sprint',
  }),
  finesse: n => ({
    title: 'Clean up finesse',
    why: 'A typical run has ' + Math.round(n.ff) + ' finesse faults and ' + Math.round(100 * (1 - n.perf)) + '% of pieces are not placed with the fewest presses. That number has barely moved since ' + monLabel(RL.first.m) + ' (' + Math.round(RL.first.ff) + ' then).',
    todo: 'Ten minutes a day in the Trainer with Focus weak spots on. It now times every placement and keeps serving the ones you miss or place slowly until they are down pat. Removing every fault would be worth about ' + fmtS(n.ff / n.kps) + ' s.',
    tab: 'trainer', btn: 'Open Trainer',
  }),
  pieces: n => ({
    title: 'Finish with an empty board',
    why: 'Typical runs use ' + Math.round(n.pc) + ' pieces; your fastest runs ' + Math.round(RL.T.pc) + '. The extra pieces are stack still on the board when line 40 clears.',
    todo: 'From about line 30, only place pieces that complete lines, and stop building upward. Aim to end with almost nothing left on the board.',
  }),
  holds: n => ({
    title: 'Hold less',
    why: 'About ' + Math.round(n.hd) + ' holds per run (' + Math.round(100 * n.hd / n.pc) + '% of pieces). Each one costs a key press and a decision.',
    todo: 'Hold only to keep an I piece or to skip an S or Z with no clean spot. Aim for under ' + Math.max(4, Math.round(n.hd / 2)) + ' holds on the results screen.',
  }),
};
function renderPlan() {
  const body = $('#planBody'), note = $('#planNote');
  if (!RL) { $('#goalCard').hidden = true; return; }
  $('#goalCard').hidden = false;
  const n = RL.now;
  note.textContent = 'Built from your last ' + RL.L.length + ' TETR.IO runs (updated ' + (histData.fetchedAt ? relTime(histData.fetchedAt) : 'earlier') + '). It changes as you fetch new runs.';
  const pbGoal = MILESTONES.find(x => x < RL.pbRun.t) || 15;
  const typGoal = Math.floor((RL.typ - 0.01) / 5) * 5;
  let h = '<div class="tiles">' + [
    ['Typical run now', fmtS(RL.typ) + ' s', 'median of your last 25'],
    ['Personal best', fmtS(RL.pbRun.t) + ' s', shortDate(RL.pbRun.dt)],
    ['Next PB goal', 'sub-' + pbGoal, (Math.max(100, Math.round(n.pc)) / pbGoal).toFixed(2) + ' PPS at ' + Math.max(100, Math.round(n.pc)) + ' pieces'],
    ['Next typical-run goal', 'under ' + typGoal + ' s', fmtS(RL.typ - typGoal) + ' s to go'],
  ].map(t => '<div class="card tile"><div class="eyebrow">' + t[0] + '</div><div class="v">' + t[1] + '</div><div class="s">' + t[2] + '</div></div>').join('') + '</div>';

  h += '<div class="card"><div class="card-head"><h3>Your focus, in order</h3><span class="muted small">seconds each is worth, measured on your last ' + RL.L.length + ' runs (median ' + fmtS(n.t) + ' s)</span></div><ol class="focus">' +
    RL.lev.map((l, i) => {
      const f = LEVER[l.key](n);
      return '<li><div class="f-head"><span class="no">' + (i + 1) + '</span><b>' + f.title + '</b><span class="cost">≈' + fmtS(l.s) + ' s</span></div>' +
        '<p>' + f.why + '</p><p class="todo"><b>Do this:</b> ' + f.todo + '</p>' + (f.tab ? '<button type="button" class="btn ghost f-go" data-go="' + f.tab + '">' + f.btn + '</button>' : '') + '</li>';
    }).join('') +
    '</ol><div class="lever-total">All four together would put your typical run near <b>' + fmtS(RL.comb) + ' s</b>. The estimates overlap, so treat that as a direction, not a promise.</div></div>';

  // Session built around the top focus
  const topKey = RL.lev[0].key;
  const sess = topKey === 'finesse'
    ? [['12 min', 'Trainer, Focus weak spots on', 'Hints off. Stay until the Mastered count stops climbing.'], ['8 min', 'Calm TETR.IO runs', 'About 10% slower than your typical pace with under 20 finesse faults.'], ['12 min', 'Push runs', 'Normal pace. Restart bad starts right away.'], ['3 min', 'Update your runs', 'Check whether faults per run moved.']]
    : topKey === 'pauses'
      ? [['5 min', 'Trainer warm-up', 'Accuracy over speed.'], ['10 min', 'Sprint here, suggested spot on', 'Never stop moving. Check the pause chart after each run.'], ['15 min', 'TETR.IO flow runs', 'Steady pace you can hold all 40 lines; look one piece ahead.'], ['5 min', 'Update your runs', 'Compare keys per second with your fastest runs.']]
      : [['5 min', 'Trainer warm-up', 'Accuracy over speed.'], ['10 min', 'Sprint here', 'Practise the ' + (topKey === 'pieces' ? 'clean finish from line 30' : 'no-hold habit') + '.'], ['15 min', 'TETR.IO push runs', 'Restart bad starts right away.'], ['5 min', 'Update your runs', 'Check the number you are working on.']];
  h += '<div class="sp-grid"><div class="card"><div class="card-head"><h3>Today\'s 35 minutes</h3><span class="muted small">built around "' + LEVER[topKey](n).title.toLowerCase() + '"</span></div><ol class="session">' +
    sess.map(x => '<li><span class="min">' + x[0] + '</span><span><b>' + x[1] + '</b>' + x[2] + '</span></li>').join('') + '</ol></div>';

  const rows = [
    ['Time', fmtS(RL.T.t) + ' s', fmtS(RL.M.t) + ' s'], ['Pieces per second', RL.T.pps.toFixed(2), RL.M.pps.toFixed(2)], ['Keys per second', RL.T.kps.toFixed(2), RL.M.kps.toFixed(2)],
    ['Keys per piece', RL.T.kpp.toFixed(2), RL.M.kpp.toFixed(2)], ['Finesse faults', String(Math.round(RL.T.ff)), String(Math.round(RL.M.ff))], ['Holds', String(Math.round(RL.T.hd)), String(Math.round(RL.M.hd))], ['Pieces placed', String(Math.round(RL.T.pc)), String(Math.round(RL.M.pc))],
  ];
  h += '<div class="card"><div class="card-head"><h3>What your fastest runs do differently</h3><span class="muted small">last ' + RL.L.length + ' runs</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th></th><th>Fastest ' + RL.top.length + '</th><th>Middle half</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + r[0] + '</td><td class="mono">' + r[1] + '</td><td class="mono">' + r[2] + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="muted small" style="margin-top:10px">Of the difference between your fast and slow runs, ' + Math.round(RL.shKps) + '% comes from key speed, ' + Math.round(RL.shPc) + '% from pieces used and ' + Math.round(RL.shKpp) + '% from keys per piece.</p></div></div>';

  const kpsUp = 100 * (n.kps / RL.first.kps - 1), kppCh = 100 * (n.kpp / RL.first.kpp - 1);
  let c1 = '<div class="card"><h3>Your progress so far came from speed</h3><b class="big">' + RL.first.kps.toFixed(2) + ' → ' + n.kps.toFixed(2) + ' keys/s</b>' +
    '<p>Since ' + monLabel(RL.first.m) + ', keys per second went up ' + Math.round(kpsUp) + '%. Keys per piece went from ' + RL.first.kpp.toFixed(2) + ' to ' + n.kpp.toFixed(2) + ' and finesse faults from ' + Math.round(RL.first.ff) + ' to ' + Math.round(n.ff) + ' per run. ' +
    (Math.abs(kppCh) < 5 ? 'You are pressing faster, not pressing less, so finesse still has the most untouched room.' : 'Both speed and efficiency have moved.') + '</p></div>';
  let c2;
  if (RL.peak && RL.peak.quad - n.quad > 0.1) {
    c2 = '<div class="card"><h3>Dropping tetris stacking paid off</h3><b class="big">' + Math.round(100 * RL.peak.quad) + '% → ' + Math.round(100 * n.quad) + '% of lines from tetrises</b>' +
      '<p>In ' + monLabel(RL.peak.m) + ' your typical run was ' + fmtS(RL.peak.t) + ' s. Clearing what is in front of you, it is ' + fmtS(n.t) + ' s. In recent runs tetrises and time are ' + (Math.abs(RL.rq) < 0.2 ? 'unrelated' : RL.rq < 0 ? 'linked: more tetrises, faster runs' : 'linked: more tetrises, slower runs') + ' (r = ' + RL.rq.toFixed(2) + '), so there is no reason to wait for I pieces.</p></div>';
  } else {
    c2 = '<div class="card"><h3>Consistency</h3><b class="big">' + RL.L.filter(d => d.t <= RL.pbRun.t * 1.1).length + ' of ' + RL.L.length + '</b><p>recent runs were within 10% of your PB. Raising the typical run moves your PB with it.</p></div>';
  }
  h += '<div class="callouts">' + c1 + c2 + '</div>';
  body.innerHTML = h;
  body.querySelectorAll('.f-go').forEach(b => b.addEventListener('click', () => { showTab(b.dataset.go, true); window.scrollTo(0, 0); }));
  if (!(goalTarget > 0)) { goalTarget = pbGoal; $('#gTarget').value = pbGoal; }
  renderGoal();
}
function renderGoal() {
  if (!RL) return;
  const n = RL.now, pc = Math.max(100, Math.round(n.pc)), tg = parseFloat($('#gTarget').value);
  const out = $('#calcOut');
  const facts = '<dl class="kv"><div><dt>Your PB</dt><dd>' + fmtS(RL.pbRun.t) + ' s <span class="muted">' + RL.pbRun.pps.toFixed(2) + ' PPS</span></dd></div><div><dt>Typical run</dt><dd>' + fmtS(RL.typ) + ' s <span class="muted">' + (pc / RL.typ).toFixed(2) + ' PPS</span></dd></div><div><dt>Pieces per run</dt><dd>' + pc + '</dd></div><div><dt>Keys per piece</dt><dd>' + n.kpp.toFixed(2) + '</dd></div></dl>';
  if (!(tg >= 10 && tg <= 300)) { out.innerHTML = facts + '<p class="muted">Enter a target between 10 and 300 seconds.</p>'; renderLadder(pc); return; }
  const need = pc / tg, typPps = pc / RL.typ, kpsNeed = need * n.kpp;
  const per01 = pc / typPps - pc / (typPps + 0.1);
  out.innerHTML = '<div class="big"><span class="num">' + need.toFixed(2) + '</span><span class="unit">PPS for ' + fmtS(tg) + ' s</span></div>' + facts +
    '<p class="insight">That is ' + Math.round(1000 / need) + ' ms per piece (' + Math.round(1000 / typPps) + ' ms in a typical run) and ' + kpsNeed.toFixed(1) + ' keys per second at your current keys per piece. ' +
    (RL.T.kps >= kpsNeed ? 'Your fastest runs already reach ' + RL.T.kps.toFixed(2) + ' keys per second, so the speed is in your hands; it is about doing it every run.' : 'Your fastest runs reach ' + RL.T.kps.toFixed(2) + ' keys per second, so cleaner finesse (fewer keys per piece) is the cheaper route.') +
    ' At your pace, every +0.1 PPS cuts about ' + per01.toFixed(1) + ' s.</p>';
  renderLadder(pc);
}
function renderLadder(pc) {
  const maxP = pc / 15, typ = RL.typ, pb = RL.pbRun.t;
  let html = '<thead><tr><th>Time</th><th>PPS</th><th>Per piece</th><th>Keys/s at your KPP</th><th style="width:30%">Pace</th><th></th></tr></thead><tbody>';
  let nextMarked = false;
  for (const t of MILESTONES) {
    const pps = pc / t;
    const done = pb <= t;
    let cls = done ? 'done' : '', tag = '';
    if (typ <= t) tag = '<span class="pill good">Typical run</span>';
    else if (done) tag = '<span class="pill good">PB</span>';
    if (!done && !nextMarked) { nextMarked = true; cls = 'is-next'; tag = '<span class="pill accent">Next</span>'; }
    html += '<tr class="' + cls + '"><td class="mono">sub-' + t + '</td><td class="mono">' + pps.toFixed(2) + '</td><td class="mono">' + Math.round(1000 / pps) + ' ms</td><td class="mono">' + (pps * RL.now.kpp).toFixed(1) + '</td><td><div class="bar"><i style="width:' + (100 * pps / maxP).toFixed(1) + '%"></i></div></td><td>' + tag + '</td></tr>';
  }
  $('#ladder').innerHTML = html + '</tbody>';
}
$('#gTarget').addEventListener('input', () => { goalTarget = parseFloat($('#gTarget').value); LS.set('sl.goal2', goalTarget); renderGoal(); });
if (goalTarget > 0) $('#gTarget').value = goalTarget;

/*__DATA__*/

/*__PLAN__*/

/* ---------- sprint: game ---------- */
const SW = 10, SH = 22, SP_Y = 0, GRAV_MS = 1000, LOCK_MS = 500, LOCK_RESETS = 15, GOAL = 40, COUNT_MS = 1500;
const spField = $('#spField'), spCv = $('#spBoard'), spCtx = spCv.getContext('2d');
const spHoldCtx = $('#spHold').getContext('2d'), spNextCtx = $('#spNext').getContext('2d');
const SP = { state: 'idle', B: null, cur: null, queue: [], bag: [], hold: null, holdUsed: false, log: [], lines: 0, keys: 0 };
const SC = { held: { left: false, right: false }, dasDir: 0, dasStart: 0, charged: false, lastShift: 0, dcdUntil: 0 };
// Sprint runs are not stored anywhere: the last run's analysis lives in memory for this visit only.
let spLast = null;

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const fmtRun = t => t >= 60 ? Math.floor(t / 60) + ':' + (t % 60).toFixed(3).padStart(6, '0') : t.toFixed(3);
const plural = (n, one, many) => n === 1 ? one : (many || one + 's');
function spRefill() { while (SP.queue.length < 6) { if (!SP.bag.length) SP.bag = shuffle(PIECES.slice()); SP.queue.push(SP.bag.pop()); } }
function spReleaseAll() { SC.held.left = SC.held.right = false; SC.dasDir = 0; SC.charged = false; }

function spShowOverlay(title, sub, o) {
  $('#spOvTitle').textContent = title;
  $('#spOvSub').textContent = sub;
  $('#spStartBtn').textContent = o.btn || 'Start';
  $('#spJump').hidden = !o.jump;
  const rk = keys.retry[0], hk = keys.hold[0];
  $('#spOvKeys').textContent = (rk ? keyName(rk) + ' restarts' : 'Bind a restart key in Settings') + (hk ? ' · ' + keyName(hk) + ' holds' : '');
  $('#spOverlay').hidden = false;
}
function spStart(now) {
  Object.assign(SP, {
    state: 'countdown', B: Array.from({ length: SH }, () => new Array(SW).fill(0)), cur: null, hold: null, holdUsed: false,
    queue: [], bag: [], lines: 0, keys: 0, holds: 0, cs: now, t0: 0, tEnd: 0, log: [], clears: [0, 0, 0, 0, 0], splits: [], splitPieces: [],
    pieceStart: 0, pk: 0, pseq: [], psoft: false, pslide: false, pheld: false, lockAt: null, lockResets: 0, lowestY: 0, lastFall: 0, failed: false,
  });
  if (SC.dasDir) { SC.charged = false; SC.dasStart = now; }
  spRefill();
  $('#spOverlay').hidden = true;
}
function spAbort() {
  if (SP.state === 'countdown' || SP.state === 'playing') {
    SP.state = 'idle'; SP.cur = null;
    spShowOverlay('Run stopped', 'You left the Sprint tab. Start a new run when you are ready.', { btn: 'Start' });
  }
  spReleaseAll();
}
/* Placement coach: scores every straight-drop placement with Dellacherie-style stack features
   (landing height, cleared cells, row/column transitions, holes, wells), looks one piece ahead,
   and breaks near-ties toward the placement with the fewest key presses. */
function stackFeatures(B) {
  const h = B.length;
  let rt = 0, ct = 0, holes = 0, wells = 0;
  for (let y = 0; y < h; y++) {
    const row = B[y];
    let prev = 1;
    for (let x = 0; x < SW; x++) { const c = row[x] ? 1 : 0; if (c !== prev) rt++; prev = c; }
    if (!prev) rt++;
  }
  for (let x = 0; x < SW; x++) {
    let prev = 0, seen = false, depth = 0;
    for (let y = 0; y < h; y++) {
      const c = B[y][x] ? 1 : 0;
      if (c !== prev) ct++;
      prev = c;
      if (c) seen = true; else if (seen) holes++;
      const l = x === 0 || B[y][x - 1], r = x === SW - 1 || B[y][x + 1];
      if (!c && l && r) { depth++; wells += depth; } else depth = 0;
    }
    if (!prev) ct++;
  }
  return { rt, ct, holes, wells };
}
function placeOn(B, p, x, r) {
  const y = dropY({ p, x, y: SP_Y, r, B });
  const cells = cellsOf(p, x, y, r);
  if (cells.some(([, cy]) => cy < 0)) return null;
  const nb = B.map(row => row.slice());
  for (const [cx, cy] of cells) nb[cy][cx] = p;
  let lines = 0, eroded = 0;
  // clear full rows; after k clears, the row now at index yy started at yy - k
  for (let yy = SH - 1; yy >= 0;) {
    if (nb[yy].every(v => v)) { eroded += cells.filter(c => c[1] === yy - lines).length; nb.splice(yy, 1); nb.unshift(new Array(SW).fill(0)); lines++; } else yy--;
  }
  const ys = cells.map(c => c[1]);
  const f = stackFeatures(nb);
  const score = -4.5 * (SH - (Math.min(...ys) + Math.max(...ys)) / 2) + 3.4 * lines * eroded - 3.2 * f.rt - 9.3 * f.ct - 7.9 * f.holes - 3.4 * f.wells;
  return { nb, cells, y, score, lines };
}
function placements(B, p) {
  const out = [], seen = new Set();
  for (let r = 0; r < 4; r++) for (let x = -3; x < SW; x++) {
    if (!fits(p, x, SP_Y, r, B)) continue;
    // the piece has to be able to slide over at spawn height from the spawn column
    let ok = true;
    for (let xx = Math.min(3, x); xx <= Math.max(3, x); xx++) if (!fits(p, xx, SP_Y, r, B)) { ok = false; break; }
    if (!ok) continue;
    const y = dropY({ p, x, y: SP_Y, r, B });
    const key = cellsKey(cellsOf(p, x, y, r));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x, r, key });
  }
  return out;
}
function spSuggest(p, B, nextP) {
  let best = null;
  for (const pl of placements(B, p)) {
    const a = placeOn(B, p, pl.x, pl.r);
    if (!a) continue;
    let look = 0;
    if (nextP) {
      look = -Infinity;
      for (const q of placements(a.nb, nextP)) { const b = placeOn(a.nb, nextP, q.x, q.r); if (b && b.score > look) look = b.score; }
      if (look === -Infinity) look = -1e6;
    }
    const t = findTarget(p, cellsKey(cellsOf(p, pl.x, dropY({ p, x: pl.x, y: 0, r: pl.r }), pl.r)));
    const keys = t ? t.path.length : 4;
    const total = 0.5 * a.score + look - 0.6 * keys;
    if (!best || total > best.total) best = { total, key: pl.key, cells: a.cells, path: t ? t.path : null };
  }
  return best;
}
function spRenderHint() {
  const el = $('#spHint');
  const show = opts.coach && opts.coachKeys && SP.state === 'playing' && SP.sugg && SP.sugg.path;
  el.hidden = !show;
  if (show) el.innerHTML = '<span class="muted">Suggested</span> ' + keysHTML(SP.sugg.path);
}
function spSpawn(p, now) {
  SP.cur = { p, x: 3, y: SP_Y, r: 0, B: SP.B };
  SP.pk = 0; SP.pseq = []; SP.psoft = false; SP.pslide = false;
  SP.lockAt = null; SP.lockResets = 0; SP.lowestY = SP_Y; SP.lastFall = now;
  if (!fits(p, 3, SP_Y, 0, SP.B)) { spFinish(now, true); return; }
  SP.sugg = opts.coach ? spSuggest(p, SP.B, SP.queue[0]) : null;
  spRenderHint();
  if (SC.dasDir && SC.charged) {
    SP.pseq.push(SC.dasDir < 0 ? 'HL' : 'HR');
    SC.dcdUntil = now + fr(handling.dcd); SC.lastShift = SC.dcdUntil;
  }
}
function spNext(now) { spRefill(); const p = SP.queue.shift(); spRefill(); SP.holdUsed = false; SP.pheld = false; spSpawn(p, now); }
function spGrounded() { const c = SP.cur; return !fits(c.p, c.x, c.y + 1, c.r, SP.B); }
// After a successful move or rotation: a grounded piece gets a fresh lock timer (limited resets).
function spMoved(now) {
  if (spGrounded()) { if (SP.lockResets < LOCK_RESETS) { SP.lockAt = now + LOCK_MS; SP.lockResets++; } }
  else SP.lockAt = null;
}
function spMarkSlide() {
  if (!(SP.state === 'playing' && SC.dasDir && SC.charged && handling.arr > 0 && SP.cur && moveH(SP.cur, SC.dasDir))) return;
  SP.pslide = true;
  for (let i = SP.pseq.length - 1; i >= 0; i--) {
    const t = SP.pseq[i];
    if (t === 'DL' || t === 'HL') { SP.pseq[i] = 'PL'; break; }
    if (t === 'DR' || t === 'HR') { SP.pseq[i] = 'PR'; break; }
  }
}
function spPress(a, now) {
  if (a === 'retry') { spStart(now); return; }
  if (SP.state === 'countdown' && (a === 'left' || a === 'right')) {
    SC.held[a] = true; SC.dasDir = a === 'left' ? -1 : 1; SC.charged = false; SC.dasStart = now; SP.keys++;
    return;
  }
  if (SP.state !== 'playing' || !SP.cur) return;
  const c = SP.cur;
  if (a === 'left' || a === 'right') {
    const d = a === 'left' ? -1 : 1;
    SC.held[a] = true; SC.dasDir = d; SC.charged = false; SC.dasStart = now; SC.dcdUntil = 0;
    const n = moveH(c, d); if (n) { SP.cur = n; spMoved(now); }
    SP.pk++; SP.keys++; SP.pseq.push(d < 0 ? 'L' : 'R');
  } else if (a === 'cw' || a === 'ccw' || a === 'r180') {
    const turn = a === 'cw' ? 1 : a === 'ccw' ? 3 : 2;
    const n = rotate(c, turn); if (n) { SP.cur = n; spMoved(now); }
    SP.pk++; SP.keys++; SP.pseq.push(a === 'cw' ? 'CW' : a === 'ccw' ? 'CCW' : 'R180');
    if (SC.dasDir && SC.charged && handling.dcd > 0) { SC.dcdUntil = now + fr(handling.dcd); SC.lastShift = SC.dcdUntil; }
  } else if (a === 'soft') {
    SP.cur = { ...c, y: dropY(c) };
    SP.psoft = true; SP.pk++; SP.keys++; SP.pseq.push('SD');
  } else if (a === 'hard') {
    SP.keys++; spLock(now, true);
  } else if (a === 'hold') {
    if (SP.holdUsed) return;
    SP.keys++; SP.holds++;
    const p = c.p;
    let np = SP.hold;
    if (!np) { spRefill(); np = SP.queue.shift(); spRefill(); }
    SP.hold = p; SP.holdUsed = true; SP.pheld = true;
    spSpawn(np, now);
  }
}
function spRelease(a, now) {
  if (a !== 'left' && a !== 'right') return;
  SC.held[a] = false;
  const d = a === 'left' ? -1 : 1;
  if (SC.dasDir !== d) return;
  spMarkSlide();
  const other = a === 'left' ? 'right' : 'left';
  if (SC.held[other]) { SC.dasDir = -d; SC.charged = false; SC.dasStart = now; }
  else { SC.dasDir = 0; SC.charged = false; }
}
function spAuto(now) {
  const before = SP.cur.x;
  if (handling.arr <= 0) SP.cur = shiftWall(SP.cur, SC.dasDir);
  else { const n = moveH(SP.cur, SC.dasDir); if (n) SP.cur = n; }
  if (SP.cur.x !== before) spMoved(now);
}
function spTick(now) {
  if (SP.state === 'countdown') {
    if (now - SP.cs < COUNT_MS) return;
    SP.state = 'playing'; SP.t0 = SP.cs + COUNT_MS; SP.pieceStart = SP.t0;
    spNext(now);
  }
  if (SP.state !== 'playing' || !SP.cur) return;
  if (SC.dasDir && now >= SC.dcdUntil) {
    if (!SC.charged) {
      if (now - SC.dasStart >= fr(handling.das)) {
        SC.charged = true; SC.lastShift = now;
        const last = SP.pseq.length - 1, tap = SC.dasDir < 0 ? 'L' : 'R';
        if (last >= 0 && SP.pseq[last] === tap) SP.pseq[last] = SC.dasDir < 0 ? 'DL' : 'DR';
        spAuto(now);
      }
    } else if (handling.arr <= 0) spAuto(now);
    else {
      const step = fr(handling.arr);
      let guard = 0;
      while (now - SC.lastShift >= step && guard++ < 12) {
        SC.lastShift += step;
        const n = moveH(SP.cur, SC.dasDir);
        if (!n) { SC.lastShift = now; break; }
        SP.cur = n; spMoved(now);
      }
    }
  }
  if (!spGrounded()) {
    SP.lockAt = null;
    if (now - SP.lastFall >= GRAV_MS) {
      SP.cur = { ...SP.cur, y: SP.cur.y + 1 }; SP.lastFall = now;
      if (SP.cur.y > SP.lowestY) { SP.lowestY = SP.cur.y; SP.lockResets = 0; }
    }
  } else {
    if (SP.lockAt == null) SP.lockAt = now + LOCK_MS;
    if (now >= SP.lockAt) spLock(now, false);
  }
}
function spLock(now, hard) {
  if (!SP.cur) return;
  spMarkSlide();
  let c = SP.cur;
  if (hard) c = { ...c, y: dropY(c) };
  const cells = cellsOf(c.p, c.x, c.y, c.r);
  const match = SP.sugg ? cellsKey(cells) === SP.sugg.key : null;
  // Finesse is judged like TETR.IO: against the empty-board optimum for the same column and rotation,
  // and skipped when the piece had to be soft dropped under the stack (a tuck or spin).
  let opt = null, best = null;
  const tuck = !fits(c.p, c.x, SP_Y, c.r, SP.B) || dropY({ p: c.p, x: c.x, y: SP_Y, r: c.r, B: SP.B }) !== c.y;
  if (!tuck) {
    const ek = cellsKey(cellsOf(c.p, c.x, dropY({ p: c.p, x: c.x, y: 0, r: c.r }), c.r));
    const t = findTarget(c.p, ek);
    if (t) { opt = t.path.length; best = t.path; }
  }
  if (hard) addFx('sp', 'trail', now, 150, { color: COLORS[c.p], cols: trailOf(c.p, cellsOf(SP.cur.p, SP.cur.x, SP.cur.y, SP.cur.r), cells) });
  for (const [x, y] of cells) {
    if (y < 0) { spFinish(now, true); return; }
    SP.B[y][x] = c.p;
  }
  const fullRows = [];
  for (let y = 0; y < SH; y++) if (SP.B[y].every(v => v)) fullRows.push(y);
  if (fullRows.length) addFx('sp', 'clear', now, fullRows.length >= 4 ? 320 : 220, { rows: fullRows });
  else addFx('sp', 'lock', now, 170, { cells });
  let n = 0;
  for (let y = SH - 1; y >= 0;) {
    if (SP.B[y].every(v => v)) { SP.B.splice(y, 1); SP.B.unshift(new Array(SW).fill(0)); n++; }
    else y--;
  }
  const prev = SP.lines;
  SP.lines += n;
  if (n) SP.clears[Math.min(n, 4)]++;
  const fault = opt != null && SP.pk > opt;
  SP.log.push({
    i: SP.log.length + 1, p: c.p, t: +((now - SP.pieceStart) / 1000).toFixed(3), at: +((now - SP.t0) / 1000).toFixed(3),
    presses: SP.pk, opt, fault, slide: SP.pslide && opts.flagSlides, tuck, held: SP.pheld, lines: n, match,
    you: fault || SP.pslide ? SP.pseq.slice() : undefined, best: fault || SP.pslide ? best : undefined,
  });
  for (let k = 1; k <= 4; k++) if (prev < k * 10 && SP.lines >= k * 10) { SP.splits[k - 1] = (now - SP.t0) / 1000; SP.splitPieces[k - 1] = SP.log.length; }
  SP.pieceStart = now;
  if (SP.lines >= GOAL) { spFinish(now, false); return; }
  spNext(now);
}
function spFinish(now, failed) {
  SP.state = 'done'; SP.failed = failed; SP.tEnd = now;
  if (failed) { spShowOverlay('Topped out', 'The stack reached the top.', { btn: 'Try again' }); return; }
  SP.cur = null;
  const A = spAnalyze();
  A.prev = spLast ? { t: spLast.t, splits: spLast.splits } : null;
  spLast = A;
  renderAnalysis(A);
  const typ = RL ? RL.typ : null;
  const sub = typ ? (A.t <= typ ? fmtS(typ - A.t) + ' s faster' : fmtS(A.t - typ) + ' s slower') + ' than your typical TETR.IO run (' + fmtS(typ) + ' s).' : 'Your analysis is below the board.';
  spShowOverlay(fmtRun(A.t) + ' s', sub + (A.matchPct != null ? ' Suggested spot matched on ' + A.matchPct + '% of pieces.' : ''), { btn: 'Again', jump: true });
}

/* ---------- sprint: analysis ---------- */
function spAnalyze() {
  const L = SP.log, N = L.length, T = (SP.tEnd - SP.t0) / 1000, K = SP.keys;
  const evalP = L.filter(x => x.opt != null);
  const faults = evalP.filter(x => x.fault);
  const extra = faults.reduce((s, x) => s + x.presses - x.opt, 0);
  const ts = L.map(x => x.t).sort((a, b) => a - b);
  const med = N % 2 ? ts[(N - 1) / 2] : (ts[N / 2 - 1] + ts[N / 2]) / 2;
  const pauseThr = Math.max(med * 2, med + 0.25);
  const pauses = L.filter(x => x.t > pauseThr);
  const kps = K / T;
  const byPiece = {};
  faults.forEach(x => { byPiece[x.p] = (byPiece[x.p] || 0) + 1; });
  return {
    t: +T.toFixed(3), N, K, pps: N / T, kpp: K / N, kps, holds: SP.holds,
    evalN: evalP.length, clean: evalP.length - faults.length, faultN: faults.length, extra,
    slides: L.filter(x => x.slide).length, tucks: L.filter(x => x.tuck).length,
    clears: SP.clears.slice(1), splits: SP.splits.slice(), splitPieces: SP.splitPieces.slice(),
    med, pauseThr, pauseN: pauses.length, pauseCost: pauses.reduce((s, x) => s + x.t - med, 0),
    finCost: kps > 0 ? extra / kps : 0, byPiece, longest: L.reduce((m, x) => (!m || x.t > m.t ? x : m), null),
    log: L, handling: { ...handling }, date: new Date().toISOString(),
    matchPct: L.some(x => x.match != null) ? Math.round(100 * L.filter(x => x.match).length / L.filter(x => x.match != null).length) : null,
  };
}
const splitDur = s => s.map((v, i) => v - (i ? s[i - 1] : 0));
function renderAnalysis(A) {
  const el = $('#spAnalysis');
  if (!A) return;
  const pb = A.prev, typ = RL ? RL.typ : null;
  const when = new Date(A.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const badge = typ == null ? '' : A.t <= typ ? '<span class="pill good">' + fmtS(typ - A.t) + ' s faster than your typical TETR.IO run</span>' : '<span class="pill warn">' + fmtS(A.t - typ) + ' s slower than your typical TETR.IO run</span>';
  const fin = A.evalN ? Math.round(100 * A.clean / A.evalN) : null;
  let h = '<div class="sp-res-head"><div><div class="eyebrow">Last run · ' + when + '</div>' +
    '<div class="sp-time">' + fmtRun(A.t) + '<small>s</small></div>' +
    '<div class="sp-sub">' + A.N + ' pieces · DAS ' + A.handling.das + ' · ARR ' + A.handling.arr + ' · DCD ' + A.handling.dcd + '</div>' +
    '<div style="margin-top:8px">' + badge + '</div></div>' +
    '<div class="sp-res-actions"><button type="button" class="btn" id="spAgain">Play again</button></div></div>' +
    '<p class="muted small">Sprint runs here are for practice and aren\'t saved. Only TETR.IO runs go in the Run log.</p>';

  const tiles = [
    ['Pace', A.pps.toFixed(2) + ' PPS', Math.round(1000 / A.pps) + ' ms per piece'],
    ['Keys per piece', A.kpp.toFixed(2), A.kps.toFixed(1) + ' keys per second'],
    ['Finesse', fin == null ? '—' : fin + '%', A.faultN + ' ' + plural(A.faultN, 'fault') + ' · ' + A.extra + ' extra ' + plural(A.extra, 'key')],
    A.matchPct != null ? ['Suggested spot', A.matchPct + '%', 'of pieces matched the coach'] : ['Holds', String(A.holds), Math.round(100 * A.holds / A.N) + '% of pieces'],
  ];
  h += '<div class="tiles">' + tiles.map(t => '<div class="card tile"><div class="eyebrow">' + t[0] + '</div><div class="v">' + t[1] + '</div><div class="s">' + t[2] + '</div></div>').join('') + '</div>';

  // Where the time went
  const items = [];
  if (A.pauseN) items.push({ cost: A.pauseCost, title: 'Hesitation', text: A.pauseN + ' ' + plural(A.pauseN, 'piece') + ' took longer than ' + fmtS(A.pauseThr) + ' s, more than twice your usual ' + fmtS(A.med) + ' s. The longest was piece ' + A.longest.i + ' (' + A.longest.p + ', ' + fmtS(A.longest.t) + ' s). Pick the next spot while the current piece is still moving.' });
  if (A.extra) {
    const top = Object.entries(A.byPiece).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => p + ' (' + n + ')').join(', ');
    items.push({ cost: A.finCost, title: 'Extra key presses', text: A.faultN + ' ' + plural(A.faultN, 'piece') + ' used ' + A.extra + ' more ' + plural(A.extra, 'press', 'presses') + ' than needed. Most faults: ' + top + '. Drill those in the Trainer with Focus weak spots on.' });
  }
  items.sort((a, b) => b.cost - a.cost);
  if (A.slides) items.push({ count: A.slides, title: 'Partial slides', text: A.slides + ' ' + plural(A.slides, 'slide') + ' stopped short of the wall. That only works with ARR above 0.' });
  if (A.holds) items.push({ count: A.holds, title: 'Holds', text: 'Each hold is a key press and a decision. Save it for keeping an I piece or skipping an awkward S or Z.' });
  if (A.tucks) items.push({ count: A.tucks, title: 'Tucks', text: A.tucks + ' ' + plural(A.tucks, 'piece') + ' had to be soft dropped under the stack. These are left out of the finesse count.' });
  const lead = items.find(x => x.cost != null);
  h += '<div class="sp-grid"><div class="card"><div class="card-head"><h3>Where the time went</h3></div>';
  if (lead) h += '<div class="lead-pill"><span class="pill accent">Biggest leak: ' + lead.title.toLowerCase() + ', about ' + fmtS(lead.cost) + ' s</span></div>';
  if (!items.length) h += '<p class="muted">A clean run: no long pauses and no extra key presses.</p>';
  else h += '<ol class="insights">' + items.map(x => '<li><span class="cost' + (x.cost == null ? ' na' : '') + '">' + (x.cost != null ? '≈' + fmtS(x.cost) + ' s' : x.count + '×') + '</span><div><b>' + x.title + '</b><p>' + x.text + '</p></div></li>').join('') + '</ol>';
  h += '<p class="muted small" style="margin-top:8px">Estimates: hesitation counts the time above your median on each long piece; extra presses are converted at your keys-per-second.</p></div>';

  // Splits
  const dur = splitDur(A.splits), bdur = pb && pb.splits && pb.splits.length === 4 ? splitDur(pb.splits) : null;
  h += '<div class="card"><div class="card-head"><h3>Splits</h3><span class="muted small">' + (bdur ? 'vs your previous run (' + fmtRun(pb.t) + ')' : 'every 10 lines') + '</span></div>';
  h += '<div class="table-scroll"><table class="data-table"><thead><tr><th>Lines</th><th>Time</th>' + (bdur ? '<th>Previous</th><th>Diff</th>' : '') + '</tr></thead><tbody>';
  const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtS(Math.abs(v));
  dur.forEach((v, i) => {
    h += '<tr><td>' + (i * 10 + 1) + '–' + (i * 10 + 10) + '</td><td class="mono">' + fmtS(v) + ' s</td>' + (bdur ? '<td class="mono">' + fmtS(bdur[i]) + ' s</td><td class="mono">' + sign(v - bdur[i]) + '</td>' : '') + '</tr>';
  });
  h += '<tr class="total"><td>Total</td><td class="mono">' + fmtRun(A.t) + ' s</td>' + (bdur ? '<td class="mono">' + fmtRun(pb.t) + ' s</td><td class="mono">' + sign(A.t - pb.t) + '</td>' : '') + '</tr>';
  h += '</tbody></table></div></div></div>';

  // Per-piece chart
  h += '<div class="card"><div class="card-head"><h3>Seconds on each piece</h3><span class="muted small">Tall bars are where you paused</span></div>' +
    '<div class="pc-chart" id="spChartWrap"><div id="spChart"></div><div class="tip" id="spTip" hidden></div></div>' +
    '<div class="chart-legend"><span><i style="background:var(--accent)"></i>Piece</span><span><i style="background:var(--warn)"></i>Pause, over 2× median</span><span><i class="dot" style="background:var(--bad)"></i>Finesse fault</span><span><i class="dash"></i>Median ' + fmtS(A.med) + ' s</span></div></div>';

  // Faults + line clears
  const fl = A.log.filter(x => x.fault || x.slide).sort((a, b) => (b.presses - (b.opt || 0)) - (a.presses - (a.opt || 0)) || a.i - b.i).slice(0, 8);
  h += '<div class="sp-grid"><div class="card"><div class="card-head"><h3>Finesse faults</h3><span class="muted small">' + (fl.length ? 'Worst ' + fl.length : '') + '</span></div>';
  if (!fl.length) h += '<p class="muted">No finesse faults this run.</p>';
  else h += '<ol class="fault-list">' + fl.map(x => '<li><span class="pc" style="--c:' + COLORS[x.p] + '">' + x.p + '</span><div><div class="fi-label">Piece ' + x.i + (x.fault ? ' · +' + (x.presses - x.opt) + ' ' + plural(x.presses - x.opt, 'key') : '') + (x.slide ? ' · partial slide' : '') + '</div><div class="fi-seq"><span>You ' + keysHTML(x.you || []) + '</span>' + (x.best ? '<span>Best ' + keysHTML(x.best) + '</span>' : '') + '</div></div></li>').join('') + '</ol>';
  h += '</div><div class="card"><div class="card-head"><h3>Line clears</h3><span class="muted small">' + A.clears[3] * 4 + ' of 40 lines from tetrises</span></div>' +
    '<div class="clears">' + ['Singles', 'Doubles', 'Triples', 'Tetrises'].map((n, i) => '<div><b>' + A.clears[i] + '</b><span>' + n + '</span></div>').join('') + '</div>';
  h += '</div></div>';
  el.innerHTML = h;
  $('#spAgain').addEventListener('click', e => { e.currentTarget.blur(); spStart(performance.now()); spRevealBoard(); });
  requestAnimationFrame(() => spChart(A));
}
function spChart(A) {
  const box = $('#spChart');
  if (!box || !A || !A.log.length || activeTab !== 'sprint') return;
  const L = A.log, n = L.length;
  const Wd = Math.max(280, box.clientWidth), Hd = 210, m = { l: 34, r: 8, t: 16, b: 24 };
  const iw = Wd - m.l - m.r, ih = Hd - m.t - m.b;
  const maxT = Math.max(A.med * 2.4, ...L.map(x => x.t));
  const step = niceStep(maxT / 4), top = Math.ceil(maxT / step) * step;
  const bw = iw / n, gap = bw > 5 ? 2 : bw > 2.5 ? 1 : 0, barW = Math.max(1, bw - gap);
  const Y = v => m.t + ih - v / top * ih;
  let s = '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="Seconds spent on each of ' + n + ' pieces">';
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = Y(v).toFixed(1);
    s += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/>';
    s += '<text x="' + (m.l - 6) + '" y="' + y + '" dy="0.32em" text-anchor="end" fill="var(--muted)" font-size="10.5" font-family="IBM Plex Mono, monospace">' + (+v.toFixed(2)) + '</text>';
  }
  (A.splitPieces || []).slice(0, 3).forEach((pi, k) => {
    const x = (m.l + pi * bw).toFixed(1);
    s += '<line x1="' + x + '" x2="' + x + '" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/>';
    s += '<text x="' + x + '" y="' + (m.t - 4) + '" text-anchor="middle" fill="var(--muted)" font-size="10">' + (k + 1) * 10 + ' lines</text>';
  });
  L.forEach((x, i) => {
    const bx = m.l + i * bw + gap / 2, y = Y(x.t), bh = Math.max(1, m.t + ih - y);
    s += '<rect x="' + bx.toFixed(1) + '" y="' + (m.t + ih - bh).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="' + Math.min(2, barW / 2).toFixed(1) + '" fill="' + (x.t > A.pauseThr ? 'var(--warn)' : 'var(--accent)') + '"/>';
  });
  L.forEach((x, i) => {
    if (!x.fault) return;
    s += '<circle cx="' + (m.l + i * bw + bw / 2).toFixed(1) + '" cy="' + (Y(x.t) - 6).toFixed(1) + '" r="3" fill="var(--bad)" stroke="var(--surface)" stroke-width="1.5"/>';
  });
  const my = Y(A.med).toFixed(1);
  s += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + my + '" y2="' + my + '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".55"/>';
  s += '<text x="' + m.l + '" y="' + (Hd - 6) + '" fill="var(--muted)" font-size="10.5">piece 1</text>';
  s += '<text x="' + (Wd - m.r) + '" y="' + (Hd - 6) + '" text-anchor="end" fill="var(--muted)" font-size="10.5">piece ' + n + '</text>';
  s += '<rect id="spHit" x="' + m.l + '" y="0" width="' + iw + '" height="' + Hd + '" fill="transparent"/>';
  box.innerHTML = s + '</svg>';
  const svg = box.querySelector('svg'), tip = $('#spTip'), wrap = $('#spChartWrap');
  const show = e => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (Wd / r.width);
    const i = Math.max(0, Math.min(n - 1, Math.floor((sx - m.l) / bw)));
    const x = L[i];
    tip.innerHTML = '';
    const b = document.createElement('b'); b.textContent = fmtS(x.t) + ' s'; tip.appendChild(b);
    const line = t => { const d = document.createElement('div'); d.className = 'muted'; d.textContent = t; tip.appendChild(d); };
    line('Piece ' + x.i + ' · ' + x.p + (x.held ? ' · from hold' : '') + (x.lines ? ' · cleared ' + x.lines : ''));
    line(x.opt != null ? x.presses + ' ' + plural(x.presses, 'press', 'presses') + ', best ' + x.opt : x.tuck ? 'Tuck, not judged for finesse' : x.presses + ' presses');
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const px = r.left - wr.left + (m.l + i * bw + bw / 2) * r.width / Wd, py = r.top - wr.top + Y(x.t) * r.height / Hd;
    tip.style.left = Math.min(Math.max(4, px - tip.offsetWidth / 2), wr.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = Math.max(0, py - tip.offsetHeight - 14) + 'px';
  };
  const hit = box.querySelector('#spHit');
  hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { tip.hidden = true; });
}
let spChartRaf = 0;
new ResizeObserver(() => { cancelAnimationFrame(spChartRaf); spChartRaf = requestAnimationFrame(() => spChart(spLast)); }).observe($('#spAnalysis'));

/* ---------- sprint: drawing ---------- */
function spSize() {
  const r = spCv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (spCv.width !== w || spCv.height !== h) { spCv.width = w; spCv.height = h; }
}
new ResizeObserver(spSize).observe(spField);
function drawMini(c, p, cx, cy, cs, alpha) {
  const cells = SHAPES[p][0];
  const xs = cells.map(q => q[0]), ys = cells.map(q => q[1]);
  const mx = Math.min(...xs), my = Math.min(...ys);
  const bw = (Math.max(...xs) - mx + 1) * cs, bh = (Math.max(...ys) - my + 1) * cs;
  c.save(); c.translate(cx - bw / 2 - mx * cs, cy - bh / 2 - my * cs);
  for (const [x, y] of cells) drawBlock(c, x, y, cs, COLORS[p], alpha);
  c.restore();
}
let spSig = '', spFxLive = false;
function paintSprintBg(c, w, h, cs) {
  const dpr = window.devicePixelRatio || 1, top = 2 * cs;
  c.fillStyle = theme.well; c.fillRect(0, 0, w, h);
  c.strokeStyle = theme.grid; c.lineWidth = 1; c.beginPath();
  for (let x = 1; x < SW; x++) { const X = Math.round(x * cs) + 0.5; c.moveTo(X, top); c.lineTo(X, h); }
  for (let y = 3; y < SH; y++) { const Y = Math.round(y * cs) + 0.5; c.moveTo(0, Y); c.lineTo(w, Y); }
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = Math.max(1, dpr);
  c.beginPath(); c.moveTo(0, Math.round(top) + 0.5); c.lineTo(w, Math.round(top) + 0.5); c.stroke();
}
function spDraw(now) {
  const c = spCtx, w = spCv.width, h = spCv.height, cs = w / SW, dpr = window.devicePixelRatio || 1;
  const s = SP.cur, k = SP.state === 'countdown' ? Math.min(2, Math.floor((now - SP.cs) / (COUNT_MS / 3))) : -1;
  const sig = w + ',' + h + ',' + themeVer + ',' + SP.state + ',' + SP.cs + ',' + k + ',' + SP.log.length + ',' + SP.failed + ',' + (s ? s.p + s.x + ',' + s.y + ',' + s.r : '-') + ',' + (SP.sugg ? SP.sugg.key : '-') + ',' + opts.coach;
  if (sig === spSig && !spFxLive) return;
  spSig = sig;
  c.drawImage(boardBg('sp', w, h, cs, paintSprintBg), 0, 0);
  if (SP.B) for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const v = SP.B[y][x]; if (v) drawBlock(c, x, y, cs, COLORS[v], 0.92); }
  spFxLive = drawFx(c, 'sp', cs, w, now);
  if (SP.cur && (SP.state === 'playing' || SP.failed)) {
    const col = COLORS[SP.cur.p];
    if (SP.state === 'playing') {
      const gy = dropY(SP.cur), g = Math.max(1, Math.round(cs * 0.04));
      const gc = cellsOf(SP.cur.p, SP.cur.x, gy, SP.cur.r);
      const on = SP.sugg && cellsKey(gc) === SP.sugg.key;
      c.fillStyle = rgba(col, on ? 0.5 : 0.28);
      for (const [x, y] of gc) if (y >= 0) c.fillRect(x * cs + g, y * cs + g, cs - 2 * g, cs - 2 * g);
      if (SP.sugg && opts.coach) {
        const lw = Math.max(2, (on ? 3 : 2) * dpr);
        c.fillStyle = 'rgba(255,255,255,.05)';
        for (const [x, y] of SP.sugg.cells) if (y >= 0) c.fillRect(x * cs, y * cs, cs, cs);
        c.lineWidth = lw; c.lineCap = 'butt';
        c.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,.72)';
        c.setLineDash(on ? [] : [Math.max(4, cs * 0.17), Math.max(3, cs * 0.083)]);
        perimeter(c, SP.sugg.cells.filter(q => q[1] >= 0), cs, lw / 2 + dpr);
        c.setLineDash([]);
      }
    }
    for (const [x, y] of cellsOf(SP.cur.p, SP.cur.x, SP.cur.y, SP.cur.r)) if (y >= 0) drawBlock(c, x, y, cs, col, 1);
  }
  if (SP.state === 'countdown') {
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 ' + Math.round(cs * 1.2) + 'px "Chakra Petch", system-ui, sans-serif';
    c.fillText(['READY', 'SET', 'GO'][k], w / 2, h * 0.42);
  }
}
let sideSig = '';
function spDrawSide() {
  const sig = themeVer + ',' + SP.hold + ',' + SP.holdUsed + ',' + SP.state + ',' + SP.queue.slice(0, 5).join('');
  if (sig === sideSig) return;
  sideSig = sig;
  const hc = spHoldCtx;
  hc.clearRect(0, 0, 128, 80); hc.fillStyle = theme.well; hc.fillRect(0, 0, 128, 80);
  if (SP.hold) drawMini(hc, SP.hold, 64, 40, 18, SP.holdUsed ? 0.35 : 1);
  const nc = spNextCtx;
  nc.clearRect(0, 0, 128, 400); nc.fillStyle = theme.well; nc.fillRect(0, 0, 128, 400);
  if (SP.state === 'playing' || SP.state === 'countdown') for (let i = 0; i < 5; i++) if (SP.queue[i]) drawMini(nc, SP.queue[i], 64, 40 + i * 80, 18, 1);
}
const spLiveCache = {};
function spSet(id, v) { if (spLiveCache[id] !== v) { spLiveCache[id] = v; document.getElementById(id).textContent = v; } }
function spLive(now) {
  const t = SP.state === 'playing' ? (now - SP.t0) / 1000 : SP.state === 'done' ? (SP.tEnd - SP.t0) / 1000 : 0;
  const n = SP.log.length;
  spSet('spClock', fmtRun(Math.max(0, t)));
  spSet('spLines', Math.min(SP.lines, GOAL) + ' / ' + GOAL);
  spSet('spPps', n && t > 0 ? (n / t).toFixed(2) : '—');
  spSet('spKpp', n ? (SP.keys / n).toFixed(2) : '—');
  spSet('spFaults', String(SP.log.filter(x => x.fault).length));
}
function spRevealBoard() {
  const r = spField.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;
  window.scrollTo({ top: Math.max(0, r.top + window.scrollY - 12), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
$('#spStartBtn').addEventListener('click', e => { e.currentTarget.blur(); spStart(performance.now()); spRevealBoard(); });
$('#spJump').addEventListener('click', () => {
  const a = $('#spAnalysis');
  window.scrollTo({ top: Math.max(0, a.getBoundingClientRect().top + window.scrollY - 12), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});
document.querySelectorAll('#spTouch button').forEach(b => {
  const a = b.dataset.act;
  b.addEventListener('pointerdown', e => { e.preventDefault(); const t = evT(e); catchUp(t); spPress(a, t); });
  const up = e => { const t = evT(e); catchUp(t); spRelease(a, t); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
spShowOverlay('40L Sprint', 'Clear 40 lines as fast as you can. Uses your keys and handling from Settings.', { btn: 'Start' });
function renderSprintContext() { if (spLast) renderAnalysis(spLast); }

/* ---------- tabs ---------- */
const TABS = ['trainer', 'sprint', 'log', 'plan', 'chart', 'options'];
const TAB_ALIAS = { goals: 'plan', history: 'log' };
let activeTab = 'trainer';
function showTab(name, push) {
  if (TAB_ALIAS[name]) name = TAB_ALIAS[name];
  if (!TABS.includes(name)) name = 'trainer';
  activeTab = name;
  for (const t of TABS) {
    document.getElementById(t).hidden = t !== name;
    const b = document.getElementById('t-' + t);
    b.setAttribute('aria-selected', String(t === name));
    b.tabIndex = t === name ? 0 : -1;
  }
  if (name !== 'trainer') { releaseAll(); if (document.activeElement === field) field.blur(); }
  if (name === 'trainer') { sizeCanvas(); if (boardSize === 'fit') requestAnimationFrame(revealBoard); }
  if (name !== 'sprint') spAbort();
  if (name === 'sprint') { spSize(); if (spLast) requestAnimationFrame(() => spChart(spLast)); }
  if (name === 'chart') renderFChart();
  if (name === 'log') requestAnimationFrame(logChart);
  if (push && location.hash !== '#' + name) { try { history.replaceState(null, '', '#' + name); } catch (e) { location.hash = name; } }
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab, true); });
document.querySelector('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = TABS.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : -1);
  const n = TABS[(i + TABS.length) % TABS.length];
  showTab(n, true); document.getElementById('t-' + n).focus();
});
window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));

/* ---------- board size ---------- */
const trainerEl = document.querySelector('.trainer');
const SIZES = ['compact', 'large', 'fit'];
let boardSize = LS.get('sl.size', 'large');
if (!SIZES.includes(boardSize)) boardSize = 'large';
// Scroll this page (not the host) just enough that the whole board is on screen.
function revealBoard() {
  if (document.body.classList.contains('focus-mode')) return;
  const r = field.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, r.top + window.scrollY - 12), behavior: smooth ? 'smooth' : 'auto' });
}
function setSize(s, reveal) {
  boardSize = s; trainerEl.dataset.size = s; LS.set('sl.size', s);
  document.querySelectorAll('.sprint').forEach(el => { el.dataset.size = s; });
  document.querySelectorAll('#sizeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === s)));
  sizeCanvas();
  if (reveal && s !== 'compact') requestAnimationFrame(revealBoard);
}
$('#sizeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setSize(b.dataset.size, true);
});
field.addEventListener('pointerdown', () => { if (boardSize !== 'compact') revealBoard(); });
setSize(boardSize, false);

let boardPos = LS.get('sl.pos', 'left');
if (boardPos !== 'left' && boardPos !== 'center') boardPos = 'left';
function setPos(p) {
  boardPos = p; trainerEl.dataset.pos = p; LS.set('sl.pos', p);
  document.querySelectorAll('#posSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pos === p)));
  sizeCanvas();
}
$('#posSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setPos(b.dataset.pos);
});
setPos(boardPos);
$('#toSettings').addEventListener('click', () => { showTab('options', true); window.scrollTo(0, 0); });

/* ---------- full screen ---------- */
// Shared by the Trainer and Sprint: hides the header and enlarges the board of the tab you're on.
const fsBtns = [$('#fsBtn'), $('#spFsBtn')];
function setFocusMode(on) {
  document.body.classList.toggle('focus-mode', on);
  fsBtns.forEach(b => { b.textContent = on ? 'Exit full screen' : 'Full screen'; });
  if (on) {
    if (activeTab === 'trainer') {
      try { field.focus({ preventScroll: true }); } catch (e) { /* focus refused */ }
      engage();
    }
    window.scrollTo(0, 0);
  }
  sizeCanvas(); spSize();
}
fsBtns.forEach(btn => btn.addEventListener('click', async () => {
  const on = !document.body.classList.contains('focus-mode');
  btn.blur();
  setFocusMode(on);
  try {
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (!on && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch (e) { /* browser full screen unavailable here; the in-page view still applies */ }
  if (on && activeTab === 'trainer') { try { field.focus({ preventScroll: true }); } catch (e) { /* focus refused */ } }
}));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('focus-mode')) setFocusMode(false);
});

/* ---------- boot ---------- */
renderPieceChips(); renderChartChips(); renderBinds(); renderOverlayKeys();
renderStats(); renderFeed(); renderPbChip();
showTab(location.hash.slice(1), false);
sizeCanvas();
spawn(performance.now());
requestAnimationFrame(loop);
/*__SITE__*/

initSite();
})();
