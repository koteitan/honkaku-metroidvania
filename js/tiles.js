// Tile codes and the ASCII legend used by room maps.
export const T = {
  EMPTY: 0, SOLID: 1, PLATFORM: 2, SPIKE: 3, CRYSTAL: 4, CRACKED: 5, BREAKABLE: 6,
  MEMBRANE: 7, VENT: 8, WATER: 9, BOSSGATE: 10, SEAL: 11, DECO: 12, SHALLOW: 13, CONV_R: 14, CONV_L: 15,
};

export const CHAR_TILE = {
  '#': T.SOLID, '.': T.EMPTY, ' ': T.EMPTY, '=': T.PLATFORM, '^': T.SPIKE,
  'C': T.CRYSTAL, 'K': T.CRACKED, 'B': T.BREAKABLE, 'M': T.MEMBRANE, 'V': T.VENT,
  '~': T.WATER, ',': T.SHALLOW, '>': T.CONV_R, '<': T.CONV_L, '|': T.BOSSGATE, 'F': T.SEAL, ':': T.DECO,
};

// Characters that place an entity; the tile under them becomes empty (or water).
export const CHAR_ENTITY = {
  '@': 'start', 'S': 'shrine',
  'w': 'walker', 'b': 'bat', 't': 'turret', 'f': 'frog', 'd': 'dropper', 'k': 'knight', 'g': 'ghost',
  'H': 'hpup', 'A': 'atkup', 'o': 'stone',
};

// Tiles that persist as "broken" once destroyed.
export const BREAKABLE_TILES = new Set([T.CRYSTAL, T.CRACKED, T.BREAKABLE]);

// Does this tile block a body? ctx = { phasing, bossLock, forks }
export function isSolidTile(t, ctx) {
  switch (t) {
    case T.SOLID: case T.CRYSTAL: case T.CRACKED: case T.BREAKABLE: case T.CONV_R: case T.CONV_L: return true;
    case T.MEMBRANE: return !(ctx && ctx.phasing);
    case T.BOSSGATE: return !!(ctx && ctx.bossLock);
    case T.SEAL: return !(ctx && ctx.forks >= 5);
    default: return false;
  }
}
