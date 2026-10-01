// Bosses. Each boss lives in an arena room; '|' tiles close while it fights.
import { TILE, overlap, clamp, approach } from './util.js';
import { G } from './state.js';
import { Ent } from './ent.js';
import { moveBody, rectSolid } from './physics.js';
import { isSolidTile, T } from './tiles.js';
import { World } from './world.js';
import { sfx, playMusic, bell } from './audio.js';
import { burst, ring, spawnFx, dust } from './fx.js';
import { Figure, pcircle, pring, pline } from './gfx.js';
import { ui } from './ui.js';
import { S, seq, SPEAKER, FORKS } from './text.js';
import { writeSave } from './save.js';
import { input } from './input.js';

// ------------------------------------------------------------------ hazards
// A rectangle that warns, then hurts. Used for shockwaves, pillars, lines, spears...
export class Hazard extends Ent {
  constructor(o) {
    super(o.x, o.y, o.w, o.h);
    Object.assign(this, { warn: 0, active: 60, dmg: 1, style: 'wave', color: '#ffb060', grav: 0, stopOnSolid: false }, o);
    this.vx = o.vx || 0; this.vy = o.vy || 0; this.front = true;
  }
  update() {
    this.t++;
    if (this.t <= this.warn) return;
    this.vy += this.grav;
    this.x += this.vx; this.y += this.vy;
    if (this.stopOnSolid && rectSolid(this.x + 2, this.y + 2, this.w - 4, this.h - 2)) {
      if (this.onLand) this.onLand(this); else { this.dead = true; burst(this.cx, this.cy, this.color, 6, 1.5, 14); }
      return;
    }
    if (this.t > this.warn + this.active) { this.dead = true; return; }
    const p = G.player;
    if (!p.dead && overlap({ x: this.x + 1, y: this.y + 1, w: this.w - 2, h: this.h - 2 }, { x: p.x + 1, y: p.y + 2, w: p.w - 2, h: p.h - 2 })) p.damage(this.dmg, this);
  }
  draw(ctx) {
    const x = Math.round(this.x), y = Math.round(this.y), w = Math.round(this.w), h = Math.round(this.h);
    const f = G.frame;
    if (this.t <= this.warn) {
      // telegraph
      ctx.globalAlpha = 0.25 + 0.25 * ((f >> 2) & 1);
      ctx.fillStyle = this.warnColor || '#ff4050';
      if (this.style === 'line') ctx.fillRect(x, y + h / 2 - 1, w, 2);
      else if (this.style === 'pillar' || this.style === 'spear') ctx.fillRect(x + w / 2 - 1, y, 2, h);
      else if (this.style === 'gear' || this.style === 'rock') ctx.fillRect(x, this.shadowY || y + h, w, 3);
      else ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      return;
    }
    switch (this.style) {
      case 'wave':
        ctx.fillStyle = '#120c18'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = this.color; ctx.fillRect(x + 1, y + 2, w - 2, h - 2);
        ctx.fillStyle = '#fff0c0'; ctx.fillRect(x + 2, y + 1 + ((f >> 1) & 1), w - 4, 2);
        break;
      case 'pillar':
        ctx.globalAlpha = 0.75; ctx.fillStyle = this.color; ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; ctx.fillRect(x + w / 2 - 2, y, 4, h);
        break;
      case 'line':
        ctx.fillStyle = this.color; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y + h / 2 - 1, w, 2);
        break;
      case 'spear':
        ctx.fillStyle = '#120c18'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
        ctx.fillStyle = this.color; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1, y + h - 6, w - 2, 6);
        break;
      case 'gear': {
        const cx = x + w / 2, cy = y + h / 2;
        pcircle(ctx, cx, cy, w / 2, '#120c18'); pcircle(ctx, cx, cy, w / 2 - 1, '#a86c4a'); pcircle(ctx, cx, cy, 2, '#3a2010');
        for (let i = 0; i < 6; i++) { const a = f / 6 + i; ctx.fillStyle = '#a86c4a'; ctx.fillRect(Math.round(cx + Math.cos(a) * (w / 2)) - 1, Math.round(cy + Math.sin(a) * (w / 2)) - 1, 3, 3); }
        break;
      }
      case 'rock':
        ctx.fillStyle = '#120c18'; ctx.fillRect(x, y, w, h); ctx.fillStyle = this.color; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        break;
      case 'seed':
        ctx.fillStyle = '#120c18'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#6a9a4a'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        break;
      case 'sprout':
        for (let i = 0; i < w; i += 4) { ctx.fillStyle = '#3a6a2a'; ctx.fillRect(x + i + 1, y + 4, 2, h - 4); ctx.fillStyle = '#d0f0a0'; ctx.fillRect(x + i + 1, y + 2, 2, 2); }
        break;
      case 'silence':
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#8a8a9a'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#d0d0e0'; for (let i = 0; i < w; i += 6) ctx.fillRect(x + i, y + h - 2 - ((i + f) % 4), 3, 2);
        ctx.globalAlpha = 1;
        break;
      default:
        ctx.fillStyle = this.color; ctx.fillRect(x, y, w, h);
    }
  }
}
export function hazard(o) { const h = new Hazard(o); G.ents.push(h); return h; }

// Expanding ring with a gap (聖歌の母).
class SongRing extends Ent {
  constructor(x, y, gapAngle, speed = 2.5) {
    super(x, y, 1, 1); this.r = 6; this.gap = gapAngle; this.speed = speed; this.front = true;
    this.gapW = (3 * TILE) / 2; // half gap in px at radius
  }
  update() {
    this.r += this.speed;
    if (this.r > 600) { this.dead = true; return; }
    const p = G.player;
    const dx = p.cx - this.x, dy = p.cy - this.y, d = Math.hypot(dx, dy);
    if (Math.abs(d - this.r) < 7) {
      let a = Math.atan2(dy, dx) - this.gap;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) * this.r > this.gapW) p.damage(1, this);
    }
  }
  draw(ctx) {
    const n = Math.max(24, Math.floor(this.r * 1.2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let da = a - this.gap; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) * this.r < this.gapW) continue;
      ctx.fillStyle = i % 3 ? '#a8f0ff' : '#ffffff';
      ctx.fillRect(Math.round(this.x + Math.cos(a) * this.r) - 1, Math.round(this.y + Math.sin(a) * this.r) - 1, 3, 3);
    }
  }
}

// Homing page (司書).
class Page extends Ent {
  constructor(x, y, life = 90, speed = 1.5) {
    super(x - 5, y - 4, 10, 8); this.hittable = true; this.hp = 1; this.contact = 1; this.life = life; this.speed = speed; this.noGauge = false;
    this.bloodColor = '#f0e8d0';
  }
  update() {
    this.t++;
    if (this.t > this.life + 40) { this.dead = true; burst(this.cx, this.cy, '#f0e8d0', 4, 1, 10); return; }
    const p = G.player;
    if (this.t < this.life) {
      const dx = p.cx - this.cx, dy = p.cy - this.cy, d = Math.hypot(dx, dy) || 1;
      this.vx = approach(this.vx, (dx / d) * this.speed, 0.08); this.vy = approach(this.vy, (dy / d) * this.speed, 0.08);
    }
    this.x += this.vx; this.y += this.vy + Math.sin(this.t / 6) * 0.3;
    this.touchPlayer();
  }
  onHurt() {}
  draw(ctx) {
    const x = Math.round(this.x), y = Math.round(this.y), fl = (this.t >> 3) & 1;
    ctx.fillStyle = '#120c18'; ctx.fillRect(x - 1, y - 1, 12, 10);
    ctx.fillStyle = '#e8dcc0'; ctx.fillRect(x, y + fl, 10, 8 - fl);
    ctx.fillStyle = '#6a5a4a'; ctx.fillRect(x + 2, y + 2, 6, 1); ctx.fillRect(x + 2, y + 5, 5, 1);
  }
}

// ------------------------------------------------------------------ base
const BOSS_INFO = {
  gear: { n: 1, fork: 'gear', ability: 'dash' },
  choir: { n: 2, fork: 'choir', ability: 'double' },
  gardener: { n: 3, fork: 'gardener', ability: 'wall' },
  wyrm: { n: 4, fork: 'wyrm', ability: 'shot' },
  librarian: { n: 5, fork: 'librarian', ability: 'glide' },
};

class Boss extends Ent {
  constructor(o, w, h) {
    super(o.tx * TILE + 8 - w / 2, (o.ty + 1) * TILE - h, w, h);
    this.o = o; this.id = o.id; this.info = BOSS_INFO[o.id] || {};
    this.state = 'wait'; this.timer = 0; this.phase = 1; this.heavy = true;
    this.hittable = false; this.contact = 1; this.active = false;
    const r = G.room;
    this.room = r;
    this.ax0 = r.px + 16; this.ax1 = r.px + r.pw - 16;
    if (o.arena) { this.ax0 = (r.tx0 + o.arena[0]) * TILE; this.ax1 = (r.tx0 + o.arena[1] + 1) * TILE; }
    this.floorY = o.floor !== undefined ? (r.ty0 + o.floor) * TILE : this.findFloor(this.cx, this.y + this.h - 4);
    this.homeX = this.x; this.homeY = this.y;
    this.phaseMarks = [];
    this.attack = null; this.atkT = 0; this.cool = 60;
    G.boss = this;
  }
  findFloor(x, y) {
    let ty = Math.floor(y / TILE);
    for (let i = 0; i < 60; i++, ty++) if (isSolidTile(World.tileAt(Math.floor(x / TILE), ty), null)) return ty * TILE;
    return this.room.py + this.room.ph - 32;
  }
  get name() { return S(`BOSS${this.info.n}_NAME`); }
  get speaker() { return SPEAKER['BOSS' + this.info.n]; }
  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    const p = G.player;
    if (this.state === 'wait') {
      // Start when the player is well inside the arena, away from the doors.
      const r = this.room;
      if (p.cx > r.px + 56 && p.cx < r.px + r.pw - 56 && p.cy > r.py + 8 && p.cy < r.py + r.ph && p.y + p.h <= this.floorY + 1 && (p.onGround || this.o.airStart)) this.startIntro();
      return;
    }
    if (this.state === 'intro') return;
    if (this.state === 'dying') { this.updateDying(); return; }
    if (this.state === 'fight') {
      this.fight();
      if (this.contact && !this.noContact) this.touchPlayer();
    }
  }
  startIntro() {
    this.state = 'intro';
    G.bossLock = true;
    sfx('door');
    playMusic('silence');
    const again = G.save.flags['met_' + this.id];
    G.save.flags['met_' + this.id] = true;
    const go = () => { this.state = 'fight'; this.active = true; this.hittable = true; playMusic(this.music || 'boss'); ui.bossName(this.name); sfx('roar'); G.cam.shake = 8; };
    if (again) { go(); return; }
    const steps = this.introSteps();
    ui.scene(steps, go);
  }
  introSteps() { return [{ speaker: this.speaker }, S(`BOSS${this.info.n}_INTRO`)]; }
  hurt(dmg, src, kind) {
    if (this.state !== 'fight' || this.invuln) return false;
    const d = this.modDamage ? this.modDamage(dmg, kind) : dmg;
    if (d <= 0) { sfx('clink'); burst(this.cx, this.cy, '#ffffff', 4, 1.5, 10); return false; }
    this.hp -= d; this.flash = 6;
    sfx('bosshit');
    burst(src ? (src.cx + this.cx) / 2 : this.cx, src ? src.cy : this.cy, this.bloodColor || '#ffe0a0', 6, 2, 18);
    this.checkPhase();
    if (this.hp <= 0) this.die();
    return true;
  }
  checkPhase() {
    const k = this.hp / this.maxHp;
    const marks = this.phaseMarks;
    for (let i = 0; i < marks.length; i++) {
      if (this.phase === i + 1 && k <= marks[marks.length - 1 - i] + 1e-9 && this.hp > 0) {
        this.phase++;
        G.hitstop = 20; G.cam.shake = 10;
        spawnFx({ kind: 'flash', x: this.cx, y: this.cy, color: '#ffffff', r: 60, life: 10, alpha: 0.6 });
        sfx('roar');
        const half = S(`BOSS${this.info.n}_HALF`);
        if (this.phase === 2 && half && !half.startsWith('BOSS')) ui.toast(`${this.speaker}「${half}」`);
        this.onPhase && this.onPhase(this.phase);
      }
    }
  }
  die() {
    this.state = 'dying'; this.timer = 0; this.hittable = false; this.attack = null;
    G.hitstop = 45; G.cam.shake = 12;
    sfx('bossdie');
    playMusic('silence');
    for (const e of G.ents) if (e !== this && (e instanceof Hazard || e instanceof SongRing || e instanceof Page || e.isProjectile || e.summoned)) e.dead = true;
  }
  updateDying() {
    this.timer++;
    if (this.timer % 6 === 0 && this.timer < 90) {
      burst(this.x + Math.random() * this.w, this.y + Math.random() * this.h, '#ffe9a8', 8, 2.5, 30);
      sfx('break'); G.cam.shake = 4;
    }
    if (this.timer === 100) {
      this.dead = true; this.keep = false;
      ring(this.cx, this.cy, '#ffffff', 10, 120, 40);
      burst(this.cx, this.cy, '#ffffff', 40, 4, 60, 0.02);
      this.reward();
    }
  }
  reward() {
    const S2 = G.save, info = this.info;
    S2.flags['boss_' + this.id] = true;
    const finish = () => {
      G.bossLock = false; G.boss = null;
      writeSave(S2);
      playMusic(G.room.def.music || 'silence');
      this.afterReward && this.afterReward();
    };
    const steps = [{ speaker: this.speaker }, S(`BOSS${info.n}_DEFEAT`)];
    ui.scene(steps, () => {
      if (!S2.forks.includes(info.fork)) S2.forks.push(info.fork);
      bell(130.8 * Math.pow(2, [0, 2, 4, 5, 7][info.n - 1] / 12), null, 0.35, 5);
      ui.forkGet(info.fork, () => {
        S2.abilities[info.ability] = true;
        sfx('ability');
        ui.abilityGet(info.ability);
        G.when(() => !G.dialog, finish);
      });
    });
  }
  // helpers
  facePlayer() { this.face = G.player.cx < this.cx ? -1 : 1; }
  setAttack(name, t = 0) { this.attack = name; this.atkT = t; }
  shoot(x, y, vx, vy, o = {}) {
    const pj = { x, y, vx, vy, owner: 'enemy', life: o.life || 240, color: o.color, big: o.big, grav: o.grav, passWalls: o.passWalls };
    // Lazy import to avoid a cycle at module load.
    return G.spawnProjectile(pj);
  }
  drawBar() {}
}

// ------------------------------------------------------------------ Boss 1: 歯車の番人 グスタフ
class GearWarden extends Boss {
  constructor(o) {
    super(o, 40, 40);
    this.hp = this.maxHp = 24; this.phaseMarks = [0.5];
    this.bloodColor = '#d89a5a'; this.rot = 0;
  }
  fight() {
    const p = G.player;
    this.atkT++;
    this.vy = Math.min(this.vy + 0.5, 8);
    switch (this.attack) {
      case null: {
        // walk toward the player
        this.facePlayer();
        this.vx = approach(this.vx, this.face * 0.8, 0.1);
        this.rot += this.vx * 0.05;
        if (--this.cool <= 0) {
          const r = Math.random();
          if (r < 0.45) this.setAttack('rollPrep');
          else if (this.phase === 2 && r < 0.75) this.setAttack('gears');
          else this.setAttack('slam');
        }
        break;
      }
      case 'rollPrep': {
        // move to the nearest wall, then wind up for 40 frames
        const left = this.cx < (this.ax0 + this.ax1) / 2;
        const tx = left ? this.ax0 + 4 : this.ax1 - this.w - 4;
        if (this.atkT < 200 && Math.abs(this.x - tx) > 3) { this.vx = Math.sign(tx - this.x) * 2.4; this.rot += this.vx * 0.06; this.atkT = Math.min(this.atkT, 1); }
        else {
          this.vx = 0; this.face = left ? 1 : -1;
          if (this.atkT % 4 === 0) G.fx.push({ kind: 'p', x: this.cx - this.face * 20, y: this.y + 8, vx: -this.face * 1.5, vy: -1, color: '#e0e0e0', t: 0, life: 25, grav: -0.02, size: 2 });
          if (this.atkT === 2) sfx('fire');
          if (this.atkT >= 40) { this.setAttack('roll'); this.rolls = this.phase === 2 ? 2 : 1; sfx('dash'); }
        }
        break;
      }
      case 'roll': {
        this.vx = this.face * 4.0; this.rot += this.face * 0.25;
        if (this.atkT % 3 === 0) dust(this.cx, this.y + this.h, 2, -this.face);
        // Phase 2 second roll bounces high enough to hit the side platforms
        if (this.rolls === 1 && this.phase === 2 && this.onGround && this.atkT % 26 === 0) this.vy = -6.5;
        if (this.hitWall || this.x <= this.ax0 + 1 || this.x + this.w >= this.ax1 - 1) {
          G.cam.shake = 6; sfx('boom');
          this.rolls--;
          if (this.rolls > 0) { this.face *= -1; this.setAttack('rollGap'); }
          else this.setAttack('dizzy');
        }
        break;
      }
      case 'rollGap': this.vx = 0; if (this.atkT >= 30) { this.setAttack('roll'); sfx('dash'); } break;
      case 'dizzy': this.vx = approach(this.vx, 0, 0.3); if (this.atkT >= 70) { this.setAttack(null); this.cool = 50; } break;
      case 'slam': {
        this.vx = approach(this.vx, 0, 0.3);
        if (this.atkT === 30) {
          G.cam.shake = 8; sfx('pound');
          const fy = this.floorY - TILE;
          for (const d of [-1, 1]) hazard({ x: this.cx - 6 + d * 16, y: fy, w: 12, h: TILE, vx: d * 3.0, active: 200, style: 'wave', color: '#ff9040', stopOnSolid: false });
          dust(this.cx, this.y + this.h, 12);
        }
        if (this.atkT >= 80) { this.setAttack(null); this.cool = 60; }
        break;
      }
      case 'gears': {
        this.vx = approach(this.vx, 0, 0.3);
        if (this.atkT === 1) {
          sfx('fire');
          for (const k of [-5, 0, 5]) {
            const x = clamp(p.cx + k * TILE, this.ax0 + 8, this.ax1 - 24);
            hazard({ x: x - 8, y: this.room.py + 20, w: 16, h: 16, warn: 30, active: 300, vy: 0.5, grav: 0.25, style: 'gear', stopOnSolid: true, shadowY: this.floorY - 3 });
          }
        }
        if (this.atkT >= 60) { this.setAttack(null); this.cool = 50; }
        break;
      }
    }
    moveBody(this);
  }
  draw(ctx) {
    const cx = Math.round(this.cx), cy = Math.round(this.cy);
    const c = this.flashColor('#a86c4a'), d = this.flashColor('#6a4232');
    const wind = this.attack === 'rollPrep' && this.atkT > 1;
    const rolling = this.attack === 'roll' || this.attack === 'rollGap';
    // gear body
    pcircle(ctx, cx, cy, 20, '#120c18');
    pcircle(ctx, cx, cy, 18, c);
    for (let i = 0; i < 10; i++) {
      const a = this.rot + (i / 10) * Math.PI * 2;
      ctx.fillStyle = '#120c18'; ctx.fillRect(Math.round(cx + Math.cos(a) * 20) - 4, Math.round(cy + Math.sin(a) * 20) - 4, 8, 8);
      ctx.fillStyle = c; ctx.fillRect(Math.round(cx + Math.cos(a) * 20) - 3, Math.round(cy + Math.sin(a) * 20) - 3, 6, 6);
    }
    pcircle(ctx, cx, cy, 11, d);
    if (!rolling) {
      // face & arms
      const f = new Figure(cx, cy, this.face < 0);
      f.r(-6, -6, 12, 9, this.flashColor('#3a2a28'));
      f.r(1, -3, 3, 2, this.attack === 'dizzy' ? '#ffe080' : '#ff7040', false);
      f.r(-4, -3, 2, 2, this.attack === 'dizzy' ? '#ffe080' : '#ff7040', false);
      if (this.attack === 'slam') {
        const up = this.atkT < 30;
        if (up) { f.r(10, -34, 4, 26, '#6a4a2a'); f.r(4, -44, 16, 12, this.flashColor('#c0c8d8')); }
        else { f.r(14, 4, 20, 4, '#6a4a2a'); f.r(30, -2, 12, 18, this.flashColor('#c0c8d8')); }
      } else { f.r(14, -8, 4, 20, '#6a4a2a'); f.r(10, 10, 12, 10, this.flashColor('#c0c8d8')); }
      f.draw(ctx);
    } else {
      pcircle(ctx, cx, cy, 4, '#3a2010');
    }
    if (wind && this.atkT % 8 < 4) { ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 1, Math.round(this.y) - 10, 2, 6); }
    if (this.attack === 'dizzy') for (let i = 0; i < 3; i++) { const a = G.frame / 10 + i * 2.1; ctx.fillStyle = '#ffe080'; ctx.fillRect(Math.round(cx + Math.cos(a) * 14), Math.round(this.y - 6 + Math.sin(a) * 4), 2, 2); }
  }
}

// ------------------------------------------------------------------ Boss 2: 聖歌の母 アデーレ
class ChoirMother extends Boss {
  constructor(o) {
    super(o, 36, 48);
    this.hp = this.maxHp = 40; this.phaseMarks = [0.5];
    this.bloodColor = '#c8e8ff'; this.hoverY = this.room.py + 40; this.y = this.hoverY;
    this.water = 0; this.waterT = 0; this.noContact = false; this.frogs = [];
    this.music = 'boss';
  }
  onPhase(ph) { if (ph === 2) { this.waterTarget = 2.5 * TILE; } }
  fight() {
    const p = G.player;
    this.atkT++;
    // rising water in phase 2
    if (this.waterTarget && this.water < this.waterTarget) this.water += 0.25;
    if (this.water > 0) {
      const wy = this.floorY - this.water;
      if (p.y + p.h > wy + 4 && p.onGround) { if (++this.waterT % 60 === 0) p.damage(1, null); }
      else this.waterT = 0;
    }
    const sitting = this.attack === 'sit';
    this.hittable = true;
    this.modDamage = (d, kind) => (sitting || kind === 'shot' || kind === 'pound' || this.y + this.h > this.floorY - 3 * TILE ? d : 0);
    switch (this.attack) {
      case null: {
        // float at hover height, drift toward the player
        const tx = clamp(p.cx - this.w / 2, this.ax0 + 20, this.ax1 - this.w - 20);
        this.x += clamp(tx - this.x, -1.2, 1.2);
        this.y += (this.hoverY + Math.sin(this.t / 30) * 8 - this.y) * 0.05;
        this.facePlayer();
        if (--this.cool <= 0) {
          const r = Math.random();
          if (r < 0.35) this.setAttack('ring');
          else if (r < 0.65) this.setAttack('pillars');
          else if (this.phase === 2 && r < 0.8 && G.ents.filter((e) => e.summoned && !e.dead).length < 2) this.setAttack('summon');
          else this.setAttack('rise');
        }
        break;
      }
      case 'ring':
        if (this.atkT === 36) {
          sfx('shot'); bell(587, null, 0.2, 2);
          const gap = Math.atan2(p.cy - this.cy, p.cx - this.cx) + (Math.random() - 0.5) * 1.2;
          G.ents.push(new SongRing(this.cx, this.cy, gap, 2.5));
        }
        if (this.phase === 2 && this.atkT === 70) G.ents.push(new SongRing(this.cx, this.cy, Math.atan2(p.cy - this.cy, p.cx - this.cx) + Math.PI * 0.8, 2.5));
        if (this.atkT >= (this.phase === 2 ? 110 : 76)) { this.setAttack(null); this.cool = 50; }
        break;
      case 'pillars':
        if (this.atkT === 1) {
          const n = 4, span = this.ax1 - this.ax0;
          const off = Math.random() * (span / n - 2 * TILE);
          for (let i = 0; i < n; i++) {
            const x = this.ax0 + off + i * (span / n);
            hazard({ x, y: this.room.py, w: 2 * TILE, h: this.floorY - this.room.py, warn: 36, active: 30, style: 'pillar', color: '#a8e8ff', warnColor: '#a8e8ff' });
          }
          sfx('fire');
        }
        if (this.atkT >= 80) { this.setAttack(null); this.cool = 40; }
        break;
      case 'rise':
        this.y = approach(this.y, this.room.py + 8, 2);
        if (this.atkT === 1) this.tx = p.cx;
        if (this.atkT >= 30) { this.tx = p.cx; this.setAttack('dive'); sfx('dash'); }
        break;
      case 'dive': {
        const ty = this.findFloor(this.tx, this.y + this.h) - this.h;
        this.x += clamp(this.tx - this.w / 2 - this.x, -4, 4);
        this.y = approach(this.y, ty, 6);
        if (this.y >= ty - 0.5) { this.y = ty; this.setAttack('sit'); G.cam.shake = 6; sfx('boom'); dust(this.cx, this.y + this.h, 10); }
        break;
      }
      case 'sit':
        if (this.atkT >= 90) { this.setAttack('lift'); }
        break;
      case 'lift':
        this.y = approach(this.y, this.hoverY, 2);
        if (Math.abs(this.y - this.hoverY) < 2) { this.setAttack(null); this.cool = 40; }
        break;
      case 'summon':
        if (this.atkT === 30) {
          sfx('switch');
          for (let i = 0; i < 2; i++) {
            const plats = this.o.plats || [];
            const pl = plats.length ? plats[Math.floor(Math.random() * plats.length)] : null;
            const x = pl ? (this.room.tx0 + pl[0]) * TILE + 8 : clamp(p.cx + (i ? 80 : -80), this.ax0 + 16, this.ax1 - 16);
            const y = pl ? (this.room.ty0 + pl[1]) * TILE - 16 : this.room.py + 40;
            const f = G.makeEnemy('frog', x, y); f.summoned = true; G.ents.push(f);
            ring(x, y + 8, '#a8f0ff', 2, 20, 16);
          }
        }
        if (this.atkT >= 50) { this.setAttack(null); this.cool = 40; }
        break;
    }
  }
  draw(ctx) {
    // water overlay
    if (this.water > 0) {
      const wy = Math.round(this.floorY - this.water);
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#4a5a70'; ctx.fillRect(this.room.px, wy, this.room.pw, Math.ceil(this.water));
      ctx.globalAlpha = 1; ctx.fillStyle = '#c0d0e0';
      for (let x = this.room.px; x < this.room.px + this.room.pw; x += 4) ctx.fillRect(x, wy + Math.round(Math.sin(x / 10 + G.frame / 15)), 3, 1);
    }
    if (this.state === 'dying' && this.timer > 90) return;
    const f = new Figure(this.cx, this.y + this.h, this.face < 0);
    const robe = this.flashColor('#4a6a8a'), robeL = this.flashColor('#8ab0d0'), skin = this.flashColor('#e8e0f0');
    const sing = (this.attack === 'ring' && this.atkT < 36) || this.attack === 'summon';
    const sway = Math.round(Math.sin(this.t / 20) * 2);
    f.r(-18, -30, 36, 30, robe);
    f.r(-14, -40, 28, 12, robe);
    f.r(-12, -26, 6, 22, robeL, false);
    f.r(-8 + sway, -52, 16, 14, skin); // face
    f.r(-10 + sway, -56, 20, 6, '#2a3a5a'); // hood
    f.r(-3 + sway, -46, 2, 2, '#202040', false); f.r(3 + sway, -46, 2, 2, '#202040', false);
    f.r(-1 + sway, -42, 3, sing ? 4 : 1, '#401020', false);
    if (this.attack === 'sit') f.r(-20, -4, 40, 4, robe);
    f.draw(ctx);
    if (sing && this.atkT % 10 < 5) { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(Math.round(this.cx) + 8, Math.round(this.y) - 6 - (this.atkT % 20), 3, 3); ctx.fillRect(Math.round(this.cx) + 10, Math.round(this.y) - 12 - (this.atkT % 20), 1, 6); }
  }
}

// ------------------------------------------------------------------ Boss 3: 庭師 トーマ
class Gardener extends Boss {
  constructor(o) {
    super(o, 28, 40);
    this.hp = this.maxHp = 48; this.phaseMarks = [0.55];
    this.bloodColor = '#a8d090';
    this.perches = (o.perches || []).map(([x, y]) => ({ x: (this.room.tx0 + x) * TILE + 8, y: (this.room.ty0 + y) * TILE }));
    if (!this.perches.length) this.perches = [{ x: this.cx, y: this.y + this.h }];
    this.perch = 0;
  }
  onPhase(ph) {
    if (ph === 2) {
      // floor turns to thorns
      const r = this.room, fy = Math.floor(this.floorY / TILE);
      for (let x = r.tx0 + 1; x < r.tx0 + r.tw - 1; x++) {
        const t = World.tileAt(x, fy - 1);
        if (t === T.EMPTY) World.setTile(x, fy - 1, T.SPIKE);
      }
      this.thorns = fy - 1;
      G.cam.shake = 10; sfx('break');
      // a spike hit must not return the player onto the new thorns: use the nearest perch
      const p = G.player;
      let best = this.perches[0];
      for (const pr of this.perches) if (Math.abs(pr.x - p.cx) + Math.abs(pr.y - p.y) < Math.abs(best.x - p.cx) + Math.abs(best.y - p.y) && pr.y < this.floorY - TILE) best = pr;
      p.safe = { x: best.x - p.w / 2, y: best.y - p.h };
      const g = G.makeEnemy('ghost', this.room.px + 60, this.room.py + 60); g.summoned = true; G.ents.push(g);
    }
  }
  die() {
    super.die();
    if (this.thorns) { const r = this.room; for (let x = r.tx0 + 1; x < r.tx0 + r.tw - 1; x++) if (World.tileAt(x, this.thorns) === T.SPIKE && r.orig[(this.thorns - r.ty0) * r.tw + (x - r.tx0)] !== T.SPIKE) World.setTile(x, this.thorns, T.EMPTY); }
  }
  fight() {
    const p = G.player;
    this.atkT++;
    switch (this.attack) {
      case null: {
        this.facePlayer();
        if (--this.cool <= 0) {
          const r = Math.random();
          if (r < 0.4) this.setAttack(this.phase === 2 && Math.random() < 0.5 ? 'prune2' : 'prune');
          else if (r < 0.6) this.setAttack('vines');
          else if (r < 0.8) this.setAttack('seeds');
          else this.setAttack('hop');
        }
        break;
      }
      case 'hop': {
        if (this.atkT === 1) {
          let n; do { n = Math.floor(Math.random() * this.perches.length); } while (n === this.perch && this.perches.length > 1);
          this.perch = n; this.from = { x: this.x, y: this.y }; sfx('jump');
        }
        const k = Math.min(1, this.atkT / 40), pr = this.perches[this.perch];
        this.x = this.from.x + (pr.x - this.w / 2 - this.from.x) * k;
        this.y = this.from.y + (pr.y - this.h - this.from.y) * k - Math.sin(k * Math.PI) * 50;
        if (k >= 1) { this.setAttack(null); this.cool = 30; dust(this.cx, this.y + this.h, 6); }
        break;
      }
      case 'prune': case 'prune2': {
        if (this.atkT === 1) {
          this.lines = [clamp(p.cy - 4, this.room.py + 24, this.floorY - 24)];
          if (this.attack === 'prune2') this.lines.push(clamp(p.cy + (Math.random() < 0.5 ? -48 : 48), this.room.py + 24, this.floorY - 24));
          hazard({ x: this.room.px + 16, y: this.lines[0] - 6, w: this.room.pw - 32, h: 12, warn: 40, active: 12, style: 'line', color: '#ff5050' });
          sfx('fire');
        }
        if (this.attack === 'prune2' && this.atkT === 21) hazard({ x: this.room.px + 16, y: this.lines[1] - 6, w: this.room.pw - 32, h: 12, warn: 40, active: 12, style: 'line', color: '#ff5050' });
        if (this.atkT === 41 || this.atkT === 61 && this.attack === 'prune2') { sfx('attack'); G.cam.shake = 5; }
        if (this.atkT >= (this.attack === 'prune2' ? 110 : 90)) { this.setAttack(null); this.cool = 30; }
        break;
      }
      case 'vines': {
        if (this.atkT === 30) {
          sfx('switch');
          const r = this.room;
          for (let i = 0; i < 3; i++) {
            const side = i % 2 ? 1 : -1;
            const y = clamp(p.cy + (i - 1) * 64, r.py + 48, this.floorY - 48);
            const x = side < 0 ? r.px + 16 : r.px + r.pw - 16 - 4 * TILE;
            G.ents.push(new VinePlatform(x, Math.round(y / 4) * 4, 4 * TILE, 180));
          }
        }
        if (this.atkT >= 50) { this.setAttack(null); this.cool = 40; }
        break;
      }
      case 'seeds': {
        if (this.atkT === 24) {
          sfx('fire');
          for (let i = 0; i < 5; i++) {
            const x = this.room.px + 32 + Math.random() * (this.room.pw - 64);
            hazard({ x, y: this.room.py + 20, w: 6, h: 6, vy: 0, grav: 0.2, active: 400, style: 'seed', stopOnSolid: true, onLand: (h) => {
              h.dead = true;
              const ty = Math.floor((h.y + h.h) / TILE) * TILE;
              hazard({ x: Math.floor(h.cx / TILE) * TILE, y: ty, w: TILE, h: TILE, active: 300, style: 'sprout' });
            } });
          }
        }
        if (this.atkT >= 60) { this.setAttack(null); this.cool = 40; }
        break;
      }
    }
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + this.h, this.face < 0);
    const coat = this.flashColor('#4a6a3a'), skin = this.flashColor('#8a9a7a');
    const pr = this.attack === 'prune' || this.attack === 'prune2';
    f.r(-8, -26, 16, 22, coat); f.r(-6, -4, 4, 4, '#3a3020'); f.r(2, -4, 4, 4, '#3a3020');
    f.r(-7, -36, 14, 10, skin); f.r(-10, -40, 20, 4, '#6a5a3a'); f.r(-6, -44, 12, 4, '#6a5a3a'); // hat
    f.r(1, -33, 3, 2, '#e0f0a0', false);
    // shears
    const open = pr && this.atkT < 40 ? 6 : 1;
    f.r(8, -22, 3, 10, '#6a4a2a');
    f.r(10, -22 - open, 22, 3, this.flashColor('#d0d8e0')); f.r(10, -19 + open, 22, 3, this.flashColor('#b0b8c0'));
    f.draw(ctx);
  }
}

class VinePlatform extends Ent {
  constructor(x, y, w, life) { super(x, y, w, 6); this.life = life; this.solidPass = true; this.grow = 0; }
  update() {
    this.t++; this.grow = Math.min(1, this.t / 15);
    if (this.t > this.life) { this.dead = true; burst(this.cx, this.cy, '#6a9a4a', 8, 1.5, 20); return; }
    G.dynSolids.push({ x: this.x, y: this.y, w: this.w * this.grow, h: this.h, platform: true });
  }
  draw(ctx) {
    const w = Math.round(this.w * this.grow), x = Math.round(this.x), y = Math.round(this.y);
    const fading = this.life - this.t < 40 && this.t % 6 < 3;
    ctx.fillStyle = '#120c18'; ctx.fillRect(x - 1, y - 1, w + 2, 8);
    ctx.fillStyle = fading ? '#8a8a5a' : '#4a7a3a'; ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = '#8ac06a'; for (let i = 2; i < w; i += 7) ctx.fillRect(x + i, y - 2, 3, 2);
  }
}

// ------------------------------------------------------------------ Boss 4: 晶喰らい ブラム
class CrystalWyrm extends Boss {
  constructor(o) {
    super(o, 56, 22);
    this.hp = this.maxHp = 60; this.phaseMarks = [0.65, 0.3];
    this.bloodColor = '#a8f0ff';
    this.y = this.floorY + 4; this.hidden = true; this.cracked = 0; this.noContact = true;
    this.segs = [];
    this.stones = (o.stones || []);
    this.pits = o.pits || [];
  }
  modDamage(d, kind) {
    if (kind === 'pound') { this.cracked = 300; sfx('crystal'); burst(this.cx, this.y, '#a8f0ff', 14, 3, 24); return d; }
    if (this.cracked > 0) return d;
    return 1;
  }
  onPhase(ph) {
    if (ph === 2) {
      // floor collapses into spike pits
      const r = this.room, fy = Math.floor(this.floorY / TILE);
      for (const px of this.pits) for (let dx = 0; dx < 4; dx++) {
        World.setTile(r.tx0 + px + dx, fy, T.SPIKE);
        burst((r.tx0 + px + dx) * TILE + 8, fy * TILE, '#8a70b0', 4, 2, 20);
      }
      G.cam.shake = 12; sfx('break');
    }
  }
  die() {
    super.die();
    const r = this.room, fy = Math.floor(this.floorY / TILE);
    for (const px of this.pits) for (let dx = 0; dx < 4; dx++) World.setTile(r.tx0 + px + dx, fy, T.SOLID);
  }
  fight() {
    const p = G.player;
    this.atkT++;
    if (this.cracked > 0) this.cracked--;
    this.hittable = !this.hidden;
    this.noContact = this.hidden;
    switch (this.attack) {
      case null:
        this.hidden = true; this.y = this.floorY + 4;
        if (--this.cool <= 0) {
          const r = Math.random();
          if (this.phase === 3 && r < 0.4) this.setAttack('chargePrep');
          else if (r < 0.7) { this.setAttack('bulge'); this.count = this.phase >= 2 ? 2 : 1; }
          else this.setAttack('spit');
        }
        break;
      case 'bulge':
        if (this.atkT === 1) { this.tx = clamp(p.cx, this.ax0 + 30, this.ax1 - 30); sfx('boom'); }
        if (this.atkT % 3 === 0) burst(this.tx + (Math.random() - 0.5) * 30, this.floorY, '#a8f0ff', 2, 2, 16);
        if (this.atkT >= (this.count === 1 && this.phase >= 2 && this.second ? 20 : 30)) {
          this.setAttack('leap'); this.hidden = false;
          this.x = this.tx - this.w / 2; this.y = this.floorY - this.h;
          this.vy = -9.0; this.vx = (p.cx < this.tx ? -1 : 1) * 2.2; this.face = Math.sign(this.vx);
          G.cam.shake = 6; sfx('crystal');
          hazard({ x: this.tx - 20, y: this.floorY - 32, w: 40, h: 32, active: 8, style: 'none', color: 'rgba(0,0,0,0)' });
        }
        break;
      case 'leap':
        this.x += this.vx; this.y += this.vy; this.vy += 0.38;
        this.noContact = false;
        this.x = clamp(this.x, this.ax0, this.ax1 - this.w);
        if (this.vy > 0 && this.y + this.h >= this.floorY) { this.y = this.floorY - this.h; this.setAttack('crawl'); G.cam.shake = 5; sfx('boom'); }
        break;
      case 'crawl':
        // back exposed on the surface: pound chance
        this.noContact = false;
        this.x += this.face * 0.6; this.x = clamp(this.x, this.ax0, this.ax1 - this.w);
        if (this.atkT >= 40) {
          this.hidden = true; this.y = this.floorY + 4; burst(this.cx, this.floorY, '#a8f0ff', 10, 2, 20);
          this.count--;
          if (this.count > 0) { this.second = true; this.setAttack('bulge'); }
          else { this.second = false; this.setAttack(null); this.cool = 50; }
        }
        break;
      case 'spit':
        if (this.atkT === 1) { this.hidden = false; this.x = clamp(p.cx + (Math.random() < 0.5 ? -120 : 120), this.ax0, this.ax1 - this.w); this.y = this.floorY - 14; this.facePlayer(); }
        this.noContact = false;
        if (this.atkT === 30) {
          sfx('crystal');
          const a0 = Math.atan2(p.cy - this.cy, p.cx - this.cx);
          for (const da of [-0.35, 0, 0.35]) G.spawnProjectile({ x: this.cx, y: this.y, vx: Math.cos(a0 + da) * 2.6, vy: Math.sin(a0 + da) * 2.6, owner: 'enemy', color: '#a8f0ff', life: 200 });
        }
        if (this.atkT >= 60) { this.hidden = true; this.y = this.floorY + 4; this.setAttack(null); this.cool = 40; }
        break;
      case 'chargePrep':
        if (this.atkT === 1) { this.hidden = false; const left = p.cx > (this.ax0 + this.ax1) / 2; this.x = left ? this.ax0 : this.ax1 - this.w; this.face = left ? 1 : -1; this.y = this.floorY - this.h; sfx('roar'); }
        this.noContact = false;
        if (this.atkT >= 40) this.setAttack('charge');
        break;
      case 'charge':
        this.x += this.face * 5.0; this.noContact = false;
        if (this.atkT % 2 === 0) dust(this.cx - this.face * 20, this.floorY, 2, -this.face);
        if (this.x <= this.ax0 || this.x + this.w >= this.ax1) { this.x = clamp(this.x, this.ax0, this.ax1 - this.w); this.setAttack('stun'); this.cracked = 80; G.cam.shake = 10; sfx('boom'); }
        break;
      case 'stun':
        this.noContact = true;
        if (this.atkT >= 80) { this.hidden = true; this.y = this.floorY + 4; this.setAttack(null); this.cool = 50; }
        break;
    }
    // contact damage is 2 during charge
    if (!this.noContact) {
      const pl = G.player;
      if (!pl.dead && overlap(this, { x: pl.x + 1, y: pl.y + 2, w: pl.w - 2, h: pl.h - 2 })) pl.damage(this.attack === 'charge' ? 2 : 1, this);
    }
  }
  draw(ctx) {
    if (this.hidden) {
      if (this.attack === 'bulge') {
        const x = Math.round(this.tx), y = Math.round(this.floorY);
        ctx.fillStyle = '#7a6c90'; ctx.fillRect(x - 16, y - 3 - (this.atkT >> 3), 32, 3 + (this.atkT >> 3));
      }
      return;
    }
    const f = new Figure(this.cx, this.y + this.h, this.face < 0);
    const body = this.flashColor('#6a5a88');
    const armor = this.cracked > 0 ? (this.cracked % 10 < 5 ? '#ff9090' : '#c06070') : this.flashColor('#88e0f8');
    for (let i = 0; i < 5; i++) {
      const sx = -24 + i * 10, sy = Math.round(Math.sin(this.t / 6 + i) * 1.5);
      f.r(sx, -18 + sy, 10, 16, body);
      f.r(sx + 1, -22 + sy, 8, 5, armor);
    }
    f.r(24, -16, 12, 14, body); // head
    f.r(32, -12, 6, 3, '#ffe0f0'); f.r(34, -7, 4, 3, '#ffe0f0'); // mandibles
    f.r(28, -14, 2, 2, '#ffff80', false);
    f.draw(ctx);
    if (this.attack === 'stun') for (let i = 0; i < 3; i++) { const a = G.frame / 10 + i * 2.1; ctx.fillStyle = '#ffe080'; ctx.fillRect(Math.round(this.cx + Math.cos(a) * 18), Math.round(this.y - 8 + Math.sin(a) * 4), 2, 2); }
  }
}

// Ringing stone (鳴り石): bounce target for the pound.
export class RingStone extends Ent {
  constructor(o) { super(o.tx * TILE, o.ty * TILE, 16, 14); this.bounceable = true; this.hittable = false; this.parryable = true; this.ringT = 0; }
  ringStone() { this.ringT = 30; sfx('switch'); bell(660 + Math.random() * 200, null, 0.12, 1.5); ring(this.cx, this.cy, '#ffe9a8', 4, 24, 14); }
  parry() { this.ringStone(); }
  update() { this.t++; if (this.ringT > 0) this.ringT--; }
  draw(ctx) {
    const sh = this.ringT > 0 ? Math.round(Math.sin(this.ringT) * 1.5) : 0;
    const f = new Figure(this.cx + sh, this.y + 14, false);
    f.r(-1, -16, 2, 3, '#4a4050');
    f.r(-5, -13, 10, 9, this.ringT > 0 ? '#fff0c0' : '#8a8090'); f.r(-7, -4, 14, 3, '#a8a0b0'); f.r(-3, -12, 2, 5, '#c8c0d0', false);
    f.draw(ctx);
  }
}

// ------------------------------------------------------------------ Boss 5: 司書 イルマ
class Librarian extends Boss {
  afterReward() { ui.scene([{ speaker: SPEAKER.IRMA }, ...seq('IRMA_POST')]); }
  constructor(o) {
    super(o, 24, 34);
    this.hp = this.maxHp = 72; this.phaseMarks = [0.65, 0.3];
    this.bloodColor = '#f0e8d0';
    this.spots = (o.spots || []).map(([x, y]) => ({ x: (this.room.tx0 + x) * TILE + 8, y: (this.room.ty0 + y) * TILE }));
    if (!this.spots.length) this.spots = [{ x: this.cx, y: this.y + this.h }];
    const lp = o.lamp || [15, 2];
    this.lamp = new LampBell({ tx: this.room.tx0 + lp[0], ty: this.room.ty0 + lp[1] }, this);
    G.ents.push(this.lamp);
    this.alcoves = o.alcoves || [];
    this.music = 'boss';
  }
  introSteps() {
    return [{ speaker: this.speaker }, S('BOSS5_ASK'), { choice: [{ label: S('CHOICE_BOSS5_A') }, { label: S('CHOICE_BOSS5_B') }] }, S('BOSS5_INTRO')];
  }
  modDamage(d) { return this.attack === 'fallen' || this.attack === 'falling' ? d : Math.min(d, 1); }
  lampRung() {
    if (this.state !== 'fight' || this.attack === 'falling' || this.attack === 'fallen') return;
    this.setAttack('falling'); sfx('roar');
  }
  fight() {
    const p = G.player;
    this.atkT++;
    switch (this.attack) {
      case null:
        this.facePlayer();
        this.y += Math.sin(this.t / 20) * 0.2;
        if (--this.cool <= 0) {
          const r = Math.random();
          if (r < 0.3) this.setAttack('teleport');
          else if (r < 0.6) this.setAttack('pages');
          else if (this.phase >= 2 && r < 0.75 && G.ents.filter((e) => e.summoned && !e.dead).length < 2) this.setAttack('ghosts');
          else if (this.phase >= 3 && r < 0.95) this.setAttack('hush');
          else this.setAttack('teleport');
        }
        break;
      case 'teleport':
        if (this.atkT === 1) {
          let n; do { n = Math.floor(Math.random() * this.spots.length); } while (this.spots.length > 1 && Math.abs(this.spots[n].x - this.cx) < 20);
          this.dest = this.spots[n]; sfx('glide');
        }
        if (this.atkT < 20 && this.atkT % 3 === 0) burst(this.dest.x, this.dest.y - 16, '#f0e8d0', 2, 1.5, 20);
        if (this.atkT === 20) { burst(this.cx, this.cy, '#f0e8d0', 10, 2, 20); this.x = this.dest.x - this.w / 2; this.y = this.dest.y - this.h; burst(this.cx, this.cy, '#f0e8d0', 10, 2, 20); }
        if (this.atkT >= 30) { this.setAttack(null); this.cool = 30; }
        break;
      case 'pages':
        if (this.atkT === 30) {
          sfx('glide');
          const n = this.phase >= 3 ? 5 : 4;
          for (let i = 0; i < n; i++) { const pg = new Page(this.cx + (i - n / 2) * 12, this.y - 4, 90, this.phase >= 3 ? 1.9 : 1.5); pg.summoned = true; G.ents.push(pg); }
        }
        if (this.atkT >= 60) { this.setAttack(null); this.cool = 50; }
        break;
      case 'ghosts':
        if (this.atkT === 30) {
          for (let i = 0; i < 2; i++) { const g = G.makeEnemy('ghost', this.room.px + 40 + i * (this.room.pw - 80), this.room.py + 60); g.summoned = true; g.hp = 4; G.ents.push(g); }
          sfx('roar');
        }
        if (this.atkT >= 50) { this.setAttack(null); this.cool = 50; }
        break;
      case 'hush':
        if (this.atkT === 1) {
          sfx('roar');
          // grey wave from the top; alcoves are safe
          const r = this.room;
          G.ents.push(new HushWave(r, this.alcoves.map(([x, y, w, h]) => ({ x: (r.tx0 + x) * TILE, y: (r.ty0 + y) * TILE, w: (w || 2) * TILE, h: (h || 2) * TILE }))));
        }
        if (this.atkT >= 170) { this.setAttack(null); this.cool = 60; }
        break;
      case 'falling': {
        this.y += 5;
        const fy = this.findFloor(this.cx, this.y);
        if (this.y + this.h >= fy) { this.y = fy - this.h; this.setAttack('fallen'); G.cam.shake = 6; sfx('boom'); }
        break;
      }
      case 'fallen':
        if (this.atkT >= 120) this.setAttack('teleport');
        break;
    }
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + this.h, this.face < 0);
    const robe = this.flashColor('#6a3a3a'), skin = this.flashColor('#f0e0d0');
    const ears = this.attack === 'fallen' || this.attack === 'falling';
    f.r(-10, -24, 20, 24, robe); f.r(-8, -22, 4, 18, '#8a5a4a', false);
    f.r(-6, -32, 12, 9, skin); f.r(-7, -35, 14, 4, '#3a2a2a'); f.r(-8, -30, 2, 10, '#3a2a2a');
    f.r(1, -29, 4, 1, '#202020', false); // glasses
    if (ears) { f.r(-9, -30, 3, 6, skin); f.r(6, -30, 3, 6, skin); }
    else { f.r(8, -20, 8, 10, '#e8dcc0'); f.r(9, -18, 6, 1, '#6a5a4a', false); }
    f.draw(ctx);
  }
}

class LampBell extends Ent {
  constructor(o, boss) { super(o.tx * TILE, o.ty * TILE, 20, 18); this.boss = boss; this.shootable = true; this.cool = 0; }
  shoot() {
    if (this.cool > 0) return;
    this.cool = 60; this.ringT = 40;
    bell(880, null, 0.3, 2.5); ring(this.cx, this.cy, '#ffe9a8', 6, 60, 24);
    this.boss.lampRung();
  }
  update() { this.t++; if (this.cool > 0) this.cool--; if (this.ringT > 0) this.ringT--; if (this.boss.dead) this.dead = true; }
  draw(ctx) {
    const sw = this.ringT > 0 ? Math.round(Math.sin(this.ringT / 2) * 2) : 0;
    const f = new Figure(this.cx + sw, this.y + 18, false);
    f.r(-1, -30, 2, 14, '#4a3a30');
    f.r(-8, -16, 16, 12, '#c8a050'); f.r(-10, -5, 20, 3, '#e8c070'); f.r(-5, -14, 3, 6, '#fff0b0', false);
    f.draw(ctx);
    ctx.globalAlpha = 0.18; pcircle(ctx, this.cx, this.cy + 8, 18, '#ffe9a8'); ctx.globalAlpha = 1;
  }
}

class HushWave extends Ent {
  constructor(r, safe) { super(r.px, r.py - 30, r.pw, 30); this.room = r; this.safe = safe; this.front = true; }
  update() {
    this.t++;
    if (this.t < 50) return; // telegraph: screen drains
    this.y += 2.2;
    if (this.y > this.room.py + this.room.ph) { this.dead = true; return; }
    const p = G.player;
    if (p.cy > this.y && p.cy < this.y + this.h) {
      const inSafe = this.safe.some((s) => overlap({ x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 4 }, s));
      if (!inSafe) p.damage(2, null);
    }
  }
  draw(ctx) {
    if (this.t < 50) { ctx.globalAlpha = (this.t / 50) * 0.3; ctx.fillStyle = '#808090'; ctx.fillRect(this.room.px, this.room.py, this.room.pw, this.room.ph); ctx.globalAlpha = 1; for (const s of this.safe) { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(s.x, s.y + s.h - 2, s.w, 2); } return; }
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#8a8a9a'; ctx.fillRect(this.x, this.y, this.w, this.h); ctx.globalAlpha = 1;
    ctx.fillStyle = '#d0d0e0'; ctx.fillRect(this.x, Math.round(this.y + this.h - 2), this.w, 2);
    for (const s of this.safe) { ctx.globalAlpha = 0.4; ctx.fillStyle = '#ffe9a8'; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.globalAlpha = 1; }
  }
}

// ------------------------------------------------------------------ Final: 沈黙の王 ヴェスパー
// Phase 1 (mirror duel) and phase 2 (silence hall) are separate rooms; phase 3 is the heart shaft.
class VesperDuel extends Boss {
  constructor(o) {
    super(o, 12, 24);
    this.hp = this.maxHp = 60; this.phaseMarks = [];
    this.bloodColor = '#c0c0d0'; this.info = { n: 6 };
    this.music = 'final';
  }
  get name() { return S('VESPER_NAME'); }
  get speaker() { return SPEAKER.VESPER; }
  introSteps() {
    const st = [{ speaker: SPEAKER.VESPER }];
    if (!G.save.flags.vesper_woke) { G.save.flags.vesper_woke = true; st.push(...seq('VESPER_WAKE')); }
    st.push(...seq('VESPER_INTRO'));
    return st;
  }
  fight() {
    const p = G.player;
    this.atkT++;
    this.vy = Math.min(this.vy + 0.45, 8);
    switch (this.attack) {
      case null:
        this.facePlayer();
        this.vx = approach(this.vx, this.face * 1.6, 0.2);
        if (Math.abs(p.cx - this.cx) < 30) this.vx = approach(this.vx, 0, 0.4);
        if (--this.cool <= 0) {
          const d = Math.abs(p.cx - this.cx), r = Math.random();
          if (d < 50 && r < 0.6) this.setAttack('strike');
          else if (r < 0.6) this.setAttack('dash');
          else this.setAttack('wall');
        }
        break;
      case 'strike':
        this.vx = approach(this.vx, 0, 0.5);
        if (this.atkT === 18 || this.atkT === 30 || this.atkT === 42) {
          sfx('attack');
          hazard({ x: this.face > 0 ? this.x + this.w : this.x - 32, y: this.y, w: 32, h: 20, active: 6, style: 'none', color: 'rgba(0,0,0,0)' });
          G.fx.push({ kind: 'slash', x: this.cx + this.face * 6, y: this.cy, dir: this.face, up: false, color: '#c0a0ff', t: 0, life: 8 });
        }
        if (this.atkT >= 90) { this.setAttack(null); this.cool = 20; }
        break;
      case 'dash':
        if (this.atkT < 24) { this.vx = approach(this.vx, 0, 0.5); this.facePlayer(); }
        else if (this.atkT < 40) {
          if (this.atkT === 24) sfx('dash');
          this.vx = this.face * 8.0;
          if (this.atkT % 2 === 0) G.fx.push({ kind: 'ghost', x: this.cx, y: this.y + this.h, face: this.face, t: 0, life: 10, phase: true });
          if (this.hitWall) this.atkT = 40;
        } else { this.vx = approach(this.vx, 0, 0.5); if (this.atkT >= 84) { this.setAttack(null); this.cool = 20; } }
        break;
      case 'wall': {
        if (this.atkT === 1) { this.side = p.cx < (this.ax0 + this.ax1) / 2 ? 1 : -1; }
        const wx = this.side > 0 ? this.ax1 - this.w - 2 : this.ax0 + 2;
        if (this.atkT < 30) {
          this.x += clamp(wx - this.x, -5, 5); this.y = approach(this.y, this.floorY - 100, 5); this.vy = 0;
        } else if (this.atkT === 30) {
          sfx('wall'); this.tx = p.cx; this.vy = -3; this.vx = clamp((this.tx - this.cx) / 30, -6, 6);
        } else if (this.atkT < 60) {
          this.vy = 0;
          if (Math.abs(this.cx - this.tx) < 6 || this.atkT >= 58) { this.vx = 0; this.setAttack('pound'); }
        }
        if (this.atkT < 30) { moveBodyFree(this); return; }
        break;
      }
      case 'pound':
        this.vx = 0; this.vy = this.atkT < 6 ? 0 : 12;
        if (this.onGround && this.atkT > 6) {
          sfx('pound'); G.cam.shake = 8; ring(this.cx, this.y + this.h, '#c0a0ff', 4, 40, 16);
          hazard({ x: this.cx - 40, y: this.y + this.h - 16, w: 80, h: 16, active: 6, style: 'none', color: 'rgba(0,0,0,0)' });
          this.setAttack('recover');
        }
        break;
      case 'recover': this.vx = 0; if (this.atkT >= 45) { this.setAttack(null); this.cool = 15; } break;
    }
    moveBody(this);
  }
  afterReward() {}
  reward() {
    G.save.flags.vesper1 = true;
    G.bossLock = false; G.boss = null; writeSave(G.save);
    ui.dialog(seq('VESPER_PHASE2'), SPEAKER.VESPER);
    playMusic('crown');
  }
  draw(ctx) {
    // a grey tuning doll like Rio
    const f = new Figure(this.cx, this.y + this.h, this.face < 0);
    const c = this.flashColor('#7a7a8a'), d = this.flashColor('#4a4a5a');
    f.r(-4, -6, 3, 6, d); f.r(1, -6, 3, 6, d);
    f.r(-4, -12, 8, 7, c);
    f.r(-6, -13, 12, 2, '#5a4a7a');
    f.r(-5, -21, 10, 8, this.flashColor('#9a9aaa')); f.r(-4, -22, 8, 1, '#9a9aaa');
    f.r(0, -19, 4, 3, '#1c2030', false); f.r(1, -18, 2, 1, '#c0a0ff', false);
    f.r(-6, -26, 12, 3, '#3a3048'); f.r(-3, -29, 6, 3, '#3a3048'); // crown
    if (this.attack === 'strike') { f.r(4, -12, 9, 2, '#4a3a5a'); f.r(12, -15, 5, 8, '#b0a0d0'); }
    else { f.r(-7, -18, 2, 10, '#4a3a5a'); f.r(-10, -21, 8, 4, '#b0a0d0'); }
    f.draw(ctx);
    if (this.attack === 'strike' && this.atkT < 18 && this.atkT % 6 < 3) { ctx.fillStyle = '#c0a0ff'; ctx.fillRect(Math.round(this.cx) - 1, Math.round(this.y) - 8, 2, 4); }
    if (this.attack === 'dash' && this.atkT < 24) { ctx.fillStyle = '#c0a0ff'; ctx.fillRect(Math.round(this.x) - 2, Math.round(this.y + this.h) - 1, this.w + 4, 1); }
  }
}
function moveBodyFree(b) { b.x += b.vx || 0; }

class VesperHall extends Boss {
  constructor(o) {
    super(o, 30, 44);
    this.hp = this.maxHp = 60; this.phaseMarks = [];
    this.info = { n: 6 }; this.music = 'final';
    this.hoverY = this.room.py + 50; this.y = this.hoverY;
    this.membranes = [];
  }
  get name() { return S('VESPER_NAME'); }
  get speaker() { return SPEAKER.VESPER; }
  introSteps() { return [{ speaker: SPEAKER.VESPER }, S('VESPER_PHASE2_03')]; }
  modDamage(d, kind) { return this.attack === 'tired' || kind === 'shot' ? d : (this.y + this.h > this.floorY - 3 * TILE ? d : 0); }
  clearMembranes() {
    for (const [x, y] of this.membranes) if (World.tileAt(x, y) === T.MEMBRANE) World.setTile(x, y, T.EMPTY);
    this.membranes = [];
  }
  die() { super.die(); this.clearMembranes(); }
  fight() {
    const p = G.player;
    this.atkT++;
    switch (this.attack) {
      case null: {
        const tx = clamp(p.cx - this.w / 2 + Math.sin(this.t / 50) * 80, this.ax0 + 20, this.ax1 - this.w - 20);
        this.x += clamp(tx - this.x, -1.5, 1.5);
        this.y += (this.hoverY + Math.sin(this.t / 25) * 6 - this.y) * 0.05;
        this.facePlayer();
        if (--this.cool <= 0) {
          const r = Math.random();
          if (r < 0.3) this.setAttack('walls');
          else if (r < 0.65) this.setAttack('spears');
          else if (r < 0.8 && G.ents.filter((e) => e.summoned && !e.dead).length < 3) this.setAttack('ghosts');
          else this.setAttack('descend');
        }
        break;
      }
      case 'walls':
        if (this.atkT === 30) {
          this.clearMembranes();
          sfx('phase');
          const r = this.room, fy = Math.floor(this.floorY / TILE);
          const n = 2 + (Math.random() < 0.5 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const tx = r.tx0 + Math.floor(((i + 1) / (n + 1)) * r.tw);
            for (let y = fy - 6; y < fy; y++) for (let k = 0; k < 2; k++) if (World.tileAt(tx + k, y) === T.EMPTY) { World.setTile(tx + k, y, T.MEMBRANE); this.membranes.push([tx + k, y]); }
          }
        }
        if (this.atkT >= 50) { this.setAttack(null); this.cool = 30; this.memT = 360; }
        break;
      case 'spears':
        if (this.atkT === 1) sfx('roar');
        if (this.atkT >= 40 && this.atkT <= 100 && (this.atkT - 40) % 15 === 0) {
          const x = p.cx - 5;
          hazard({ x, y: this.room.py + 8, w: 10, h: this.floorY - this.room.py - 8, warn: 30, active: 14, style: 'pillar', dmg: 2, color: '#c0a0ff', warnColor: '#c0a0ff' });
        }
        if (this.atkT >= 150) { this.setAttack(null); this.cool = 40; }
        break;
      case 'ghosts':
        if (this.atkT === 30) {
          sfx('roar');
          for (let i = 0; i < 3; i++) { const g = G.makeEnemy('ghost', this.room.px + 40 + i * ((this.room.pw - 80) / 2), this.room.py + 40); g.summoned = true; g.hp = 4; G.ents.push(g); }
        }
        if (this.atkT >= 50) { this.setAttack(null); this.cool = 40; }
        break;
      case 'descend': {
        if (this.atkT === 1) this.tx = p.cx;
        const ty = this.floorY - this.h;
        this.x += clamp(this.tx - this.w / 2 - this.x, -3, 3);
        this.y = approach(this.y, ty, 3);
        if (this.y >= ty) { this.setAttack('tired'); sfx('boom'); G.cam.shake = 5; }
        break;
      }
      case 'tired':
        if (this.atkT >= 100) this.setAttack('rise');
        break;
      case 'rise':
        this.y = approach(this.y, this.hoverY, 2);
        if (Math.abs(this.y - this.hoverY) < 2) { this.setAttack(null); this.cool = 30; }
        break;
    }
    if (this.memT > 0 && --this.memT === 0) this.clearMembranes();
  }
  reward() {
    G.save.flags.vesper2 = true;
    G.bossLock = false; G.boss = null; writeSave(G.save);
    playMusic('crown');
    ui.toast('撞木が揺れている。上へ。');
  }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + this.h, this.face < 0);
    const robe = this.flashColor('#3a3048'), robeL = this.flashColor('#5a4a6a');
    f.r(-15, -30, 30, 30, robe); f.r(-12, -28, 6, 24, robeL, false);
    f.r(-7, -40, 14, 11, this.flashColor('#9a9aaa'));
    f.r(-9, -44, 18, 4, '#c8b070'); f.r(-7, -48, 3, 4, '#c8b070'); f.r(-1, -49, 3, 5, '#c8b070'); f.r(5, -48, 3, 4, '#c8b070');
    f.r(1, -36, 4, 2, '#c0a0ff', false);
    f.draw(ctx);
  }
}

// Phase 3: the clapper's heart. Ring five small bells in order Do-Re-Mi-Fa-So.
class HeartBells extends Ent {
  constructor(o) {
    super(o.tx * TILE, o.ty * TILE, 16, 16);
    this.o = o; this.room = G.room;
    this.bells = (o.bells || []).map(([x, y], i) => new NoteBell({ tx: this.room.tx0 + x, ty: this.room.ty0 + y }, i, this));
    for (const b of this.bells) G.ents.push(b);
    this.next = 0; this.done = !!G.save.flags.heart_done; this.waveT = 120; this.spearT = 200;
    this.started = false;
  }
  rung(i) {
    if (this.done) return;
    if (i === this.next) {
      this.next++; bell(261.6 * Math.pow(2, [0, 2, 4, 5, 7][i] / 12), null, 0.3, 4);
      ring(this.bells[i].cx, this.bells[i].cy, '#ffe9a8', 4, 40, 24);
      if (this.next >= 5) this.finish();
    } else sfx('clink');
  }
  update() {
    this.t++;
    if (this.done) return;
    const p = G.player, r = this.room;
    if (!this.started) { if (p.onGround && p.cy > r.py + r.ph - 80) { this.started = true; playMusic('final'); ui.toast('五つの鐘を、ド・レ・ミ・ファ・ソの順に鳴らせ'); } else return; }
    // hazards: silence waves from above with one gap, spears from the side
    if (--this.waveT <= 0) {
      this.waveT = 200;
      const gapX = r.px + 32 + Math.random() * (r.pw - 96);
      const y = clamp(p.y - 120, r.py, r.py + r.ph);
      hazard({ x: r.px + 16, y, w: gapX - r.px - 16, h: 10, warn: 30, active: 140, vy: 1.2, style: 'silence' });
      hazard({ x: gapX + 48, y, w: r.px + r.pw - 16 - gapX - 48, h: 10, warn: 30, active: 140, vy: 1.2, style: 'silence' });
    }
    if (--this.spearT <= 0) {
      this.spearT = 150;
      const side = Math.random() < 0.5 ? -1 : 1;
      const y = p.cy - 4;
      hazard({ x: side < 0 ? r.px + 16 : r.px + r.pw - 16 - 40, y, w: 40, h: 8, warn: 40, active: 120, vx: -side * 3.5, style: 'spear', color: '#c0a0ff', dmg: 2, warnColor: '#c0a0ff' });
    }
  }
  finish() {
    this.done = true;
    G.save.flags.heart_done = true;
    for (const e of G.ents) if (e instanceof Hazard) e.dead = true;
    writeSave(G.save);
    playMusic('silence');
    const c = this.o.core || [15, 6], p = G.player;
    p.x = (this.room.tx0 + c[0]) * TILE + 8 - p.w / 2; p.y = (this.room.ty0 + c[1]) * TILE - p.h; p.vx = 0; p.vy = 0; p.gliding = false;
    ring(p.cx, p.cy, '#ffffff', 6, 80, 30);
    finalSequence();
  }
  draw() {}
}

class NoteBell extends Ent {
  constructor(o, i, heart) { super(o.tx * TILE, o.ty * TILE, 16, 16); this.i = i; this.heart = heart; this.shootable = true; this.parryable = true; this.lit = false; }
  shoot() { this.heart.rung(this.i); }
  parry() { this.heart.rung(this.i); }
  update() { this.t++; this.lit = this.heart.next > this.i || this.heart.done; }
  draw(ctx) {
    const f = new Figure(this.cx, this.y + 16, false);
    const c = this.lit ? '#ffe9a8' : '#8a7a5a';
    f.r(-1, -18, 2, 3, '#4a4050'); f.r(-5, -15, 10, 10, c); f.r(-7, -5, 14, 3, this.lit ? '#fff6d0' : '#a08a60');
    f.draw(ctx);
    ctx.font = '7px monospace'; ctx.fillStyle = this.lit ? '#ffffff' : '#c0b090';
    ctx.fillText(['ド', 'レ', 'ミ', 'ファ', 'ソ'][this.i], Math.round(this.cx) - 4, Math.round(this.y) - 6);
  }
}

// The final strike / retune. The player presses the button themselves.
function finalSequence() {
  const S2 = G.save;
  const all = S2.scores.length >= 12;
  const steps = [{ speaker: SPEAKER.VESPER }, ...seq('VESPER_DEFEAT')];
  ui.scene(steps, () => {
    if (all) {
      ui.playScoreNow(12);
      G.when(() => !ui.subtitleActive() && !G.dialog, () => {
        ui.scene([{ speaker: SPEAKER.VESPER }, ...seq('VESPER_TRUE', 1, 5), { choice: [
          { label: S('CHOICE_BELL_A'), steps: [S('VESPER_NORMAL_01')], fn: () => { G.finalChoice = 'normal'; } },
          { label: S('CHOICE_BELL_B'), steps: seq('VESPER_TRUE', 6, 8), fn: () => { G.finalChoice = 'true'; } },
        ] }], () => { G.finalPrompt = { kind: G.finalChoice || 'normal', t: 0 }; });
      });
    } else {
      ui.scene([{ choice: [{ label: S('CHOICE_BELL_A'), fn: () => { G.finalChoice = 'normal'; } }] }], () => { G.finalPrompt = { kind: 'normal', t: 0 }; });
    }
  });
}

// Waits for the player's final input: X (strike) for normal, hold ↓ (tune) for true.
export class FinalPrompt extends Ent {
  constructor() { super(0, 0, 1, 1); this.hold = 0; this.front = true; }
  update() {
    const fp = G.finalPrompt;
    if (!fp) return;
    fp.t++;
    if (fp.kind === 'true') {
      if (input.held.down) { this.hold++; if (this.hold % 10 === 1) sfx('blip'); } else this.hold = 0;
      if (this.hold >= 50) { G.finalPrompt = null; G.startEnding('true'); }
    } else if (input.pressed.attack) {
      G.finalPrompt = null; bell(110, null, 0.5, 6); G.cam.shake = 12;
      const t0 = G.frame; G.when(() => G.frame - t0 > 70, () => G.startEnding('normal'));
    }
  }
  draw(ctx) {
    const fp = G.finalPrompt;
    if (!fp) return;
    ui.prompt(G.player.cx, G.player.y - 30, fp.kind === 'true' ? '↓ を長押しして、調律する' : 'X で、撞木を鳴らす');
    if (this.hold > 0) { ctx.fillStyle = '#7ff7e6'; ctx.fillRect(Math.round(G.player.cx) - 10, Math.round(G.player.y) - 8, Math.round(20 * this.hold / 50), 2); }
  }
}

// ------------------------------------------------------------------ factory
export function makeBoss(o) {
  if (o.id === 'heart') { const h = new HeartBells(o); G.ents.push(new FinalPrompt()); return h; }
  if (o.id === 'stone') return new RingStone(o);
  if (o.id === 'vesper1') { if (G.save.flags.vesper1) return null; return new VesperDuel(o); }
  if (o.id === 'vesper2') { if (G.save.flags.vesper2) return null; return new VesperHall(o); }
  if (G.save.flags['boss_' + o.id]) return null;
  switch (o.id) {
    case 'gear': return new GearWarden(o);
    case 'choir': return new ChoirMother(o);
    case 'gardener': return new Gardener(o);
    case 'wyrm': return new CrystalWyrm(o);
    case 'librarian': return new Librarian(o);
  }
  console.warn('unknown boss', o.id);
  return null;
}
