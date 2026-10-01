// Boot, main loop, scenes and room transitions.
import { VIEW_W, VIEW_H, TILE, CELL_W, CELL_H, makeCanvas, clamp } from './util.js';
import { G } from './state.js';
import { pollInput, input, consume, virtual } from './input.js';
import { World } from './world.js';
import { ROOMS } from './rooms/index.js';
import { Player } from './player.js';
import { spawnRoomEntities } from './entities.js';
import { updateFx, drawFx } from './fx.js';
import { drawWorld, drawVignette, updateCamera, themeOf } from './render.js';
import { ui, updateUI, drawHUD, drawOverlay, drawMap, drawMapText, mapState, FONT } from './ui.js';
import { newSave, loadSave, writeSave, hasSave, eraseSave } from './save.js';
import { initAudio, playMusic, updateMusic, sfx, audioSettings, setVolumes, setMusicLayer, bell } from './audio.js';
import { seq, S } from './text.js';
import { drawBellShape } from './gfx.js';
import { startEnding, updateEnding, drawEnding } from './ending.js';

// ---------------------------------------------------------------- canvases
const screen = document.getElementById('screen');
const sctx = screen.getContext('2d');
const [gameCanvas, gctx] = makeCanvas(VIEW_W, VIEW_H);
let scale = 1, dpr = 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  const ww = window.innerWidth, wh = window.innerHeight;
  let s = Math.min(ww / VIEW_W, wh / VIEW_H);
  if (s >= 1) s = Math.floor(s);
  scale = s;
  screen.style.width = `${Math.floor(VIEW_W * s)}px`;
  screen.style.height = `${Math.floor(VIEW_H * s)}px`;
  screen.width = Math.floor(VIEW_W * s * dpr);
  screen.height = Math.floor(VIEW_H * s * dpr);
  sctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- world
World.init(ROOMS);
G.World = World;
window.G = G; // for debugging and automated tests
G.virtual = virtual;
G.bellTone = (hz) => bell(hz, null, 0.22, 2.5);

function startRoomDef() {
  for (const r of World.rooms) for (const e of r.ents) if (e.type === 'start') return { r, e };
  return { r: World.rooms[0], e: { tx: 5, ty: 5 } };
}

export function enterRoom(r, opts = {}) {
  const prevRegion = G.room ? G.room.region : null;
  G.room = r;
  G.fx = [];
  G.bossLock = false;
  G.boss = null;
  G.dynSolids = [];
  G.ents = spawnRoomEntities(r);
  const S = G.save;
  const first = !S.visited[r.id];
  S.visited[r.id] = true;
  if (r.region !== prevRegion || opts.force) {
    if (first || opts.force) ui.area(themeOf(r.region).name);
  }
  playMusic(r.def.music || themeOf(r.region).music);
  setMusicLayer(S.forks.length);
  writeSave(S);
}

function placePlayerAt(gx, gyFeet) {
  const p = G.player;
  p.x = gx - p.w / 2; p.y = gyFeet - p.h;
  p.vx = 0; p.vy = 0;
  p.safe = { x: p.x, y: p.y };
}

export function newGame() {
  eraseSave();
  G.save = newSave();
  World.resetTiles(G.save.broken);
  const { r, e } = startRoomDef();
  G.player = new Player(0, 0);
  placePlayerAt((r.tx0 + e.tx) * TILE + 8, (r.ty0 + e.ty + 1) * TILE);
  G.save.room = r.id; G.save.sx = G.player.cx; G.save.sy = G.player.y + G.player.h;
  G.room = null;
  enterRoom(r);
  updateCamera(true);
  G.scene = 'game';
}

export function continueGame() {
  const s = loadSave();
  if (!s) return newGame();
  G.save = s;
  World.resetTiles(s.broken);
  s.hp = s.maxHp;
  const r = World.byId[s.room] || startRoomDef().r;
  G.player = new Player(0, 0);
  placePlayerAt(s.sx, s.sy);
  G.room = null;
  enterRoom(r, { force: true });
  updateCamera(true);
  G.scene = 'game';
}

function respawn() {
  const s = G.save;
  s.hp = s.maxHp;
  s.deaths++;
  const r = World.byId[s.room] || startRoomDef().r;
  G.player = new Player(0, 0);
  placePlayerAt(s.sx, s.sy);
  G.room = null;
  enterRoom(r);
  updateCamera(true);
  writeSave(s);
}

// ---------------------------------------------------------------- transitions
let trans = null; // { t, room, dir }
function checkRoomExit() {
  const p = G.player, r = G.room;
  const cx = p.cx, cy = p.cy;
  if (cx >= r.px && cx < r.px + r.pw && cy >= r.py && cy < r.py + r.ph) return;
  const nr = World.roomAtPx(cx, cy);
  if (!nr) { // no room there: keep inside
    p.x = clamp(p.x, r.px - p.w / 2, r.px + r.pw - p.w / 2);
    p.y = clamp(p.y, r.py - p.h / 2, r.py + r.ph - p.h / 2);
    return;
  }
  const dir = cy < r.py ? 'up' : cy >= r.py + r.ph ? 'down' : cx < r.px ? 'left' : 'right';
  trans = { t: 0, room: nr, dir };
}

function updateTransition() {
  trans.t++;
  const p = G.player;
  if (trans.t <= 8) G.fade = trans.t / 8;
  if (trans.t === 8) {
    enterRoom(trans.room);
    if (trans.dir === 'up') { p.vy = Math.min(p.vy, -6.2); p.jumping = false; }
    updateCamera(true);
  }
  if (trans.t > 8) G.fade = 1 - (trans.t - 8) / 8;
  if (trans.t >= 16) { G.fade = 0; trans = null; }
}

// ---------------------------------------------------------------- scenes
const title = { sel: 0, t: 0, items: [] };
function titleItems() {
  return hasSave() ? ['つづきから', 'はじめから', '操作説明'] : ['はじめから', '操作説明'];
}
const intro = { i: 0, t: 0, lines: [] };
const pause = { sel: 0 };
const PAUSE_ITEMS = ['つづける', '効果音', '音楽', '操作説明', 'タイトルへ'];
let help = false;

function updateTitle() {
  title.t++;
  title.items = titleItems();
  if (help) { if (input.pressed.jump || input.pressed.attack || input.pressed.confirm || input.pressed.pause) { help = false; sfx('menu'); } return; }
  if (input.pressed.up) { title.sel = (title.sel + title.items.length - 1) % title.items.length; sfx('menu'); }
  if (input.pressed.down) { title.sel = (title.sel + 1) % title.items.length; sfx('menu'); }
  if (input.pressed.jump || input.pressed.confirm) {
    initAudio();
    sfx('select');
    const it = title.items[title.sel];
    if (it === 'つづきから') { continueGame(); }
    else if (it === 'はじめから') { G.scene = 'intro'; intro.i = 0; intro.t = 0; intro.lines = seq('OPENING'); playMusic('title'); }
    else if (it === '操作説明') help = true;
  }
}

function updateIntro() {
  intro.t++;
  const skip = input.pressed.pause;
  if (input.pressed.jump || input.pressed.confirm || input.pressed.attack) {
    if (intro.t < 40) intro.t = 40; else { intro.i++; intro.t = 0; }
  }
  if (intro.t > 260) { intro.i++; intro.t = 0; }
  if (intro.i >= intro.lines.length + 1 || skip) newGame();
}

function updatePause() {
  if (help) { if (input.pressed.jump || input.pressed.attack || input.pressed.confirm || input.pressed.pause) { help = false; sfx('menu'); } return; }
  if (input.pressed.pause) { G.scene = 'game'; sfx('menu'); return; }
  if (input.pressed.up) { pause.sel = (pause.sel + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length; sfx('menu'); }
  if (input.pressed.down) { pause.sel = (pause.sel + 1) % PAUSE_ITEMS.length; sfx('menu'); }
  const it = PAUSE_ITEMS[pause.sel];
  const lr = (input.pressed.right ? 1 : 0) - (input.pressed.left ? 1 : 0);
  if (lr && (it === '効果音' || it === '音楽')) {
    const k = it === '効果音' ? 'sfx' : 'music';
    audioSettings[k] = clamp(Math.round((audioSettings[k] + lr * 0.1) * 10) / 10, 0, 1);
    setVolumes(); sfx('menu');
    try { localStorage.setItem('sbr-audio', JSON.stringify(audioSettings)); } catch (e) { /* ignore */ }
  }
  if (input.pressed.jump || input.pressed.confirm) {
    if (it === 'つづける') { G.scene = 'game'; sfx('menu'); }
    else if (it === '操作説明') help = true;
    else if (it === 'タイトルへ') { writeSave(G.save); G.scene = 'title'; title.sel = 0; playMusic('title'); }
  }
}

function updateMapScene() {
  if (mapState.warp) {
    const w = mapState.warp;
    if (input.pressed.left || input.pressed.up) { w.sel = (w.sel + w.list.length - 1) % w.list.length; sfx('menu'); }
    if (input.pressed.right || input.pressed.down) { w.sel = (w.sel + 1) % w.list.length; sfx('menu'); }
    if (input.pressed.attack || input.pressed.map || input.pressed.pause) { mapState.warp = null; G.scene = 'game'; sfx('menu'); }
    else if (input.pressed.jump || input.pressed.confirm) {
      const sh = w.list[w.sel];
      mapState.warp = null; G.scene = 'game';
      sfx('shrine');
      G.save.room = sh.room; G.save.sx = sh.x; G.save.sy = sh.y;
      G.warpT = 40;
    }
    return;
  }
  if (input.pressed.map || input.pressed.pause || input.pressed.attack) { G.scene = 'game'; sfx('menu'); }
}

// List of shrines the player has visited (for warping).
export function openWarp() {
  const list = [];
  for (const r of World.rooms) {
    if (!G.save.visited[r.id]) continue;
    for (const e of r.ents) if (e.type === 'shrine') list.push({ room: r.id, x: (r.tx0 + e.tx) * TILE + 8, y: (r.ty0 + e.ty + 1) * TILE });
  }
  if (list.length < 2) return false;
  const cur = list.findIndex((s) => s.room === G.room.id);
  mapState.warp = { list, sel: Math.max(0, cur) };
  G.scene = 'map';
  return true;
}
G.openWarp = openWarp;

// Deferred actions: G.when(cond, fn) runs fn on the first tick where cond() is true.
G.waiters = [];
G.when = (cond, fn) => G.waiters.push({ cond, fn });
function runWaiters() {
  if (!G.waiters.length) return;
  const ready = G.waiters.filter((w) => w.cond());
  if (!ready.length) return;
  G.waiters = G.waiters.filter((w) => !ready.includes(w));
  for (const w of ready) w.fn();
}

let deathT = 0;
function updateGame() {
  const S = G.save;
  runWaiters();
  if (G.warpT > 0) {
    G.warpT--;
    G.fade = G.warpT > 20 ? (40 - G.warpT) / 20 : G.warpT / 20;
    if (G.warpT === 20) respawnAtSave();
    return;
  }
  if (trans) { updateTransition(); return; }
  if (updateUI()) return;
  if (input.pressed.pause) { G.scene = 'pause'; pause.sel = 0; sfx('menu'); return; }
  if (input.pressed.map) { G.scene = 'map'; mapState.warp = null; sfx('menu'); return; }
  if (G.hitstop > 0) { G.hitstop--; return; }
  S.time++;
  const p = G.player;
  if (p.dead) {
    deathT++;
    if (deathT === 50) { ui.toast(S2('DEATH_01')); ui.toast(S2('DEATH_02')); }
    if (deathT > 60) G.fade = Math.min(1, (deathT - 60) / 40);
    if (deathT === 110) { respawn(); }
    if (deathT > 110) { G.fade = Math.max(0, 1 - (deathT - 110) / 30); }
    if (deathT > 140) { deathT = 0; G.fade = 0; }
    updateFx();
    return;
  }
  G.dynSolids = [];
  for (const e of G.ents) if (e.solidPass) e.update();
  p.update();
  for (const e of G.ents.slice()) if (!e.solidPass && !e.dead) e.update();
  G.ents = G.ents.filter((e) => !e.dead || e.keep);
  updateFx();
  if (!G.bossLock) checkRoomExit();
  if (S.hp === 1 && S.time % 90 === 0) sfx('heartbeat');
  if (S.gauge >= 70 && !S.flags.tuneHint) { S.flags.tuneHint = true; ui.toast(S2('TUNE_HINT_01') + ' ' + S2('TUNE_HINT_02')); }
}
const S2 = (k) => S(k);

function respawnAtSave() {
  const s = G.save;
  const r = World.byId[s.room];
  placePlayerAt(s.sx, s.sy);
  G.room = null;
  enterRoom(r);
  updateCamera(true);
}

// ---------------------------------------------------------------- render
function render() {
  const g = gctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  let overlayFn = null;
  if (G.scene === 'game' || G.scene === 'pause' || (G.scene === 'map' && G.room)) {
    if (G.scene !== 'map') {
      if (G.scene === 'game' && !trans) updateCamera();
      drawWorld(g, drawEntities);
      drawVignette(g, G.room.def.dark || 0);
      drawHUD(g);
      overlayFn = (t) => drawOverlay(t);
      if (G.scene === 'pause') {
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, VIEW_W, VIEW_H);
        overlayFn = (t) => { drawOverlay(t); drawPause(t); };
      }
    } else {
      drawMap(g);
      overlayFn = (t) => drawMapText(t);
    }
  } else if (G.scene === 'title') {
    drawTitleBg(g);
    overlayFn = drawTitle;
  } else if (G.scene === 'intro') {
    overlayFn = drawIntro;
  } else if (G.scene === 'ending') {
    drawEnding(g, null);
    overlayFn = (t) => drawEnding(null, t);
  }
  if (G.fade > 0) { g.fillStyle = `rgba(0,0,0,${clamp(G.fade, 0, 1)})`; g.fillRect(0, 0, VIEW_W, VIEW_H); }
  // compose
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(gameCanvas, 0, 0, screen.width, screen.height);
  const k = scale * dpr;
  sctx.setTransform(k, 0, 0, k, 0, 0);
  if (overlayFn) overlayFn(sctx);
  if (help) drawHelp(sctx);
}

function drawEntities(ctx, layer) {
  if (layer === 'behind') { for (const e of G.ents) if (e.behind && !e.dead) e.draw(ctx); return; }
  for (const e of G.ents) if (!e.behind && !e.front && !e.dead && !e.isProjectile) e.draw(ctx);
  G.player.draw(ctx);
  for (const e of G.ents) if ((e.front || e.isProjectile) && !e.dead) e.draw(ctx);
  drawFx(ctx);
}

function drawTitleBg(g) {
  const t = title.t;
  const grd = g.createLinearGradient(0, 0, 0, VIEW_H);
  grd.addColorStop(0, '#0a0610'); grd.addColorStop(1, '#1a1208');
  g.fillStyle = grd; g.fillRect(0, 0, VIEW_W, VIEW_H);
  // the sunken bell silhouette
  const cx = VIEW_W / 2, top = 70, H = 140, by = top + H;
  drawBellShape(g, cx, top, H);
  // glow lines (cracks)
  g.fillStyle = `rgba(255,220,150,${0.25 + 0.15 * Math.sin(t / 30)})`;
  for (let i = 0; i < 30; i++) g.fillRect(Math.round(cx + 20 + i * 1.5 + Math.sin(i * 1.7) * 3), top + 30 + i * 3, 2, 2);
  // falling dust
  g.fillStyle = '#806a50';
  for (let i = 0; i < 50; i++) {
    const x = (i * 97 + t * (0.2 + (i % 5) * 0.05)) % VIEW_W, y = (i * 53 + t * (0.3 + (i % 3) * 0.1)) % VIEW_H;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  g.fillStyle = '#120c08'; g.fillRect(0, by, VIEW_W, VIEW_H);
}

function drawTitle(t) {
  t.textBaseline = 'top'; t.textAlign = 'center';
  t.font = `28px ${FONT}`; t.fillStyle = '#f0e0c0';
  t.fillText('沈鐘のリフレイン', VIEW_W / 2, 40);
  t.font = `9px ${FONT}`; t.fillStyle = '#a89070';
  t.fillText('SUNKEN BELL REFRAIN', VIEW_W / 2, 76);
  title.items.forEach((it, i) => {
    t.font = `12px ${FONT}`;
    t.fillStyle = i === title.sel ? '#ffe9a8' : '#8a7a6a';
    t.fillText((i === title.sel ? '▶ ' : '') + it, VIEW_W / 2, 196 + i * 18);
  });
  t.font = `8px ${FONT}`; t.fillStyle = '#6a5a4a';
  t.fillText('Z / Space で決定　↑↓ で選ぶ', VIEW_W / 2, VIEW_H - 14);
  t.textAlign = 'left';
}

function drawIntro(t) {
  t.textBaseline = 'top'; t.textAlign = 'center';
  const L = intro.i < intro.lines.length ? intro.lines[intro.i] : null;
  const a = Math.min(1, intro.t / 40) * (intro.t > 220 ? Math.max(0, (260 - intro.t) / 40) : 1);
  t.globalAlpha = a;
  if (L) { t.font = `13px ${FONT}`; t.fillStyle = '#e8dcc8'; t.fillText(L, VIEW_W / 2, VIEW_H / 2 - 8); }
  else { t.font = `26px ${FONT}`; t.fillStyle = '#f0e0c0'; t.fillText(S('OPENING_TITLE'), VIEW_W / 2, VIEW_H / 2 - 16); }
  t.globalAlpha = 1;
  t.font = `8px ${FONT}`; t.fillStyle = '#5a4a3a'; t.fillText('Esc でとばす', VIEW_W - 50, VIEW_H - 14);
  t.textAlign = 'left';
}

function drawPause(t) {
  t.textBaseline = 'top'; t.textAlign = 'center';
  t.font = `16px ${FONT}`; t.fillStyle = '#f0e0c0'; t.fillText('ポーズ', VIEW_W / 2, 50);
  PAUSE_ITEMS.forEach((it, i) => {
    let s = it;
    if (it === '効果音') s += `  ◀ ${'■'.repeat(Math.round(audioSettings.sfx * 10))}${'□'.repeat(10 - Math.round(audioSettings.sfx * 10))} ▶`;
    if (it === '音楽') s += `  ◀ ${'■'.repeat(Math.round(audioSettings.music * 10))}${'□'.repeat(10 - Math.round(audioSettings.music * 10))} ▶`;
    t.font = `11px ${FONT}`; t.fillStyle = i === pause.sel ? '#ffe9a8' : '#9a8a7a';
    t.fillText(s, VIEW_W / 2, 90 + i * 20);
  });
  t.textAlign = 'left';
}

function drawHelp(t) {
  t.fillStyle = 'rgba(8,6,12,0.94)'; t.fillRect(40, 30, VIEW_W - 80, VIEW_H - 60);
  t.textBaseline = 'top'; t.textAlign = 'left'; t.font = `10px ${FONT}`; t.fillStyle = '#f0e8d8';
  const L = [
    '← →　移動', '↑ 　話す・調べる・祠を鳴らす (上攻撃は ↑+X)', 'Z / Space　ジャンプ (空中でもう一度：二段ジャンプ)',
    'X　打鍵 (攻撃)　　空中で ↓+X：フォルテ', 'C / Shift　スタッカート (ダッシュ)', 'V　共鳴弾',
    '↓ 長押し　調律 (響きを使って回復)', 'Tab / M　地図　　Esc　ポーズ', '', 'ゲームパッドにも対応しています。',
  ];
  L.forEach((l, i) => t.fillText(l, 60, 46 + i * 17));
}

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0;
const STEP = 1000 / 60;
function frame(now) {
  acc += Math.min(100, now - last);
  last = now;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    tick();
    acc -= STEP; steps++;
  }
  if (steps === 4) acc = 0;
  render();
  updateMusic();
  requestAnimationFrame(frame);
}

function tick() {
  const any = pollInput();
  if (any) initAudio();
  G.frame++;
  switch (G.scene) {
    case 'title': updateTitle(); break;
    case 'intro': updateIntro(); break;
    case 'game': updateGame(); break;
    case 'pause': updatePause(); break;
    case 'map': updateMapScene(); break;
    case 'ending': updateEnding(); break;
  }
}
G.tick = tick; // tests can drive frames directly
G.render = render;
G.newGame = newGame;
G.enterRoom = enterRoom;
G.startEnding = startEnding;

try { Object.assign(audioSettings, JSON.parse(localStorage.getItem('sbr-audio') || '{}')); } catch (e) { /* ignore */ }

// Debug: ?room=ID&ab=dash,double  jumps straight into a room
const params = new URLSearchParams(location.search);
if (params.get('room')) {
  newGame();
  const r = World.byId[params.get('room')];
  if (r) {
    for (const a of (params.get('ab') || '').split(',').filter(Boolean)) G.save.abilities[a] = true;
    if (params.get('forks')) G.save.forks = params.get('forks').split(',');
    G.room = null; enterRoom(r);
    const st = r.ents.find((e) => e.type === 'shrine') || { tx: Math.floor(r.tw / 2), ty: 2 };
    placePlayerAt((r.tx0 + st.tx) * TILE + 8, (r.ty0 + st.ty + 1) * TILE);
    if (params.get('x')) placePlayerAt((r.tx0 + +params.get('x')) * TILE + 8, (r.ty0 + +params.get('y') + 1) * TILE);
    updateCamera(true);
  }
}
if (params.get('debug')) G.debug = true;

document.fonts && document.fonts.load(`12px "DotGothic16"`).catch(() => {});
requestAnimationFrame(frame);
