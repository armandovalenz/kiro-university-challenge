// Maze tile data for Math Man.
//
// Framework-agnostic (no Phaser imports): this module only exports plain data
// (tile-code rows) and small helpers so it stays unit-testable and portable.
// `Maze.js` turns these rows into a Phaser Tilemap + sprite groups, while the
// pure grid logic in `mazeLogic.js` interprets the same codes for movement,
// pellet, and coordinate math (Properties 5-8).

// --- Tile codes ---------------------------------------------------------------
// See design.md "Maze Model". Each character in a layout row is one tile.

export const TILE = {
  WALL: '#',
  PELLET: '.',
  PATH: ' ',
  POWER_PELLET: 'o',
  MATH_MAN_SPAWN: 'M',
  GHOST_SPAWN: 'G',
  FRUIT_SPAWN: 'F',
  TUNNEL: '-', // horizontal (East↔West) wrap edge, on a tunnel ROW
  TUNNEL_V: '|', // vertical (North↔South) wrap edge, on a tunnel COLUMN
};

/** Codes that block movement (collision tiles). */
export const WALL_CODES = new Set([TILE.WALL]);

/** Codes that carry a collectible pellet at start of a level. */
export const PELLET_CODES = new Set([TILE.PELLET, TILE.POWER_PELLET]);

// --- Base maze layout ---------------------------------------------------------
// 28 columns x 31 rows, matching GAME_WIDTH/GAME_HEIGHT at TILE_SIZE = 24.
// A Pac-Man-style symmetric maze:
//   #  wall          .  pellet         (space) empty path
//   o  power pellet   M  Math Man spawn  G  ghost-house spawn
//   F  fruit spawn    -  horizontal (E↔W) wrap edge
//   |  vertical (N↔S) wrap edge
//
// The central box (rows 12-16) is the ghost house; the door (row 12, cols
// 13-14) opens upward and the four ghosts spawn inside the interior (rows 13
// and 15). Row 14 is the horizontal tunnel/wrap row and is kept a clean
// left/right corridor — it deliberately does NOT carry ghost spawns, so the
// house interior never sits on the wrap row. Math Man spawns lower-center
// (row 23); a fruit spawns just below the ghost house (row 17).

export const BASE_MAZE = [
  '############################', // 0
  '#............##............#', // 1
  '#.####.#####.##.#####.####.#', // 2
  '#o####.#####.##.#####.####o#', // 3
  '#.####.#####.##.#####.####.#', // 4
  '#..........................#', // 5
  '#.####.##.########.##.####.#', // 6
  '#.####.##.########.##.####.#', // 7
  '#......##....##....##......#', // 8
  '######.#####.##.#####.######', // 9
  '######.#####.##.#####.######', // 10
  '######.##..........##.######', // 11
  '######.##.###  ###.##.######', // 12  (ghost-house door at cols 13-14)
  '######.##.# G  G #.##.######', // 13  (ghost spawns, house interior)
  '----------#      #----------', // 14  (clean tunnel/wrap row; NOT the house)
  '######.##.# G  G #.##.######', // 15  (ghost spawns, house interior)
  '######.##.########.##.######', // 16
  '######.##....F.....##.######', // 17  (fruit spawn at col 13)
  '######.##.########.##.######', // 18
  '######.##.########.##.######', // 19
  '#............##............#', // 20
  '#.####.#####.##.#####.####.#', // 21
  '#.####.#####.##.#####.####.#', // 22
  '#o..##.......MM.......##..o#', // 23  (Math Man spawn at cols 13-14)
  '###.##.##.########.##.##.###', // 24
  '###.##.##.########.##.##.###', // 25
  '#......##....##....##......#', // 26
  '#.##########.##.##########.#', // 27
  '#.##########.##.##########.#', // 28
  '#..........................#', // 29
  '############################', // 30
];

// --- Level 2 (6th grade): CIRCULAR maze -------------------------------------
// Concentric square 'rings' (as circular as a tile grid allows) with staggered
// doorway gaps so the path spirals between rings. Same 28x31 size and the same
// central ghost house / door / spawns as BASE_MAZE, so every consumer (2D Maze,
// FP3D MazeGrid, ghost-house helpers) works unchanged. Validated connected:
// every pellet is reachable from the Math Man spawn and the house exit is open.
// Four wrap tunnels: a vertical '|' at the TOP and BOTTOM of the central column
// (N↔S wrap), and a horizontal '-' at the LEFT and RIGHT of a mid row (E↔W
// wrap).
export const CIRCULAR_MAZE = [
  "#############|##############",
  "#..........................#",
  "#.o......................o.#",
  "#..........................#",
  "#.###########.###########..#",
  "#.#.....................#..#",
  "#.#.#########.#########.#..#",
  "#.#.#.................#.#..#",
  "#.#.#.#######.#######.#.#..#",
  "#.#.#.#.............#.#.#..#",
  "#.#.#.#.#####.#####.#.#.#..#",
  "#.#.#.#.#.........#.#.#.#..#",
  "#.#.#.#.#.###  ##.#.#.#.#..#",
  "#.#.#.#.#.##G  G#.#.#.#.#..#",
  "#.#.#.#.#.##    #.#.#.#.#..#",
  "-..........#G  G#....MM....-",
  "#.#.#.#.#.#######.#.#.#.#..#",
  "#.#.#.#.#.#.....#.#.#.#.#..#",
  "#.#.#.#.#.###.###.#.#.#.#..#",
  "#.#.#.#.#....F....#.#.#.#..#",
  "#.#.#.#.#####.#####.#.#.#..#",
  "#.#.#.#.............#.#.#..#",
  "#.#.#.#######.#######.#.#..#",
  "#.#.#.................#.#..#",
  "#.#.#########.#########.#..#",
  "#.#.....................#..#",
  "#.###########.###########..#",
  "#..........................#",
  "#.o......................o.#",
  "#..........................#",
  "#############|##############",
];

// --- Level 3+ (7th grade): THE SHINING / Overlook hedge maze ----------------
// A LARGER 39x59 grid (bigger than the 28x31 base/circular mazes) so the dense
// Overlook-style hedge detail fits: a bordered rectangular hedge with blocky
// right-angle corridors, a strong central vertical aisle running top→bottom
// (the iconic middle path), flanking chambers, and a bottom-center entrance
// approaching the central clearing. It is an ORIGINAL tile layout evoking the
// Overlook hotel hedge maze — not a trace of any specific artwork.
//
// Spawns sit on existing corridor tiles (NO walls moved, size unchanged): the
// four ghosts (G) spawn in the central chamber at cols 18 & 20, rows 18 & 19,
// flanking the open col-19 exit aisle. The grid-relative ghost-house helpers
// (houseRegionFromGrid / ghostHouseExitTile) derive the house from those spawns
// — bounding box cols 18..20 / rows 18..19, expanded to cols 17..21 /
// rows 17..20, door col 19 — and the ghosts path straight UP col 19 through the
// (19,16) exit tile. Math Man (M) spawns lower-center at (19,26); a fruit (F)
// sits just below the chamber at (19,21); four power pellets (o) mark the
// corners (rows 1 & 57, cols 2 & 36). FP3D sizes its world from the grid so the
// bigger maze renders fine in first person. Validated connected: all pellets
// reachable from the Math Man spawn and the house exit open. The top/bottom
// central gaps ('...'/'..') are the N↔S wrap corridor.
export const SHINING_MAZE = [
  "#################|||###################",
  "#.o..............MM.................o.#",
  "#.....................................#",
  "#..############.#...#.##############..#",
  "#..#............#...#..............#..#",
  "#..#.#############################.#..#",
  "#..#.#............#.#............#.#..#",
  "#..#.#.##########.#.#.##########.#.#..#",
  "#..#.#.#..........#.#.#........#.#.#..#",
  "#..#.#.#.########.#.#.#.######.#.#.#..#",
  "#..#.#.#.#......#.#.#.#.#....#.#.#.#..#",
  "#..#.#.#.#.####.#.#.#.######.#.#.#.#..#",
  "#..#.#.#...#....#...#......#.#.#.#.#..#",
  "#..#.#.#####.#############.#.#.#.#.#..#",
  "#............#...........#...#.#.#.#..#",
  "#..#.#########.#########.#####.#.#.#..#",
  "#..#.#.........................#......#",
  "#..#.#.#########.##.##.###########.#..#",
  "#..#.#.#.......#.#G.G#.........#...#..#",
  "#..#.#.#.#####.#.#G.G#.#.#####.#.#.#..#",
  "#..#.#.#.#...#.#.#...#.#.....#.#.#.#..#",
  "#..#.#.#.#.#.#.#...F...#.#.#.#.#.#.#..#",
  "#..#.#.#.#.#...#.#...#.#.#.#.#.#.#.#..#",
  "#..#.#.#.#.#.#.#.#...#.#.#.#.#.#.#.#..#",
  "#..#.#.#...#.#.#.#...#.#.#.#.#.#.#.#..#",
  "#..#.#.#####.#.#.#...#.#.#...#.#.#.#..#",
  "#....#.......#...........#####.#.#.#..#",
  "#..###########.#.#...#.#.......#...#..#",
  "#............#.#.#...#.#########.#.#..#",
  "############.#.#.#...#.#.........#....#",
  "#........#...#.#.#...#.#.##############",
  "#..#####.#.###.#.......#.#.......#....#",
  "#..#...#.#.#...#.#...#.#.#.#####.#.#..#",
  "#..#.#.#.#.#.#.#.#...#.#.#.#...#.#.#..#",
  "#..#.#.#.#.#.#...#...#.#.#.#.#.#.#.#..#",
  "#..#.#.#.#.#.#.#.#...#.#.#.#.#.#.#.#..#",
  "#..#.#.#.#.#...#.......#...#.#.#.#.#..#",
  "#..#.#.#.#.###.#.#...#.#####.#.#.#.#..#",
  "#..#.#.#.#...#.#.#...#.#.....#.#.#.#..#",
  "#..#.###.###.#.#.#...#.#.#####.#.#.#..#",
  "#........#...#.#.#...#.........#.#.#..#",
  "#..#####.#.###.#.#####.#########.#.####",
  "#..#...#.#.#...........#.......#.#....#",
  "#..#.#.#.#.#.#.#######.#.#####.#.#.#..#",
  "#..#.#.#.#.#.#.........#.#...#.#.#.#..#",
  "#..#.#.#.#.#.#####.#.###.#.#.#.#.#.#..#",
  "#..#.#.#.#.#.....#.#.#...#.#.#.#.#.#..#",
  "#..#.#.#.#.#####.#.#.#.###.#.#.#.#.#..#",
  "#..#.#.#.#.....#.#.#.#.....#.#.#.#.#..#",
  "#..#.#.#.#####.#.#.#.#######.#.#.#.#..#",
  "#..#.#.#.......#.#.#.........#.#.#.#..#",
  "#..#.#.#########.#.###########.#.#.#..#",
  "#..#.#.............#.............#.#..#",
  "#..#.###############.#############.#..#",
  "#..#...............#.#.............#..#",
  "#..###############.#.#.#############..#",
  "#..................#..................#",
  "#.o................#................o.#",
  "#####################||################"
];


/**
 * Return the tile-code rows for a given (1-based) level. The layout is shared
 * across levels for now; `level` is accepted so callers/`Maze.reset(level)` can
 * swap layouts later without changing signatures.
 * @param {number} [level=1]
 * @returns {string[]} array of equal-length tile-code rows
 */
export function getLevelLayout(level = 1) {
  // Per-level maze variety, tied to the grade progression (level 1 = 5th grade,
  // level 2 = 6th, level 3+ = 7th):
  //   level 1  -> BASE_MAZE     (the classic Pac-Man-style layout)
  //   level 2  -> CIRCULAR_MAZE (concentric rings for 6th grade)
  //   level 3+ -> SHINING_MAZE  (the Overlook hedge maze for 7th grade; the
  //               grade caps at 7, so every level beyond 3 reuses it).
  // All three are 28x31 with the same central ghost house, so every consumer
  // (2D Maze, FP3D MazeGrid, ghost-house helpers, pellet logic) is unchanged.
  const n = Number.isFinite(level) ? Math.trunc(level) : 1;
  if (n <= 1) return BASE_MAZE;
  if (n === 2) return CIRCULAR_MAZE;
  return SHINING_MAZE;
}

/**
 * Validate that a layout is a non-empty rectangle (all rows equal length).
 * Throws on malformed data so callers can guard/rebuild (design: "Malformed
 * maze data: validated on load").
 * @param {string[]} rows
 * @returns {{ cols: number, rows: number }}
 */
export function validateLayout(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Maze layout must be a non-empty array of rows.');
  }
  const width = rows[0].length;
  if (width === 0) {
    throw new Error('Maze layout rows must be non-empty.');
  }
  for (let r = 0; r < rows.length; r++) {
    if (typeof rows[r] !== 'string' || rows[r].length !== width) {
      throw new Error(
        `Maze layout is not rectangular: row ${r} has length ` +
          `${rows[r] && rows[r].length} (expected ${width}).`,
      );
    }
  }
  return { cols: width, rows: rows.length };
}
