// Room data validator + approximate reachability analysis.
// Usage: node tools/validate.mjs [--verbose]
// Checks map shapes, overlaps, matching exits, and for each ability stage which
// rooms / items / bosses can be reached from the start, plus softlock detection
// (places you can enter but cannot get back to a shrine from).
import { World } from '../js/world.js';
import { ROOMS } from '../js/rooms/index.js';
import { T } from '../js/tiles.js';
import { CELL_W, CELL_H } from '../js/util.js';

const verbose = process.argv.includes('--verbose');
World.init(ROOMS);
let errors = [...World.errors];
const warn = [];

// ---------------------------------------------------------------- exits
for (const r of World.rooms) {
  const edges = [];
  for (let x = 0; x < r.tw; x++) { edges.push([x, 0, 0, -1]); edges.push([x, r.th - 1, 0, 1]); }
  for (let y = 0; y < r.th; y++) { edges.push([0, y, -1, 0]); edges.push([r.tw - 1, y, 1, 0]); }
  for (const [x, y, dx, dy] of edges) {
    const t = r.tiles[y * r.tw + x];
    if (isBlock(t)) continue;
    const gx = r.tx0 + x + dx, gy = r.ty0 + y + dy;
    const nr = World.roomAtCell(Math.floor(gx / CELL_W), Math.floor(gy / CELL_H));
    if (!nr) { errors.push(`${r.id}: opening at (${x},${y}) leads outside any room`); continue; }
    const nt = World.tileAt(gx, gy);
    if (isBlock(nt)) warn.push(`${r.id}: opening at (${x},${y}) faces a wall in ${nr.id}`);
  }
}
function isBlock(t) { return t === T.SOLID || t === T.CONV_R || t === T.CONV_L; }

// ---------------------------------------------------------------- fast tile grid
const GW = 20 * CELL_W, GH = 14 * CELL_H;
const GRID = new Uint8Array(GW * GH);
for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) GRID[y * GW + x] = World.tileAt(x, y);
const tileAt = (x, y) => (x < 0 || y < 0 || x >= GW || y >= GH ? T.SOLID : GRID[y * GW + x]);
let GATE = new Uint8Array(GW * GH), MOVER = new Uint8Array(GW * GH);

// ---------------------------------------------------------------- graph
// Nodes are standing spots: feet on top of tile row `y` at column `x` (global tiles).
const STAGES = [
  { name: 'start', ab: [] },
  { name: '+dash', ab: ['dash'] },
  { name: '+double', ab: ['dash', 'double'] },
  { name: '+wall', ab: ['dash', 'double', 'wall'] },
  { name: '+pound', ab: ['dash', 'double', 'wall', 'pound'] },
  { name: '+shot', ab: ['dash', 'double', 'wall', 'pound', 'shot'] },
  { name: '+glide', ab: ['dash', 'double', 'wall', 'pound', 'shot', 'glide'] },
  { name: '+phase', ab: ['dash', 'double', 'wall', 'pound', 'shot', 'glide', 'phase'], forks: 5 },
];

const startRoom = World.rooms.find((r) => r.ents.some((e) => e.type === 'start'));
if (!startRoom && !process.argv.includes('--start')) errors.push('no start (@) found');

function analyse(stage) {
  const A = new Set(stage.ab);
  CUR_AB = A;
  GATE = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (gateAt(x, y)) GATE[y * GW + x] = 1;
  if (!MOVER.some((v) => v)) for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (moverAt(x, y)) MOVER[y * GW + x] = 1;
  const openGates = new Set();
  const key = (x, y) => x * 100000 + y;
  const passable = (x, y, horizontal = true) => {
    const t = tileAt(x, y);
    switch (t) {
      case T.SOLID: case T.CONV_R: case T.CONV_L: return false;
      case T.SPIKE: return false;
      case T.WATER: return false;
      case T.CRYSTAL: return A.has('shot');
      case T.CRACKED: return A.has('pound');
      case T.BREAKABLE: return true;
      case T.MEMBRANE: return A.has('phase') && horizontal;
      case T.SEAL: return (stage.forks || 0) >= 5 && A.has('phase');
      default: return !GATE[y * GW + x];
    }
  };
  const standOn = (x, y) => {
    const t = tileAt(x, y);
    if (t === T.SOLID || t === T.PLATFORM || t === T.CONV_R || t === T.CONV_L) return true;
    if (t === T.CRYSTAL) return !A.has('shot');
    if (t === T.CRACKED) return true;
    if (t === T.BREAKABLE) return true;
    if (t === T.MEMBRANE) return true;
    if (t === T.SEAL) return !((stage.forks || 0) >= 5);
    if (x >= 0 && y >= 0 && x < GW && y < GH && GATE[y * GW + x]) return true;
    return x >= 0 && y >= 0 && x < GW && y < GH && !!MOVER[y * GW + x];
  };
  const body = (x, y) => passable(x, y - 1) && passable(x, y - 2);
  const isNode = (x, y) => body(x, y) && standOn(x, y);
  const waterAt = (x, y) => tileAt(x, y - 1) === T.WATER;

  const nodes = new Map();
  const adj = new Map();
  const add = (a, b) => { if (a === b) return; let s = adj.get(a); if (!s) adj.set(a, (s = new Set())); s.add(b); };

  // Jump parameters (tiles)
  const H = A.has('double') ? 6 : 3;
  const reach = (dy) => { // dy > 0 means target is higher
    let r = 6;
    if (A.has('dash')) r += 4;
    if (A.has('double')) r += A.has('dash') ? 4 : 3;
    if (dy < 0) r += Math.min(6, -dy) * (A.has('glide') ? 2 : 1);
    if (A.has('glide')) r += 5;
    if (dy > 0) r -= Math.ceil(dy * 0.8);
    return Math.max(1, r);
  };
  // Clear L-path: up at x0 to row `top`, across to x1, down to y1.
  const pathClear = (x0, y0, x1, y1, top) => {
    for (let y = y0; y > top; y--) if (!body(x0, y)) return false;
    const s = Math.sign(x1 - x0);
    for (let x = x0; x !== x1; x += s) if (!body(x + s, top + 1)) return false;
    for (let y = top + 1; y <= y1; y++) if (!body(x1, y)) return false;
    return true;
  };

  for (const r of World.rooms) {
    for (let y = r.ty0; y < r.ty0 + r.th + 1; y++) for (let x = r.tx0; x < r.tx0 + r.tw; x++) {
      if (y - 1 < r.ty0 || y - 1 >= r.ty0 + r.th) continue;
      if (isNode(x, y)) nodes.set(key(x, y), { x, y, room: r });
    }
  }
  // Wall-climb columns: positions next to a wall (needs 'wall').
  const wallAt = (x, y) => tileAt(x - 1, y - 1) === T.SOLID || tileAt(x + 1, y - 1) === T.SOLID;

  for (const [k, n] of nodes) {
    const { x, y } = n;
    // walk
    for (const d of [-1, 1]) {
      if (nodes.has(key(x + d, y))) add(k, key(x + d, y));
      else if (body(x + d, y)) {
        // walk off the edge and fall
        let yy = y; while (yy < y + 60 && body(x + d, yy + 1) && !standOn(x + d, yy)) yy++;
        if (nodes.has(key(x + d, yy))) add(k, key(x + d, yy));
      }
      // step up 1 tile
      if (nodes.has(key(x + d, y - 1)) && body(x, y - 1)) add(k, key(x + d, y - 1));
    }
    // drop through a platform
    if (tileAt(x, y) === T.PLATFORM) {
      let yy = y + 1; while (yy < y + 60 && body(x, yy + 1) && !standOn(x, yy)) yy++;
      if (nodes.has(key(x, yy))) add(k, key(x, yy));
    }
    // jumps
    const water = waterAt(x, y);
    const h = water ? 2 : H;
    for (let dy = -14; dy <= h; dy++) {
      const R = water ? 3 : reach(dy);
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 && dy === 0) continue;
        const tk = key(x + dx, y - dy);
        if (!nodes.has(tk)) continue;
        const top = Math.min(y, y - dy) - (dx === 0 ? 0 : 0);
        if (pathClear(x, y, x + dx, y - dy, top - 2)) add(k, tk);
      }
    }
    // wall climbing: from a node next to a wall, climb the column up while it stays next to a wall
    if (A.has('wall')) {
      for (const cx of [x - 1, x, x + 1]) {
        if (!body(cx, y)) continue;
        let yy = y;
        while (yy > y - 60 && body(cx, yy - 1) && wallAt(cx, yy - 1)) yy--;
        // from the top of the climb, can jump up ~3 more and sideways
        for (let ty = yy - 3; ty <= y; ty++) for (let tx = cx - 6; tx <= cx + 6; tx++) {
          const tk = key(tx, ty);
          if (!nodes.has(tk) || tk === k) continue;
          const top = Math.min(ty, yy) - 2;
          if (top >= yy - 4 && pathClear(cx, Math.max(yy, top + 2), tx, ty, top)) add(k, tk);
        }
      }
    }
  }
  // updrafts (glide): a vent column lets you rise to its top and glide sideways
  if (A.has('glide')) {
    for (const r of World.rooms) for (let y = r.ty0; y < r.ty0 + r.th; y++) for (let x = r.tx0; x < r.tx0 + r.tw; x++) {
      if (tileAt(x, y) !== T.VENT) continue;
      let top = y; while (top > y - 120 && passable(x, top - 1) && tileAt(x, top - 1) !== T.PLATFORM) top--;
      const from = [];
      for (const [k, n] of nodes) if (Math.abs(n.x - x) <= 4 && n.y >= top && n.y <= y + 1) from.push(k);
      const to = [];
      for (const [k, n] of nodes) if (Math.abs(n.x - x) <= 10 && n.y >= top + 1 && n.y <= y + 1) to.push(k);
      for (const a of from) for (const b of to) add(a, b);
    }
  }
  return { nodes, adj, key, openGates };
}

// Gates & movers from objects
const gates = [], movers = [], switches = [];
for (const r of World.rooms) for (const e of r.ents) {
  if (e.type === 'gate') gates.push({ id: e.id, x: r.tx0 + e.tx, y: r.ty0 + e.ty, w: e.w || 1, h: e.h || 3, room: r.id, invert: !!e.invert, pound: !!e.pound });
  if (e.type === 'mover') movers.push({ x: r.tx0 + e.tx, y: r.ty0 + e.ty, w: e.w || 3, dx: e.dx || 0, dy: e.dy || 0 });
  if (e.type === 'switch') switches.push({ id: e.id, x: r.tx0 + e.tx, y: r.ty0 + e.ty, shot: !!e.shot, room: r.id });
}
let OPEN = new Set();
function gateAt(x, y) {
  for (const g of gates) {
    let open = OPEN.has(g.id) || (g.pound && CUR_AB.has('pound'));
    if (g.invert) open = !open;
    if (!open && x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h) return true;
  }
  return false;
}
let CUR_AB = new Set();
function moverAt(x, y) {
  for (const m of movers) {
    const steps = Math.max(Math.abs(m.dx), Math.abs(m.dy), 1);
    for (let i = 0; i <= steps; i++) {
      const mx = m.x + Math.round((m.dx * i) / steps), my = m.y + Math.round((m.dy * i) / steps);
      if (y === my && x >= mx && x < mx + m.w) return true;
    }
  }
  return false;
}

function bfs(adj, starts) {
  const seen = new Set(starts), q = [...starts];
  while (q.length) { const a = q.pop(); for (const b of adj.get(a) || []) if (!seen.has(b)) { seen.add(b); q.push(b); } }
  return seen;
}

// --start ROOM_ID [--ab dash,double,...] analyses one stage from that room (its shrine, or its first floor spot).
const argv = process.argv;
const argStart = argv.includes('--start') ? argv[argv.indexOf('--start') + 1] : null;
const argAb = argv.includes('--ab') ? argv[argv.indexOf('--ab') + 1].split(',').filter(Boolean) : null;
if (argStart) {
  STAGES.length = 0;
  STAGES.push({ name: 'from ' + argStart + ' with [' + (argAb || []).join(',') + ']', ab: argAb || [], forks: argAb && argAb.includes('phase') ? 5 : 0 });
}
const startNode = (() => {
  if (argStart) {
    const r = World.byId[argStart];
    if (!r) { console.log('no such room ' + argStart); process.exit(1); }
    const e = r.ents.find((e) => e.type === 'shrine' || e.type === 'start');
    const cands = [];
    if (e) cands.push([r.tx0 + e.tx, r.ty0 + e.ty + 1]);
    for (let y = r.ty0 + 2; y < r.ty0 + r.th; y++) for (let x = r.tx0 + 1; x < r.tx0 + r.tw - 1; x++) cands.push([x, y]);
    for (const [x, y0] of cands) {
      let y = y0;
      const fl = (t) => t === T.SOLID || t === T.PLATFORM || t === T.CONV_R || t === T.CONV_L;
      while (y < r.ty0 + r.th && !fl(World.tileAt(x, y))) y++;
      if (World.tileAt(x, y - 1) !== T.SOLID && World.tileAt(x, y - 2) !== T.SOLID && y < r.ty0 + r.th) return { x, y };
    }
  }
  const e = startRoom.ents.find((e) => e.type === 'start');
  let x = startRoom.tx0 + e.tx, y = startRoom.ty0 + e.ty + 1;
  while (World.tileAt(x, y) !== T.SOLID && y < startRoom.ty0 + startRoom.th) y++;
  return { x, y };
})();

const ITEM_TYPES = ['hpup', 'atkup', 'score', 'ability', 'boss', 'shrine', 'npc', 'switch', 'chime', 'arena'];
function itemsReached(nodes, seen, key) {
  const out = [];
  for (const r of World.rooms) for (const e of r.ents) {
    if (!ITEM_TYPES.includes(e.type)) continue;
    const ex = r.tx0 + e.tx, ey = r.ty0 + e.ty;
    let ok = false;
    const rw = e.type === 'arena' ? (e.w || 4) : 0, rh = e.type === 'arena' ? (e.h || 4) : 0;
    const needShot = (e.type === 'switch' || e.type === 'chime') && e.shot;
    if (needShot && !CUR_AB.has('shot')) continue;
    for (let dy = -2; dy <= 3 + rh && !ok; dy++) for (let dx = -2; dx <= 2 + rw && !ok; dx++) if (seen.has(key(ex + dx, ey + dy))) ok = true;
    if (!ok && e.type === 'boss') {
      for (const k of seen) { const n = nodes.get(k); if (n && n.room === r) { ok = true; break; } }
    }
    if (!ok && e.type === 'switch' && e.shot) {
      for (const k of seen) { const n = nodes.get(k); if (n && (Math.abs(n.x - ex) <= 12 && Math.abs(n.y - 1 - ey) <= 1 || Math.abs(n.y - ey) <= 12 && n.x === ex)) { ok = true; break; } }
    }
    if (ok) {
      const id = e.type === 'chime' ? e.group : e.type === 'shrine' ? 'shrine_' + r.id : e.id;
      out.push(`${r.id}:${e.type}${id ? '(' + id + ')' : ''}${e.n ? '#' + e.n : ''}@${e.tx},${e.ty}`);
    }
  }
  return out;
}

function evalStage(st) {
  OPEN = new Set();
  let res, seen, items;
  // iterate: open gates whose switches become reachable
  for (let iter = 0; iter < 10; iter++) {
    res = analyse(st);
    const sk = res.key(startNode.x, startNode.y);
    seen = bfs(res.adj, [sk]);
    items = itemsReached(res.nodes, seen, res.key);
    const before = OPEN.size;
    for (const it of items) {
      const m = it.match(/(?:switch|chime|shrine|arena)\((.+?)\)/); if (m) OPEN.add(m[1]);
      const b = it.match(/boss\((.+?)\)/); if (b) { OPEN.add(b[1]); OPEN.add('boss_' + b[1]); }
    }
    if (OPEN.size === before) break;
  }
  const rooms = new Set();
  for (const k of seen) { const n = res.nodes.get(k); if (n) rooms.add(n.room.id); }
  // softlocks: reachable nodes that cannot get back to any shrine (or the start)
  const rev = new Map();
  for (const [a, s] of res.adj) for (const b of s) { let r = rev.get(b); if (!r) rev.set(b, (r = new Set())); r.add(a); }
  const shrineNodes = [res.key(startNode.x, startNode.y)];
  for (const r of World.rooms) for (const e of r.ents) if (e.type === 'shrine') {
    const x = r.tx0 + e.tx; let y = r.ty0 + e.ty + 1;
    while (!res.nodes.has(res.key(x, y)) && y < r.ty0 + r.th + 1) y++;
    shrineNodes.push(res.key(x, y));
  }
  const canReturn = bfs(rev, shrineNodes.filter((k) => res.nodes.has(k)));
  const stuckRooms = new Map();
  for (const k of seen) if (!canReturn.has(k)) { const n = res.nodes.get(k); if (n) stuckRooms.set(n.room.id, (stuckRooms.get(n.room.id) || []).concat([`${n.x - n.room.tx0},${n.y - n.room.ty0}`])); }
  return { rooms, items, stuckRooms };
}
const fmtStuck = (stuck) => [...stuck].map(([r, l]) => `${r}[${l.slice(0, 4).join(' ')}${l.length > 4 ? ' …' : ''}]`).join(' ');
const allItems = [];
for (const r of World.rooms) for (const e of r.ents) if (['hpup', 'atkup', 'score', 'ability', 'boss'].includes(e.type)) allItems.push(`${r.id}:${e.type}${e.id ? '(' + e.id + ')' : ''}${e.n ? '#' + e.n : ''}@${e.tx},${e.ty}`);

let prevRooms = new Set(), prevItems = new Set();
const report = [];
for (const st of STAGES) {
  const { rooms, items, stuckRooms } = evalStage(st);
  const newRooms = [...rooms].filter((r) => !prevRooms.has(r));
  const newItems = items.filter((i) => !prevItems.has(i));
  report.push(`== ${st.name}: ${rooms.size}/${World.rooms.length} rooms`);
  report.push(`   new rooms: ${newRooms.join(' ')}`);
  report.push(`   new items: ${newItems.join(' ')}`);
  if (stuckRooms.size) report.push(`   (stage view) dead-end spots: ${fmtStuck(stuckRooms)}`);
  prevRooms = rooms; prevItems = new Set(items);
  if (st === STAGES[STAGES.length - 1]) {
    const unreached = World.rooms.filter((r) => !rooms.has(r.id)).map((r) => r.id);
    if (unreached.length) report.push(`   UNREACHED rooms at the end: ${unreached.join(' ')}`);
    const missing = allItems.filter((i) => !items.includes(i));
    if (missing.length) report.push(`   UNREACHED items: ${missing.join(' ')}`);
  }
}

// ---------------------------------------------------------------- progression simulation
// Start with nothing; whenever a boss or ability pickup is reachable, take it; repeat.
if (!argStart) {
  const BOSS_AB = { gear: 'dash', choir: 'double', gardener: 'wall', wyrm: 'shot', librarian: 'glide' };
  const ab = new Set(); let forks = 0; const got = new Set();
  report.push('', '== PROGRESSION (abilities taken as soon as reachable)');
  let last;
  for (let step = 0; step < 15; step++) {
    last = evalStage({ name: 'p', ab: [...ab], forks });
    const gained = [];
    for (const it of last.items) {
      const b = it.match(/boss\((.+?)\)/), a = it.match(/ability\((.+?)\)/);
      if (b && BOSS_AB[b[1]] && !got.has(b[1])) { got.add(b[1]); forks++; ab.add(BOSS_AB[b[1]]); gained.push(`${b[1]}→${BOSS_AB[b[1]]}`); }
      if (a && !got.has(a[1])) { got.add(a[1]); ab.add(a[1]); gained.push(a[1]); }
    }
    report.push(`   step ${step}: ${last.rooms.size} rooms, have [${[...ab].join(',')}] forks ${forks}${gained.length ? ', gains ' + gained.join(' ') : ''}`);
    if (last.stuckRooms.size) report.push(`     dead ends until this step's reward is taken: ${fmtStuck(last.stuckRooms)}`);
    if (!gained.length) break;
  }
  const unreached = World.rooms.filter((r) => !last.rooms.has(r.id)).map((r) => r.id);
  if (unreached.length) report.push(`   PROGRESSION UNREACHED rooms: ${unreached.join(' ')}`);
  const missing = allItems.filter((i) => !last.items.includes(i));
  if (missing.length) report.push(`   PROGRESSION UNREACHED items: ${missing.join(' ')}`);
  if (!unreached.length && !missing.length) report.push('   PROGRESSION OK: every room and item is reachable in a normal playthrough.');
}

// Inventory summary
const count = (t) => World.rooms.reduce((n, r) => n + r.ents.filter((e) => e.type === t).length, 0);
const scores = []; for (const r of World.rooms) for (const e of r.ents) if (e.type === 'score') scores.push(e.n);
console.log(`rooms ${World.rooms.length}, shrines ${count('shrine')}, hpup ${count('hpup')}, atkup ${count('atkup')}, scores ${scores.sort((a, b) => a - b).join(',')}, bosses ${count('boss')}, abilities ${count('ability')}`);
for (const l of report) console.log(l);
if (warn.length) { console.log(`\n${warn.length} warnings`); if (verbose) for (const w of warn) console.log('  ' + w); else for (const w of warn.slice(0, 15)) console.log('  ' + w); }
if (errors.length) { console.log(`\n${errors.length} ERRORS`); for (const e of errors.slice(0, 60)) console.log('  ' + e); process.exitCode = 1; }
