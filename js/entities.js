// Enemies, pickups, shrines, NPCs, projectiles, gates and other room objects.
import { TILE, VIEW_W, VIEW_H, overlap, clamp, approach, hash2 } from './util.js';
import { G } from './state.js';
import { moveBody, rectSolid, tilesInRect } from './physics.js';
import { T, isSolidTile } from './tiles.js';
import { World } from './world.js';
import { sfx } from './audio.js';
import { burst, dust, ring, spawnFx, text as fxText } from './fx.js';
import { Figure, pcircle, pring, pline } from './gfx.js';
import { input } from './input.js';
import { ui } from './ui.js';
import { TXT, npcScript, seq, S as S2 } from './text.js';
import { writeSave } from './save.js';
import { makeBoss, RingStone } from './bosses.js';
import { themeOf } from './render.js';

import { Ent } from './ent.js';
export { Ent };

// ------------------------------------------------------------------ enemies
// Numbers follow design.md §4.3.
const solidAt = (x, y) => isSolidTile(World.tileAt(Math.floor(x / TILE), Math.floor(y / TILE)), { bossLock: G.bossLock, forks: G.save.forks.length });
const floorAt = (x, y) => { const t = World.tileAt(Math.floor(x / TILE), Math.floor(y / TILE)); return solidAt(x, y) || t === T.PLATFORM; };
const spikeAt = (x, y) => World.tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) === T.SPIKE;
const onScreen = (e, m = 0) => e.x + e.w > G.cam.x - m && e.x < G.cam.x + VIEW_W + m && e.y + e.h > G.cam.y - m && e.y < G.cam.y + VIEW_H + m;

// ゼンマイ虫: a wind-up beetle. Walks 0.6; every 240f runs down for 60f, then rushes at 1.4 for 120f.
class Walker extends Ent {
  constructor(x, y) {
    super(x - 7, y + 16 - 12, 14, 12);
    this.hittable = true; this.hp = this.maxHp = 3; this.contact = 1; this.face = -1;
    this.bloodColor = '#c09050'; this.cycle = Math.floor(hash2(x, y) * 200);
    // Ceiling walker if there is a ceiling right above and no floor below.
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    this.ceil = isSolidTile(World.tileAt(tx, ty - 1), null) && !isSolidTile(World.tileAt(tx, ty + 1), null);
    if (this.ceil) this.y = ty * TILE;
  }
  onHurt(dmg, dir) { this.vx = dir * 1.5; this.kb = 6; }
  update() {
    this.t++; this.cycle++;
    if (this.flash > 0) this.flash--;
    const c = this.cycle % 420;
    const speed = c < 240 ? 0.6 : c < 300 ? 0 : 1.4;
    this.keySpeed = c < 200 ? 6 : c < 240 ? 14 : c < 300 ? 0 : 3;
    if (this.kb > 0) this.kb--;
    else this.vx = approach(this.vx, this.face * speed, 0.1);
    if (this.ceil) {
      this.vy = 0;
      this.x += this.vx;
      const ahead = this.face > 0 ? this.x + this.w + 1 : this.x - 1;
      if (!solidAt(ahead, this.y - 2) || solidAt(ahead, this.y + 4)) { this.face *= -1; this.x -= this.vx; this.vx = 0; }
    } else {
      this.vy = Math.min(this.vy + 0.35, 6);
      moveBody(this);
      if (this.onGround && this.kb <= 0) {
        const ahead = this.face > 0 ? this.x + this.w + 1 : this.x - 1;
        if (this.hitWall || !floorAt(ahead, this.y + this.h + 2) || spikeAt(ahead, this.y + this.h - 4)) { this.face *= -1; this.vx = 0; }
      }
    }
    this.touchPlayer();
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.ceil ? this.y : this.y + this.h, this.face > 0);
    const s = this.ceil ? -1 : 1; // flip vertically when on the ceiling
    const R = (x, y, w, h, c, o) => f.r(x, s > 0 ? y : -y - h, w, h, c, o);
    const step = this.vx !== 0 ? Math.floor(this.t / (this.keySpeed > 6 ? 4 : 8)) % 2 : 0;
    const shell = this.flashColor('#a86a3a'), shellL = this.flashColor('#d89a5a');
    R(-6, -2, 2, 2 - step, '#3a2a20'); R(-1, -2, 2, 2 - (1 - step), '#3a2a20'); R(4, -2, 2, 2 - step, '#3a2a20');
    R(-7, -9, 14, 7, shell);
    R(-5, -10, 10, 1, shell);
    R(-5, -8, 5, 2, shellL, false);
    R(-9, -6, 3, 3, this.flashColor('#5a4a40'));
    R(-9, -5, 1, 1, '#ffd060', false);
    const k = this.keySpeed ? Math.floor(this.t / this.keySpeed) % 3 : 1;
    R(-1, -13, 2, 3, '#c8c0a0');
    R(k === 0 ? -3 : k === 1 ? -2 : -1, -15, k === 1 ? 4 : k === 0 ? 6 : 2, 2, '#e8e0c0');
    f.draw(ctx);
  }
}

// 鈴蝙蝠: hangs; within 6 tiles it rings 30f, then dives in an arc toward where you were (3.0, ~50f), returns, rests 90f.
class Bat extends Ent {
  constructor(x, y) {
    super(x - 6, y + 2, 12, 10);
    this.hittable = true; this.hp = this.maxHp = 2; this.contact = 1;
    this.hx = this.x; this.hy = this.y; this.state = 'hang'; this.timer = 0; this.bloodColor = '#b0a0e0';
  }
  onHurt(dmg, dir) { this.vx = dir * 2; this.vy = -1; if (this.state === 'hang') { this.state = 'return'; } }
  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    const p = G.player;
    switch (this.state) {
      case 'hang':
        if (Math.hypot(p.cx - this.cx, p.cy - this.cy) < 6 * TILE) { this.state = 'ring'; this.timer = 30; }
        break;
      case 'ring':
        if (this.timer % 8 === 0) sfx('clink');
        if (--this.timer <= 0) {
          this.state = 'dive'; this.timer = 50;
          const dx = p.cx - this.cx, dy = p.cy - this.cy, d = Math.hypot(dx, dy) || 1;
          this.vx = (dx / d) * 3.0; this.vy = (dy / d) * 3.0 + 1.2; this.face = Math.sign(dx) || 1;
        }
        break;
      case 'dive':
        this.vy -= 0.05; // curve back up
        this.x += this.vx; this.y += this.vy;
        if (rectSolid(this.x, this.y, this.w, this.h) || --this.timer <= 0) { this.x -= this.vx; this.y -= this.vy; this.state = 'return'; }
        break;
      case 'return': {
        const dx = this.hx - this.x, dy = this.hy - this.y, d = Math.hypot(dx, dy);
        if (d < 2) { this.x = this.hx; this.y = this.hy; this.state = 'rest'; this.timer = 90; break; }
        this.vx = approach(this.vx, (dx / d) * 1.4, 0.1); this.vy = approach(this.vy, (dy / d) * 1.4, 0.1);
        this.x += this.vx; this.y += this.vy;
        break;
      }
      case 'rest': if (--this.timer <= 0) this.state = 'hang'; break;
    }
    this.touchPlayer();
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.cy, this.face < 0);
    const flying = this.state === 'dive' || this.state === 'return';
    const flap = flying ? Math.floor(this.t / 4) % 2 : 2;
    const c = this.flashColor('#7060a8'), c2 = this.flashColor('#c8b8f0');
    if (!flying) {
      const sh = this.state === 'ring' ? (this.t % 4 < 2 ? -1 : 1) : 0;
      f.r(-3 + sh, -6, 6, 9, c); f.r(-1, -8, 2, 2, '#c8c0a0'); f.r(-1 + sh, 3, 2, 2, this.state === 'ring' ? '#ffe080' : c2);
      f.draw(ctx); return;
    }
    f.r(-3, -4, 6, 7, c);
    f.r(-4, 1, 8, 2, c2);
    f.r(-1, 3, 2, 2, '#e8e0c0');
    if (flap === 0) { f.r(-9, -6, 6, 2, c); f.r(3, -6, 6, 2, c); f.r(-10, -8, 2, 2, c); f.r(8, -8, 2, 2, c); }
    else { f.r(-9, -1, 6, 2, c); f.r(3, -1, 6, 2, c); f.r(-10, 1, 2, 2, c); f.r(8, 1, 2, 2, c); }
    f.r(-2, -2, 1, 1, '#ff6060', false); f.r(1, -2, 1, 1, '#ff6060', false);
    f.draw(ctx);
  }
}

// 錆砲: fixed turret. Every 120f fires a 2.0 px/f aimed bullet; glows red 40f before. Only fires on screen.
class Turret extends Ent {
  constructor(x, y) {
    super(x - 8, y, 16, 16);
    this.hittable = true; this.hp = this.maxHp = 4; this.contact = 1; this.heavy = true;
    this.cool = 60 + Math.floor(hash2(x, y) * 60);
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const s = (dx, dy) => isSolidTile(World.tileAt(tx + dx, ty + dy), null);
    this.mount = s(0, 1) ? 'down' : s(0, -1) ? 'up' : s(-1, 0) ? 'left' : s(1, 0) ? 'right' : 'down';
    this.bloodColor = '#b06040';
    this.aim = this.mount === 'up' ? Math.PI / 2 : -Math.PI / 2;
  }
  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    const p = G.player;
    if (!onScreen(this, -8)) return;
    if (this.cool > 0) this.cool--;
    if (this.cool > 40) this.aim = Math.atan2(p.cy - this.cy, p.cx - this.cx);
    if (this.cool === 40) sfx('fire');
    if (this.cool === 0) {
      this.cool = 120;
      spawnProjectile({ x: this.cx + Math.cos(this.aim) * 9, y: this.cy + Math.sin(this.aim) * 9, vx: Math.cos(this.aim) * 2.0, vy: Math.sin(this.aim) * 2.0, owner: 'enemy', life: 300 });
      sfx('fire');
    }
    this.touchPlayer();
  }
  draw(ctx) {
    const cx = Math.round(this.cx), cy = Math.round(this.cy);
    const base = this.flashColor('#7a4a3a'), dark = '#4a2a24';
    const m = this.mount;
    const plate = { down: [-8, 4, 16, 4], up: [-8, -8, 16, 4], left: [-8, -8, 4, 16], right: [4, -8, 4, 16] }[m];
    ctx.fillStyle = '#120c18'; ctx.fillRect(cx + plate[0] - 1, cy + plate[1] - 1, plate[2] + 2, plate[3] + 2);
    ctx.fillStyle = dark; ctx.fillRect(cx + plate[0], cy + plate[1], plate[2], plate[3]);
    pcircle(ctx, cx, cy, 6, '#120c18');
    pcircle(ctx, cx, cy, 5, base);
    const warn = this.cool <= 40 && this.cool > 0;
    pline(ctx, cx, cy, cx + Math.cos(this.aim) * 9, cy + Math.sin(this.aim) * 9, '#120c18', 3);
    pline(ctx, cx, cy, cx + Math.cos(this.aim) * 8, cy + Math.sin(this.aim) * 8, warn && this.cool % 6 < 3 ? '#ff4030' : '#a07060', 2);
    ctx.fillStyle = warn ? '#ff4030' : '#e06040';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }
}

// 鐘蛙: every 90f puffs its throat for 20f and leaps (~3 tiles high, 4-6 across). Landing ripple.
class Frog extends Ent {
  constructor(x, y) {
    super(x - 7, y + 4, 14, 12);
    this.hittable = true; this.hp = this.maxHp = 5; this.contact = 1; this.cool = 60 + Math.floor(hash2(x, y) * 30); this.bloodColor = '#80c0a0';
  }
  onHurt(dmg, dir) { this.vx = dir * 1.5; }
  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    this.vy = Math.min(this.vy + 0.32, 6);
    const wasG = this.onGround;
    if (this.onGround) {
      this.vx = approach(this.vx, 0, 0.3);
      if (this.cool > 0) { if (this.near(220, 140) || this.cool > 20) this.cool--; }
      else {
        this.face = Math.sign(G.player.cx - this.cx) || 1;
        this.vy = -5.6; this.vx = this.face * (1.8 + Math.random() * 0.6); this.cool = 90; sfx('clink');
      }
    }
    moveBody(this);
    if (this.hitWall) this.vx = -this.vx * 0.5;
    if (this.onGround && !wasG && this.t > 5) {
      for (const d of [-1, 1]) G.ents.push(new Ripple(this.cx + d * 8, this.y + this.h, d));
    }
    this.touchPlayer();
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + this.h, this.face > 0);
    const c = this.flashColor('#4a8a70'), cl = this.flashColor('#8ad0a8');
    const puff = this.onGround && this.cool < 20;
    const air = !this.onGround;
    f.r(-7, -9, 14, 9, c);
    f.r(-5, -11, 10, 2, c);
    f.r(-5, -8, 4, 2, cl, false);
    f.r(-7, -1, 14, 1, '#c8a050', false);
    if (puff) f.r(-10, -6, 5, 5, '#e8c0a0');
    if (air) { f.r(-9, -2, 3, 4, c); f.r(6, -2, 3, 4, c); }
    else { f.r(-9, -3, 3, 3, c); f.r(6, -3, 3, 3, c); }
    f.r(-6, -12, 3, 3, '#e8e0c0'); f.r(-5, -11, 1, 1, '#120c18', false);
    f.draw(ctx);
  }
}
class Ripple extends Ent {
  constructor(x, y, dir) { super(x - 6, y - 6, 12, 6); this.vx = dir * 1.2; this.contact = 1; }
  update() { this.t++; this.x += this.vx; if (this.t > 10) this.dead = true; this.touchPlayer(); }
  draw(ctx) { ctx.globalAlpha = 1 - this.t / 10; ctx.fillStyle = '#a8f0e0'; ctx.fillRect(Math.round(this.x), Math.round(this.y + 4), 12, 2); ctx.globalAlpha = 1; }
}

// 天井しずく: when you pass within 1 tile below, a shadow shows for 24f, then it falls at 6.0.
class Dropper extends Ent {
  constructor(x, y) {
    super(x - 5, y, 10, 12);
    this.hittable = true; this.hp = this.maxHp = 1; this.contact = 1;
    this.hx = this.x; this.hy = this.y; this.state = 'hang'; this.timer = 0; this.bloodColor = '#90c8f0';
    this.shadowY = this.findFloor();
  }
  findFloor() { let ty = Math.floor((this.y + 14) / TILE); for (let i = 0; i < 30; i++, ty++) if (floorAt(this.cx, ty * TILE + 1)) return ty * TILE; return this.y + 100; }
  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    const p = G.player;
    if (this.state === 'hang') {
      if (Math.abs(p.cx - this.cx) < 20 && p.y > this.y) { this.state = 'shake'; this.timer = 24; }
    } else if (this.state === 'shake') {
      if (--this.timer <= 0) { this.state = 'fall'; this.vy = 6.0; }
    } else if (this.state === 'fall') {
      this.vy = 6.0;
      moveBody(this);
      if (this.onGround) this.splash();
    } else if (this.state === 'gone') {
      if (--this.timer <= 0) { this.state = 'hang'; this.x = this.hx; this.y = this.hy; this.hp = 1; this.hittable = true; }
      return;
    }
    this.touchPlayer();
  }
  splash() {
    burst(this.cx, this.y + this.h, '#90c8f0', 10, 2, 18);
    sfx('clink');
    this.state = 'gone'; this.timer = 180; this.hittable = false;
  }
  kill() { super.kill(); this.dead = false; this.state = 'gone'; this.timer = 180; this.hittable = false; }
  draw(ctx) {
    if (this.state === 'gone') return;
    if (this.state === 'shake') { ctx.globalAlpha = 0.4; ctx.fillStyle = '#000'; ctx.fillRect(Math.round(this.cx) - 5, this.shadowY - 2, 10, 2); ctx.globalAlpha = 1; }
    const sx = this.state === 'shake' ? (this.t % 4 < 2 ? -1 : 1) : 0;
    const f = new Figure(this.cx + sx, this.y, false);
    const c = this.flashColor('#5a98c8'), cl = this.flashColor('#b8e0ff');
    f.r(-3, 0, 6, 3, c); f.r(-5, 3, 10, 6, c); f.r(-3, 9, 6, 3, c);
    f.r(-3, 4, 2, 3, cl, false);
    f.r(-2, 6, 1, 1, '#120c18', false); f.r(1, 6, 1, 1, '#120c18', false);
    f.draw(ctx);
  }
}

// 沈黙騎士: shield blocks frontal hits. Thrust (30f wind, 3 tiles, 40f open) and overhead (40f wind, dmg 2, 60f open).
// Turns slowly (20f). A pound from above staggers it for 60f with the shield down. Makes no sound.
class Knight extends Ent {
  constructor(x, y) {
    super(x - 7, y - 10, 14, 26);
    this.hittable = true; this.hp = this.maxHp = 12; this.contact = 1; this.heavy = true;
    this.state = 'walk'; this.timer = 0; this.face = -1; this.turnT = 0; this.bloodColor = '#9090a8';
  }
  get open() { return this.state === 'tired' || this.state === 'stagger'; }
  hurt(dmg, src, kind) {
    if (kind === 'pound') { this.state = 'stagger'; this.timer = 60; return super.hurt(dmg, src, kind); }
    const fromFront = Math.sign(src.cx - this.cx) === this.face;
    if (fromFront && !this.open) {
      sfx('clink');
      burst(this.cx + this.face * 8, this.cy, '#ffffff', 5, 2, 10);
      if (src === G.player) G.player.recoil = 6;
      return false;
    }
    return super.hurt(dmg, src, kind);
  }
  onHurt(dmg, dir) { this.vx = dir * 0.6; }
  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    const p = G.player;
    this.vy = Math.min(this.vy + 0.4, 6);
    const dx = p.cx - this.cx;
    const want = Math.sign(dx) || this.face;
    switch (this.state) {
      case 'walk':
        if (want !== this.face) { if (++this.turnT >= 20) { this.face = want; this.turnT = 0; } } else this.turnT = 0;
        if (this.near(220, 70)) {
          this.vx = approach(this.vx, this.face * 0.5, 0.1);
          if (Math.abs(dx) < 3.5 * TILE && want === this.face && ++this.timer > 40) {
            this.state = Math.random() < 0.6 ? 'windThrust' : 'windOver'; this.timer = this.state === 'windThrust' ? 30 : 40;
          }
        } else this.vx = approach(this.vx, 0, 0.1);
        break;
      case 'windThrust': this.vx = approach(this.vx, 0, 0.3); if (--this.timer <= 0) { this.state = 'thrust'; this.timer = 10; } break;
      case 'thrust': {
        this.vx = this.face * 1.5;
        const hb = { x: this.face > 0 ? this.x + this.w : this.x - 3 * TILE, y: this.y + 6, w: 3 * TILE, h: 8 };
        if (overlap(hb, p)) p.damage(1, this);
        if (--this.timer <= 0) { this.state = 'tired'; this.timer = 40; }
        break;
      }
      case 'windOver': this.vx = approach(this.vx, 0, 0.3); if (--this.timer <= 0) { this.state = 'over'; this.timer = 10; G.cam.shake = 3; } break;
      case 'over': {
        const hb = { x: this.face > 0 ? this.x + this.w - 4 : this.x - 2 * TILE + 4, y: this.y - 8, w: 2 * TILE, h: this.h + 8 };
        if (overlap(hb, p)) p.damage(2, this);
        if (--this.timer <= 0) { this.state = 'tired'; this.timer = 60; }
        break;
      }
      case 'tired': case 'stagger': this.vx = approach(this.vx, 0, 0.25); if (--this.timer <= 0) { this.state = 'walk'; this.timer = 0; } break;
    }
    moveBody(this);
    const ahead = this.face > 0 ? this.x + this.w + 2 : this.x - 2;
    if (this.onGround && !floorAt(ahead, this.y + this.h + 2)) this.vx = 0;
    this.touchPlayer();
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + this.h, this.face < 0);
    const a = this.flashColor('#5a5a78'), al = this.flashColor('#8a8aa8');
    const st = this.state === 'walk' && Math.abs(this.vx) > 0.1 ? Math.floor(this.t / 10) % 2 : 0;
    const sink = this.state === 'windThrust' || this.state === 'windOver' ? 2 : 0;
    f.r(-5, -6, 3, 6 - st, '#3a3a50'); f.r(2, -6, 3, 6 - (st ? 0 : 1) * 0, '#3a3a50');
    f.r(-6, -18 + sink, 12, 12, a);
    f.r(-4, -17 + sink, 4, 4, al, false);
    f.r(-5, -26 + sink, 10, 8, a);
    f.r(-3, -23 + sink, 8, 2, '#120c18', false);
    f.r(1, -23 + sink, 2, 1, this.state.startsWith('wind') ? '#ff4040' : '#a0a0c0', false);
    f.r(-1, -29 + sink, 2, 3, '#a03040');
    // spear
    const spearGlow = this.state.startsWith('wind') && this.t % 6 < 3 ? '#ffffff' : '#c8c8d8';
    if (this.state === 'windThrust') f.r(-14, -14 + sink, 18, 2, spearGlow);
    else if (this.state === 'thrust') f.r(2, -14, 3 * TILE + 4, 2, '#e8e8f8');
    else if (this.state === 'windOver') f.r(-2, -46, 2, 26, spearGlow);
    else if (this.state === 'over') f.r(4, -10, 2 * TILE, 3, '#e8e8f8');
    else f.r(-8, -30, 2, 26, '#9a9ab0');
    if (!this.open) {
      f.r(6, -22 + sink, 4, 16, this.flashColor('#c8b070'));
      f.r(7, -20 + sink, 2, 12, '#e8d8a0', false);
    } else f.r(-10, -10, 4, 10, '#c8b070');
    f.draw(ctx);
    if (this.state === 'stagger' && this.t % 20 < 10) { ctx.fillStyle = '#ffe080'; ctx.fillRect(Math.round(this.cx) - 1, Math.round(this.y) - 8, 2, 2); }
  }
}

// 静寂霊: drifts through walls at 0.8, 20% visible (untouchable). Within 4 tiles: 36f to materialize, then a 1.8 charge for 30f.
// Solid for 90f. Touch: 1 damage + silence. A resonance shot (or one passing within 24px) materializes it for 90f.
class Ghost extends Ent {
  constructor(x, y) {
    super(x - 7, y, 14, 16);
    this.hittable = false; this.hp = this.maxHp = 6; this.contact = 1; this.vis = 0.2; this.bloodColor = '#d0d8ff';
    this.state = 'drift'; this.timer = 0; this.shootable = false;
  }
  materialize(n = 90) { this.state = 'solid'; this.timer = n; this.hittable = true; }
  hurt(dmg, src, kind) { if (kind === 'shot' && this.state !== 'solid') { this.materialize(); } return super.hurt(dmg, src, kind); }
  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    const p = G.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy, d = Math.hypot(dx, dy) || 1;
    // shots passing nearby reveal it
    if (this.state !== 'solid') for (const e of G.ents) if (e.isProjectile && e.owner === 'player' && Math.hypot(e.cx - this.cx, e.cy - this.cy) < 24) { this.materialize(); break; }
    switch (this.state) {
      case 'drift':
        this.vis = 0.2; this.hittable = false;
        if (!this.near(300, 220)) return;
        this.vx = approach(this.vx, (dx / d) * 0.8, 0.03); this.vy = approach(this.vy, (dy / d) * 0.8, 0.03);
        if (d < 4 * TILE) { this.state = 'form'; this.timer = 36; sfx('glide'); }
        break;
      case 'form':
        this.vx *= 0.9; this.vy *= 0.9;
        this.vis = 0.2 + 0.8 * (1 - this.timer / 36);
        if (--this.timer <= 0) { this.state = 'charge'; this.timer = 30; this.vx = (dx / d) * 1.8; this.vy = (dy / d) * 1.8; this.hittable = true; }
        break;
      case 'charge':
        this.vis = 1;
        if (--this.timer <= 0) { this.state = 'solid'; this.timer = 60; }
        break;
      case 'solid':
        this.vis = 1; this.vx *= 0.92; this.vy *= 0.92; this.hittable = true;
        if (--this.timer <= 0) { this.state = 'drift'; }
        break;
    }
    this.face = Math.sign(dx) || 1;
    this.x += this.vx; this.y += this.vy + Math.sin(this.t / 15) * 0.2;
    if (this.vis > 0.9 && !p.dead && overlap(this, { x: p.x + 1, y: p.y + 2, w: p.w - 2, h: p.h - 2 })) {
      if (p.damage(1, this)) p.silenced = 180;
    }
  }
  onHurt(dmg, dir) { this.vx = dir * 2; this.vy = -1; }
  draw(ctx) {
    ctx.globalAlpha = this.vis;
    const f = new Figure(this.cx, this.y, this.face < 0);
    const c = this.flashColor('#c8d0f0');
    f.r(-6, 2, 12, 10, c); f.r(-4, 0, 8, 2, c);
    const w = Math.floor(this.t / 8) % 2;
    f.r(-6, 12, 3, 3 + w, c); f.r(-1, 12, 3, 4 - w, c); f.r(4, 12, 2, 3 + w, c);
    f.r(-3, 5, 2, 3, '#303050', false); f.r(2, 5, 2, 3, '#303050', false);
    f.r(-1, 9, 3, this.state === 'charge' ? 2 : 1, '#303050', false);
    f.draw(ctx, '#404070');
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ projectiles
export class Projectile extends Ent {
  constructor(o) {
    super(o.x - 3, o.y - 3, 6, 6);
    this.vx = o.vx; this.vy = o.vy; this.owner = o.owner; this.life = o.life || 70;
    this.dmg = o.dmg || 1; this.color = o.color; this.big = o.big; this.grav = o.grav || 0;
    if (o.big) { this.x -= 3; this.y -= 3; this.w = 12; this.h = 12; }
    this.passWalls = !!o.passWalls;
    this.isProjectile = true;
    this.parryable = this.owner === 'enemy' && !o.big;
  }
  parry() { this.dead = true; G.save.gauge = Math.min(100, G.save.gauge + 6); burst(this.cx, this.cy, '#ffe0a0', 6, 2, 12); sfx('clink'); }
  update() {
    this.t++;
    this.vy += this.grav;
    this.x += this.vx; this.y += this.vy;
    if (this.t > this.life) { this.dead = true; return; }
    if (this.owner === 'player') {
      if (this.t % 2 === 0) G.fx.push({ kind: 'p', x: this.cx, y: this.cy, vx: 0, vy: 0, color: '#7ff7e6', t: 0, life: 10, grav: 0, size: 2 });
      // Crystals break; other solids stop the shot.
      let stop = false;
      tilesInRect(this.x, this.y, this.w, this.h, (tx, ty, t) => {
        if (t === T.CRYSTAL) { breakTile(tx, ty); stop = true; }
        else if (isSolidTile(t, { bossLock: G.bossLock, forks: G.save.forks.length })) stop = true;
      });
      for (const e of G.ents) {
        if (e === this || e.dead) continue;
        if ((e.hittable || e.shootable) && overlap(this, e)) {
          if (e.shootable) e.shoot && e.shoot();
          else if (e.hurt(1, this, 'shot') !== false && !e.noGauge) G.save.gauge = Math.min(100, G.save.gauge + 4);
          stop = true; break;
        }
      }
      if (stop) { this.dead = true; ring(this.cx, this.cy, '#7ff7e6', 2, 10, 10); }
    } else {
      const p = G.player;
      if (!p.dead && overlap(this, { x: p.x + 1, y: p.y + 2, w: p.w - 2, h: p.h - 3 })) { if (p.damage(this.dmg, this)) this.dead = true; }
      if (!this.passWalls && rectSolid(this.x + 1, this.y + 1, this.w - 2, this.h - 2)) { this.dead = true; burst(this.cx, this.cy, '#ffb060', 4, 1, 10); }
    }
  }
  draw(ctx) {
    const cx = Math.round(this.cx), cy = Math.round(this.cy);
    if (this.owner === 'player') {
      pcircle(ctx, cx, cy, 3, '#2a6a70'); pcircle(ctx, cx, cy, 2, '#7ff7e6'); ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
    } else if (this.big) {
      pcircle(ctx, cx, cy, 6, '#120c18'); pcircle(ctx, cx, cy, 5, this.color || '#ff7040'); pcircle(ctx, cx, cy, 2, '#fff0c0');
    } else {
      pcircle(ctx, cx, cy, 3, '#120c18'); pcircle(ctx, cx, cy, 2, this.color || '#ff9040'); ctx.fillStyle = '#fff0c0'; ctx.fillRect(cx, cy - 1, 1, 1);
    }
  }
}
export function spawnProjectile(o) { const p = new Projectile(o); G.ents.push(p); return p; }

// ------------------------------------------------------------------ tiles
export function breakTile(tx, ty) {
  const t = World.tileAt(tx, ty);
  const r = World.setTile(tx, ty, T.EMPTY);
  if (!r) return;
  const idx = (ty - r.ty0) * r.tw + (tx - r.tx0);
  if (r.orig[idx] === T.WATER) World.setTile(tx, ty, T.WATER);
  (G.save.broken[r.id] = G.save.broken[r.id] || []).push(idx);
  const th = themeOf(r.region);
  const x = tx * TILE + 8, y = ty * TILE + 8;
  if (t === T.CRYSTAL) { sfx('crystal'); burst(x, y, '#a8f0ff', 12, 2.5, 30); burst(x, y, '#ffffff', 5, 2, 20); }
  else { sfx('break'); burst(x, y, th.wall, 12, 2.5, 30, 0.15); burst(x, y, th.wallL, 6, 2, 24, 0.15); }
  G.cam.shake = Math.max(G.cam.shake, 3);
}

// ------------------------------------------------------------------ pickups & objects
const itemKey = (o) => `${G.room.id}:${o.tx},${o.ty}`;

class Pickup extends Ent {
  constructor(o) {
    super(o.tx * TILE + 2, o.ty * TILE + 2, 12, 12);
    this.o = o; this.kind = o.type; this.key = itemKey(o);
    if (G.save.items[this.key]) this.dead = true;
  }
  get hidden() { return this.o.need && !G.save.flags[this.o.need]; }
  update() {
    this.t++;
    if (this.hidden) return;
    if (overlap(this, G.player) && !G.player.dead) this.collect();
  }
  collect() {
    const S = G.save;
    this.dead = true;
    S.items[this.key] = true;
    burst(this.cx, this.cy, '#ffffff', 16, 2.5, 30, 0);
    ring(this.cx, this.cy, '#ffe9a8', 4, 36, 24);
    if (this.kind === 'hpup') {
      S.maxHp++; S.hp = S.maxHp; sfx('pickup');
      ui.banner(TXT.HPUP_TITLE, TXT.HPUP_BODY);
    } else if (this.kind === 'atkup') {
      S.atk++; sfx('pickup');
      ui.banner(TXT.ATKUP_TITLE, TXT.ATKUP_BODY);
    } else if (this.kind === 'score') {
      if (!S.scores.includes(this.o.n)) S.scores.push(this.o.n);
      sfx('shrine');
      ui.score(this.o.n);
    } else if (this.kind === 'ability') {
      S.abilities[this.o.id] = true; sfx('ability');
      ui.abilityGet(this.o.id);
    }
  }
  draw(ctx) {
    if (this.hidden) return;
    const cx = Math.round(this.cx), cy = Math.round(this.cy + Math.sin(this.t / 15) * 2);
    if (this.t % 30 === 0) burst(cx, cy, '#ffe9a8', 2, 0.6, 30, -0.02);
    if (this.kind === 'hpup') {
      pcircle(ctx, cx, cy, 7, '#120c18'); pcircle(ctx, cx, cy, 6, '#c03050'); pcircle(ctx, cx - 2, cy - 2, 2, '#ff8090');
      ctx.fillStyle = '#ffd0d8'; ctx.fillRect(cx - 1, cy - 4, 1, 1);
    } else if (this.kind === 'atkup') {
      const f = new Figure(cx, cy, false);
      f.r(-1, -7, 2, 12, '#9a6a3a'); f.r(-5, -8, 10, 4, '#e0e8f8'); f.r(-4, -7, 3, 1, '#ffffff', false);
      f.draw(ctx);
    } else if (this.kind === 'score') {
      const f = new Figure(cx, cy, false);
      f.r(-6, -7, 12, 14, '#e8dcc0'); f.r(-4, -5, 8, 1, '#6a5a4a', false); f.r(-4, -2, 8, 1, '#6a5a4a', false); f.r(-4, 1, 8, 1, '#6a5a4a', false);
      f.r(0, -4, 2, 2, '#202020', false); f.r(-3, 0, 2, 2, '#202020', false); f.r(2, 3, 2, 2, '#202020', false);
      f.draw(ctx);
    } else if (this.kind === 'ability') {
      const r = 9 + Math.sin(this.t / 8);
      pring(ctx, cx, cy, r + 3, '#ffe9a8');
      pcircle(ctx, cx, cy, 7, '#120c18'); pcircle(ctx, cx, cy, 6, '#ffe9a8'); pcircle(ctx, cx, cy, 3, '#ffffff');
    }
  }
}

// 鐘の祠: save shrine. Press up to rest.
class Shrine extends Ent {
  constructor(o) {
    super(o.tx * TILE - 8, o.ty * TILE - 16, 32, 32);
    this.o = o; this.lit = false;
  }
  update() {
    this.t++;
    const p = G.player;
    const near = overlap(this, p);
    this.prompt = near && p.onGround;
    if (near && p.onGround && input.pressed.up && !G.dialog) this.rest();
  }
  rest() {
    const S = G.save, p = G.player;
    S.hp = S.maxHp;
    S.room = G.room.id; S.sx = this.cx; S.sy = this.y + this.h;
    const first = !S.flags['shrine_' + G.room.id];
    S.flags['shrine_' + G.room.id] = true;
    this.lit = true; this.ring = 60;
    sfx('shrine');
    ring(this.cx, this.cy - 4, '#ffe9a8', 6, 60, 40);
    burst(this.cx, this.cy, '#ffe9a8', 20, 1.5, 50, -0.03);
    ui.saveGame();
    G.respawnEnemies = true;
    const warp = S.forks.includes('gardener');
    const steps = [];
    if (!S.flags.shrineFirst) { S.flags.shrineFirst = true; steps.push(...seq('SHRINE_FIRST')); }
    else steps.push(S2('SHRINE_01'));
    steps.push(S2('SHRINE_02'), S2('SHRINE_SAVE'));
    if (warp) steps.push({ choice: [{ label: 'ここで休む' }, { label: '別の祠へ移る', fn: () => { G.wantWarp = true; } }] });
    ui.scene(steps, () => { if (G.wantWarp) { G.wantWarp = false; G.openWarp(); } });
    void first;
  }
  draw(ctx) {
    const cx = Math.round(this.cx), by = Math.round(this.y + this.h);
    const f = new Figure(cx, by, false);
    f.r(-12, -3, 24, 3, '#6a6070'); f.r(-10, -5, 20, 2, '#8a8090');
    f.r(-9, -26, 2, 21, '#5a4a40'); f.r(7, -26, 2, 21, '#5a4a40'); f.r(-11, -28, 22, 3, '#7a5a40');
    const swing = Math.sin(this.t / 30) * (this.ring > 0 ? 2 : 0.6);
    f.r(-5 + Math.round(swing), -23, 10, 9, '#c8a050'); f.r(-6 + Math.round(swing), -15, 12, 2, '#e8c070');
    f.r(-3 + Math.round(swing), -22, 2, 5, '#f6dc98', false);
    f.draw(ctx);
    if (this.ring > 0) this.ring--;
    const glow = G.save.room === G.room.id && Math.abs(G.save.sx - this.cx) < 4;
    if (glow) { ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.t / 20); pcircle(ctx, cx, by - 18, 14, '#ffe9a8'); ctx.globalAlpha = 1; }
    if (this.prompt) ui.prompt(cx, by - 40, TXT.PROMPT_REST);
  }
}

// NPC: press up to talk; the script function decides the lines.
class Npc extends Ent {
  constructor(o) {
    super(o.tx * TILE - 4, o.ty * TILE - 10, 24, 26);
    this.o = o; this.id = o.id; this.face = o.face || -1;
  }
  update() {
    this.t++;
    const p = G.player;
    this.prompt = overlap({ x: this.x - 10, y: this.y, w: this.w + 20, h: this.h }, p) && p.onGround;
    if (Math.abs(p.cx - this.cx) < 80) this.face = p.cx < this.cx ? -1 : 1;
    if (this.prompt && input.pressed.up && !G.dialog) {
      const s = npcScript(this.id, G.save, this.o);
      if (s) ui.scene(s.steps);
    }
  }
  draw(ctx) {
    drawNpc(ctx, this);
    if (this.prompt) ui.prompt(Math.round(this.cx), Math.round(this.y) - 10, TXT.PROMPT_TALK);
  }
}

function drawNpc(ctx, n) {
  const f = new Figure(n.cx, n.y + n.h, n.face > 0);
  const breathe = Math.floor(n.t / 40) % 2;
  if (n.id === 'orgo') {
    // old keeper, turning to stone a little more with every fork taken
    const k = G.save.forks.length, stone = '#8a8a90';
    const br = k >= 4 ? 0 : breathe;
    f.r(-7, -10, 14, 10, stone); f.r(-6, -9, 4, 6, '#a8a8b0', false);
    f.r(-6, -20 - br, 12, 11, k >= 2 ? stone : '#6a4a3a');
    f.r(-5, -27 - br, 10, 7, k >= 5 ? stone : '#d8b8a0'); f.r(-6, -29 - br, 12, 3, k >= 5 ? '#a0a0a8' : '#e8e8e8');
    f.r(1, -24 - br, 2, 1, '#202020', false);
    f.r(-6, -22 - br, 12, 3, k >= 5 ? '#a0a0a8' : '#e8e8e8', false); // beard
    f.r(7, -16, 2, 8, k >= 3 ? stone : '#5a3a2a'); f.r(6, -9, 5, 5, '#ffd070'); f.r(7, -8, 3, 3, '#fff0b0', false);
    if (n.t % 50 === 0) burst(n.cx + 9, n.y + n.h - 6, '#ffd070', 1, 0.4, 30, -0.02);
  } else if (n.id === 'mimosa') {
    f.r(-5, -12, 10, 12, '#d8c060'); f.r(-4, -10, 3, 3, '#f0e080', false);
    f.r(-5, -20 - breathe, 10, 8, '#f0d0b8'); f.r(-6, -22 - breathe, 12, 4, '#a07040'); f.r(-6, -18 - breathe, 2, 7, '#a07040');
    f.r(1, -17 - breathe, 2, 1, '#202020', false);
    f.r(-5, -6, 10, 6, '#9a9aa0'); // legs turned to stone
  } else if (n.id === 'polka') {
    // wandering musician with a small lyre and a big pack
    f.r(-6, -18, 12, 18, '#4a5a7a'); f.r(-5, -16, 3, 8, '#6a7a9a', false);
    f.r(-5, -26 - breathe, 10, 8, '#d8b090'); f.r(-6, -28 - breathe, 12, 3, '#7a3a2a'); f.r(1, -23 - breathe, 2, 1, '#202020', false);
    f.r(-12, -16, 6, 12, '#8a6a4a'); f.r(-11, -15, 4, 2, '#a88a6a', false);
    const strum = Math.floor(n.t / 12) % 2;
    f.r(4, -14 + strum, 6, 8, '#c8a050'); f.r(5, -13 + strum, 1, 6, '#fff0c0', false); f.r(8, -13 + strum, 1, 6, '#fff0c0', false);
    if (n.t % 40 === 0) burst(n.cx + 10, n.y + 4, '#ffe9a8', 1, 0.5, 30, -0.03);
  } else if (n.id === 'sera') {
    // stone woman seated at the workbench, chisel in hand
    const st = '#8a8a92', st2 = '#a0a0a8';
    f.r(-12, -12, 4, 12, '#5a4030'); f.r(8, -12, 4, 12, '#5a4030'); f.r(-14, -14, 28, 3, '#7a5a40'); // bench
    f.r(-4, -10, 8, 10, st); f.r(-5, -22, 10, 12, st); f.r(-4, -29, 8, 7, st2); f.r(-5, -31, 10, 4, st);
    f.r(4, -18, 7, 2, st); f.r(10, -19, 2, 3, '#c0c0c8');
    f.r(-3, -21, 3, 8, '#b0b0b8', false);
  } else if (n.id === 'yona' || n.id === 'erna' || n.id === 'statue') {
    const st = '#828290', st2 = '#a0a0aa';
    f.r(-5, -24, 10, 24, st); f.r(-4, -31, 8, 7, st2); f.r(-3, -22, 3, 10, '#9a9aa4', false);
    if (n.id === 'erna') { f.r(-6, -32, 12, 3, st); f.r(-5, -18, 10, 3, '#9090a0', false); }
    if (n.id === 'yona') { f.r(1, -26, 3, 1, '#c8a0a0', false); f.r(4, -18, 5, 2, st); }
  } else if (n.id === 'crocca') {
    // the first doll: bigger, dull brass, a hole in the chest
    f.r(-5, -8, 4, 8, '#6a5a48'); f.r(1, -8, 4, 8, '#6a5a48');
    f.r(-6, -18, 12, 10, '#8a7a60'); f.r(-1, -15, 3, 3, '#120c18', false);
    f.r(-6, -28, 12, 10, '#a08a58'); f.r(1, -25, 4, 3, '#1c2030', false); f.r(2, -24, 2, 1, n.o && G.save.abilities.phase ? '#404050' : '#a0a8c0', false);
    f.r(-2, -31, 1, 3, '#6a5a3a'); f.r(2, -31, 1, 3, '#6a5a3a');
  } else {
    f.r(-6, -18, 12, 18, '#6a5a8a'); f.r(-5, -26 - breathe, 10, 8, '#d8b8a0'); f.r(1, -23 - breathe, 2, 1, '#202020', false);
  }
  f.draw(ctx);
}

// Readable tablet / sign.
class Sign extends Ent {
  constructor(o) { super(o.tx * TILE, o.ty * TILE, 16, 16); this.o = o; }
  update() {
    const p = G.player;
    this.prompt = overlap({ x: this.x - 6, y: this.y - 16, w: this.w + 12, h: this.h + 16 }, p) && p.onGround;
    if (this.prompt && input.pressed.up && !G.dialog) {
      if (this.o.npc) { const s = npcScript(this.o.npc, G.save, this.o); if (s) ui.scene(s.steps); }
      else ui.dialog(TXT[this.o.text] ? [].concat(TXT[this.o.text]) : [this.o.text], null);
    }
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + 16, false);
    f.r(-1, -6, 2, 6, '#5a4a3a'); f.r(-6, -14, 12, 9, '#9a8a6a'); f.r(-4, -12, 8, 1, '#5a4a3a', false); f.r(-4, -9, 6, 1, '#5a4a3a', false);
    f.draw(ctx);
    if (this.prompt) ui.prompt(Math.round(this.cx), Math.round(this.y) - 12, TXT.PROMPT_READ);
  }
}

// A switch (bell) that sets a flag when struck or shot.
class Switch extends Ent {
  constructor(o) {
    super(o.tx * TILE + 2, o.ty * TILE, 12, 16);
    this.o = o; this.hittable = true; this.noGauge = true; this.shootable = !!o.shot;
    this.on = !!G.save.flags[o.id];
  }
  hurt() { if (this.o.shot) return false; this.trigger(); return true; }
  shoot() { this.trigger(); }
  trigger() {
    if (this.on) { sfx('clink'); return; }
    this.on = true; G.save.flags[this.o.id] = true; sfx('switch'); bellRing(this.cx, this.cy);
    G.cam.shake = 4;
  }
  update() { this.t++; }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + 16, false);
    const c = this.o.shot ? '#60c8d0' : '#c8a050';
    f.r(-1, -16, 2, 3, '#5a4a40');
    f.r(-5, -13, 10, 9, this.on ? '#706050' : c); f.r(-6, -5, 12, 2, this.on ? '#605040' : '#e8c070');
    if (!this.on) f.r(-3, -12, 2, 5, '#ffffff', false);
    f.draw(ctx);
  }
}
function bellRing(x, y) { ring(x, y, '#ffe9a8', 4, 30, 20); }

// A gate that is solid until its flag is set. o.h = height in tiles, o.w = width in tiles.
// invert:true -> the opposite (a bridge that appears when the flag is set).
// pound:true -> landing a フォルテ on top of it sets the flag (a hatch); look:'cracked' draws it as cracked stone.
export class Gate extends Ent {
  constructor(o) {
    super(o.tx * TILE, o.ty * TILE, (o.w || 1) * TILE, (o.h || 3) * TILE);
    this.o = o; this.open = this.isOpen(); this.offset = this.open ? this.h : 0;
    this.solidPass = true;
  }
  isOpen() { const f = !!G.save.flags[this.o.id]; return this.o.invert ? !f : f; }
  update() {
    const want = this.isOpen();
    if (want !== this.open) {
      this.open = want; sfx('door'); G.cam.shake = 4;
      if (this.o.look === 'cracked' && want) { burst(this.cx, this.cy, '#a09080', 20, 3, 30, 0.15); sfx('break'); this.offset = this.h; }
    }
    if (this.open && this.offset < this.h) this.offset = Math.min(this.h, this.offset + 2);
    if (!this.open && this.offset > 0) this.offset = Math.max(0, this.offset - 2);
    const sh = this.h - this.offset;
    if (sh > 0) G.dynSolids.push({ x: this.x, y: this.y, w: this.w, h: sh });
  }
  draw(ctx) {
    const sh = this.h - this.offset;
    if (sh <= 0) return;
    const x = Math.round(this.x), y = Math.round(this.y);
    if (this.o.look === 'cracked' || this.o.look === 'bridge') {
      const cr = this.o.look === 'cracked';
      ctx.fillStyle = '#120c18'; ctx.fillRect(x, y, this.w, sh);
      ctx.fillStyle = cr ? '#8a7a6a' : '#7a5a3a'; ctx.fillRect(x, y + 1, this.w, sh - 2);
      ctx.fillStyle = cr ? '#b0a090' : '#a07a4a'; ctx.fillRect(x, y, this.w, 2);
      ctx.fillStyle = '#3a2a24';
      if (cr) for (let i = 3; i < this.w; i += 7) { ctx.fillRect(x + i, y + 3, 1, 4); ctx.fillRect(x + i + 1, y + 6, 1, 3); ctx.fillRect(x + i + 2, y + 8, 2, 1); }
      else for (let i = 0; i < this.w; i += 8) ctx.fillRect(x + i, y + 2, 1, sh - 3);
      return;
    }
    ctx.fillStyle = '#120c18'; ctx.fillRect(x, y, this.w, sh);
    ctx.fillStyle = '#6a5a50'; ctx.fillRect(x + 2, y, this.w - 4, sh);
    ctx.fillStyle = '#8a7a68';
    for (let i = 4; i < this.w - 2; i += 5) ctx.fillRect(x + i, y, 2, sh);
    ctx.fillStyle = '#c8a050'; ctx.fillRect(x + 2, y + sh - 3, this.w - 4, 2);
  }
}

// Decorative objects that give rooms character.
class Deco extends Ent {
  constructor(o) { super(o.tx * TILE, o.ty * TILE, 16, 16); this.o = o; this.kind = o.kind; this.behind = true; }
  update() { this.t++; }
  draw(ctx) {
    const x = Math.round(this.x + 8), y = Math.round(this.y + 16), k = this.kind;
    if (k === 'statue') { // petrified citizen
      const f = new Figure(x, y, (this.o.face || 1) < 0);
      f.r(-5, -24, 10, 24, '#7a7a84'); f.r(-4, -31, 8, 7, '#8a8a94'); f.r(-3, -22, 3, 10, '#9a9aa4', false);
      f.r(4, -20, 5, 2, '#7a7a84'); f.draw(ctx, '#3a3a44');
    } else if (k === 'lamp') {
      ctx.fillStyle = '#3a3040'; ctx.fillRect(x - 1, y - 40, 2, 30);
      ctx.globalAlpha = 0.18 + 0.05 * Math.sin(this.t / 13); pcircle(ctx, x, y - 8, 16, '#ffd070'); ctx.globalAlpha = 1;
      ctx.fillStyle = '#120c18'; ctx.fillRect(x - 4, y - 13, 8, 9); ctx.fillStyle = '#ffd070'; ctx.fillRect(x - 3, y - 12, 6, 7);
    } else if (k === 'gear') {
      const r = this.o.r || 24, a = this.t / (this.o.speed || 90) * (this.o.dir || 1);
      ctx.globalAlpha = 0.5;
      pcircle(ctx, x, y - 8, r - 4, '#3a2a28'); pcircle(ctx, x, y - 8, Math.floor(r / 3), '#5a4a40');
      for (let i = 0; i < 10; i++) { const aa = a + i * Math.PI / 5; ctx.fillStyle = '#3a2a28'; ctx.fillRect(Math.round(x + Math.cos(aa) * r) - 3, Math.round(y - 8 + Math.sin(aa) * r) - 3, 6, 6); }
      ctx.globalAlpha = 1;
    } else if (k === 'crystal') {
      const f = new Figure(x, y, false);
      f.r(-3, -14, 6, 14, '#68c8e8'); f.r(-7, -8, 4, 8, '#58a8d8'); f.r(3, -10, 4, 10, '#88e0f8'); f.r(-2, -12, 2, 8, '#d8f8ff', false);
      f.draw(ctx, '#183048');
      if (this.t % 50 === 0) burst(x, y - 10, '#c8f8ff', 1, 0.4, 30, -0.01);
    } else if (k === 'flower') {
      ctx.fillStyle = '#4a7a4a'; ctx.fillRect(x, y - 8, 1, 8);
      ctx.fillStyle = this.o.color || '#e8e0f0'; ctx.fillRect(x - 2, y - 11, 5, 3); ctx.fillRect(x - 1, y - 12, 3, 5);
      ctx.fillStyle = '#ffe080'; ctx.fillRect(x, y - 10, 1, 1);
    } else if (k === 'books') {
      for (let i = 0; i < 6; i++) { ctx.fillStyle = ['#7a3a3a', '#3a5a7a', '#6a6a3a', '#5a3a6a'][i % 4]; ctx.fillRect(x - 8 + i * 3, y - 10 - (i % 2) * 2, 3, 10 + (i % 2) * 2); }
    } else if (k === 'bigbell') {
      const f = new Figure(x, y, false);
      f.r(-14, -34, 28, 26, '#8a6a30'); f.r(-18, -10, 36, 4, '#a07a38'); f.r(-10, -40, 20, 6, '#8a6a30'); f.r(-10, -30, 5, 18, '#b89048', false);
      f.r(-2, -8, 4, 6, '#5a4020');
      f.draw(ctx);
    } else if (k === 'chain') {
      ctx.fillStyle = '#4a4050';
      for (let i = 0; i < (this.o.len || 6); i++) ctx.fillRect(x - 1 + (i % 2), y - 16 - i * 6 + 16, 2, 4);
    } else if (k === 'pipe') {
      ctx.fillStyle = '#3a3438'; ctx.fillRect(x - 4, y - 16 * (this.o.len || 3), 8, 16 * (this.o.len || 3));
      ctx.fillStyle = '#5a5058'; ctx.fillRect(x - 3, y - 16 * (this.o.len || 3), 2, 16 * (this.o.len || 3));
    } else if (k === 'window') {
      ctx.fillStyle = '#1a2a48'; ctx.fillRect(x - 10, y - 40, 20, 34);
      ctx.fillStyle = '#2a4a78'; ctx.fillRect(x - 8, y - 38, 7, 30); ctx.fillRect(x + 1, y - 38, 7, 30);
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#a0c8ff'; ctx.fillRect(x - 8, y - 38, 16, 8); ctx.globalAlpha = 1;
    }
  }
}

// Text trigger: shows dialog once when the player enters its rect.
class Trigger extends Ent {
  constructor(o) { super(o.tx * TILE, o.ty * TILE, (o.w || 1) * TILE, (o.h || 1) * TILE); this.o = o; }
  update() {
    if (G.save.flags['trig_' + this.o.id]) { this.dead = true; return; }
    if (overlap(this, G.player) && !G.dialog) {
      if (this.o.need && !this.o.need.every((a) => G.save.abilities[a] || G.save.flags[a])) return;
      G.save.flags['trig_' + this.o.id] = true;
      const s = TXT[this.o.text] || this.o.text;
      if (s) ui.dialog([].concat(s), this.o.speaker || null);
      this.dead = true;
    }
  }
}

// Moving platform: oscillates between start and start+(dx,dy) tiles.
class Mover extends Ent {
  constructor(o) {
    super(o.tx * TILE, o.ty * TILE, (o.w || 3) * TILE, 8);
    this.o = o; this.x0 = this.x; this.y0 = this.y; this.period = o.period || 240;
    this.t = o.phase ? Math.floor(o.phase * this.period) : 0;
    this.solidPass = true;
  }
  update() {
    this.t++;
    const k = (1 - Math.cos((this.t / this.period) * Math.PI * 2)) / 2;
    const nx = this.x0 + (this.o.dx || 0) * TILE * k, ny = this.y0 + (this.o.dy || 0) * TILE * k;
    const p = G.player;
    const riding = p.onGround && Math.abs(p.y + p.h - this.y) < 2 && p.x + p.w > this.x && p.x < this.x + this.w;
    const dx = nx - this.x, dy = ny - this.y;
    this.x = nx; this.y = ny;
    if (riding && !p.dead) {
      p.x += dx; p.y += dy;
      if (rectSolid(p.x, p.y, p.w, p.h, p)) { p.x -= dx; p.y -= dy; }
    }
    G.dynSolids.push({ x: this.x, y: this.y, w: this.w, h: this.h, platform: true });
  }
  draw(ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    ctx.fillStyle = '#120c18'; ctx.fillRect(x - 1, y - 1, this.w + 2, this.h + 2);
    ctx.fillStyle = '#8a6a40'; ctx.fillRect(x, y, this.w, this.h);
    ctx.fillStyle = '#c8a060'; ctx.fillRect(x, y, this.w, 2);
    ctx.fillStyle = '#5a4028';
    for (let i = 4; i < this.w; i += 8) ctx.fillRect(x + i, y + 4, 2, 2);
  }
}


// Piston: a block that slides out of a wall and back. Solid; its top can be stood on.
// {type:'piston', x, y, len (tiles when extended), dir: 1 (extends right) | -1 (left), h:1, period:120, phase:0..1}
class Piston extends Ent {
  constructor(o) {
    super(o.tx * TILE, o.ty * TILE, TILE, (o.h || 1) * TILE);
    this.o = o; this.dir = o.dir || 1; this.len = (o.len || 4) * TILE; this.period = o.period || 120;
    this.t = Math.floor((o.phase || 0) * this.period); this.solidPass = true; this.ext = 0;
  }
  update() {
    this.t++;
    const k = (this.t % this.period) / this.period;
    // out quickly, hold, in, hold
    const target = k < 0.15 ? k / 0.15 : k < 0.5 ? 1 : k < 0.65 ? 1 - (k - 0.5) / 0.15 : 0;
    const prev = this.ext;
    this.ext = target * this.len;
    const r = this.rect();
    // push the player out of the way
    const p = G.player;
    if (!p.dead && overlap(r, p)) {
      if (this.ext > prev) {
        if (this.dir > 0) p.x = r.x + r.w; else p.x = r.x - p.w;
        if (rectSolid(p.x, p.y, p.w, p.h, p)) p.y = r.y - p.h;
      } else if (p.y + p.h <= r.y + 6) p.y = r.y - p.h;
    }
    G.dynSolids.push(r);
    if (prev === 0 && this.ext > 0) sfx('door');
  }
  rect() {
    const w = Math.max(1, this.ext);
    return this.dir > 0 ? { x: this.x, y: this.y, w, h: this.h } : { x: this.x + TILE - w, y: this.y, w, h: this.h };
  }
  draw(ctx) {
    const r = this.rect();
    if (r.w < 2) return;
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w);
    ctx.fillStyle = '#120c18'; ctx.fillRect(x, y, w, r.h);
    ctx.fillStyle = '#7a7a88'; ctx.fillRect(x + 1, y + 3, w - 2, r.h - 6);
    ctx.fillStyle = '#b8b8c8'; ctx.fillRect(x, y, w, 3);
    const hx = this.dir > 0 ? x + w - 6 : x;
    ctx.fillStyle = '#c8a060'; ctx.fillRect(hx, y, 6, r.h);
  }
}

// Combat trial: when the player enters the rect, doors close until every enemy in the room is defeated.
// {type:'arena', id, x, y, w, h, doors: [[x,y,w,h], ...]}  Rewards use {need: id} to appear afterwards.
class Arena extends Ent {
  constructor(o) {
    super(o.tx * TILE, o.ty * TILE, (o.w || 4) * TILE, (o.h || 4) * TILE);
    this.o = o; this.active = false; this.solidPass = true;
    const r = G.room;
    this.doors = (o.doors || []).map(([x, y, w, h]) => ({ x: (r.tx0 + x) * TILE, y: (r.ty0 + y) * TILE, w: (w || 1) * TILE, h: (h || 3) * TILE }));
    this.done = !!G.save.flags[o.id];
    if (o.zone) { const [x, y, w, h] = o.zone; this.zone = { x: (r.tx0 + x) * TILE, y: (r.ty0 + y) * TILE, w: w * TILE, h: h * TILE }; }
  }
  update() {
    if (this.done) return;
    if (!this.active) {
      if (overlap(this, G.player)) { this.active = true; sfx('door'); G.cam.shake = 4; ui.toast('扉が閉じた。'); }
      else return;
    }
    for (const d of this.doors) G.dynSolids.push(d);
    const z = this.zone;
    const left = G.ents.filter((e) => ENEMY_CLASSES.has(e.constructor) && !e.dead && !(e instanceof Dropper && e.state === 'gone') && (!z || overlap(e, z)));
    if (left.length === 0) {
      this.done = true; G.save.flags[this.o.id] = true; sfx('switch'); sfx('door'); ui.toast('扉が開いた。');
      writeSave(G.save);
    }
  }
  draw(ctx) {
    if (!this.active || this.done) return;
    for (const d of this.doors) {
      ctx.fillStyle = '#120c18'; ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#8a8098'; for (let i = 2; i < d.w; i += 5) ctx.fillRect(d.x + i, d.y, 2, d.h);
    }
  }
}

// Training dummy: harmless, fills the resonance gauge when struck.
class Dummy extends Ent {
  constructor(o) { super(o.tx * TILE + 2, o.ty * TILE - 10, 12, 26); this.hittable = true; this.hp = 9999; this.heavy = true; this.wob = 0; }
  hurt(dmg, src) { this.flash = 6; this.wob = 12 * (src && src.cx < this.cx ? 1 : -1); sfx('hit'); return true; }
  update() { this.t++; if (this.flash > 0) this.flash--; this.wob *= 0.85; }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + this.h, false);
    const lean = Math.round(this.wob / 4);
    f.r(-1, -10, 2, 10, '#5a4030');
    f.r(-6 + lean, -22, 12, 12, this.flashColor('#c8a878')); f.r(-4 + lean, -20, 8, 1, '#8a6a48', false); f.r(-4 + lean, -16, 8, 1, '#8a6a48', false);
    f.r(-4 + lean * 2, -28, 8, 6, this.flashColor('#d8b888'));
    f.r(-8, -1, 16, 1, '#5a4030');
    f.draw(ctx);
  }
}

// Chime puzzle: chimes {type:'chime', group, note:0..6, x, y}; puzzle {type:'puzzle', id, order:[notes...], x, y}.
// Strike the chimes in the right order to set flag `id`.
const NOTE_HZ = [261.6, 293.7, 329.6, 349.2, 392.0, 440.0, 493.9];
const NOTE_NAME = ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ'];
class Chime extends Ent {
  constructor(o) { super(o.tx * TILE + 2, o.ty * TILE, 12, 16); this.o = o; this.hittable = true; this.noGauge = true; this.shootable = !!o.shot; this.ringT = 0; }
  hurt() { this.strike(); return true; }
  shoot() { this.strike(); }
  strike() {
    this.ringT = 30;
    bellTone(NOTE_HZ[this.o.note % 7]);
    ring(this.cx, this.cy, '#ffe9a8', 3, 22, 14);
    for (const e of G.ents) if (e instanceof Puzzle && e.o.id === this.o.group) e.hear(this.o.note);
  }
  update() { this.t++; if (this.ringT > 0) this.ringT--; }
  draw(ctx) {
    const sh = this.ringT > 0 ? Math.round(Math.sin(this.ringT) * 1.5) : 0;
    const f = new Figure(this.cx + sh, this.y + 16, false);
    f.r(-1, -16, 2, 3, '#5a4a40');
    f.r(-5, -13, 10, 9, this.ringT > 0 ? '#fff0c0' : '#a8b8c8'); f.r(-6, -5, 12, 2, '#d0d8e0');
    f.draw(ctx);
    ctx.font = '7px monospace'; ctx.fillStyle = '#fff'; ctx.fillText(NOTE_NAME[this.o.note % 7], Math.round(this.cx) - 4, Math.round(this.y) - 4);
  }
}
class Puzzle extends Ent {
  constructor(o) { super(o.tx * TILE, o.ty * TILE, 16, 16); this.o = o; this.seq = []; }
  hear(n) {
    if (G.save.flags[this.o.id]) return;
    this.seq.push(n);
    const ord = this.o.order;
    for (let i = 0; i < this.seq.length; i++) if (this.seq[i] !== ord[i]) { this.seq = n === ord[0] ? [n] : []; sfx('clink'); return; }
    if (this.seq.length === ord.length) { G.save.flags[this.o.id] = true; sfx('ability'); G.cam.shake = 4; writeSave(G.save); }
  }
}
function bellTone(hz) { G.bellTone ? G.bellTone(hz) : sfx('switch'); }

// Fork altar in the workshop: shows collected forks.
class Altar extends Ent {
  constructor(o) { super(o.tx * TILE - 24, o.ty * TILE - 24, 64, 40); this.o = o; this.behind = true; }
  update() { this.t++; }
  draw(ctx) {
    const x = Math.round(this.x + 32), y = Math.round(this.y + 40);
    const f = new Figure(x, y, false);
    f.r(-28, -6, 56, 6, '#5a4a48'); f.r(-24, -10, 48, 4, '#7a6a60');
    f.draw(ctx);
    const names = ['gear', 'choir', 'gardener', 'wyrm', 'librarian'];
    names.forEach((n, i) => {
      const has = G.save.forks.includes(n);
      const fx = x - 20 + i * 10;
      ctx.fillStyle = has ? '#ffe9a8' : '#3a3440';
      ctx.fillRect(fx, y - 24, 1, 12); ctx.fillRect(fx + 3, y - 24, 1, 12); ctx.fillRect(fx, y - 13, 4, 1); ctx.fillRect(fx + 1, y - 12, 2, 3);
      if (has && (this.t + i * 20) % 120 < 4) burst(fx + 2, y - 24, '#ffe9a8', 1, 0.5, 20, -0.02);
    });
  }
}

// ------------------------------------------------------------------ factory
const ENEMY = { walker: Walker, bat: Bat, turret: Turret, frog: Frog, dropper: Dropper, knight: Knight, ghost: Ghost };
const ENEMY_CLASSES = new Set(Object.values(ENEMY));

export function spawnRoomEntities(room) {
  // Constructors may push helper entities into G.ents, so build directly into it.
  G.ents = [];
  const list = G.ents;
  for (const e of room.ents) {
    const x = (room.tx0 + e.tx) * TILE, y = (room.ty0 + e.ty) * TILE;
    const o = Object.assign({}, e, { tx: room.tx0 + e.tx, ty: room.ty0 + e.ty });
    let ent = null;
    if (ENEMY[e.type]) ent = new ENEMY[e.type](x + 8, y);
    else switch (e.type) {
      case 'hpup': case 'atkup': case 'score': case 'ability': ent = new Pickup(o); break;
      case 'shrine': ent = new Shrine(o); break;
      case 'npc': ent = new Npc(o); break;
      case 'sign': ent = new Sign(o); break;
      case 'switch': ent = new Switch(o); break;
      case 'gate': ent = new Gate(o); break;
      case 'deco': ent = new Deco(o); break;
      case 'trigger': ent = new Trigger(o); break;
      case 'mover': ent = new Mover(o); break;
      case 'altar': ent = new Altar(o); break;
      case 'piston': ent = new Piston(o); break;
      case 'arena': ent = new Arena(o); break;
      case 'dummy': ent = new Dummy(o); break;
      case 'chime': ent = new Chime(o); break;
      case 'puzzle': ent = new Puzzle(o); break;
      case 'boss': ent = makeBoss(o); break;
      case 'stone': ent = new RingStone(o); break;
      case 'start': break;
      default: console.warn('unknown entity', e.type);
    }
    if (ent && !ent.dead) list.push(ent);
  }
  // Pickups' keys depend on the room-local coords; fix them up.
  for (const ent of list) if (ent instanceof Pickup) {
    ent.key = `${room.id}:${ent.o.tx - room.tx0},${ent.o.ty - room.ty0}`;
    if (G.save.items[ent.key]) ent.dead = true;
  }
  G.ents = list.filter((e) => !e.dead);
  return G.ents;
}

export { Pickup };
G.spawnProjectile = spawnProjectile;
G.makeEnemy = (type, x, y) => new ENEMY[type](x, y);
