// Persistent progress stored in localStorage.
const KEY = 'sunken-bell-refrain-save-v1';

export function newSave() {
  return {
    version: 1,
    room: null,            // shrine room id
    sx: 0, sy: 0,          // respawn global pixel position (feet)
    abilities: {},         // dash, double, wall, pound, shot, glide, phase
    maxHp: 5,
    hp: 5,
    gauge: 0,
    atk: 1,
    forks: [],             // boss ids whose fork was obtained
    scores: [],            // memory score numbers collected
    items: {},             // 'room:x,y' -> true for collected pickups
    broken: {},            // room id -> [tile indices]
    flags: {},             // misc story flags / switches / bosses
    visited: {},           // room id -> true
    time: 0,               // frames played
    deaths: 0,
  };
}

export function loadSave() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const d = JSON.parse(s);
    return Object.assign(newSave(), d);
  } catch (e) {
    return null;
  }
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ }
}

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
}

export function eraseSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
