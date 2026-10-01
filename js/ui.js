// HUD, dialogs, notices, map, and text rendering.
import { VIEW_W, VIEW_H, CELL_W, CELL_H, TILE, clamp } from './util.js';
import { G } from './state.js';
import { input, consume } from './input.js';
import { sfx } from './audio.js';
import { writeSave } from './save.js';
import { World } from './world.js';
import { T, isSolidTile } from './tiles.js';
import { THEMES, themeOf } from './render.js';
import { abilityText, scoreText, S, TXT, FORKS } from './text.js';

export const FONT = '"DotGothic16", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif';

const prompts = [];
let toastQ = [];
let subtitle = null;
let areaTitle = null;
let bossTitle = null;

export const ui = {
  // ---------------- modal dialog
  scene(steps, onDone) {
    if (!steps || !steps.length) { onDone && onDone(); return; }
    G.dialog = { steps: steps.slice(), i: -1, speaker: null, text: '', shown: 0, choice: null, sel: 0, onDone, wait: 6 };
    advance();
  },
  dialog(lines, speaker, onDone) {
    const steps = [];
    if (speaker) steps.push({ speaker });
    for (const l of [].concat(lines)) steps.push(l);
    this.scene(steps, onDone);
  },
  // Item / ability notice (modal, centred)
  notice(title, lines, onDone, style = 'item') {
    G.dialog = { notice: true, title, lines: [].concat(lines || []), t: 0, onDone, style, wait: 30 };
  },
  banner(title, body) { this.notice(title, body); },
  abilityGet(id) {
    const a = abilityText(id);
    this.notice(a.name, a.desc, null, 'ability');
  },
  forkGet(id, onDone) {
    const lines = S(FORKS[id].key + '_01');
    this.notice(lines, [S(FORKS[id].key + '_02')], onDone, 'fork');
  },
  score(n) {
    const s = scoreText(n);
    const count = G.save.scores.length;
    this.toast(S('SCORE_GET_01').replace('n/12', `${count}/12`) + ` 「${s.title}」`);
    subtitle = { lines: s.lines, i: 0, t: 0 };
    if (count === 12) this.toast(S('SCORE_ALL'));
  },
  playScoreNow(n) { const s = scoreText(n); subtitle = { lines: s.lines, i: 0, t: 0 }; },
  subtitleActive() { return !!subtitle; },
  toast(msg) { toastQ.push({ msg, t: 0 }); },
  prompt(x, y, text) { prompts.push({ x, y, text }); },
  area(name) { areaTitle = { name, t: 0 }; },
  bossName(name) { bossTitle = { name, t: 0 }; },
  saveGame() { writeSave(G.save); },
};

function advance() {
  const d = G.dialog;
  for (;;) {
    d.i++;
    if (d.i >= d.steps.length) { const cb = d.onDone; G.dialog = null; consume('jump'); consume('attack'); consume('up'); cb && cb(); return; }
    const s = d.steps[d.i];
    if (typeof s === 'string') { d.text = s; d.shown = 0; d.choice = null; return; }
    if (s.speaker !== undefined) { d.speaker = s.speaker; continue; }
    if (s.choice) { d.choice = s.choice; d.sel = 0; return; }
    if (s.fn) { s.fn(); if (G.dialog !== d) return; continue; }
  }
}

// Returns true while a modal UI element should pause the game.
export function updateUI() {
  for (const t of toastQ) t.t++;
  toastQ = toastQ.filter((t) => t.t < 170);
  if (toastQ.length > 3) toastQ.shift();
  if (subtitle) {
    subtitle.t++;
    const L = subtitle.lines[subtitle.i] || '';
    if (subtitle.t > 70 + L.length * 6) { subtitle.i++; subtitle.t = 0; if (subtitle.i >= subtitle.lines.length) subtitle = null; }
  }
  if (areaTitle) { areaTitle.t++; if (areaTitle.t > 200) areaTitle = null; }
  if (bossTitle) { bossTitle.t++; if (bossTitle.t > 200) bossTitle = null; }
  const d = G.dialog;
  if (!d) return false;
  const ok = input.pressed.jump || input.pressed.attack || input.pressed.confirm || input.pressed.up && !d.choice && !d.notice;
  if (d.wait > 0) { d.wait--; return true; }
  if (d.notice) {
    d.t++;
    if (ok && d.t > 30) { const cb = d.onDone; G.dialog = null; consume('jump'); consume('attack'); sfx('menu'); cb && cb(); }
    return true;
  }
  if (d.choice) {
    if (input.pressed.up || input.pressed.left) { d.sel = (d.sel + d.choice.length - 1) % d.choice.length; sfx('menu'); }
    if (input.pressed.down || input.pressed.right) { d.sel = (d.sel + 1) % d.choice.length; sfx('menu'); }
    if (input.pressed.jump || input.pressed.confirm || input.pressed.attack) {
      sfx('select');
      const c = d.choice[d.sel];
      d.steps.splice(d.i + 1, 0, ...(c.steps || []));
      if (c.fn) c.fn();
      d.choice = null;
      if (G.dialog === d) advance();
    }
    return true;
  }
  if (d.shown < d.text.length) {
    d.shown += 0.75;
    if (Math.floor(d.shown) % 3 === 0 && d.shown % 1 === 0) sfx('blip');
    if (ok) d.shown = d.text.length;
  } else if (ok) { sfx('menu'); advance(); }
  return true;
}

// ---------------- HUD (pixel canvas)
export function drawHUD(ctx) {
  const S = G.save;
  // Bells for HP
  for (let i = 0; i < S.maxHp; i++) {
    const x = 10 + i * 13, y = 8;
    const full = i < S.hp;
    ctx.fillStyle = '#120c18'; ctx.fillRect(x - 1, y - 1, 12, 13);
    ctx.fillStyle = full ? '#e8c060' : '#3a3440';
    ctx.fillRect(x + 2, y, 6, 2); ctx.fillRect(x + 1, y + 2, 8, 6); ctx.fillRect(x, y + 8, 10, 2);
    if (full) { ctx.fillStyle = '#fff0b0'; ctx.fillRect(x + 2, y + 2, 2, 4); ctx.fillStyle = '#9a7030'; ctx.fillRect(x + 4, y + 10, 2, 1); }
  }
  if (S.hp === 1 && G.frame % 90 < 45) { ctx.globalAlpha = 0.15; ctx.fillStyle = '#ff2040'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1; }
  // Resonance gauge
  const gx = 10, gy = 24, gw = 64;
  const shake = G.gaugeShake > 0 ? (G.gaugeShake--, (G.frame % 2) * 2 - 1) : 0;
  ctx.fillStyle = '#120c18'; ctx.fillRect(gx - 1 + shake, gy - 1, gw + 2, 6);
  ctx.fillStyle = '#2a2a3a'; ctx.fillRect(gx + shake, gy, gw, 4);
  const ready = S.gauge >= 70;
  ctx.fillStyle = ready ? (G.frame % 40 < 20 ? '#ffe9a8' : '#e8c060') : '#5ac8c0';
  ctx.fillRect(gx + shake, gy, Math.round(gw * S.gauge / 100), 4);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(gx + Math.round(gw * 0.7) + shake, gy - 1, 1, 6);
  // Forks
  const names = ['gear', 'choir', 'gardener', 'wyrm', 'librarian'];
  names.forEach((n, i) => {
    if (!S.forks.includes(n)) return;
    const x = 84 + i * 7, y = 22;
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(x, y, 1, 5); ctx.fillRect(x + 3, y, 1, 5); ctx.fillRect(x, y + 5, 4, 1); ctx.fillRect(x + 1, y + 6, 2, 3);
  });
  // Boss bar
  const b = G.boss;
  if (b && b.active && !b.dead) {
    const w = 240, x = (VIEW_W - w) / 2, y = VIEW_H - 14;
    ctx.fillStyle = '#120c18'; ctx.fillRect(x - 2, y - 2, w + 4, 7);
    ctx.fillStyle = '#3a1a20'; ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = '#e04050'; ctx.fillRect(x, y, Math.round(w * Math.max(0, b.hp) / b.maxHp), 3);
    ctx.fillStyle = '#fff';
    for (const p of b.phaseMarks || []) ctx.fillRect(Math.round(x + w * p), y - 1, 1, 5);
  }
}

// ---------------- text overlay (display canvas, already scaled to logical units)
export function drawOverlay(ctx) {
  ctx.textBaseline = 'top';
  // prompts
  for (const p of prompts) {
    const x = p.x - G.cam.x, y = p.y - G.cam.y;
    textBox(ctx, p.text, x, y, 8, true);
  }
  prompts.length = 0;
  // toasts
  toastQ.forEach((t, i) => {
    const a = t.t < 15 ? t.t / 15 : t.t > 150 ? (170 - t.t) / 20 : 1;
    ctx.globalAlpha = a;
    textBox(ctx, t.msg, VIEW_W / 2, 38 + i * 16, 9, true);
    ctx.globalAlpha = 1;
  });
  if (subtitle && !G.dialog) {
    const L = subtitle.lines[subtitle.i] || '';
    const a = Math.min(1, subtitle.t / 12);
    ctx.globalAlpha = a;
    ctx.font = `9px ${FONT}`;
    const w = ctx.measureText(L).width;
    ctx.fillStyle = 'rgba(10,8,16,0.7)'; ctx.fillRect(VIEW_W / 2 - w / 2 - 6, VIEW_H - 46, w + 12, 16);
    ctx.fillStyle = '#c8f0ff'; ctx.textAlign = 'center'; ctx.fillText(L, VIEW_W / 2, VIEW_H - 43);
    ctx.font = `7px ${FONT}`; ctx.fillStyle = '#80a0b0'; ctx.fillText('— セラ', VIEW_W / 2, VIEW_H - 56);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  if (areaTitle) {
    const t = areaTitle.t, a = t < 30 ? t / 30 : t > 160 ? (200 - t) / 40 : 1;
    ctx.globalAlpha = a; ctx.textAlign = 'center';
    ctx.font = `16px ${FONT}`; ctx.fillStyle = '#f0e8d8'; ctx.fillText(areaTitle.name, VIEW_W / 2, 70);
    ctx.fillStyle = '#f0e8d8'; ctx.fillRect(VIEW_W / 2 - 60, 92, 120, 1);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  if (bossTitle) {
    const t = bossTitle.t, a = t < 30 ? t / 30 : t > 160 ? (200 - t) / 40 : 1;
    ctx.globalAlpha = a; ctx.textAlign = 'center';
    ctx.font = `14px ${FONT}`; ctx.fillStyle = '#ffe0d0'; ctx.fillText(bossTitle.name, VIEW_W / 2, VIEW_H - 50);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  const d = G.dialog;
  if (d) {
    if (d.notice) drawNotice(ctx, d);
    else drawDialog(ctx, d);
  }
}

function textBox(ctx, text, x, y, size, center) {
  ctx.font = `${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  const bx = center ? x - w / 2 - 4 : x;
  ctx.fillStyle = 'rgba(10,8,16,0.75)'; ctx.fillRect(bx, y - 2, w + 8, size + 5);
  ctx.fillStyle = '#f0e8d8'; ctx.fillText(text, bx + 4, y);
}

function frame(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(12,9,18,0.92)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#c8a050'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = '#5a4a30'; ctx.fillRect(x + 2, y + 2, w - 4, 1); ctx.fillRect(x + 2, y + h - 3, w - 4, 1);
}

function drawDialog(ctx, d) {
  const x = 20, y = VIEW_H - 74, w = VIEW_W - 40, h = 64;
  frame(ctx, x, y, w, h);
  if (d.speaker) {
    ctx.font = `9px ${FONT}`;
    const sw = ctx.measureText(d.speaker).width;
    frame(ctx, x + 8, y - 12, sw + 14, 15);
    ctx.fillStyle = '#ffe9a8'; ctx.fillText(d.speaker, x + 15, y - 9);
  }
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = '#f0e8d8';
  if (!d.choice) {
    ctx.fillText(d.text.slice(0, Math.floor(d.shown)), x + 14, y + 14);
    if (d.shown >= d.text.length && G.frame % 40 < 26) { ctx.fillStyle = '#c8a050'; ctx.fillText('▼', x + w - 18, y + h - 16); }
  } else {
    ctx.fillText(d.text, x + 14, y + 8);
    d.choice.forEach((c, i) => {
      ctx.fillStyle = i === d.sel ? '#ffe9a8' : '#8a8090';
      ctx.fillText((i === d.sel ? '▶ ' : '　 ') + c.label, x + 24, y + 26 + i * 14);
    });
  }
}

function drawNotice(ctx, d) {
  const w = 300, h = 46 + d.lines.length * 14, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2 - 10;
  const a = Math.min(1, d.t / 10);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  frame(ctx, x, y, w, h);
  ctx.textAlign = 'center';
  ctx.font = `${d.style === 'item' ? 12 : 15}px ${FONT}`;
  ctx.fillStyle = d.style === 'ability' ? '#7ff7e6' : d.style === 'fork' ? '#ffe9a8' : '#ffd0a0';
  ctx.fillText(d.title, VIEW_W / 2, y + 12);
  ctx.font = `10px ${FONT}`; ctx.fillStyle = '#f0e8d8';
  d.lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, y + 36 + i * 14));
  if (d.t > 30 && G.frame % 40 < 26) { ctx.fillStyle = '#c8a050'; ctx.fillText('▼', VIEW_W / 2, y + h - 12); }
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

// ---------------- map screen
const REGION_COL = {
  WORKSHOP: '#b08860', CLOISTER: '#8a8aa8', GEARWORKS: '#c87a48', NAVE: '#5a9ab0', GARDEN: '#7aa860',
  MINES: '#8a70b0', ARCHIVE: '#b07858', SHELL: '#5aa890', CROWN: '#e8d090',
};
export const mapState = { cx: 0, cy: 0, warp: null };

export function drawMap(ctx, tctx) {
  const S = G.save;
  ctx.fillStyle = '#0a0810'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const cw = 20, ch = 12; // cell size on map
  const ox = Math.round(VIEW_W / 2 - 10 * cw), oy = 28;
  // grid
  ctx.fillStyle = '#16121e';
  for (let x = 0; x <= 20; x++) ctx.fillRect(ox + x * cw, oy, 1, 14 * ch);
  for (let y = 0; y <= 14; y++) ctx.fillRect(ox, oy + y * ch, 20 * cw, 1);
  for (const r of World.rooms) {
    if (!S.visited[r.id]) continue;
    const x = ox + r.cx * cw, y = oy + r.cy * ch, w = r.w * cw, h = r.h * ch;
    const col = REGION_COL[r.region] || '#888';
    ctx.fillStyle = shadeHex(col, -0.55); ctx.fillRect(x + 1, y + 1, w - 1, h - 1);
    ctx.fillStyle = col;
    // outline with gaps where exits are
    drawRoomOutline(ctx, r, x, y, w, h, col);
    // icons
    for (const e of r.ents) {
      const ix = x + 1 + Math.floor((e.tx / r.tw) * (w - 2)), iy = y + 1 + Math.floor((e.ty / r.th) * (h - 2));
      if (e.type === 'shrine') { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(ix - 1, iy - 1, 3, 3); }
      else if (['hpup', 'atkup', 'score', 'ability'].includes(e.type) && !S.items[`${r.id}:${e.tx},${e.ty}`]) {
        if (G.frame % 60 < 40) { ctx.fillStyle = '#7ff7e6'; ctx.fillRect(ix, iy, 1, 1); }
      } else if (e.type === 'boss') { ctx.fillStyle = S.flags['boss_' + e.id] ? '#ffe9a8' : '#e04050'; ctx.fillRect(ix - 1, iy - 1, 3, 3); }
    }
  }
  // player
  if (G.room && G.frame % 30 < 20) {
    const p = G.player;
    const px = ox + (p.cx / (CELL_W * TILE)) * cw, py = oy + (p.cy / (CELL_H * TILE)) * ch;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
  }
  // warp cursor
  if (mapState.warp) {
    const sh = mapState.warp.list[mapState.warp.sel];
    const r = World.byId[sh.room];
    const x = ox + (sh.x / (CELL_W * TILE)) * cw, y = oy + (sh.y / (CELL_H * TILE)) * ch;
    ctx.fillStyle = G.frame % 20 < 10 ? '#ffe9a8' : '#c8a050';
    ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 9, 1); ctx.fillRect(Math.round(x) - 4, Math.round(y) + 4, 9, 1);
    ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 1, 9); ctx.fillRect(Math.round(x) + 4, Math.round(y) - 4, 1, 9);
    void r;
  }
}

export function drawMapText(tctx) {
  const S = G.save;
  tctx.textBaseline = 'top';
  tctx.font = `11px ${FONT}`; tctx.fillStyle = '#f0e8d8'; tctx.textAlign = 'center';
  const rname = G.room ? themeOf(G.room.region).name : '';
  tctx.fillText(mapState.warp ? '祠を選ぶ (←→ で選ぶ / Z で移る / X でやめる)' : `地図 — ${rname}`, VIEW_W / 2, 8);
  tctx.textAlign = 'left';
  tctx.font = `8px ${FONT}`;
  const t = Math.floor(S.time / 60);
  const items = `鼓動の器 ${S.maxHp - 5}/6   鋼の撥 ${S.atk - 1}/3   記憶の譜面 ${S.scores.length}/12   音叉 ${S.forks.length}/5`;
  tctx.fillStyle = '#c8c0d0';
  tctx.fillText(items, 16, VIEW_H - 22);
  tctx.textAlign = 'right';
  tctx.fillText(`${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, VIEW_W - 16, VIEW_H - 22);
  tctx.textAlign = 'left';
  if (mapState.warp) {
    const sh = mapState.warp.list[mapState.warp.sel];
    tctx.font = `10px ${FONT}`; tctx.fillStyle = '#ffe9a8'; tctx.textAlign = 'center';
    tctx.fillText(themeOf(World.byId[sh.room].region).name + ' の祠', VIEW_W / 2, VIEW_H - 40);
    tctx.textAlign = 'left';
  }
}

function drawRoomOutline(ctx, r, x, y, w, h, col) {
  ctx.fillStyle = col;
  const open = (gx, gy) => !isSolidTile(World.tileAt(gx, gy), { bossLock: false, forks: 0 });
  // top & bottom
  for (let i = 0; i < w; i++) {
    const tx = r.tx0 + Math.floor((i / w) * r.tw);
    if (!(open(tx, r.ty0) && open(tx, r.ty0 - 1))) ctx.fillRect(x + i, y, 1, 1);
    if (!(open(tx, r.ty0 + r.th - 1) && open(tx, r.ty0 + r.th))) ctx.fillRect(x + i, y + h, 1, 1);
  }
  for (let j = 0; j <= h; j++) {
    const ty = r.ty0 + Math.min(r.th - 1, Math.floor((j / h) * r.th));
    if (!(open(r.tx0, ty) && open(r.tx0 - 1, ty))) ctx.fillRect(x, y + j, 1, 1);
    if (!(open(r.tx0 + r.tw - 1, ty) && open(r.tx0 + r.tw, ty))) ctx.fillRect(x + w, y + j, 1, 1);
  }
}

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r * (1 + f)); g = Math.round(g * (1 + f)); b = Math.round(b * (1 + f));
  return `rgb(${r},${g},${b})`;
}
