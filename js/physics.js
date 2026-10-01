// Axis-separated AABB movement against the global tile grid.
import { TILE } from './util.js';
import { T, isSolidTile } from './tiles.js';
import { World } from './world.js';
import { G } from './state.js';

export function solidCtx(body) {
  return {
    phasing: !!(body && body.phasing),
    bossLock: G.bossLock,
    forks: G.save ? G.save.forks.length : 0,
  };
}

// Dynamic solid rectangles (gates, latches) registered by entities each frame.
export function dynSolids() { return G.dynSolids; }

export function rectSolid(x, y, w, h, body, ignorePlatforms = true) {
  const ctx = solidCtx(body);
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (isSolidTile(World.tileAt(tx, ty), ctx)) return true;
  for (const s of G.dynSolids)
    if (!s.platform && x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) return true;
  return false;
}

// Is there a one-way platform top exactly at row boundary under the body moving down?
function platformBelow(x, w, oldBottom, newBottom) {
  const ty = Math.floor((newBottom - 0.001) / TILE);
  const top = ty * TILE;
  if (oldBottom > top + 0.01 || newBottom < top) return null;
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
  for (let tx = x0; tx <= x1; tx++) if (World.tileAt(tx, ty) === T.PLATFORM) return top;
  return null;
}

// Moving platforms registered as dynamic solids with platform:true.
function dynPlatformBelow(x, w, oldBottom, newBottom) {
  for (const s of G.dynSolids) {
    if (!s.platform) continue;
    if (x + w > s.x && x < s.x + s.w && oldBottom <= s.y + 0.5 && newBottom >= s.y) return s.y;
  }
  return null;
}

// Move body {x,y,w,h,vx,vy}. Sets body.onGround, hitWall (-1/0/1), hitCeil.
export function moveBody(b, opts = {}) {
  b.hitWall = 0; b.hitCeil = false;
  const wasGround = b.onGround;
  b.onGround = false;
  // Horizontal
  let dx = b.vx;
  const stepX = Math.sign(dx);
  while (dx !== 0) {
    const s = Math.abs(dx) > 1 ? stepX : dx;
    if (rectSolid(b.x + s, b.y, b.w, b.h, b)) {
      // Small step-up assist is not used: walls are walls.
      b.hitWall = stepX; b.vx = 0; break;
    }
    b.x += s; dx -= s;
  }
  // Vertical
  let dy = b.vy;
  const stepY = Math.sign(dy);
  while (dy !== 0) {
    const s = Math.abs(dy) > 1 ? stepY : dy;
    if (rectSolid(b.x, b.y + s, b.w, b.h, b)) {
      if (stepY > 0) {
        b.onGround = true;
        const ny = Math.round(b.y);
        if (!rectSolid(b.x, ny, b.w, b.h, b)) b.y = ny;
      }
      else b.hitCeil = true;
      b.vy = 0; break;
    }
    if (s > 0 && !opts.dropThrough) {
      let top = platformBelow(b.x, b.w, b.y + b.h, b.y + b.h + s);
      if (top === null) top = dynPlatformBelow(b.x, b.w, b.y + b.h, b.y + b.h + s);
      if (top !== null) { b.y = top - b.h; b.onGround = true; b.vy = 0; break; }
    }
    b.y += s; dy -= s;
  }
  // Ground probe when not moving vertically
  if (!b.onGround && b.vy >= 0) {
    if (rectSolid(b.x, b.y + 1, b.w, b.h, b)) b.onGround = true;
    else if (dynPlatformBelow(b.x, b.w, b.y + b.h, b.y + b.h + 1) !== null) b.onGround = true;
    else if (!opts.dropThrough) {
      const bottom = b.y + b.h;
      if (Math.abs(bottom - Math.round(bottom / TILE) * TILE) < 0.01) {
        const ty = Math.round(bottom / TILE);
        const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 0.001) / TILE);
        for (let tx = x0; tx <= x1; tx++) if (World.tileAt(tx, ty) === T.PLATFORM) { b.onGround = true; break; }
      }
    }
  }
  b.wasGround = wasGround;
}

// Tile type queries over a rect.
export function rectHasTile(x, y, w, h, tile) {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (World.tileAt(tx, ty) === tile) return { tx, ty };
  return null;
}

export function tilesInRect(x, y, w, h, fn) {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) fn(tx, ty, World.tileAt(tx, ty));
}

// Spike hit test with a forgiving inset.
export function touchesSpike(b) {
  let hit = false;
  tilesInRect(b.x + 2, b.y + 3, b.w - 4, b.h - 4, (tx, ty, t) => { if (t === T.SPIKE) hit = true; });
  // Deep "silent water" works like spikes: sinking in it sends you back.
  if (!hit) tilesInRect(b.x + 2, b.y + b.h * 0.5, b.w - 4, b.h * 0.5 - 2, (tx, ty, t) => { if (t === T.WATER) hit = true; });
  return hit;
}

// No swimming in this game (level.md §2.4); kept for compatibility.
export function inWater(b) { return false; }
export function inShallow(b) { return !!rectHasTile(b.x, b.y + b.h - 4, b.w, 4, T.SHALLOW); }

// Is there an updraft column at this rect? A vent pushes up until it meets a solid tile.
export function inUpdraft(b) {
  const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 0.001) / TILE);
  const ty0 = Math.floor((b.y + b.h / 2) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = ty0; ty < ty0 + 40; ty++) {
      const t = World.tileAt(tx, ty);
      if (t === T.VENT) return true;
      if (isSolidTile(t, solidCtx(null)) || t === T.PLATFORM) break;
    }
  }
  return false;
}
