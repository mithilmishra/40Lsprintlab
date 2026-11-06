// ENGINE START
const W = 10, H = 20, CEIL = -20;
const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
// SRS shapes, [x, y] inside the piece box, y grows downward. States: 0 spawn, 1 CW, 2 180, 3 CCW.
const SHAPES = {
  I: [[[0,1],[1,1],[2,1],[3,1]], [[2,0],[2,1],[2,2],[2,3]], [[0,2],[1,2],[2,2],[3,2]], [[1,0],[1,1],[1,2],[1,3]]],
  O: [[[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]]],
  T: [[[1,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[2,1],[1,2]], [[0,1],[1,1],[2,1],[1,2]], [[1,0],[0,1],[1,1],[1,2]]],
  S: [[[1,0],[2,0],[0,1],[1,1]], [[1,0],[1,1],[2,1],[2,2]], [[1,1],[2,1],[0,2],[1,2]], [[0,0],[0,1],[1,1],[1,2]]],
  Z: [[[0,0],[1,0],[1,1],[2,1]], [[2,0],[1,1],[2,1],[1,2]], [[0,1],[1,1],[1,2],[2,2]], [[1,0],[0,1],[1,1],[0,2]]],
  J: [[[0,0],[0,1],[1,1],[2,1]], [[1,0],[2,0],[1,1],[1,2]], [[0,1],[1,1],[2,1],[2,2]], [[1,0],[1,1],[0,2],[1,2]]],
  L: [[[2,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[1,2],[2,2]], [[0,1],[1,1],[2,1],[0,2]], [[0,0],[1,0],[1,1],[1,2]]],
};
// TETR.IO SRS+ kick tests after the in-place test, y grows downward.
const KICK = {
  '01': [[-1,0],[-1,-1],[0,2],[-1,2]], '10': [[1,0],[1,1],[0,-2],[1,-2]],
  '12': [[1,0],[1,1],[0,-2],[1,-2]],   '21': [[-1,0],[-1,-1],[0,2],[-1,2]],
  '23': [[1,0],[1,-1],[0,2],[1,2]],    '32': [[-1,0],[-1,1],[0,-2],[-1,-2]],
  '30': [[-1,0],[-1,1],[0,-2],[-1,-2]], '03': [[1,0],[1,-1],[0,2],[1,2]],
  '02': [[0,-1],[1,-1],[-1,-1],[1,0],[-1,0]], '13': [[1,0],[1,-2],[1,-1],[0,-2],[0,-1]],
  '20': [[0,1],[-1,1],[1,1],[-1,0],[1,0]],    '31': [[-1,0],[-1,-2],[-1,-1],[0,-2],[0,-1]],
};
const KICK_I = {
  '01': [[1,0],[-2,0],[-2,1],[1,-2]],  '10': [[-1,0],[2,0],[-1,2],[2,-1]],
  '12': [[-1,0],[2,0],[-1,-2],[2,1]],  '21': [[-2,0],[1,0],[-2,-1],[1,2]],
  '23': [[2,0],[-1,0],[2,-1],[-1,2]],  '32': [[1,0],[-2,0],[1,-2],[-2,1]],
  '30': [[1,0],[-2,0],[1,2],[-2,-1]],  '03': [[-1,0],[2,0],[2,-1],[-1,2]],
  '02': [[0,-1]], '13': [[1,0]], '20': [[0,1]], '31': [[-1,0]],
};
const SPAWN = { x: 3, y: 0, r: 0 };

function cellsOf(p, x, y, r) { return SHAPES[p][r].map(([a, b]) => [x + a, y + b]); }
// B (optional) is a board: an array of rows, each an array of W cells (0 = empty). Without it the board is empty and H tall.
function fits(p, x, y, r, B) {
  const h = B ? B.length : H;
  for (const [a, b] of SHAPES[p][r]) {
    const cx = x + a, cy = y + b;
    if (cx < 0 || cx >= W || cy >= h || cy < CEIL) return false;
    if (B && cy >= 0 && B[cy][cx]) return false;
  }
  return true;
}
function moveH(s, dx) { return fits(s.p, s.x + dx, s.y, s.r, s.B) ? { ...s, x: s.x + dx } : null; }
function shiftWall(s, dx) { let t = s, n; while ((n = moveH(t, dx))) t = n; return t; }
function rotate(s, turn) {
  const nr = (s.r + turn) % 4;
  if (s.p === 'O') return { ...s, r: nr };
  const table = s.p === 'I' ? KICK_I : KICK;
  const tests = [[0, 0], ...(table['' + s.r + nr] || [])];
  for (const [dx, dy] of tests) {
    if (fits(s.p, s.x + dx, s.y + dy, nr, s.B)) return { ...s, x: s.x + dx, y: s.y + dy, r: nr };
  }
  return null;
}
function dropY(s) { let y = s.y; while (fits(s.p, s.x, y + 1, s.r, s.B)) y++; return y; }
function cellsKey(cells) { return cells.map(([a, b]) => a + ',' + b).sort().join(';'); }
function finalKey(s) { return cellsKey(cellsOf(s.p, s.x, dropY(s), s.r)); }

const ACTIONS = {
  CW: s => rotate(s, 1), CCW: s => rotate(s, 3), R180: s => rotate(s, 2),
  L: s => moveH(s, -1), R: s => moveH(s, 1),
  DL: s => shiftWall(s, -1), DR: s => shiftWall(s, 1),
};
// Breadth-first search over single key presses from spawn. First hit per landing spot = fewest presses.
function solve(p, use180) {
  const order = ['CW', 'CCW', ...(use180 ? ['R180'] : []), 'L', 'R', 'DL', 'DR'];
  const start = { p, ...SPAWN };
  const sk = s => s.x + '|' + s.y + '|' + s.r;
  const seen = new Map([[sk(start), []]]);
  const q = [start];
  const best = new Map();
  for (let i = 0; i < q.length; i++) {
    const s = q[i];
    const path = seen.get(sk(s));
    const fk = finalKey(s);
    if (!best.has(fk)) best.set(fk, { path, x: s.x, r: s.r });
    for (const a of order) {
      const n = ACTIONS[a](s);
      if (!n) continue;
      const k = sk(n);
      if (seen.has(k)) continue;
      seen.set(k, [...path, a]);
      q.push(n);
    }
  }
  return best;
}
// ENGINE END
