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
  TUNNEL: '-',
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
//   F  fruit spawn    -  tunnel / horizontal wrap edge
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

/**
 * Return the tile-code rows for a given (1-based) level. The layout is shared
 * across levels for now; `level` is accepted so callers/`Maze.reset(level)` can
 * swap layouts later without changing signatures.
 * @param {number} [level=1]
 * @returns {string[]} array of equal-length tile-code rows
 */
export function getLevelLayout(level = 1) {
  // Currently one shared layout; kept as a function so future levels can vary
  // the maze while preserving the API.
  void level;
  return BASE_MAZE;
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
