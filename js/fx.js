// Particles and short-lived visual effects.
import { G } from './state.js';
import { pcircle, pring } from './gfx.js';

// Custom drawers registered by other modules (e.g. player afterimages).
export const fxDrawers = {};

export function spawnFx(o) { G.fx.push(Object.assign({ t: 0, life: 20 }, o)); }

export function burst(x, y, color, n = 8, speed = 2, life = 20, grav = 0.1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
    G.fx.push({ kind: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, color, t: 0, life: life * (0.6 + Math.random() * 0.6), grav, size: Math.random() < 0.3 ? 2 : 1 });
  }
}

export function dust(x, y, n = 4, dir = 0) {
  for (let i = 0; i < n; i++)
    G.fx.push({ kind: 'p', x: x + (Math.random() - 0.5) * 8, y, vx: (Math.random() - 0.5) * 1.2 + dir * 0.8, vy: -Math.random() * 0.8, color: '#b8a898', t: 0, life: 14 + Math.random() * 10, grav: -0.01, size: 1 });
}

export function ring(x, y, color, r0 = 4, r1 = 30, life = 18) {
  G.fx.push({ kind: 'ring', x, y, color, r0, r1, t: 0, life });
}

export function slash(x, y, dir, up, color = '#fff6d8') {
  G.fx.push({ kind: 'slash', x, y, dir, up, color, t: 0, life: 8 });
}

export function text(x, y, str, color = '#fff') {
  G.fx.push({ kind: 'text', x, y, str, color, t: 0, life: 50 });
}

export function updateFx() {
  for (const f of G.fx) {
    f.t++;
    if (f.kind === 'p') { f.x += f.vx; f.y += f.vy; f.vy += f.grav; f.vx *= 0.97; }
    if (f.kind === 'text') f.y -= 0.4;
  }
  G.fx = G.fx.filter((f) => f.t < f.life);
}

export function drawFx(ctx) {
  for (const f of G.fx) {
    const k = f.t / f.life;
    if (f.kind === 'p') {
      ctx.globalAlpha = 1 - k * 0.7;
      ctx.fillStyle = f.color;
      ctx.fillRect(Math.round(f.x), Math.round(f.y), f.size, f.size);
    } else if (f.kind === 'ring') {
      ctx.globalAlpha = 1 - k;
      pring(ctx, f.x, f.y, f.r0 + (f.r1 - f.r0) * Math.sqrt(k), f.color, 1);
    } else if (f.kind === 'slash') {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      const n = 12, r = 13 + k * 3;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1) - 0.5) * 2.6;
        const th = i > 2 && i < n - 3 ? 2 : 1;
        if (f.up) ctx.fillRect(Math.round(f.x + Math.sin(a) * r), Math.round(f.y - Math.cos(a) * r), th, th);
        else ctx.fillRect(Math.round(f.x + f.dir * Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r), th, th);
      }
    } else if (f.kind === 'flash') {
      ctx.globalAlpha = (1 - k) * (f.alpha || 0.6);
      ctx.fillStyle = f.color;
      pcircle(ctx, f.x, f.y, f.r || 6, f.color);
    } else if (fxDrawers[f.kind]) {
      fxDrawers[f.kind](ctx, f, k);
    } else if (f.kind === 'text') {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      ctx.font = '8px monospace';
      ctx.fillText(f.str, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;
  }
}
