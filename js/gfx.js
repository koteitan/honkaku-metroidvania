// Pixel drawing helpers: integer rects with automatic 1px outline.
export const OUTLINE = '#120c18';

// A tiny builder: add parts, then draw outlines first and fills second.
export class Figure {
  constructor(ox, oy, flip) {
    this.ox = Math.round(ox); this.oy = Math.round(oy); this.flip = flip; this.parts = [];
  }
  r(x, y, w, h, color, outline = true) {
    this.parts.push({ x, y, w, h, color, outline });
    return this;
  }
  draw(ctx, outlineColor = OUTLINE) {
    const P = this.parts;
    ctx.fillStyle = outlineColor;
    for (const p of P) {
      if (!p.outline) continue;
      const x = this.flip ? -p.x - p.w : p.x;
      ctx.fillRect(this.ox + x - 1, this.oy + p.y - 1, p.w + 2, p.h + 2);
    }
    for (const p of P) {
      const x = this.flip ? -p.x - p.w : p.x;
      ctx.fillStyle = p.color;
      ctx.fillRect(this.ox + x, this.oy + p.y, p.w, p.h);
    }
  }
}

// Draw a pixel-art sprite from strings + palette. Cached per (rows, palette) key.
const cache = new Map();
export function sprite(key, rows, pal) {
  let c = cache.get(key);
  if (c) return c;
  const h = rows.length, w = rows[0].length;
  c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const ch = rows[j][i];
      if (ch === '.' || ch === ' ') continue;
      x.fillStyle = pal[ch] || '#f0f';
      x.fillRect(i, j, 1, 1);
    }
  cache.set(key, c);
  return c;
}

export function drawSprite(ctx, img, x, y, flip = false) {
  x = Math.round(x); y = Math.round(y);
  if (!flip) { ctx.drawImage(img, x, y); return; }
  ctx.save();
  ctx.translate(x + img.width, y);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// Pixel circle (no anti-aliasing).
export function pcircle(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
    ctx.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}

export function pring(ctx, cx, cy, r, color, thick = 1) {
  ctx.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  const steps = Math.max(16, Math.floor(r * 6));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), thick, thick);
  }
}

// Pixel line (Bresenham).
export function pline(ctx, x0, y0, x1, y1, color, t = 1) {
  ctx.fillStyle = color;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 2000; n++) {
    ctx.fillRect(x0, y0, t, t);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// A church-bell silhouette: dome, waist and flared lip. Centre x, top y, height H.
export function drawBellShape(g, cx, top, H, body = '#2a2010', edge = '#3a2e16', lip = '#3a2c14', swing = 0) {
  const prof = (k) => (k < 0.12 ? 0.44 * Math.sqrt(k / 0.12) : 0.44 + 0.13 * (k - 0.12) + 0.85 * Math.pow(Math.max(0, k - 0.55) / 0.45, 2.4));
  for (let y = 0; y < H; y++) {
    const k = y / H;
    const w = Math.round(prof(k) * H);
    const x = Math.round(cx - w + swing * (1 - k));
    g.fillStyle = k > 0.93 ? lip : body;
    g.fillRect(x, top + y, w * 2, 1);
    g.fillStyle = edge; g.fillRect(x, top + y, Math.max(1, Math.round(H / 50)), 1);
  }
  const cw = Math.round(H * 0.1);
  g.fillStyle = lip; g.fillRect(Math.round(cx - cw + swing), top - Math.round(H * 0.1), cw * 2, Math.round(H * 0.11));
  for (const kk of [0.29, 0.33, 0.79]) { const w = Math.round(prof(kk) * H); g.fillStyle = edge; g.fillRect(Math.round(cx - w + 2 + swing * (1 - kk)), top + Math.round(kk * H), w * 2 - 4, Math.max(1, Math.round(H / 70))); }
}
