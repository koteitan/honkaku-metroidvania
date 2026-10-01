// Region themes, tile art, backgrounds and the world renderer.
import { TILE, VIEW_W, VIEW_H, hash2, makeCanvas, shade, clamp, rng } from './util.js';
import { T, isSolidTile } from './tiles.js';
import { World } from './world.js';
import { G } from './state.js';
import { pcircle } from './gfx.js';

export const THEMES = {
  WORKSHOP:  { name: '調律工房', style: 'wood',   wall: '#5a4038', wallL: '#94704e', wallD: '#2a1a1a', bg0: '#140c10', bg1: '#24171c', bg2: '#33232a', accent: '#ffd070', top: '#b08860', music: 'workshop' },
  CLOISTER:  { name: '下層回廊', style: 'brick',  wall: '#4a4a5c', wallL: '#7c7c92', wallD: '#20202c', bg0: '#0c0c14', bg1: '#181822', bg2: '#242432', accent: '#a0b0ff', top: '#8a8aa0', music: 'cloister' },
  GEARWORKS: { name: '歯車庫',   style: 'metal',  wall: '#6a4232', wallL: '#a86c4a', wallD: '#2a1810', bg0: '#140a08', bg1: '#24140e', bg2: '#341e16', accent: '#ff9040', top: '#c87a48', music: 'gearworks' },
  NAVE:      { name: '水没聖堂', style: 'stone',  wall: '#3a5260', wallL: '#64889a', wallD: '#16242c', bg0: '#06121a', bg1: '#0c1e28', bg2: '#142a36', accent: '#80e0ff', top: '#7aa8b8', music: 'nave' },
  GARDEN:    { name: '静寂の庭', style: 'garden', wall: '#585e52', wallL: '#8c9878', wallD: '#262a22', bg0: '#0e120e', bg1: '#182018', bg2: '#222c22', accent: '#e8f0d0', top: '#6aa04a', music: 'garden' },
  MINES:     { name: '結晶坑道', style: 'rock',   wall: '#3a3048', wallL: '#625678', wallD: '#16121e', bg0: '#08060e', bg1: '#100c1a', bg2: '#1a1428', accent: '#68d8f8', top: '#7a6c90', music: 'mines' },
  ARCHIVE:   { name: '大書庫',   style: 'shelf',  wall: '#5a3a30', wallL: '#8c5e44', wallD: '#24140e', bg0: '#120a08', bg1: '#1e120e', bg2: '#2c1c14', accent: '#ffe0a0', top: '#a87a50', music: 'archive' },
  SHELL:     { name: '鐘の外殻', style: 'bronze', wall: '#5c4a2a', wallL: '#94804a', wallD: '#241c0e', bg0: '#0c0a06', bg1: '#16140c', bg2: '#221e12', accent: '#60c8a8', top: '#4a9a80', music: 'shell' },
  CROWN:     { name: '鐘冠',     style: 'bronze', wall: '#6a5a3a', wallL: '#c8b070', wallD: '#2a2210', bg0: '#060408', bg1: '#100c10', bg2: '#1a1418', accent: '#fff0c0', top: '#e8d090', music: 'crown' },
};
export function themeOf(region) { return THEMES[region] || THEMES.CLOISTER; }

// --------------------------------------------------------------- tile cache
const solidPlain = (t) => t === T.SOLID || t === T.BREAKABLE || t === T.CRACKED || t === T.CRYSTAL || t === T.CONV_R || t === T.CONV_L;

function roomTile(r, x, y) {
  if (x < 0 || y < 0 || x >= r.tw || y >= r.th) return World.tileAt(r.tx0 + x, r.ty0 + y);
  return r.tiles[y * r.tw + x];
}

export function buildRoomCanvas(r) {
  if (!r.canvas) {
    const [c, ctx] = makeCanvas(r.pw, r.ph);
    r.canvas = c; r.ctx = ctx;
    const [bc, bctx] = makeCanvas(r.pw, r.ph);
    r.bgCanvas = bc; r.bgCtx = bctx;
  }
  r.ctx.clearRect(0, 0, r.pw, r.ph);
  r.bgCtx.clearRect(0, 0, r.pw, r.ph);
  const th = themeOf(r.region);
  for (let y = 0; y < r.th; y++) for (let x = 0; x < r.tw; x++) drawTile(r, x, y, th);
  r.dirty = false;
}

function drawTile(r, x, y, th) {
  const t = roomTile(r, x, y);
  const ctx = r.ctx, px = x * TILE, py = y * TILE;
  if (t === T.DECO) { drawDecoTile(r.bgCtx, r, x, y, th); return; }
  if (t === T.SOLID || t === T.BREAKABLE || t === T.CRACKED) { drawSolid(ctx, r, x, y, th, t); return; }
  if (t === T.CONV_R || t === T.CONV_L) { drawSolid(ctx, r, x, y, th, T.SOLID); return; }
  if (t === T.CRYSTAL) { drawCrystal(ctx, px, py, x, y); return; }
  if (t === T.PLATFORM) { drawPlatform(ctx, px, py, th, r, x, y); return; }
  if (t === T.SPIKE) { drawSpike(ctx, r, x, y, th); return; }
  if (t === T.VENT) { drawVent(ctx, px, py, th); return; }
}

function exposedSides(r, x, y) {
  const s = (dx, dy) => solidPlain(roomTile(r, x + dx, y + dy)) || roomTile(r, x + dx, y + dy) === T.SEAL;
  return { up: !s(0, -1), down: !s(0, 1), left: !s(-1, 0), right: !s(1, 0), depth: (!s(0, -1) || !s(0, 1) || !s(-1, 0) || !s(1, 0)) ? 0 : (!s(0, -2) || !s(0, 2) || !s(-2, 0) || !s(2, 0)) ? 1 : 2 };
}

function drawSolid(ctx, r, x, y, th, t) {
  const px = x * TILE, py = y * TILE;
  const e = exposedSides(r, x, y);
  const base = e.depth === 0 ? th.wall : e.depth === 1 ? shade(th.wall, -0.25) : th.wallD;
  ctx.fillStyle = base;
  ctx.fillRect(px, py, TILE, TILE);
  const gx = r.tx0 + x, gy = r.ty0 + y;
  const dark = shade(base, -0.3), light = shade(base, 0.15);
  // Style-specific texture
  switch (th.style) {
    case 'brick': case 'stone': {
      const off = (gy % 2) * 8;
      ctx.fillStyle = dark;
      ctx.fillRect(px, py + 7, TILE, 1); ctx.fillRect(px, py + 15, TILE, 1);
      ctx.fillRect(px + ((off + 4) % 16), py, 1, 7); ctx.fillRect(px + ((off + 12) % 16), py + 8, 1, 7);
      if (th.style === 'stone' && hash2(gx, gy, 3) < 0.3) { ctx.fillStyle = '#2a6a58'; ctx.fillRect(px + 3, py + 9, 4, 2); }
      break;
    }
    case 'metal': {
      ctx.fillStyle = dark; ctx.fillRect(px, py + 15, TILE, 1); ctx.fillRect(px + 15, py, 1, TILE);
      ctx.fillStyle = light; ctx.fillRect(px + 2, py + 2, 1, 1); ctx.fillRect(px + 13, py + 2, 1, 1); ctx.fillRect(px + 2, py + 13, 1, 1); ctx.fillRect(px + 13, py + 13, 1, 1);
      if (hash2(gx, gy, 5) < 0.25) { ctx.fillStyle = '#8a3a20'; ctx.fillRect(px + 5, py + 6, 5, 3); }
      break;
    }
    case 'wood': {
      ctx.fillStyle = dark;
      ctx.fillRect(px, py + 5, TILE, 1); ctx.fillRect(px, py + 11, TILE, 1);
      if (hash2(gx, gy, 2) < 0.5) ctx.fillRect(px + Math.floor(hash2(gx, gy, 9) * 14), py, 1, 5);
      break;
    }
    case 'garden': {
      ctx.fillStyle = dark;
      ctx.fillRect(px, py + 15, TILE, 1);
      ctx.fillRect(px + ((gx * 7 + gy * 3) % 12) + 2, py + 3, 3, 2);
      if (hash2(gx, gy, 4) < 0.3) { ctx.fillStyle = '#4a6a3a'; ctx.fillRect(px + 2, py + 9, 6, 2); }
      break;
    }
    case 'rock': {
      for (let i = 0; i < 4; i++) {
        const hx = Math.floor(hash2(gx, gy, i) * 14), hy = Math.floor(hash2(gx, gy, i + 7) * 14);
        ctx.fillStyle = i % 2 ? dark : light; ctx.fillRect(px + hx, py + hy, 2, 2);
      }
      if (hash2(gx, gy, 11) < 0.12) { ctx.fillStyle = '#4ab8e0'; ctx.fillRect(px + 6, py + 6, 3, 2); ctx.fillRect(px + 8, py + 5, 1, 1); }
      break;
    }
    case 'shelf': {
      // book spines inside walls
      if (e.depth === 0 || hash2(gx, gy, 1) < 0.5) {
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = ['#6a2a24', '#2a4a5a', '#5a5a2a', '#4a2a4a'][(gx + gy + i) % 4];
          ctx.fillRect(px + 1 + i * 4, py + 3 + ((gx + i) % 2), 3, 11 - ((gx + i) % 2));
        }
        ctx.fillStyle = dark; ctx.fillRect(px, py + 14, TILE, 2);
      }
      break;
    }
    case 'bronze': {
      ctx.fillStyle = dark; ctx.fillRect(px, py + 15, TILE, 1);
      if ((gx + gy) % 3 === 0) { ctx.fillStyle = light; ctx.fillRect(px + 7, py + 7, 2, 2); }
      if (hash2(gx, gy, 6) < 0.3) { ctx.fillStyle = '#3a7a68'; ctx.fillRect(px + 2, py + 3, 5, 2); ctx.fillRect(px + 4, py + 5, 2, 3); }
      break;
    }
  }
  // Exposed edges
  if (e.up) {
    ctx.fillStyle = th.wallL; ctx.fillRect(px, py, TILE, 2);
    ctx.fillStyle = th.top;
    for (let i = 0; i < TILE; i += 2) if (hash2(gx * 16 + i, gy, 1) < 0.55) ctx.fillRect(px + i, py - 1, 2, 2 + Math.floor(hash2(gx * 16 + i, gy, 2) * 2));
  }
  if (e.down) { ctx.fillStyle = shade(th.wallD, -0.3); ctx.fillRect(px, py + TILE - 2, TILE, 2); }
  if (e.left) { ctx.fillStyle = shade(th.wallL, -0.15); ctx.fillRect(px, py, 1, TILE); }
  if (e.right) { ctx.fillStyle = shade(th.wallD, 0.1); ctx.fillRect(px + TILE - 1, py, 1, TILE); }
  if (t === T.CRACKED) {
    ctx.fillStyle = shade(th.wallL, 0.1);
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = shade(th.wallD, -0.4);
    const c = [[2, 3], [3, 4], [4, 5], [5, 5], [6, 6], [7, 7], [8, 7], [9, 8], [10, 9], [11, 10], [12, 10], [13, 11], [6, 7], [5, 8], [5, 9], [4, 10], [9, 9], [9, 10], [10, 11], [10, 12]];
    for (const [a, b] of c) ctx.fillRect(px + a, py + b, 1, 1);
    ctx.fillRect(px, py + TILE - 1, TILE, 1);
  }
  if (t === T.BREAKABLE && r.region === 'WORKSHOP') {
    // wooden crate
    ctx.fillStyle = '#120c18'; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#9a6a3a'; ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = '#6a4424'; ctx.fillRect(px + 1, py + 7, TILE - 2, 2); ctx.fillRect(px + 3, py + 1, 2, TILE - 2); ctx.fillRect(px + 11, py + 1, 2, TILE - 2);
    ctx.fillStyle = '#c8945a'; ctx.fillRect(px + 1, py + 1, TILE - 2, 1);
    return;
  }
  if (t === T.BREAKABLE) {
    // a very faint hint: slightly misaligned mortar
    ctx.fillStyle = shade(base, 0.08);
    ctx.fillRect(px + 3, py + 3, 1, 1); ctx.fillRect(px + 12, py + 11, 1, 1);
  }
}

function drawCrystal(ctx, px, py, x, y) {
  ctx.fillStyle = '#183048'; ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = '#3a90c0'; ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = '#68c8e8';
  ctx.fillRect(px + 2, py + 2, 6, 12); ctx.fillRect(px + 9, py + 4, 5, 9);
  ctx.fillStyle = '#c8f4ff'; ctx.fillRect(px + 3, py + 3, 2, 6); ctx.fillRect(px + 10, py + 5, 1, 4);
  ctx.fillStyle = '#2a6890'; ctx.fillRect(px + 8, py + 1, 1, 14);
}

function drawPlatform(ctx, px, py, th, r, x, y) {
  ctx.fillStyle = '#120c18'; ctx.fillRect(px, py, TILE, 5);
  ctx.fillStyle = shade(th.wallL, -0.1); ctx.fillRect(px, py, TILE, 4);
  ctx.fillStyle = shade(th.wallL, 0.2); ctx.fillRect(px, py, TILE, 1);
  ctx.fillStyle = shade(th.wallD, 0); ctx.fillRect(px + 7, py + 4, 2, 3);
  if (roomTile(r, x - 1, y) !== T.PLATFORM) { ctx.fillStyle = '#120c18'; ctx.fillRect(px, py, 1, 5); }
  if (roomTile(r, x + 1, y) !== T.PLATFORM) { ctx.fillStyle = '#120c18'; ctx.fillRect(px + 15, py, 1, 5); }
}

function drawSpike(ctx, r, x, y, th) {
  const px = x * TILE, py = y * TILE;
  const s = (dx, dy) => isSolidTile(roomTile(r, x + dx, y + dy), null);
  let dir = 'up';
  if (s(0, 1)) dir = 'up'; else if (s(0, -1)) dir = 'down'; else if (s(-1, 0)) dir = 'right'; else if (s(1, 0)) dir = 'left';
  const metal = '#c8ccd8', dark = '#5a5e70', tip = '#ff6070';
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 8; k++) {
      const wdt = Math.max(1, 4 - Math.floor(k / 2));
      const off = Math.floor((4 - wdt) / 2);
      let rx, ry, rw, rh;
      if (dir === 'up') { rx = px + i * 4 + off; ry = py + 15 - k; rw = wdt; rh = 1; }
      else if (dir === 'down') { rx = px + i * 4 + off; ry = py + k; rw = wdt; rh = 1; }
      else if (dir === 'right') { rx = px + k; ry = py + i * 4 + off; rw = 1; rh = wdt; }
      else { rx = px + 15 - k; ry = py + i * 4 + off; rw = 1; rh = wdt; }
      ctx.fillStyle = k >= 6 ? tip : k < 2 ? dark : metal;
      ctx.fillRect(rx, ry, rw, rh);
    }
  }
}

function drawVent(ctx, px, py, th) {
  ctx.fillStyle = '#120c18'; ctx.fillRect(px, py + 10, TILE, 6);
  ctx.fillStyle = '#6a6a78'; ctx.fillRect(px, py + 11, TILE, 5);
  ctx.fillStyle = '#2a2a34';
  for (let i = 1; i < TILE; i += 3) ctx.fillRect(px + i, py + 12, 2, 3);
  ctx.fillStyle = th.accent; ctx.fillRect(px, py + 10, TILE, 1);
}

function drawDecoTile(ctx, r, x, y, th) {
  const px = x * TILE, py = y * TILE;
  const gx = r.tx0 + x, gy = r.ty0 + y;
  ctx.fillStyle = shade(th.bg2, 0.12);
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = shade(th.bg2, -0.1);
  if (gy % 2 === 0) ctx.fillRect(px, py + 15, TILE, 1);
  ctx.fillRect(px + ((gx + gy) % 2) * 8, py, 1, TILE);
  const up = roomTile(r, x, y - 1) !== T.DECO, left = roomTile(r, x - 1, y) !== T.DECO, right = roomTile(r, x + 1, y) !== T.DECO;
  ctx.fillStyle = shade(th.bg2, 0.25);
  if (up) ctx.fillRect(px, py, TILE, 1);
  if (left) ctx.fillRect(px, py, 1, TILE);
  ctx.fillStyle = shade(th.bg2, -0.25);
  if (right) ctx.fillRect(px + 15, py, 1, TILE);
}

// --------------------------------------------------------------- backgrounds
const bgCache = {};
function regionBackground(region) {
  if (bgCache[region]) return bgCache[region];
  const th = themeOf(region);
  const W = 640, H = 360;
  const [c, ctx] = makeCanvas(W, H);
  const R = rng(region.length * 977 + region.charCodeAt(0));
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, th.bg0); grd.addColorStop(1, th.bg1);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.bg2;
  const st = th.style;
  if (st === 'brick' || st === 'stone') {
    for (let i = 0; i < 5; i++) { // arches
      const x = i * 128 + 20;
      ctx.fillRect(x, 60, 18, H); ctx.fillRect(x + 90, 60, 18, H);
      for (let a = 0; a <= 20; a++) {
        const ang = Math.PI * (a / 20);
        ctx.fillRect(Math.round(x + 54 - Math.cos(ang) * 46), Math.round(70 - Math.sin(ang) * 40), 12, 10);
      }
    }
    if (st === 'stone') { ctx.fillStyle = shade(th.bg2, 0.2); for (let i = 0; i < 5; i++) ctx.fillRect(i * 128 + 60, 90, 8, 60); }
  } else if (st === 'metal') {
    for (let i = 0; i < 9; i++) {
      const x = R() * W, y = R() * H, rr = 20 + R() * 50;
      pcircle(ctx, x, y, rr, th.bg2); pcircle(ctx, x, y, rr * 0.35, th.bg1);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.fillRect(Math.round(x + Math.cos(a) * rr) - 4, Math.round(y + Math.sin(a) * rr) - 4, 8, 8); }
    }
    for (let i = 0; i < 6; i++) ctx.fillRect(R() * W, 0, 6, H);
  } else if (st === 'wood') {
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 80 + 10, 0, 12, H);
    for (let j = 0; j < 4; j++) ctx.fillRect(0, j * 90 + 40, W, 6);
    ctx.fillStyle = shade(th.bg2, 0.15);
    for (let i = 0; i < 20; i++) ctx.fillRect(R() * W, R() * H, 10 + R() * 20, 3);
  } else if (st === 'garden') {
    for (let i = 0; i < 14; i++) { // hedges & trees
      const x = R() * W, h = 60 + R() * 140;
      ctx.fillRect(x, H - h, 6, h);
      pcircle(ctx, x + 3, H - h, 18 + R() * 14, th.bg2);
    }
    ctx.fillStyle = shade(th.bg2, 0.2);
    for (let i = 0; i < 40; i++) ctx.fillRect(R() * W, R() * H, 1, 1);
  } else if (st === 'rock') {
    for (let i = 0; i < 18; i++) {
      const x = R() * W, y = R() * H, h = 20 + R() * 60;
      ctx.fillStyle = th.bg2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10 + R() * 10, y - h); ctx.lineTo(x + 20 + R() * 10, y); ctx.fill();
    }
    for (let i = 0; i < 30; i++) { ctx.fillStyle = R() < 0.5 ? '#1e3a58' : '#2a2050'; ctx.fillRect(R() * W, R() * H, 2, 2); }
  } else if (st === 'shelf') {
    for (let j = 0; j < 8; j++) {
      ctx.fillStyle = th.bg2; ctx.fillRect(0, j * 46 + 40, W, 4);
      for (let i = 0; i < 80; i++) {
        ctx.fillStyle = shade(['#3a1a14', '#1a2a34', '#34341a', '#2a1a2a'][Math.floor(R() * 4)], -0.2);
        const h = 20 + R() * 16; ctx.fillRect(i * 8, j * 46 + 40 - h, 6, h);
      }
    }
  } else if (st === 'bronze') {
    for (let i = 0; i < 7; i++) { // bell ribs (curves)
      const x0 = i * 100;
      for (let k = 0; k < 60; k++) {
        const yy = k * 6, xx = x0 + Math.sin(k / 12) * 30;
        ctx.fillRect(Math.round(xx), yy, 10, 6);
      }
    }
    ctx.fillStyle = shade(th.bg2, 0.25);
    for (let i = 0; i < 30; i++) ctx.fillRect(R() * W, R() * H, 2, 1);
  }
  // Dust motes baked
  ctx.fillStyle = shade(th.bg2, 0.35);
  for (let i = 0; i < 25; i++) ctx.fillRect(Math.floor(R() * W), Math.floor(R() * H), 1, 1);
  bgCache[region] = c;
  return c;
}

const midCache = {};
function regionMidground(region) {
  if (midCache[region]) return midCache[region];
  const th = themeOf(region);
  const W = 720, H = 400;
  const [c, ctx] = makeCanvas(W, H);
  const R = rng(region.length * 131 + 7);
  const col = shade(th.bg2, 0.06), col2 = shade(th.bg2, 0.14);
  ctx.fillStyle = col;
  const st = th.style;
  if (st === 'brick' || st === 'stone') {
    for (let i = 0; i < 3; i++) { const x = 60 + i * 240 + R() * 40; ctx.fillRect(x, 0, 26, H); ctx.fillStyle = col2; ctx.fillRect(x, 0, 3, H); ctx.fillStyle = col; for (let y = 30; y < H; y += 90) ctx.fillRect(x - 6, y, 38, 8); }
    if (st === 'stone') { ctx.fillStyle = col2; for (let i = 0; i < 4; i++) { const x = R() * W; for (let k = 0; k < 40; k++) ctx.fillRect(Math.round(x + Math.sin(k / 3) * 3), k * 6, 2, 4); } }
  } else if (st === 'metal') {
    for (let i = 0; i < 4; i++) {
      const x = R() * W, y = R() * H, rr = 50 + R() * 50;
      pcircle(ctx, x, y, rr, col); pcircle(ctx, x, y, rr * 0.55, shade(th.bg2, 0.05)); pcircle(ctx, x, y, rr * 0.2, col2);
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; ctx.fillStyle = col; ctx.fillRect(Math.round(x + Math.cos(a) * rr) - 6, Math.round(y + Math.sin(a) * rr) - 6, 12, 12); }
    }
  } else if (st === 'wood') {
    for (let i = 0; i < 4; i++) { const x = i * 180 + R() * 40; ctx.fillRect(x, 0, 18, H); }
    ctx.fillStyle = col2; for (let i = 0; i < 6; i++) { const x = R() * W, y = R() * H; ctx.fillRect(x, y, 60, 4); ctx.fillRect(x + 6, y + 4, 3, 20); ctx.fillRect(x + 50, y + 4, 3, 20); }
  } else if (st === 'garden') {
    for (let i = 0; i < 7; i++) { const x = R() * W, h = 120 + R() * 200; ctx.fillStyle = col; ctx.fillRect(x, H - h, 8, h); pcircle(ctx, x + 4, H - h, 30 + R() * 20, col); ctx.fillStyle = col2; for (let k = 0; k < 6; k++) ctx.fillRect(x - 20 + R() * 48, H - h - 20 + R() * 40, 3, 3); }
  } else if (st === 'rock') {
    for (let i = 0; i < 10; i++) {
      const x = R() * W, y = R() * H;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 14 + R() * 10, y - 60 - R() * 40); ctx.lineTo(x + 30, y); ctx.fill();
      ctx.fillStyle = R() < 0.5 ? '#2a5a7a' : '#3a2a6a'; ctx.fillRect(x + 12, y - 30, 3, 10);
    }
  } else if (st === 'shelf') {
    for (let i = 0; i < 3; i++) { const x = i * 250 + R() * 60; ctx.fillStyle = col; ctx.fillRect(x, 0, 120, H); ctx.fillStyle = shade(th.bg2, 0.05); for (let y = 10; y < H; y += 40) ctx.fillRect(x + 6, y, 108, 32); ctx.fillStyle = col2; for (let y = 10; y < H; y += 40) for (let k = 0; k < 12; k++) ctx.fillRect(x + 8 + k * 9, y + 6 + (k % 3) * 2, 6, 26 - (k % 3) * 2); }
  } else if (st === 'bronze') {
    for (let i = 0; i < 3; i++) { const x0 = 80 + i * 250; for (let k = 0; k < 70; k++) { const yy = k * 6, xx = x0 + Math.sin(k / 14) * 50; ctx.fillStyle = col; ctx.fillRect(Math.round(xx), yy, 18, 6); ctx.fillStyle = col2; ctx.fillRect(Math.round(xx), yy, 3, 6); } }
  }
  midCache[region] = c;
  return c;
}

// Ambient particles drawn in screen space (cheap, deterministic per frame).
function drawAmbient(ctx, region, cx, cy) {
  const f = G.frame, st = themeOf(region).style;
  const kind = { garden: 'leaf', rock: 'spark', stone: 'bubble', shelf: 'paper', metal: 'ember', bronze: 'dust', wood: 'dust', brick: 'dust' }[st] || 'dust';
  const n = kind === 'dust' ? 22 : 16;
  for (let i = 0; i < n; i++) {
    const seed = i * 7919;
    const sp = 0.15 + (i % 5) * 0.06;
    let x, y, col, w = 1, h = 1;
    if (kind === 'leaf') { x = (seed + f * sp * 2 + Math.sin(f / 40 + i) * 20 - cx * 0.7) % VIEW_W; y = (seed * 3 + f * sp * 3 - cy * 0.7) % VIEW_H; col = i % 2 ? '#8ab060' : '#c8d890'; w = 2; }
    else if (kind === 'spark') { x = (seed - cx * 0.8) % VIEW_W; y = (seed * 5 - cy * 0.8 - f * sp) % VIEW_H; col = (f + i * 13) % 60 < 30 ? '#a8f0ff' : '#5a8ab0'; }
    else if (kind === 'bubble') { x = (seed + Math.sin(f / 30 + i) * 6 - cx * 0.8) % VIEW_W; y = (seed * 5 - f * sp * 2 - cy * 0.8) % VIEW_H; col = '#7ab8d0'; }
    else if (kind === 'paper') { x = (seed + f * sp - cx * 0.8) % VIEW_W; y = (seed * 3 + f * sp * 1.5 + Math.sin(f / 25 + i) * 8 - cy * 0.8) % VIEW_H; col = '#d8ccb0'; w = 2; h = (f >> 4) % 2 ? 1 : 2; }
    else if (kind === 'ember') { x = (seed + Math.sin(f / 20 + i) * 4 - cx * 0.8) % VIEW_W; y = (seed * 3 - f * sp * 2.5 - cy * 0.8) % VIEW_H; col = (i % 3) ? '#ff9040' : '#ffd080'; }
    else { x = (seed + f * sp * 0.5 + Math.sin(f / 50 + i) * 10 - cx * 0.6) % VIEW_W; y = (seed * 3 + f * sp * 0.3 - cy * 0.6) % VIEW_H; col = '#a89880'; }
    x = (x + VIEW_W * 10) % VIEW_W; y = (y + VIEW_H * 10) % VIEW_H;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }
  ctx.globalAlpha = 1;
}

// --------------------------------------------------------------- frame
export function drawWorld(ctx, drawEntities) {
  const r = G.room;
  const cam = G.cam;
  const th = themeOf(r.region);
  const sx = cam.shakeX || 0, sy = cam.shakeY || 0;
  const cx = Math.round(cam.x + sx), cy = Math.round(cam.y + sy);
  // Background
  const bg = regionBackground(r.region);
  const par = 0.3;
  const bx = -(((cx * par) % bg.width) + bg.width) % bg.width, by = -(((cy * par) % bg.height) + bg.height) % bg.height;
  for (let ox = bx; ox < VIEW_W; ox += bg.width) for (let oy = by; oy < VIEW_H; oy += bg.height) ctx.drawImage(bg, ox, oy);
  // Mid layer: larger silhouettes with stronger parallax for depth.
  const mid = regionMidground(r.region);
  const par2 = 0.55;
  const mx = -(((cx * par2) % mid.width) + mid.width) % mid.width, my = -(((cy * par2) % mid.height) + mid.height) % mid.height;
  ctx.globalAlpha = 0.8;
  for (let ox = mx; ox < VIEW_W; ox += mid.width) for (let oy = my; oy < VIEW_H; oy += mid.height) ctx.drawImage(mid, ox, oy);
  ctx.globalAlpha = 1;
  drawAmbient(ctx, r.region, cx, cy);
  // Neighbouring rooms' tiles may peek in during shake; draw current room only.
  for (const rr of visibleRooms(cx, cy)) {
    if (rr.dirty || !rr.canvas) buildRoomCanvas(rr);
    ctx.drawImage(rr.bgCanvas, rr.px - cx, rr.py - cy);
  }
  ctx.save();
  ctx.translate(-cx, -cy);
  drawEntities(ctx, 'behind');
  ctx.restore();
  for (const rr of visibleRooms(cx, cy)) ctx.drawImage(rr.canvas, rr.px - cx, rr.py - cy);
  ctx.save();
  ctx.translate(-cx, -cy);
  drawDynamicTiles(ctx, r, cx, cy, th);
  drawEntities(ctx, 'main');
  drawWater(ctx, r, cx, cy, th);
  ctx.restore();
}

function visibleRooms(cx, cy) {
  const out = [G.room];
  return out;
}

function drawDynamicTiles(ctx, r, cx, cy, th) {
  const x0 = Math.max(0, Math.floor((cx - r.px) / TILE) - 1), x1 = Math.min(r.tw - 1, Math.floor((cx + VIEW_W - r.px) / TILE) + 1);
  const y0 = Math.max(0, Math.floor((cy - r.py) / TILE) - 1), y1 = Math.min(r.th - 1, Math.floor((cy + VIEW_H - r.py) / TILE) + 1);
  const f = G.frame;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = r.tiles[y * r.tw + x];
    const px = r.px + x * TILE, py = r.py + y * TILE;
    if (t === T.MEMBRANE) {
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(f / 20 + x + y);
      ctx.fillStyle = '#3a2060'; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#9a70e0';
      for (let k = 0; k < 4; k++) { const yy = (f / 2 + k * 4 + x * 3) % 16; ctx.fillRect(px + ((k * 5 + y * 3) % 14), py + Math.floor(yy), 2, 1); }
      ctx.fillStyle = '#d0b8ff'; ctx.fillRect(px + 7 + Math.round(Math.sin(f / 15 + y) * 3), py, 1, TILE);
      ctx.globalAlpha = 1;
    } else if (t === T.BOSSGATE && G.bossLock) {
      ctx.fillStyle = '#120c18'; ctx.fillRect(px + 3, py, 10, TILE);
      ctx.fillStyle = '#b0a080'; ctx.fillRect(px + 4, py, 2, TILE); ctx.fillRect(px + 10, py, 2, TILE);
      ctx.fillStyle = '#7a6a50'; ctx.fillRect(px + 7, py, 2, TILE);
    } else if (t === T.SEAL) {
      const open = G.save.forks.length >= 5;
      if (open) continue;
      ctx.fillStyle = '#2a2010'; ctx.fillRect(px, py, TILE, TILE);
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(f / 25 + y);
      ctx.fillStyle = '#ffe9a8'; ctx.fillRect(px + 2, py, 1, TILE); ctx.fillRect(px + 13, py, 1, TILE);
      if ((x + y) % 3 === 0) { ctx.fillRect(px + 6, py + 6, 4, 4); }
      ctx.globalAlpha = 1;
    } else if (t === T.CONV_R || t === T.CONV_L) {
      const d = t === T.CONV_R ? 1 : -1;
      ctx.fillStyle = '#2a2024'; ctx.fillRect(px, py, TILE, 4);
      ctx.fillStyle = '#c8a060';
      for (let i = 0; i < 4; i++) ctx.fillRect(px + ((i * 4 + Math.floor(f / 2) * d) % 16 + 16) % 16, py + 1, 2, 2);
    } else if (t === T.VENT && f % 4 === 0) {
      G.fx.push({ kind: 'p', x: px + 2 + Math.random() * 12, y: py + 8, vx: 0, vy: -2 - Math.random() * 1.5, color: th.accent, t: 0, life: 40 + Math.random() * 40, grav: 0, size: 1 });
    }
  }
}

function drawWater(ctx, r, cx, cy, th) {
  const x0 = Math.max(0, Math.floor((cx - r.px) / TILE)), x1 = Math.min(r.tw - 1, Math.floor((cx + VIEW_W - r.px) / TILE) + 1);
  const y0 = Math.max(0, Math.floor((cy - r.py) / TILE)), y1 = Math.min(r.th - 1, Math.floor((cy + VIEW_H - r.py) / TILE) + 1);
  const f = G.frame;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = r.tiles[y * r.tw + x];
    if (t !== T.WATER && t !== T.SHALLOW) continue;
    const px = r.px + x * TILE, py = r.py + y * TILE;
    const above = y === 0 ? World.tileAt(r.tx0 + x, r.ty0 - 1) : r.tiles[(y - 1) * r.tw + x];
    const surface = above !== t;
    if (t === T.WATER) {
      // deep, silent water: dark and still
      ctx.globalAlpha = 0.86; ctx.fillStyle = '#081018'; ctx.fillRect(px, py, TILE, TILE); ctx.globalAlpha = 1;
      if (surface) {
        ctx.fillStyle = '#3a5a6a'; ctx.fillRect(px, py, TILE, 1);
        ctx.fillStyle = '#6a8a9a';
        for (let i = 0; i < TILE; i += 4) if (((px + i) / 4 + Math.floor(f / 40)) % 5 === 0) ctx.fillRect(px + i, py, 3, 1);
      }
    } else {
      ctx.globalAlpha = 0.38; ctx.fillStyle = '#3a8aaa'; ctx.fillRect(px, py + (surface ? 4 : 0), TILE, surface ? 12 : TILE); ctx.globalAlpha = 1;
      if (surface) {
        ctx.fillStyle = '#a8e8ff';
        for (let i = 0; i < TILE; i += 2) ctx.fillRect(px + i, py + 4 + Math.round(Math.sin((px + i) / 9 + f / 18)), 2, 1);
      }
    }
  }
}

// Darkness / vignette overlay
let vig = null;
export function drawVignette(ctx, dark) {
  if (!vig) {
    const [c, x] = makeCanvas(VIEW_W, VIEW_H);
    const g = x.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = g; x.fillRect(0, 0, VIEW_W, VIEW_H);
    vig = c;
  }
  ctx.drawImage(vig, 0, 0);
  if (dark) {
    const p = G.player;
    const px = p.cx - G.cam.x, py = p.cy - G.cam.y;
    const g = ctx.createRadialGradient(px, py, 30, px, py, 170);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${dark})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

export function updateCamera(snap = false) {
  const r = G.room, p = G.player, cam = G.cam;
  cam.look = cam.look === undefined ? 0 : cam.look;
  cam.look += ((p.face * 28) - cam.look) * 0.04;
  let lookY = 0;
  if (p.onGround && p.healT === 0 && Math.abs(p.vx) < 0.1) {
    if (cam.lookT === undefined) cam.lookT = 0;
  }
  const tx = p.cx + cam.look - VIEW_W / 2;
  const ty = p.cy - VIEW_H / 2 - 16 + lookY + (p.vy > 4 ? 30 : 0);
  const minX = r.px, maxX = r.px + r.pw - VIEW_W, minY = r.py, maxY = r.py + r.ph - VIEW_H;
  const cxT = clamp(tx, minX, Math.max(minX, maxX)), cyT = clamp(ty, minY, Math.max(minY, maxY));
  if (snap) { cam.x = cxT; cam.y = cyT; }
  else {
    cam.x += (cxT - cam.x) * 0.14;
    cam.y += (cyT - cam.y) * (p.vy > 3 ? 0.25 : 0.12);
  }
  cam.x = clamp(cam.x, minX, Math.max(minX, maxX));
  cam.y = clamp(cam.y, minY, Math.max(minY, maxY));
  if (cam.shake > 0) {
    cam.shakeX = (Math.random() - 0.5) * cam.shake; cam.shakeY = (Math.random() - 0.5) * cam.shake;
    cam.shake = Math.max(0, cam.shake - 0.5);
  } else { cam.shakeX = 0; cam.shakeY = 0; }
}
