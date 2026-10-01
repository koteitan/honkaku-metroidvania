// The player: Rio the tuning automaton.
import { TILE, clamp, approach, overlap } from './util.js';
import { input, consume } from './input.js';
import { G } from './state.js';
import { moveBody, rectSolid, touchesSpike, inWater, inUpdraft, tilesInRect } from './physics.js';
import { T } from './tiles.js';
import { World } from './world.js';
import { sfx } from './audio.js';
import { burst, dust, ring, slash, spawnFx, fxDrawers } from './fx.js';
import { Figure } from './gfx.js';
import { breakTile, spawnProjectile } from './entities.js';

// Movement tuning (60fps). Values from design.md §2-§4.
export const P = {
  run: 2.75, accelG: 0.92, decelG: 1.4, accelA: 0.74, decelA: 0.35,
  gravUp: 0.45, gravDown: 0.70, maxFall: 8.0, jumpV: 6.9, cutMul: 0.4, cutMinT: 3, apexV: 1.0,
  djumpV: 6.6, coyote: 6, buffer: 8, wallCoyote: 5,
  dashV: 8.0, dashT: 8, dashCD: 6,
  wallSlide: 1.5, wallJumpVX: 3.2, wallJumpVY: 6.4, wallLock: 7,
  glideFall: 1.33, updraftAcc: 0.5, updraftMax: 4.0,
  poundHang: 6, poundV: 12, poundBounce: 7.5, poundLag: 10, poundR: 40,
  atkStart: 3, atkActive: 4, atkRecover: 10, atkBuffer: 6,
  shotV: 6.0, shotLife: 32, shotCD: 20,
  iframes: 75, hurtLock: 12, kbX: 3.0, kbY: 3.0,
  healTime: 50, healCost: 70, gaugeMax: 100, gaugeHit: 14,
  waterGrav: 0.22, waterMaxFall: 2.4, waterRun: 1.7, waterJumpV: 4.6,
};
const ATK_TOTAL = P.atkStart + P.atkActive + P.atkRecover;

export class Player {
  constructor(x, y) {
    this.w = 10; this.h = 22;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.face = 1;
    this.onGround = true; this.wasGround = true;
    this.coyote = 0; this.jumpBuf = 0; this.jumping = false; this.jumpT = 0;
    this.airJumps = 0; this.airDash = true;
    this.dashT = 0; this.dashCD = 0; this.dashDir = 1; this.phasing = false; this.dashBuf = 0;
    this.wallDir = 0; this.wallSliding = false; this.wallLock = 0; this.wallCoyote = 0; this.lastWall = 0;
    this.gliding = false; this.glideArmed = false;
    this.pounding = 0; this.poundLag = 0;
    this.atkT = 0; this.atkUp = false; this.atkHits = new Set(); this.atkBuf = 0; this.recoil = 0;
    this.shotCD = 0;
    this.inv = 0; this.ctrlLock = 0;
    this.healT = 0;
    this.dropT = 0;
    this.anim = 0; this.stepT = 0;
    this.safe = { x, y };
    this.safeT = 0;
    this.dead = false; this.deadT = 0;
    this.spikeT = 0;
    this.squash = 0;
    this.silenced = 0;
  }

  get ab() { return G.save.abilities; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update() {
    const I = input;
    const S = G.save;
    if (this.dead) { this.deadT++; return; }
    if (this.spikeT > 0) { this.updateSpikeReturn(); return; }

    this.anim++;
    if (this.inv > 0) this.inv--;
    if (this.ctrlLock > 0) this.ctrlLock--;
    if (this.dashCD > 0) this.dashCD--;
    if (this.shotCD > 0) this.shotCD--;
    if (this.wallLock > 0) this.wallLock--;
    if (this.dropT > 0) this.dropT--;
    if (this.silenced > 0) this.silenced--;

    const water = inWater(this);
    const ctl = this.ctrlLock === 0;
    let mx = ctl ? (I.held.right ? 1 : 0) - (I.held.left ? 1 : 0) : 0;
    if (this.wallLock > 0) mx = 0;

    // Input buffers
    if (I.pressed.jump) this.jumpBuf = P.buffer; else if (this.jumpBuf > 0) this.jumpBuf--;
    if (I.pressed.attack) this.atkBuf = P.atkBuffer; else if (this.atkBuf > 0) this.atkBuf--;
    if (I.pressed.dash) this.dashBuf = 6; else if (this.dashBuf > 0) this.dashBuf--;
    if (this.onGround) { this.coyote = P.coyote; this.restoreAir(); }
    else if (this.coyote > 0) this.coyote--;

    // ---- Heal (調律): hold down on the ground, standing still
    if (this.onGround && ctl && I.held.down && mx === 0 && this.dashT === 0 && this.atkT === 0 && !this.poundLag) {
      if (S.hp < S.maxHp && S.gauge >= P.healCost) {
        this.healT++;
        if (this.healT % 10 === 1) { spawnFx({ kind: 'ring', x: this.cx, y: this.cy, color: '#7ff7e6', r0: 18, r1: 4, life: 12 }); sfx('blip'); }
        if (this.healT >= P.healTime) {
          this.healT = 0; S.hp++; S.gauge -= P.healCost;
          sfx('heal'); burst(this.cx, this.cy, '#7ff7e6', 14, 1.5, 30, -0.03);
        }
        this.vx = approach(this.vx, 0, P.decelG);
        moveBody(this);
        return;
      } else if (I.pressed.down) G.gaugeShake = 10;
    }
    this.healT = 0;

    // ---- Pound landing lag
    if (this.poundLag > 0) { this.poundLag--; this.vx = 0; moveBody(this); this.checkHazards(); return; }

    // ---- Dash
    if (this.dashT > 0) {
      this.dashT--;
      this.vx = this.dashDir * P.dashV;
      this.vy = 0;
      this.phasing = !!this.ab.phase;
      if (this.anim % 2 === 0) spawnFx({ kind: 'ghost', x: this.cx, y: this.y + this.h, face: this.face, t: 0, life: 10, phase: this.phasing });
      this.dashCornerCorrect();
      moveBody(this);
      if (this.hitWall) this.dashT = 0;
      // Dash-jump: jumping during the last 2 frames carries momentum.
      if (this.jumpBuf > 0 && (this.onGround || this.coyote > 0)) {
        const carry = this.dashT <= 2;
        this.endDash(); this.doJump(water);
        if (carry) this.vx = this.dashDir * 4.0;
      } else if (this.dashT === 0) this.endDash();
      this.checkHazards();
      return;
    }
    const canCancel = this.atkT === 0 || this.atkT > P.atkStart + P.atkActive + 4;
    if (ctl && this.dashBuf > 0 && this.ab.dash && this.dashCD === 0 && (this.onGround || this.airDash) && !this.pounding && canCancel) {
      this.dashBuf = 0;
      this.dashT = P.dashT;
      this.dashDir = mx !== 0 ? mx : (this.wallSliding ? -this.wallDir : this.face); this.face = this.dashDir;
      if (!this.onGround) this.airDash = false;
      this.atkT = 0; this.gliding = false; this.wallSliding = false;
      sfx(this.ab.phase ? 'phase' : 'dash');
      dust(this.cx, this.y + this.h, 5, -this.dashDir);
      return;
    }

    // ---- Pound (フォルテ)
    if (this.pounding) {
      this.pounding++;
      this.vx = 0;
      if (this.pounding <= P.poundHang) { this.vy = 0; return; }
      this.vy = P.poundV;
      moveBody(this);
      // Bounce off enemies / ringing stones under the hammer.
      const foot = { x: this.x - 3, y: this.y + this.h - 4, w: this.w + 6, h: 12 };
      for (const e of G.ents) {
        if (e.dead || !(e.hittable || e.bounceable) || !overlap(foot, e)) continue;
        if (e.bounceable) e.ringStone();
        else { e.hurt(G.save.atk + 1, this, 'pound'); S.gauge = Math.min(P.gaugeMax, S.gauge + P.gaugeHit); }
        this.pounding = 0; this.vy = -P.poundBounce; this.restoreAir(); this.jumping = false;
        G.hitstop = 5; sfx('pound'); ring(this.cx, this.y + this.h, '#ffe9a8', 4, 30, 14);
        return;
      }
      if (this.onGround) this.landPound();
      this.checkHazards();
      return;
    }
    if (ctl && !this.onGround && this.ab.pound && I.held.down && this.atkBuf > 0 && !water) {
      this.atkBuf = 0;
      this.pounding = 1; this.vy = 0; this.gliding = false; this.atkT = 0;
      sfx('menu');
      return;
    }

    // ---- Horizontal movement
    const run = water ? P.waterRun : P.run;
    if (this.recoil > 0) {
      this.recoil--; this.vx = -this.face * 2.0;
    } else if (mx !== 0) {
      const acc = this.onGround ? P.accelG : P.accelA;
      if (Math.abs(this.vx) > run && Math.sign(this.vx) === mx) this.vx = approach(this.vx, mx * run, 0.2);
      else this.vx = approach(this.vx, mx * run, acc);
      if (this.atkT === 0) this.face = mx;
    } else {
      this.vx = approach(this.vx, 0, this.onGround ? P.decelG : P.decelA);
    }

    // ---- Walls
    this.wallDir = 0;
    if (!this.onGround) {
      if (rectSolid(this.x - 2, this.y + 4, 2, this.h - 8, this)) this.wallDir = -1;
      else if (rectSolid(this.x + this.w, this.y + 4, 2, this.h - 8, this)) this.wallDir = 1;
    }
    const heldDir = (I.held.right ? 1 : 0) - (I.held.left ? 1 : 0);
    const wasSliding = this.wallSliding;
    this.wallSliding = this.ab.wall && this.wallDir !== 0 && heldDir === this.wallDir && this.vy > 0 && !water && ctl;
    if (this.wallSliding) {
      this.lastWall = this.wallDir; this.wallCoyote = P.wallCoyote; this.restoreAir();
      if (!wasSliding) sfx('wall');
      if (this.anim % 5 === 0) G.fx.push({ kind: 'p', x: this.wallDir > 0 ? this.x + this.w : this.x, y: this.y + 4, vx: -this.wallDir * 0.5, vy: -0.3, color: '#fff0c0', t: 0, life: 12, grav: 0.05, size: 1 });
    } else if (this.wallCoyote > 0) this.wallCoyote--;
    if (this.onGround) this.wallCoyote = 0;

    // ---- Jump
    let jumped = false;
    if (ctl && this.jumpBuf > 0) {
      if (this.onGround && I.held.down && this.onPlatform()) {
        this.dropT = 10; this.jumpBuf = 0; this.y += 1;
      } else if (this.onGround || this.coyote > 0) {
        this.doJump(water); jumped = true;
      } else if (this.ab.wall && !water && (this.wallDir !== 0 || this.wallCoyote > 0)) {
        const wd = this.wallDir || this.lastWall;
        this.jumpBuf = 0; this.jumping = true; this.jumpT = 0; this.wallCoyote = 0;
        this.vx = -wd * P.wallJumpVX; this.vy = -P.wallJumpVY;
        this.wallLock = P.wallLock; this.face = -wd;
        this.restoreAir(); this.glideArmed = false;
        sfx('wall'); dust(wd > 0 ? this.x + this.w : this.x, this.cy, 4, -wd);
        jumped = true;
      } else if (this.airJumps > 0 && !water) {
        this.airJumps--; this.jumpBuf = 0; this.jumping = true; this.jumpT = 0;
        this.vy = -P.djumpV; this.glideArmed = true;
        sfx('djump'); ring(this.cx, this.y + this.h, '#ffe9a8', 2, 14, 14);
        jumped = true;
      } else if (this.ab.glide && !water) {
        this.jumpBuf = 0; this.glideArmed = true; // re-press arms the glide
      }
    }

    // ---- Gravity, variable height, apex hang, glide
    if (!this.onGround) {
      this.jumpT++;
      if (this.jumping && !I.held.jump && this.vy < 0 && this.jumpT > P.cutMinT) { this.vy *= P.cutMul; this.jumping = false; }
      if (this.vy >= 0) this.jumping = false;
      if (!I.held.jump) this.glideArmed = false;
      let g = this.vy < 0 ? P.gravUp : P.gravDown;
      if (Math.abs(this.vy) < P.apexV && I.held.jump && !this.gliding) g *= 0.5;
      let maxFall = P.maxFall;
      if (water) { g = P.waterGrav; maxFall = P.waterMaxFall; }
      const updraft = !water && inUpdraft(this);
      this.gliding = !!(this.ab.glide && this.glideArmed && I.held.jump && this.vy > -0.5 && !water && ctl && !this.wallSliding);
      if (this.wallSliding) maxFall = P.wallSlide;
      if (this.gliding) {
        if (updraft) { this.vy = Math.max(this.vy - P.updraftAcc, -P.updraftMax); g = 0; maxFall = 99; }
        else { maxFall = P.glideFall; if (this.vy > maxFall) this.vy += (maxFall - this.vy) * 0.3; }
        if (this.anim % 24 === 0) sfx('glide');
      }
      this.vy = Math.min(this.vy + g, Math.max(maxFall, this.gliding ? this.vy : -99));
    } else { this.gliding = false; this.glideArmed = false; }

    // ---- Attack
    if (this.atkT > 0) {
      this.atkT++;
      if (this.atkT > P.atkStart && this.atkT <= P.atkStart + P.atkActive) this.attackHit();
      if (this.atkT > ATK_TOTAL) this.atkT = 0;
    }
    if (this.atkT === 0 && ctl && this.atkBuf > 0) {
      this.atkBuf = 0;
      this.atkT = 1; this.atkUp = I.held.up; this.atkHits.clear();
      if (mx !== 0) this.face = mx;
      sfx('attack');
    }
    if (this.atkT === P.atkStart + 1) slash(this.atkUp ? this.cx : this.cx + this.face * 6, this.atkUp ? this.y - 2 : this.cy, this.face, this.atkUp);

    // ---- Shot (共鳴弾)
    if (ctl && I.pressed.shot && this.ab.shot && this.shotCD === 0 && G.ents.filter((e) => e.owner === 'player' && !e.dead).length < 2) {
      this.shotCD = P.shotCD;
      const up = I.held.up;
      const dir = this.wallSliding ? -this.wallDir : this.face;
      spawnProjectile({ x: this.cx + (up ? 0 : dir * 8), y: up ? this.y : this.cy - 2, vx: up ? 0 : dir * P.shotV, vy: up ? -P.shotV : 0, owner: 'player', life: P.shotLife });
      sfx('shot');
    }

    // ---- Conveyor belts carry you at half walking speed
    if (this.onGround) {
      let conv = 0;
      tilesInRect(this.x, this.y + this.h, this.w, 1, (tx, ty, t) => { if (t === T.CONV_R) conv = 1; else if (t === T.CONV_L) conv = -1; });
      if (conv && !rectSolid(this.x + conv * P.run * 0.5, this.y, this.w, this.h, this)) this.x += conv * P.run * 0.5;
    }
    // ---- Move
    const wasG = this.onGround;
    const vyBefore = this.vy;
    if (this.vy < 0) this.headCornerCorrect();
    if (this.vy > 0 && !this.onGround) this.ledgeAssist();
    moveBody(this, { dropThrough: this.dropT > 0 });
    if (this.onGround && !wasG) {
      if (vyBefore > 3) { sfx('land'); dust(this.cx, this.y + this.h, 4); this.squash = 6; }
    }
    if (this.onGround && Math.abs(this.vx) > 1) {
      this.stepT++;
      if (this.stepT % 14 === 0) sfx('step');
    }
    this.checkHazards();
  }

  restoreAir() { this.airJumps = this.ab.double ? 1 : 0; this.airDash = true; }

  // Head hits a ceiling corner within 4px: nudge sideways.
  headCornerCorrect() {
    const ny = this.y + this.vy;
    if (!rectSolid(this.x, ny, this.w, this.h, this)) return;
    for (let d = 1; d <= 4; d++) {
      for (const s of [-1, 1]) {
        if (!rectSolid(this.x + s * d, ny, this.w, this.h, this) && !rectSolid(this.x + s * d, this.y, this.w, this.h, this)) { this.x += s * d; return; }
      }
    }
  }

  // Falling past a ledge edge by up to 3px: step onto it.
  ledgeAssist() {
    if (this.vx === 0 && !input.held.left && !input.held.right) return;
    const dir = Math.sign(this.vx) || ((input.held.right ? 1 : 0) - (input.held.left ? 1 : 0));
    if (!rectSolid(this.x + dir * 2, this.y, this.w, this.h, this)) return;
    for (let up = 1; up <= 3; up++) {
      if (!rectSolid(this.x + dir * 2, this.y - up, this.w, this.h, this)) { this.y -= up; this.x += dir; this.vy = 0; return; }
    }
  }

  // Dashing into a step corner within 4px: slide over/under it.
  dashCornerCorrect() {
    const nx = this.x + this.vx;
    if (!rectSolid(nx, this.y, this.w, this.h, this)) return;
    for (let d = 1; d <= 4; d++) {
      for (const s of [-1, 1]) {
        if (!rectSolid(nx, this.y + s * d, this.w, this.h, this) && !rectSolid(this.x, this.y + s * d, this.w, this.h, this)) { this.y += s * d; return; }
      }
    }
  }

  onPlatform() {
    let p = false;
    tilesInRect(this.x, this.y + this.h, this.w, 1, (tx, ty, t) => { if (t === T.PLATFORM) p = true; });
    return p && !rectSolid(this.x, this.y + 1, this.w, this.h, this);
  }

  doJump(water = false) {
    this.jumpBuf = 0; this.coyote = 0; this.jumping = true; this.jumpT = 0; this.glideArmed = false;
    this.vy = -(water ? P.waterJumpV : P.jumpV);
    this.onGround = false;
    sfx('jump'); dust(this.cx, this.y + this.h, 3);
  }

  endDash() {
    this.dashT = 0;
    this.vx = this.dashDir * P.run;
    this.dashCD = this.onGround ? P.dashCD : 0;
    // Never end a phase dash inside a membrane: push back to the side we came from.
    if (this.phasing && this.insideMembrane()) {
      let n = 0;
      while (this.insideMembrane() && n++ < 64) this.x -= this.dashDir;
    }
    this.phasing = false;
    if (this.ab.glide && input.held.jump && !this.onGround) this.glideArmed = true;
  }

  insideMembrane() {
    let m = false;
    tilesInRect(this.x, this.y, this.w, this.h, (tx, ty, t) => { if (t === T.MEMBRANE) m = true; });
    return m;
  }

  landPound() {
    let broke = false;
    tilesInRect(this.x - 4, this.y + this.h, this.w + 8, 2, (tx, ty, t) => {
      if (t === T.CRACKED) { breakCrackedPatch(tx, ty); broke = true; }
    });
    G.cam.shake = Math.max(G.cam.shake, 6);
    sfx('pound');
    ring(this.cx, this.y + this.h, '#ffe9a8', 4, P.poundR, 16);
    dust(this.cx, this.y + this.h, 10);
    const area = { x: this.cx - P.poundR, y: this.y - 8, w: P.poundR * 2, h: this.h + 12 };
    for (const e of G.ents) if (e.hittable && !e.dead && overlap(area, e)) {
      if (e.hurt(G.save.atk + 1, this, 'pound') !== false) G.save.gauge = Math.min(P.gaugeMax, G.save.gauge + P.gaugeHit);
      G.hitstop = Math.max(G.hitstop, 5);
    }
    // Hatches (gates with pound:true) open when pounded from above.
    const foot = { x: this.x - 2, y: this.y + this.h, w: this.w + 4, h: 3 };
    for (const e of G.ents) if (e.o && e.o.pound && e.o.type === 'gate' && !e.open && overlap(foot, e)) { G.save.flags[e.o.id] = true; broke = true; }
    if (broke) { this.vy = P.poundV; this.onGround = false; return; }
    this.pounding = 0; this.poundLag = P.poundLag;
  }

  atkBox() {
    if (this.atkUp) return { x: this.cx - 12, y: this.y - 26, w: 24, h: 30 };
    return { x: this.face > 0 ? this.x + this.w : this.x - 28, y: this.y + 1, w: 28, h: 20 };
  }

  attackHit() {
    const hb = this.atkBox();
    let hitSomething = false;
    for (const e of G.ents) {
      if (!(e.hittable || e.parryable) || e.dead || this.atkHits.has(e)) continue;
      if (overlap(hb, e)) {
        this.atkHits.add(e);
        if (e.parryable && !e.hittable) { e.parry(this); hitSomething = true; continue; }
        const r = e.hurt(G.save.atk, this, 'melee');
        hitSomething = true;
        if (r !== false && !e.noGauge && !this.silenced) G.save.gauge = Math.min(P.gaugeMax, G.save.gauge + P.gaugeHit);
        if (r === false) G.hitstop = Math.max(G.hitstop, 4);
        else G.hitstop = Math.max(G.hitstop, e.dead ? 6 : 3);
        if (e.dead) G.cam.shake = Math.max(G.cam.shake, 2);
      }
    }
    tilesInRect(hb.x, hb.y, hb.w, hb.h, (tx, ty, t) => {
      if (t === T.BREAKABLE && !this.atkHits.has('t' + tx + ',' + ty)) {
        this.atkHits.add('t' + tx + ',' + ty);
        breakTile(tx, ty);
        hitSomething = true;
      } else if ((t === T.SOLID || t === T.CRYSTAL || t === T.CRACKED) && !this.atkHits.has('wall') && this.atkT === P.atkStart + 1) {
        this.atkHits.add('wall');
        sfx('clink');
        burst(clamp(tx * TILE + 8, hb.x, hb.x + hb.w), clamp(ty * TILE + 8, hb.y, hb.y + hb.h), '#fff2c0', 3, 1.5, 10);
      }
    });
    if (hitSomething && !this.atkHits.has('recoil')) {
      this.atkHits.add('recoil');
      if (this.atkUp) { if (!this.onGround) this.vy = Math.max(this.vy, 0) * 0; }
      else this.recoil = 4;
    }
  }

  checkHazards() {
    if (touchesSpike(this)) this.spikeHit();
    if (this.onGround && this.dashT === 0) {
      const below = rectSolid(this.x - 4, this.y + this.h, this.w + 8, 2, null);
      const left = rectSolid(this.x - 4, this.y + this.h, 2, 2, null), right = rectSolid(this.x + this.w + 2, this.y + this.h, 2, 2, null);
      if (below && left && right && !touchesSpike({ x: this.x - 32, y: this.y - 8, w: this.w + 64, h: this.h + 12 })) {
        this.safeT++;
        if (this.safeT >= 10) this.safe = { x: this.x, y: this.y };
      } else this.safeT = 0;
    } else this.safeT = 0;
  }

  spikeHit() {
    if (this.spikeT > 0) return;
    if (this.inv <= 0) this.damage(1, null, true);
    if (G.save.hp <= 0) return;
    this.spikeT = 40; this.vx = 0; this.vy = 0;
    this.dashT = 0; this.pounding = 0; this.phasing = false;
  }

  updateSpikeReturn() {
    this.spikeT--;
    if (this.spikeT === 20) {
      this.x = this.safe.x; this.y = this.safe.y; this.vx = 0; this.vy = 0;
    }
    G.fade = this.spikeT > 20 ? (40 - this.spikeT) / 20 * 0.8 : this.spikeT / 20 * 0.8;
    if (this.spikeT === 0) { G.fade = 0; this.inv = Math.max(this.inv, 50); }
  }

  // Returns true if damage applied.
  damage(n, src, ignoreInv = false) {
    if (this.dead) return false;
    if (!ignoreInv && (this.inv > 0 || (this.dashT > 0 && this.phasing))) return false;
    G.save.hp -= n;
    this.inv = P.iframes; this.ctrlLock = P.hurtLock;
    this.healT = 0; this.atkT = 0; this.dashT = 0; this.pounding = 0; this.phasing = false; this.gliding = false;
    const dir = src ? (src.x + (src.w || 0) / 2 < this.cx ? 1 : -1) : -this.face;
    this.vx = dir * P.kbX; this.vy = -P.kbY; this.onGround = false;
    G.hitstop = 10; G.cam.shake = 8;
    sfx('hurt');
    burst(this.cx, this.cy, '#ff5a6a', 12, 2.2, 24);
    spawnFx({ kind: 'flash', x: this.cx, y: this.cy, color: '#ffffff', r: 14, life: 6, alpha: 0.8 });
    if (G.save.hp <= 0) { G.save.hp = 0; this.die(); }
    return true;
  }

  die() {
    this.dead = true; this.deadT = 0;
    sfx('death');
    burst(this.cx, this.cy, '#7ff7e6', 30, 3, 50, 0.02);
    burst(this.cx, this.cy, '#c8a050', 20, 2.5, 50, 0.1);
  }

  // ---------------- Drawing ----------------
  draw(ctx) {
    if (this.dead) return;
    if (this.spikeT > 0 && this.spikeT < 20) return;
    if (this.inv > 0 && Math.floor(this.inv / 4) % 2 === 0 && this.ctrlLock === 0) return;
    const fx = Math.round(this.cx), fy = Math.round(this.y + this.h);
    drawRio(ctx, fx, fy, this);
  }
}

// Rio, built from rects. Origin = feet centre.
export function drawRio(ctx, fx, fy, p) {
  const f = new Figure(fx, fy, p.face < 0);
  const run = p.onGround && Math.abs(p.vx) > 0.5 && p.dashT === 0;
  const ph = Math.floor(p.anim / 5) % 4;
  const air = !p.onGround;
  const bob = !air && !run ? (Math.floor(p.anim / 30) % 2) : run ? (ph % 2) : 0;
  const sq = p.squash > 0 ? (p.squash--, 1) : 0;
  const by = -bob + sq; // body offset
  const brass = '#d8b060', brassD = '#9a7038', brassL = '#f6dc98';
  const metal = '#8c94a8', metalD = '#5a6078';
  const scarf = '#d84a5a', scarfD = '#8e2a3e';
  const eye = p.inv > 0 && p.ctrlLock > 0 ? '#ff7070' : '#7ff7e6';
  // Legs
  let l1 = 0, l2 = 0;
  if (run) { l1 = [0, -2, 0, 0][ph]; l2 = [0, 0, 0, -2][ph]; }
  if (air) { l1 = -2; l2 = p.vy < 0 ? -1 : 0; }
  if (p.dashT > 0) { l1 = -1; l2 = -2; }
  f.r(-4, -6 + l1, 3, 6 - (l1 < 0 ? 1 : 0), metalD);
  f.r(1, -6 + l2, 3, 6 - (l2 < 0 ? 1 : 0), metal);
  // Torso
  f.r(-4, -12 + by, 8, 7, metal);
  f.r(-3, -11 + by, 6, 2, '#b0b8c8', false);
  // Scarf
  f.r(-5, -13 + by, 10, 2, scarf);
  const flow = air ? (p.vy < 0 ? 2 : -1) : run || p.dashT > 0 ? 0 : 3;
  f.r(-8, -13 + by + flow, 4, 2, scarfD);
  if (p.dashT > 0 || p.gliding) f.r(-12, -14 + by, 5, 2, scarfD);
  // Glide: scarf spreads as a wing
  if (p.gliding) { f.r(-11, -15 + by, 22, 2, scarf); f.r(-9, -13 + by, 18, 1, scarfD, false); }
  // Head
  f.r(-5, -21 + by, 10, 8, brass);
  f.r(-4, -22 + by, 8, 1, brass);
  f.r(-4, -20 + by, 3, 2, brassL, false);
  f.r(-5, -14 + by, 10, 1, brassD, false);
  // Eye (single, looking forward)
  f.r(0, -19 + by, 4, 3, '#1c2030', false);
  f.r(1, -18 + by, 2, 1, eye, false);
  // Tuning-fork antenna
  f.r(-1, -24 + by, 2, 2, brassD);
  f.r(-2, -27 + by, 1, 3, brassD);
  f.r(1, -27 + by, 1, 3, brassD);
  // Hammer
  drawHammer(f, p, by);
  f.draw(ctx);
  // Heal glow
  if (p.healT > 0) {
    ctx.globalAlpha = Math.min(1, p.healT / P.healTime);
    ctx.fillStyle = '#7ff7e6';
    ctx.fillRect(fx - 1, fy - 31, 2, 2);
    ctx.globalAlpha = 1;
  }
}

function drawHammer(f, p, by) {
  const head = '#c0c8d8', handle = '#7a4a2a';
  const t = p.atkT;
  if (t > 0) {
    if (p.atkUp) {
      if (t <= P.atkStart) { f.r(-2, -16 + by, 2, 8, handle); f.r(-4, -19 + by, 6, 4, head); }
      else { f.r(2, -30 + by, 2, 10, handle); f.r(-1, -35 + by, 8, 5, head); }
    } else if (t <= P.atkStart) { // wind-up behind
      f.r(-9, -20 + by, 2, 8, handle); f.r(-12, -24 + by, 7, 5, head);
    } else if (t <= P.atkStart + P.atkActive + 1) { // strike forward
      f.r(4, -12 + by, 9, 2, handle); f.r(12, -15 + by, 5, 8, head);
    } else { // follow-through low
      f.r(3, -8 + by, 7, 2, handle); f.r(9, -9 + by, 5, 7, head);
    }
    return;
  }
  if (p.pounding) { f.r(-1, 0, 2, 6, handle); f.r(-4, 5, 8, 5, head); return; }
  if (p.shotCD > P.shotCD - 8) { f.r(4, -12 + by, 6, 2, handle); f.r(9, -15 + by, 5, 7, head); return; }
  // carried on the back
  f.r(-7, -18 + by, 2, 10, handle);
  f.r(-10, -21 + by, 8, 4, head);
}

// Dash afterimage: a flat-coloured silhouette of Rio.
fxDrawers.ghost = (ctx, f, k) => {
  const [c, x] = ghostCanvas();
  x.clearRect(0, 0, c.width, c.height);
  drawRio(x, 20, 34, { face: f.face, anim: 0, onGround: true, vx: 0, vy: 0, dashT: 1, atkT: 0, inv: 0, ctrlLock: 0, healT: 0, squash: 0, shotCD: 0 });
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = f.phase ? '#c0a0ff' : '#7ff7e6';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.45 * (1 - k);
  ctx.drawImage(c, Math.round(f.x - 20), Math.round(f.y - 34));
  ctx.globalAlpha = 1;
};
let _gc = null;
function ghostCanvas() {
  if (!_gc) { const c = document.createElement('canvas'); c.width = 40; c.height = 40; _gc = [c, c.getContext('2d')]; }
  return _gc;
}

// Break a whole connected patch of cracked floor (flood fill, capped).
function breakCrackedPatch(tx, ty) {
  const q = [[tx, ty]], seen = new Set();
  while (q.length && seen.size < 64) {
    const [x, y] = q.pop(), k = x + ',' + y;
    if (seen.has(k) || World.tileAt(x, y) !== T.CRACKED) continue;
    seen.add(k);
    breakTile(x, y);
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}
