// Keyboard + gamepad input mapped to abstract actions.
const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  KeyZ: 'jump', Space: 'jump', KeyK: 'jump',
  KeyX: 'attack', KeyJ: 'attack',
  KeyC: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash', KeyL: 'dash',
  KeyV: 'shot', KeyI: 'shot',
  Tab: 'map', KeyM: 'map',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm',
};
export const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'dash', 'shot', 'map', 'pause', 'confirm'];

const keyHeld = {};
const held = {};
const prev = {};
const pressed = {};
const released = {};
let anyKeyPressed = false;

window.addEventListener('keydown', (e) => {
  const a = KEYMAP[e.code];
  if (a) { keyHeld[a] = true; e.preventDefault(); }
  anyKeyPressed = true;
});
window.addEventListener('keyup', (e) => {
  const a = KEYMAP[e.code];
  if (a) { keyHeld[a] = false; e.preventDefault(); }
});
window.addEventListener('blur', () => { for (const k in keyHeld) keyHeld[k] = false; });

// Touch-free virtual input hook (used by automated tests).
export const virtual = {};

function readPad() {
  const out = {};
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const b = (i) => p.buttons[i] && p.buttons[i].pressed;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (ax < -0.4 || b(14)) out.left = true;
    if (ax > 0.4 || b(15)) out.right = true;
    if (ay < -0.5 || b(12)) out.up = true;
    if (ay > 0.5 || b(13)) out.down = true;
    if (b(0)) out.jump = true;
    if (b(2)) out.attack = true;
    if (b(1) || b(7) || b(5)) out.dash = true;
    if (b(3) || b(6) || b(4)) out.shot = true;
    if (b(8)) out.map = true;
    if (b(9)) out.pause = true;
  }
  return out;
}

export function pollInput() {
  const pad = readPad();
  for (const a of ACTIONS) {
    held[a] = !!(keyHeld[a] || pad[a] || virtual[a]);
    pressed[a] = held[a] && !prev[a];
    released[a] = !held[a] && prev[a];
    prev[a] = held[a];
  }
  const any = anyKeyPressed;
  anyKeyPressed = false;
  return any;
}

export const input = { held, pressed, released };

// Consume a press so that one keypress does not trigger two things.
export function consume(a) { pressed[a] = false; }
