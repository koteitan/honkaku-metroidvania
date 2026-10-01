// WebAudio synthesized sound effects and generative music.
let ac = null, master = null, sfxBus = null, musBus = null, reverb = null;
export const audioSettings = { sfx: 0.7, music: 0.5 };

export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { return; }
  master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
  sfxBus = ac.createGain(); sfxBus.gain.value = audioSettings.sfx; sfxBus.connect(master);
  musBus = ac.createGain(); musBus.gain.value = audioSettings.music; musBus.connect(master);
  // Simple feedback-delay "reverb" for bells.
  reverb = ac.createGain(); reverb.gain.value = 0.35;
  const d1 = ac.createDelay(1); d1.delayTime.value = 0.13;
  const d2 = ac.createDelay(1); d2.delayTime.value = 0.21;
  const fb = ac.createGain(); fb.gain.value = 0.45;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  reverb.connect(d1); d1.connect(d2); d2.connect(lp); lp.connect(fb); fb.connect(d1);
  lp.connect(master);
}

export function setVolumes() {
  if (!ac) return;
  sfxBus.gain.value = audioSettings.sfx;
  musBus.gain.value = audioSettings.music;
}

const now = () => ac.currentTime;

function env(g, t, a, peak, d, sus = 0.0001) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + d);
}

function osc(type, freq, t, dur, peak, bus, opts = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur);
  env(g, t, opts.a || 0.005, peak, dur);
  o.connect(g);
  if (opts.filter) {
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.filter;
    g.connect(f); f.connect(bus);
  } else g.connect(bus);
  if (opts.verb) g.connect(reverb);
  o.start(t); o.stop(t + (opts.a || 0.005) + dur + 0.05);
}

let noiseBuf = null;
function noise(t, dur, peak, bus, freq = 1200, q = 1, type = 'bandpass') {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); env(g, t, 0.003, peak, dur);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

// Bell: inharmonic partials.
export function bell(freq, t = null, peak = 0.25, dur = 2.5, bus = null) {
  if (!ac) return;
  t = t ?? now(); bus = bus || sfxBus;
  const parts = [[1, 1], [2.0, 0.5], [2.76, 0.35], [5.4, 0.2], [0.5, 0.3]];
  for (const [m, a] of parts) osc('sine', freq * m, t, dur / (m > 1 ? m * 0.6 : 1), peak * a, bus, { verb: true, a: 0.003 });
}

const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz

export function sfx(name, p = 0) {
  if (!ac) return;
  const t = now(), B = sfxBus;
  switch (name) {
    case 'jump': osc('square', 330, t, 0.09, 0.08, B, { slide: 620, filter: 2000 }); break;
    case 'djump': osc('square', 520, t, 0.1, 0.07, B, { slide: 990, filter: 2600 }); osc('sine', 1040, t, 0.2, 0.06, B, { verb: true }); break;
    case 'land': noise(t, 0.06, 0.12, B, 400, 1, 'lowpass'); break;
    case 'step': noise(t, 0.03, 0.04, B, 900, 2); break;
    case 'attack': noise(t, 0.08, 0.15, B, 2500, 0.8); osc('triangle', 220, t, 0.06, 0.06, B, { slide: 110 }); break;
    case 'hit': osc('square', 880, t, 0.05, 0.1, B, { slide: 440, filter: 3000 }); noise(t, 0.08, 0.2, B, 1800, 1); osc('sine', N(76 + p), t, 0.4, 0.08, B, { verb: true }); break;
    case 'clink': osc('triangle', 1800, t, 0.12, 0.08, B, { verb: true }); break;
    case 'die': noise(t, 0.3, 0.25, B, 700, 0.7); osc('square', 300, t, 0.3, 0.08, B, { slide: 60, filter: 1500 }); break;
    case 'hurt': osc('sawtooth', 200, t, 0.25, 0.15, B, { slide: 70, filter: 1200 }); noise(t, 0.2, 0.2, B, 500, 1); break;
    case 'dash': noise(t, 0.18, 0.16, B, 3000, 0.6, 'highpass'); osc('sine', N(79), t, 0.15, 0.05, B); break;
    case 'wall': osc('triangle', 600, t, 0.08, 0.08, B, { slide: 900 }); break;
    case 'shot': osc('sine', N(84), t, 0.25, 0.12, B, { verb: true }); osc('sine', N(91), t, 0.18, 0.06, B); break;
    case 'pound': noise(t, 0.4, 0.4, B, 200, 0.8, 'lowpass'); osc('sine', 90, t, 0.4, 0.3, B, { slide: 40 }); break;
    case 'break': noise(t, 0.25, 0.3, B, 900, 0.6); osc('square', 140, t, 0.2, 0.08, B, { slide: 60, filter: 800 }); break;
    case 'crystal': for (let i = 0; i < 4; i++) osc('sine', N(88 + i * 3), t + i * 0.03, 0.4, 0.06, B, { verb: true }); noise(t, 0.2, 0.15, B, 6000, 1); break;
    case 'pickup': [72, 76, 79, 84].forEach((n, i) => osc('triangle', N(n), t + i * 0.06, 0.25, 0.1, B, { verb: true })); break;
    case 'ability': [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => osc('triangle', N(n), t + i * 0.09, 0.6, 0.09, B, { verb: true })); bell(N(60), t + 0.7, 0.3, 4); break;
    case 'shrine': bell(N(62), t, 0.25, 3.5); bell(N(69), t + 0.4, 0.18, 3); break;
    case 'heal': [67, 71, 74, 79].forEach((n, i) => osc('sine', N(n), t + i * 0.05, 0.5, 0.08, B, { verb: true })); break;
    case 'blip': osc('square', 900 + Math.random() * 60, t, 0.025, 0.025, B, { filter: 2500 }); break;
    case 'menu': osc('triangle', 660, t, 0.05, 0.08, B); break;
    case 'select': osc('triangle', 880, t, 0.08, 0.1, B); osc('triangle', 1320, t + 0.06, 0.12, 0.08, B); break;
    case 'door': noise(t, 0.5, 0.25, B, 150, 0.7, 'lowpass'); osc('square', 60, t, 0.4, 0.08, B, { filter: 300 }); break;
    case 'roar': noise(t, 0.9, 0.35, B, 300, 0.5); osc('sawtooth', 80, t, 0.9, 0.15, B, { slide: 50, filter: 600 }); break;
    case 'bosshit': osc('square', 220, t, 0.08, 0.1, B, { slide: 110, filter: 1500 }); noise(t, 0.1, 0.25, B, 1200, 1); break;
    case 'bossdie': for (let i = 0; i < 6; i++) noise(t + i * 0.15, 0.4, 0.3, B, 300 + i * 200, 0.6); bell(N(48), t + 1, 0.4, 5); break;
    case 'glide': noise(t, 0.3, 0.05, B, 1500, 0.5); break;
    case 'death': osc('triangle', 440, t, 1.2, 0.15, B, { slide: 55, verb: true }); break;
    case 'switch': osc('square', 440, t, 0.06, 0.08, B); osc('square', 660, t + 0.07, 0.1, 0.08, B); break;
    case 'boom': noise(t, 0.6, 0.35, B, 250, 0.6, 'lowpass'); break;
    case 'fire': osc('square', 500, t, 0.1, 0.06, B, { slide: 250, filter: 1800 }); break;
    case 'heartbeat': osc('sine', 55, t, 0.12, 0.25, B); osc('sine', 50, t + 0.18, 0.12, 0.2, B); break;
    case 'phase': osc('sine', N(72), t, 0.3, 0.1, B, { verb: true }); osc('sine', N(79), t, 0.3, 0.08, B, { verb: true }); break;
  }
}

// ---------------- Music ----------------
// Each track: tempo, scale degrees (midi), chord roots, voices.
const TRACKS = {
  title:     { bpm: 60, root: 50, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 4], bells: 1, arp: 0.6, bass: 0.6, pad: 1 },
  workshop:  { bpm: 72, root: 55, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 3, 5, 4], bells: 0.6, arp: 0.7, bass: 0.5, pad: 0.8 },
  cloister:  { bpm: 80, root: 52, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 6, 5, 4], bells: 0.4, arp: 0.9, bass: 0.7, pad: 0.6 },
  gearworks: { bpm: 112, root: 45, scale: [0, 2, 3, 5, 7, 8, 11], prog: [0, 0, 5, 4], bells: 0.2, arp: 1, bass: 1, pad: 0.4, tick: 1 },
  nave:      { bpm: 64, root: 50, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 0, 4], bells: 0.5, arp: 0.5, bass: 0.6, pad: 1, choir: 1 },
  garden:    { bpm: 70, root: 57, scale: [0, 2, 4, 7, 9], prog: [0, 3, 1, 4], bells: 0.5, arp: 0.6, bass: 0.4, pad: 0.8 },
  mines:     { bpm: 90, root: 47, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 6], bells: 0.3, arp: 0.8, bass: 0.9, pad: 0.6, crystal: 1 },
  archive:   { bpm: 76, root: 53, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 4, 2, 5], bells: 0.4, arp: 0.7, bass: 0.6, pad: 0.7 },
  shell:     { bpm: 96, root: 48, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 1, 4, 3], bells: 0.6, arp: 1, bass: 0.8, pad: 0.7 },
  crown:     { bpm: 56, root: 43, scale: [0, 1, 3, 5, 6, 8, 10], prog: [0, 1, 0, 5], bells: 0.9, arp: 0.2, bass: 0.9, pad: 1 },
  boss:      { bpm: 140, root: 45, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 0, 1, 6], bells: 0.2, arp: 1, bass: 1.2, pad: 0.3, tick: 1 },
  final:     { bpm: 150, root: 43, scale: [0, 1, 3, 5, 6, 8, 10], prog: [0, 5, 1, 6], bells: 0.6, arp: 1, bass: 1.2, pad: 0.5, tick: 1 },
  ending:    { bpm: 66, root: 55, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 5, 3, 4], bells: 1, arp: 0.6, bass: 0.5, pad: 1 },
  silence:   null,
};

let cur = null, curName = null, nextT = 0, step = 0, musGain = null, layer = 0;
export function playMusic(name) {
  if (!ac) { curName = name; return; }
  if (name === curName && cur) return;
  curName = name;
  if (musGain) {
    const g = musGain;
    g.gain.setTargetAtTime(0.0001, now(), 0.4);
    setTimeout(() => g.disconnect(), 2500);
  }
  cur = TRACKS[name] || null;
  if (!cur) { musGain = null; return; }
  musGain = ac.createGain();
  musGain.gain.setValueAtTime(0.0001, now());
  musGain.gain.setTargetAtTime(1, now() + 0.3, 0.6);
  musGain.connect(musBus);
  nextT = now() + 0.4; step = 0;
}
export function currentMusic() { return curName; }
// More forks -> richer arrangement.
export function setMusicLayer(n) { layer = n; }

export function updateMusic() {
  if (!ac || !cur || !musGain) return;
  if (ac.state !== 'running') return;
  const spb = 60 / cur.bpm / 2; // eighth notes
  while (nextT < now() + 0.25) {
    scheduleStep(nextT, step);
    nextT += spb; step++;
  }
}

function deg(tr, d, oct = 0) {
  const s = tr.scale, n = s.length;
  const o = Math.floor(d / n), i = ((d % n) + n) % n;
  return tr.root + s[i] + 12 * (o + oct);
}

function scheduleStep(t, st) {
  const tr = cur, bus = musGain;
  const bar = Math.floor(st / 8), beat = st % 8;
  const chord = tr.prog[bar % tr.prog.length];
  const spb = 60 / tr.bpm / 2;
  // Bass on beats 0 and 4
  if (tr.bass && (beat === 0 || (beat === 4 && tr.bpm > 85) || (tr.tick && beat % 2 === 0))) {
    osc('triangle', N(deg(tr, chord, -2)), t, spb * (beat === 0 ? 3 : 1.5), 0.12 * tr.bass, bus, { filter: 600 });
  }
  // Pad at bar start
  if (tr.pad && beat === 0) {
    for (const k of [0, 2, 4]) {
      osc(tr.choir ? 'sawtooth' : 'triangle', N(deg(tr, chord + k, 0)), t, spb * 7.5, 0.025 * tr.pad, bus, { a: spb * 2, filter: tr.choir ? 900 : 1400 });
    }
  }
  // Arpeggio (deterministic pseudo-random walk)
  if (tr.arp) {
    const pattern = [0, 2, 4, 7, 4, 2, 5, 4];
    const play = ((st * 7 + bar * 3) % 5) !== 0 || tr.bpm > 100;
    if (play) {
      const d = chord + pattern[(beat + bar) % 8];
      const oct = (layer >= 3 && beat % 4 === 3) ? 2 : 1;
      osc(tr.tick ? 'square' : 'triangle', N(deg(tr, d, oct)), t, spb * 0.9, 0.035 * tr.arp, bus, { filter: tr.tick ? 1600 : 3000 });
    }
  }
  // Ticking percussion
  if (tr.tick) {
    noise(t, 0.03, beat % 4 === 0 ? 0.06 : 0.025, bus, beat % 4 === 2 ? 2500 : 6000, 2);
    if (beat === 4) noise(t, 0.12, 0.08, bus, 200, 0.8, 'lowpass');
  }
  // Crystal sparkle
  if (tr.crystal && (st % 11 === 3)) osc('sine', N(deg(tr, chord + 7, 2)), t, 0.6, 0.03, bus, { verb: true });
  // Bells
  if (tr.bells && beat === 0 && (bar % 2 === 0)) {
    bell(N(deg(tr, chord, 1)), t, 0.08 * tr.bells, 3, bus);
  }
  if (layer >= 2 && tr.bells && beat === 6 && bar % 4 === 1) bell(N(deg(tr, chord + 4, 1)), t, 0.05 * tr.bells, 2.5, bus);
}
