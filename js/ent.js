// Base entity class shared by enemies, objects and bosses.
import { overlap } from './util.js';
import { G } from './state.js';
import { sfx } from './audio.js';
import { burst, ring } from './fx.js';

// ------------------------------------------------------------------ base
export class Ent {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.dead = false; this.hittable = false; this.hp = 1; this.maxHp = 1;
    this.flash = 0; this.t = 0; this.face = -1;
    this.contact = 0; // damage dealt on touch
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  update() {}
  draw() {}
  hurt(dmg, src, kind) {
    if (this.dead) return false;
    this.hp -= dmg; this.flash = 8;
    const dir = src ? Math.sign(this.cx - src.cx) || 1 : 1;
    this.onHurt(dmg, dir, kind);
    if (this.hp <= 0) { this.kill(); } else sfx('hit', Math.floor(Math.random() * 5));
    G.hitstop = Math.max(G.hitstop, 3);
    return true;
  }
  onHurt(dmg, dir) { if (!this.heavy) { this.vx = dir * 2.5; this.vy = Math.min(this.vy, -1.5); } }
  kill() {
    this.dead = true;
    sfx('die');
    burst(this.cx, this.cy, this.bloodColor || '#e8d8c0', 14, 2.5, 26);
    ring(this.cx, this.cy, '#ffffff', 3, 18, 12);
    G.save.gauge = Math.min(100, G.save.gauge + 4);
  }
  touchPlayer() {
    const p = G.player;
    if (this.contact && !this.dead && !p.dead && overlap(this, { x: p.x + 1, y: p.y + 2, w: p.w - 2, h: p.h - 2 })) p.damage(this.contact, this);
  }
  near(dx, dy = 9999) {
    const p = G.player;
    return Math.abs(p.cx - this.cx) < dx && Math.abs(p.cy - this.cy) < dy;
  }
  flashColor(c) { return this.flash > 0 && this.flash % 4 < 2 ? '#ffffff' : c; }
}

