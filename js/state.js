// Global mutable game state shared by all modules.
export const G = {
  scene: 'title',
  frame: 0,
  save: null,         // persistent progress (see save.js)
  room: null,         // current room (runtime object from World)
  player: null,
  ents: [],           // live entities in the current room
  fx: [],             // particles / effects
  dynSolids: [],      // dynamic solid rects rebuilt each frame
  bossLock: false,
  boss: null,
  cam: { x: 0, y: 0, shake: 0 },
  hitstop: 0,
  fade: 0,            // 0..1 black overlay
  dialog: null,
  toast: null,
  debug: false,
};
