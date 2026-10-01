// Room registry, parsing and global tile lookup.
// All positions in the game are GLOBAL pixels; a room is a rectangle of cells.
import { TILE, CELL_W, CELL_H } from './util.js';
import { T, CHAR_TILE, CHAR_ENTITY } from './tiles.js';

export const World = {
  rooms: [],
  byId: {},
  byCell: new Map(),
  errors: [],

  init(defs) {
    this.rooms = [];
    this.byId = {};
    this.byCell.clear();
    this.errors = [];
    for (const def of defs) {
      const r = parseRoom(def, this.errors);
      if (this.byId[r.id]) this.errors.push(`duplicate room id ${r.id}`);
      this.rooms.push(r);
      this.byId[r.id] = r;
      for (let y = 0; y < def.h; y++) for (let x = 0; x < def.w; x++) {
        const key = (def.cx + x) + ',' + (def.cy + y);
        if (this.byCell.has(key)) this.errors.push(`cell ${key} overlap: ${this.byCell.get(key).id} & ${r.id}`);
        this.byCell.set(key, r);
      }
    }
    if (this.errors.length) console.warn('World errors:\n' + this.errors.join('\n'));
  },

  roomAtCell(cx, cy) { return this.byCell.get(cx + ',' + cy) || null; },
  roomAtPx(gx, gy) {
    return this.roomAtCell(Math.floor(gx / (CELL_W * TILE)), Math.floor(gy / (CELL_H * TILE)));
  },

  // Global tile coords -> tile code. Outside every room = solid rock.
  tileAt(gtx, gty) {
    const r = this.roomAtCell(Math.floor(gtx / CELL_W), Math.floor(gty / CELL_H));
    if (!r) return T.SOLID;
    return r.tiles[(gty - r.ty0) * r.tw + (gtx - r.tx0)];
  },

  setTile(gtx, gty, t) {
    const r = this.roomAtCell(Math.floor(gtx / CELL_W), Math.floor(gty / CELL_H));
    if (!r) return null;
    r.tiles[(gty - r.ty0) * r.tw + (gtx - r.tx0)] = t;
    r.dirty = true;
    return r;
  },

  // Reset mutable tile state to the authored map, then apply saved breakage.
  resetTiles(broken) {
    for (const r of this.rooms) {
      r.tiles.set(r.orig);
      const list = broken && broken[r.id];
      if (list) for (const i of list) r.tiles[i] = r.orig[i] === T.WATER ? T.WATER : T.EMPTY;
      r.dirty = true;
    }
  },
};

function parseRoom(def, errors) {
  const tw = def.w * CELL_W, th = def.h * CELL_H;
  const rows = def.map;
  if (rows.length !== th) errors.push(`${def.id}: map has ${rows.length} rows, expected ${th}`);
  const tiles = new Uint8Array(tw * th);
  const ents = [];
  for (let y = 0; y < th; y++) {
    const row = rows[y] || '';
    if (row.length !== tw) errors.push(`${def.id}: row ${y} has ${row.length} cols, expected ${tw}`);
    for (let x = 0; x < tw; x++) {
      const ch = row[x] ?? '#';
      let t = CHAR_TILE[ch];
      if (t === undefined) {
        const e = CHAR_ENTITY[ch];
        if (e) ents.push({ type: e, tx: x, ty: y });
        else errors.push(`${def.id}: unknown char '${ch}' at ${x},${y}`);
        t = T.EMPTY;
      }
      tiles[y * tw + x] = t;
    }
  }
  // Entities standing inside water keep the water around them.
  for (const e of ents) {
    const i = e.ty * tw + e.tx;
    const nb = [i - 1, i + 1, i - tw].filter((j) => j >= 0 && j < tiles.length);
    if (nb.some((j) => tiles[j] === T.WATER)) tiles[i] = T.WATER;
    else if (nb.some((j) => tiles[j] === T.SHALLOW)) tiles[i] = T.SHALLOW;
  }
  for (const o of def.objects || []) ents.push({ ...o, tx: o.x, ty: o.y, obj: true });
  return {
    def, id: def.id, name: def.name, region: def.region,
    cx: def.cx, cy: def.cy, w: def.w, h: def.h,
    tx0: def.cx * CELL_W, ty0: def.cy * CELL_H, tw, th,
    px: def.cx * CELL_W * TILE, py: def.cy * CELL_H * TILE, pw: tw * TILE, ph: th * TILE,
    tiles, orig: tiles.slice(), ents, dirty: true,
  };
}
