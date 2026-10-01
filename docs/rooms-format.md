# Room data format (for js/rooms/*.js)

Each region file exports an array of room objects:

```js
// js/rooms/gearworks.js
export default [
  {
    id: 'GW_01', name: '錆びた搬入口', region: 'GEARWORKS',
    cx: 14, cy: 7, w: 1, h: 1,          // top-left cell and size in cells
    music: undefined,                    // optional; defaults to the region's track
    dark: 0,                             // optional 0..0.8 darkness around the player
    map: [                               // exactly 17*h strings of exactly 30*w chars
      '##############################',
      ...
    ],
    objects: [                           // optional, coordinates are ROOM-LOCAL tiles
      { type: 'npc', id: 'polka', scene: 'C', x: 10, y: 14 },
    ],
  },
];
```

Coordinates: room-local tile (x, y), (0,0) top-left. A 1×1 room is 30×17 tiles. The player is 10×22 px (1 tile wide, under 2 tiles tall).
For entity letters in the map and for objects, (x, y) is the tile the thing occupies; things that stand on the floor go in the row directly above the floor.

## Map legend

| char | meaning |
|---|---|
| `#` | solid wall/floor |
| `.` | empty air |
| `=` | one-way platform (jump up through it, ↓+jump drops through) |
| `^` | spikes (orientation is automatic from the adjacent solid tile). 1 damage + return to last safe floor |
| `~` | deep "silent water": a hazard exactly like spikes (dark water). |
| `,` | shallow water: decoration only |
| `>` / `<` | conveyor belt floor (solid) moving the standing player right / left at half walking speed |
| `C` | crystal block: solid; broken by 共鳴弾 (shot). Gate for `shot` |
| `K` | cracked floor: solid; broken by landing a フォルテ (pound) on it. Gate for `pound` |
| `B` | breakable wall: looks like a wall; broken by a normal hammer hit. Secret walls (give a hint nearby) |
| `M` | silence membrane: solid unless the player dashes with 鐘の声 (phase). Max 3 tiles thick |
| `V` | updraft vent (put it in the floor row's surface position, i.e. the tile ABOVE solid floor is fine too; it is non-solid). With 余韻 (glide) the player rises in the column above it until a solid tile |
| `|` | boss gate: open normally, solid while a boss fight is active. Put these in the doorway columns of boss arenas |
| `F` | fork seal: solid until all 5 forks are collected (only in SHELL→CROWN) |
| `:` | background wall (non-solid decoration, drawn darker behind everything) |
| `@` | player start (only one in the whole game, WORKSHOP) |
| `S` | 鐘の祠 save shrine (stand on floor: put it in the row above the floor) |
| `H` | 鼓動の器 (max HP +1) — 6 in the game |
| `A` | 鋼の撥 (attack +1) — 3 in the game |
| `o` | 鳴り石 ringing stone: hangs in the air, bounce target for フォルテ |
| `w` | ゼンマイ虫 walker (put on floor row above solid; if placed directly under a ceiling with no floor below, it walks on the ceiling) |
| `b` | 鈴蝙蝠 bat (place directly under a ceiling) |
| `t` | 錆砲 turret (place adjacent to a solid tile; it mounts on it) |
| `f` | 鐘蛙 frog (on floor) |
| `d` | 天井しずく dropper (directly under a ceiling) |
| `k` | 沈黙騎士 knight (on floor; 2 tiles tall, needs head room) |
| `g` | 静寂霊 ghost (anywhere) |

Any other character is an error.

## Objects (`objects: [...]`, room-local tile coords)

| object | fields | notes |
|---|---|---|
| score | `{type:'score', n: 1..12, x, y}` | 記憶の譜面 #n (each number exactly once in the game) |
| ability | `{type:'ability', id, x, y}` | id: `pound` (MINES) or `phase` (SHELL). Other abilities come from bosses automatically |
| boss | `{type:'boss', id, x, y, ...}` | see "Boss arenas" |
| npc | `{type:'npc', id, x, y, scene?, face?}` | ids: `orgo` (CL_03), `polka` (scene 'C' cloister, 'M' mines entrance, 'S' shell), `mimosa` (garden), `yona` (cloister bridge statue, near the NAVE gate), `erna` (nave statue), `crocca` (shell, next to the phase ability), `sera` (workshop, stone woman at the workbench). x,y = the tile above the floor where they stand |
| sign | `{type:'sign', text:KEY, x, y}` or `{type:'sign', npc:'namewall', x, y}` | KEY in: `WS_DOOR`, `WS_DISH`, `SHELL_CRACK`, `NAMEWALL` … or a literal Japanese string (≤ 40 chars) |
| switch | `{type:'switch', id:'unique_id', x, y, shot?:true}` | a bell switch; hit with the hammer (or with 共鳴弾 if `shot:true` — use that for far, high switches). Sets a persistent flag |
| gate | `{type:'gate', id:'same_id', x, y, w?:1, h?:3, invert?, pound?, look?}` | solid door (w×h tiles, top-left at x,y) that opens when flag `id` is set (e.g. the switch with the same id is hit). Use a gate+switch on one side for one-way shortcut doors. `invert:true` makes a bridge: absent until the flag is set, solid afterwards (use `look:'bridge'`). `pound:true` = a hatch in a floor that also opens when the player lands a フォルテ on it (use `look:'cracked'`) |
| mover | `{type:'mover', x, y, w:3, dx, dy, period:240, phase?:0..1}` | moving platform (w tiles wide), oscillates between (x,y) and (x+dx, y+dy) |
| deco | `{type:'deco', kind, x, y, ...}` | kinds: `statue` (petrified citizen, face:±1), `lamp`, `gear` (r, speed, dir), `crystal`, `flower` (color), `books`, `bigbell`, `chain` (len), `pipe` (len), `window`. Purely visual — use them generously for atmosphere (2–5 per room) |
| trigger | `{type:'trigger', id, x, y, w, h, text:KEY}` | shows a text once when the player enters the rect (story beats) |
| altar | `{type:'altar', x, y}` | fork altar showing collected forks (workshop / crown) |
| piston | `{type:'piston', x, y, len:4, dir:1, h:1, period:120, phase:0}` | a solid block that slides out of a wall (x,y = its base tile next to the wall) by `len` tiles toward `dir` (1 right, -1 left) and back. Its top can be stood on |
| arena | `{type:'arena', id, x, y, w, h, doors:[[x,y,w,h],...], zone?:[x,y,w,h]}` | combat trial: entering the rect closes the door rects until every enemy in the room (or only those inside `zone`) is dead, then sets flag `id`. Put the reward as a pickup with `need: id` |
| dummy | `{type:'dummy', x, y}` | harmless training dummy (fills the gauge) |
| chime / puzzle | `{type:'chime', group:'pz1', note:0..6, x, y, shot?}` + `{type:'puzzle', id:'pz1', order:[2,0,4], x, y}` | striking chimes (ド=0 … シ=6) in `order` sets flag `id`; use a gate with the same id as the reward door |

Pickups (`hpup`/`atkup` letters can't take fields, so use objects for these cases): `{type:'hpup', x, y, need?:flag}`, `{type:'atkup', x, y, need?:flag}`, `{type:'score', n, x, y, need?:flag}` — `need` hides the item until the flag is set.

Flags you can use as gate ids: any switch id, puzzle id, arena id, `shrine_<ROOM_ID>` (set when the player rests at the shrine in that room — e.g. the WS_03 floor door), `boss_<id>` (set when a boss is beaten: gear, choir, gardener, wyrm, librarian).

## Rules

- Exits: an exit is simply an opening in the room's border. The neighbouring room must have the matching opening at the same global position. Standard positions (level.md §2.2): E/W standard = edge column, y=12–14 (floor at y=15 on both sides); E/W upper = y=2–4; N/S standard = x=13–16. For multi-cell rooms, the positions are per cell (e.g. a 2×1 room's east edge cell 1 uses y=12–14 of that cell).
- The border of the room must be solid (`#`) everywhere except exits.
- Going up through a N exit: the player arrives with an upward boost of ~3 tiles, so place a ledge/platform right beside the opening in the upper room (or `=` platforms per level.md §2.2).
- Physics (design.md §2): jump 3 tiles up (not 4), gap 5 (not 6); jump+dash gap 9 (not 10); double jump 6 up (not 7); wall-jump climbs any wall; glide falls 1 tile per 2 tiles forward. Use level.md §2.3 "must pass" vs "gate" sizes.
- Passages at least 3 tiles tall. Enemies at least 6 tiles from doors.
- Every region needs its shrines as listed in level.md. Each boss arena needs a shrine within 1–2 rooms.

## Boss arenas (the code depends on these shapes)

Keep each boss room at the size and position level.md gives (they are 2×1 or 3×1). The boss code adapts to the room, but needs these parameters on the boss object:

- every boss: `x, y` = where it starts (y = the row above the floor for walkers), `floor: 15` (the floor surface row, i.e. the first solid row under the arena floor), optional `arena: [x0, x1]` = the leftmost and rightmost walkable floor columns of the fighting area (defaults to the whole room minus the 1-tile border). Doorways contain `|` tiles (closed during the fight). The fight starts when the player stands on the arena floor at least 3–4 tiles inside the room, so an entrance from above should drop the player onto the floor near the wall.
- `gear` (GW_08, 歯車の番人): flat floor across the arena; ceiling high (≥ 8 tiles above the floor); a 4-wide, 3-high block at both ends of the arena floor as side platforms. It rolls from one end of `arena` to the other — if the room is 60 wide, set `arena` to a ~30–36-tile-wide stretch bounded by walls (design.md §5.1 wants one screen).
- `choir` (NV_07, 聖歌の母): flat floor; 4–5 pillars 4 tiles tall (top surface = floor−4), 2–3 wide, gaps 6–8. `plats: [[x, y],...]` = the tile above each pillar top. Water rises ~2.5 tiles in phase 2. Boss starts floating near the top centre.
- `gardener` (GD_05, 庭師): branch platforms (`=` or `#`, 3–5 wide) at two or three heights above the floor, each reachable with double jump (≤ 5 up), spread over the room. `perches: [[x, y],...]` = 4–6 spots on top of branches where he lands (y = the branch's own row; his feet rest on top of it). In phase 2 the whole floor row (floor−1) turns into thorns, so the branches are the arena.
- `wyrm` (MN_08, 晶喰らい): flat floor (crystal sand), ceiling 12+ tiles above the floor. `pits: [x1, x2, x3]` = left x of three 4-wide floor sections that collapse into spikes in phase 2 (not under the doors). Put 3+ `o` ringing stones ~6–7 tiles above the floor near the pits for pound-bouncing across.
- `librarian` (AR_06, 司書): ledges on the walls / in the room at several heights. `spots: [[x, y]×6]` (ledges where she teleports; y = row above the ledge), `lamp: [x, y]` (tile of the hanging lamp-bell near the ceiling centre — must be shootable from below), `alcoves: [[x, y, w, h]×3]` (safe recesses, tile rects ≥ 2×2, reachable, where the player hides from the descending grey wave).
- Vesper / heart are built in CROWN by the lead.

## Cross-region ids (agreed between regions)

| id | where the switch is | where the gate is |
|---|---|---|
| `nave_lever` | NV_01 (NAVE): `{type:'switch', id:'nave_lever'}` (the water-gate lever) | CL_05 (CLOISTER): bridge over the 7-wide spike pit, `{type:'gate', id:'nave_lever', invert:true, look:'bridge', x, y, w:7, h:1}` |
| `cl06_hatch` | MN_11 (MINES): a switch just under the shaft top, reachable only from below (up-attack) | CL_06 (CLOISTER): the floor hatch over the S exit x=13–16, `{type:'gate', id:'cl06_hatch', pound:true, look:'cracked', x:13, y:15, w:4, h:2}` (no K tiles there) |

Other inter-region links have no shared ids: just put the openings at the exact positions of level.md §3.3 and the gate (crystal, vent, membrane, seal) on the side level.md says.
CROWN (built by the lead): CR_01 sits at cell (9,1) with its S opening at x=13–16 (one-way platform `=` at its row 15). SHELL's SH_04 N exit in cell cx9 must be at x=13–16 and be guarded by the fork seal `F` (and a membrane) as level.md describes.
