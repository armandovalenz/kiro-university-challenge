// Framework-agnostic wall-decoration placement for FP3D_Mode (portraits,
// torches, …).
//
// NO Phaser and NO Three.js imports (Req 9.1). Works on any grid-like object
// with `cols`, `rows`, `isWall(col,row)` and `inBounds(col,row)` — in the game
// that is the `MazeGrid` built from `getLevelLayout()`, which stays the single
// source of maze truth. Nothing here mutates the grid: decorations only decide
// where on an existing wall face to hang a prop.

/**
 * The four faces a wall tile can present to an open neighbour. `dx`/`dy` step
 * from the wall tile to the corridor tile, (`nx`, `nz`) is the outward normal in
 * world X/Z (X = east, Z = south), and `yaw` is the Y-rotation that turns a
 * prop's local +Z onto that normal (rotating +Z by θ gives (sin θ, 0, cos θ)).
 * This is the prop convention — NOT the camera's `FACING_TO_YAW`, whose sign is
 * opposite.
 */
export const WALL_NEIGHBORS = [
  { dx: 0, dy: -1, nx: 0, nz: -1, yaw: Math.PI },       // corridor to the north
  { dx: 0, dy: 1, nx: 0, nz: 1, yaw: 0 },               // corridor to the south
  { dx: 1, dy: 0, nx: 1, nz: 0, yaw: Math.PI / 2 },     // corridor to the east
  { dx: -1, dy: 0, nx: -1, nz: 0, yaw: -Math.PI / 2 },  // corridor to the west
];

/** Key for a wall tile, used to keep at most one decoration per tile. */
export const wallKey = (col, row) => `${col},${row}`;

/**
 * Every wall face that borders an in-bounds open tile, in a fixed row-major
 * order (so seeded selection over it is stable across reloads).
 * @param {{cols:number, rows:number, isWall:(c:number,r:number)=>boolean, inBounds:(c:number,r:number)=>boolean}} grid
 * @returns {Array<{col:number,row:number,ncol:number,nrow:number,n:typeof WALL_NEIGHBORS[number]}>}
 */
export function wallFaces(grid) {
  const faces = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!grid.isWall(col, row)) continue;
      for (const n of WALL_NEIGHBORS) {
        const ncol = col + n.dx;
        const nrow = row + n.dy;
        if (!grid.inBounds(ncol, nrow)) continue;
        if (grid.isWall(ncol, nrow)) continue;
        faces.push({ col, row, ncol, nrow, n });
      }
    }
  }
  return faces;
}

/**
 * Deterministic PRNG (mulberry32) returning floats in [0, 1). Same seed → same
 * sequence, so "random" decoration placement is stable per reload.
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a spaced-out subset of wall faces. Walks `faces` in order and keeps a
 * face with probability `1 / every`, but only if its wall tile is not excluded
 * or already used and its corridor tile is at least `minSpacing` (Manhattan,
 * in tiles) from every face already kept. Returns the kept faces in order.
 * @param {ReturnType<typeof wallFaces>} faces candidate faces
 * @param {object} opts
 * @param {() => number} opts.rand PRNG in [0, 1)
 * @param {number} opts.every keep roughly 1 in `every` eligible faces (>= 1)
 * @param {number} [opts.minSpacing=0] minimum corridor-tile distance between kept faces
 * @param {Set<string>} [opts.excludeWalls] wall-tile keys that must not be used
 * @returns {ReturnType<typeof wallFaces>}
 */
export function pickSpacedFaces(faces, { rand, every, minSpacing = 0, excludeWalls = new Set() }) {
  const chance = 1 / Math.max(1, every);
  const used = new Set();
  const kept = [];
  for (const face of faces) {
    const key = wallKey(face.col, face.row);
    if (excludeWalls.has(key) || used.has(key)) continue;
    const tooClose = kept.some(
      (k) => Math.abs(k.ncol - face.ncol) + Math.abs(k.nrow - face.nrow) < minSpacing,
    );
    if (tooClose) continue;
    if (rand() < chance) {
      used.add(key);
      kept.push(face);
    }
  }
  return kept;
}
