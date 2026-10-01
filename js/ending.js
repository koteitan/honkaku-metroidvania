// Ending sequence: lines of text over a slowly ringing bell, then stats.
import { VIEW_W, VIEW_H } from './util.js';
import { G } from './state.js';
import { input } from './input.js';
import { seq, S } from './text.js';
import { FONT } from './ui.js';
import { playMusic, bell, sfx } from './audio.js';
import { pcircle, pring, drawBellShape } from './gfx.js';
import { writeSave } from './save.js';

const E = { kind: 'normal', lines: [], i: 0, t: 0, phase: 'text', rings: [] };

export function startEnding(kind) {
  E.kind = kind; E.i = 0; E.t = 0; E.phase = 'text'; E.rings = [];
  if (kind === 'true') {
    const a = seq('ENDING_TRUE', 1, 14), b = seq('ENDING_TRUE', 15, 19);
    E.lines = [...a, { speaker: 'ヴェスパー', text: S('VESPER_TRUE_END') }, ...b];
  } else {
    E.lines = [{ speaker: 'ヴェスパー', text: S('VESPER_NORMAL_02') }, ...seq('ENDING_NORMAL', 1, 18)];
  }
  G.save.flags['ending_' + kind] = true;
  G.save.flags.cleared = true;
  writeSave(G.save);
  G.scene = 'ending';
  G.fade = 0;
  playMusic('ending');
}

export function updateEnding() {
  E.t++;
  if (E.t % 240 === 1) { bell(E.kind === 'true' ? 98 : 110, null, 0.25, 6); E.rings.push(0); }
  E.rings = E.rings.map((r) => r + 1).filter((r) => r < 400);
  const ok = input.pressed.jump || input.pressed.confirm || input.pressed.attack;
  if (E.phase === 'text') {
    if ((ok && E.t > 60) || E.t > 300) { E.i++; E.t = 0; if (E.i >= E.lines.length) { E.phase = 'title'; E.t = 0; } }
  } else if (E.phase === 'title') {
    if ((ok && E.t > 90) || E.t > 400) { E.phase = 'stats'; E.t = 0; }
  } else if (E.phase === 'stats') {
    if (ok && E.t > 60) { G.scene = 'title'; playMusic('title'); sfx('select'); }
  }
}

export function drawEnding(g, t) {
  if (g) {
    const grd = g.createLinearGradient(0, 0, 0, VIEW_H);
    if (E.kind === 'true') { grd.addColorStop(0, '#1a1428'); grd.addColorStop(1, '#3a2a18'); }
    else { grd.addColorStop(0, '#0a0810'); grd.addColorStop(1, '#2a1c10'); }
    g.fillStyle = grd; g.fillRect(0, 0, VIEW_W, VIEW_H);
    for (const r of E.rings) { g.globalAlpha = Math.max(0, 1 - r / 400) * 0.6; pring(g, VIEW_W / 2, 140, r * 0.8, '#ffe9a8'); }
    g.globalAlpha = 1;
    // bell
    const cx = VIEW_W / 2, swing = Math.sin(G.frame / 60) * 2;
    drawBellShape(g, cx, 100, 64, '#6a5228', '#8a6a30', '#8a6a30', swing);
    pcircle(g, cx + swing * 3, 170, 4, '#4a3818');
  }
  if (t) {
    t.textBaseline = 'top'; t.textAlign = 'center';
    if (E.phase === 'text') {
      const L = E.lines[E.i];
      const a = Math.min(1, E.t / 40);
      t.globalAlpha = a;
      if (typeof L === 'string') { t.font = `12px ${FONT}`; t.fillStyle = '#f0e8d8'; t.fillText(L, VIEW_W / 2, 214); }
      else if (L) {
        t.font = `9px ${FONT}`; t.fillStyle = '#a8a0c0'; t.fillText(L.speaker, VIEW_W / 2, 200);
        t.font = `12px ${FONT}`; t.fillStyle = '#e0d8f8'; t.fillText(L.text, VIEW_W / 2, 214);
      }
      t.globalAlpha = 1;
    } else if (E.phase === 'title') {
      t.globalAlpha = Math.min(1, E.t / 60);
      t.font = `26px ${FONT}`; t.fillStyle = '#f0e0c0';
      t.fillText(S(E.kind === 'true' ? 'ENDING_TRUE_TITLE' : 'ENDING_NORMAL_TITLE'), VIEW_W / 2, 40);
      t.font = `10px ${FONT}`; t.fillStyle = '#c8b090';
      t.fillText(E.kind === 'true' ? '— 調律の結末 —' : '— 鐘の結末 —', VIEW_W / 2, 76);
      t.globalAlpha = 1;
    } else {
      const s = G.save, sec = Math.floor(s.time / 60);
      const L = [
        'クリア時間　' + `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`,
        '力尽きた回数　' + s.deaths,
        '鼓動の器　' + (s.maxHp - 5) + '/6',
        '鋼の撥　' + (s.atk - 1) + '/3',
        '記憶の譜面　' + s.scores.length + '/12',
        '',
        s.scores.length < 12 ? 'すべての譜面を集めると、別の結末が見られる。' : 'すべての譜面を聞いてくれて、ありがとう。',
        '',
        'Thank you for playing.',
      ];
      t.font = `11px ${FONT}`; t.fillStyle = '#f0e8d8';
      L.forEach((l, i) => t.fillText(l, VIEW_W / 2, 40 + i * 18));
    }
    t.textAlign = 'left';
  }
}
