// Phaser maze: builds the tilemap wall collision layer and the pellet/fruit
// sprite groups, then mirrors edits back onto the pure `MazeGrid`.
//
// All grid/coordinate/pellet math lives in `mazeLogic.js` (framework-agnostic,
// property-tested). This class is the thin Phaser wrapper: it owns a `MazeGrid`
// and keeps Phaser display objects in sync with it. Rendering degrades
// gracefully — if art fails to load we draw simple shape textures instead
// (Req 13.5).

import Phaser from 'phaser';
import { TILE_SIZE, IMAGE_ASSETS } from '../config.js';
import { TILE } from './mazeData.js';
import { MazeGrid, tileKey } from './mazeLogic.js';

// Generated fallback texture keys (drawn when real art is unavailable).
const TEX = {
  wall: 'maze_wall_tile',
  pellet: 'maze_pellet',
  powerPellet: 'maze_power_pellet',
  fruit: 'maze_fruit',
};

// Wall tile index used inside the tilemap layer; empty tiles are -1.
const WALL_INDEX = 0;

export default class Maze {
  /**
   * @param {Phaser.Scene} scene the owning scene (usually GameScene)
   * @param {object} [opts]
   * @param {number} [opts.level=1] starting level
   * @param {string[]} [opts.layout] explicit tile-code rows (for tests/levels)
   */
  constructor(scene, { level = 1, layout } = {}) {
    this.scene = scene;
    this.tileSize = TILE_SIZE;

    /** Pure, framework-agnostic grid model (source of truth). */
    this.grid = new MazeGrid({ level, layout });

    /** Map of "col,row" -> pellet Phaser image, for removal on eat. */
    this._pelletSprites = new Map();

    this._ensureTextures();
    this._buildTilemap();
    this.pellets = scene.add.group();
    this.fruitPoints = scene.add.group();
    this._spawnPellets();
    this._spawnFruitPoints();
  }

  // --- Build ------------------------------------------------------------------

  /** Generate simple fallback textures for walls, pellets, and fruit. */
  _ensureTextures() {
    const t = this.tileSize;
    const make = (key, draw) => {
      if (this.scene.textures.exists(key)) return;
      const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
      draw(g);
      g.generateTexture(key, t, t);
      g.destroy();
    };

    // Wall tile: filled rounded blue square with a lighter inset (Pac-Man feel).
    make(TEX.wall, (g) => {
      g.fillStyle(0x1919a6, 1);
      g.fillRect(0, 0, t, t);
      g.lineStyle(2, 0x3737ff, 1);
      g.strokeRect(1, 1, t - 2, t - 2);
    });

    // Small pellet dot.
    make(TEX.pellet, (g) => {
      g.fillStyle(0xffe08a, 1);
      g.fillCircle(t / 2, t / 2, Math.max(2, t * 0.12));
    });

    // Larger power pellet.
    make(TEX.powerPellet, (g) => {
      g.fillStyle(0xffe08a, 1);
      g.fillCircle(t / 2, t / 2, Math.max(4, t * 0.28));
    });

    // Fruit marker (cherry-ish red circle) — fallback for the collectibles art.
    make(TEX.fruit, (g) => {
      g.fillStyle(0xff4d4d, 1);
      g.fillCircle(t / 2, t / 2, t * 0.32);
      g.fillStyle(0x2e7d32, 1);
      g.fillRect(t / 2 - 1, t * 0.18, 2, t * 0.22);
    });
  }

  /**
   * Texture key to use for a collectible: prefer the loaded collectibles art
   * when available, otherwise the generated fallback. (Frame slicing for
   * `05_collectibles_and_math_icons.png` is defined in later entity tasks; until
   * then the fallback shapes keep the maze rendering correct.)
   */
  _collectibleTexture(fallbackKey) {
    const artKey = IMAGE_ASSETS.collectibles.key;
    if (this.scene.textures.exists(artKey)) {
      // No frame map yet — keep using the reliable fallback shape so pellets do
      // not render as the full un-sliced sheet. Returning fallback here.
      return fallbackKey;
    }
    return fallbackKey;
  }

  /** Build the Phaser Tilemap and a wall collision layer from the grid. */
  _buildTilemap() {
    const { cols, rows } = this.grid;

    // Numeric layer data: wall tiles use WALL_INDEX, everything else is empty.
    const data = [];
    for (let row = 0; row < rows; row++) {
      const line = [];
      for (let col = 0; col < cols; col++) {
        line.push(this.grid.isWall(col, row) ? WALL_INDEX : -1);
      }
      data.push(line);
    }

    this.map = this.scene.make.tilemap({
      data,
      tileWidth: this.tileSize,
      tileHeight: this.tileSize,
    });

    const tileset = this.map.addTilesetImage(
      TEX.wall,
      TEX.wall,
      this.tileSize,
      this.tileSize,
    );
    this.wallLayer = this.map.createLayer(0, tileset, 0, 0);
    // Only the wall index collides (Property 5 / Req 1.3).
    this.wallLayer.setCollision(WALL_INDEX);
  }

  /** Create pellet sprites for every pellet tile in the grid. */
  _spawnPellets() {
    this.pellets.clear(true, true);
    this._pelletSprites.clear();

    for (const [key, code] of this.grid.pellets.entries()) {
      const [col, row] = key.split(',').map(Number);
      const { x, y } = this.grid.tileToWorld(col, row);
      const texKey =
        code === TILE.POWER_PELLET
          ? this._collectibleTexture(TEX.powerPellet)
          : this._collectibleTexture(TEX.pellet);
      const sprite = this.scene.add.image(x, y, texKey);
      sprite.setData('col', col);
      sprite.setData('row', row);
      this.pellets.add(sprite);
      this._pelletSprites.set(key, sprite);
    }
  }

  /** Create a marker sprite at each fruit spawn tile (fruit entity added later). */
  _spawnFruitPoints() {
    this.fruitPoints.clear(true, true);
    for (const { col, row } of this.grid.fruitSpawns) {
      const { x, y } = this.grid.tileToWorld(col, row);
      const sprite = this.scene.add.image(x, y, this._collectibleTexture(TEX.fruit));
      sprite.setData('col', col);
      sprite.setData('row', row);
      sprite.setVisible(false); // shown when a Fruit actually spawns (Task 14)
      this.fruitPoints.add(sprite);
    }
  }

  // --- Delegated grid helpers -------------------------------------------------

  /** @see MazeGrid#isWall */
  isWall(col, row) {
    return this.grid.isWall(col, row);
  }

  /** @see MazeGrid#tileToWorld */
  tileToWorld(col, row) {
    return this.grid.tileToWorld(col, row);
  }

  /** @see MazeGrid#worldToTile */
  worldToTile(x, y) {
    return this.grid.worldToTile(x, y);
  }

  /** @see MazeGrid#wrapIfTunnel — wraps a Phaser sprite in place. */
  wrapIfTunnel(entity) {
    return this.grid.wrapIfTunnel(entity);
  }

  /** @see MazeGrid#pelletCount */
  pelletCount() {
    return this.grid.pelletCount();
  }

  /**
   * Eat the pellet at (col,row): remove it from the grid and destroy its
   * sprite, returning the points earned (0 when no pellet). Keeps the Phaser
   * view in sync with the pure model (Property 7).
   */
  eatPelletAt(col, row) {
    const points = this.grid.eatPelletAt(col, row);
    if (points > 0) {
      const key = tileKey(col, row);
      const sprite = this._pelletSprites.get(key);
      if (sprite) {
        this.pellets.remove(sprite, true, true);
        this._pelletSprites.delete(key);
      }
    }
    return points;
  }

  /** True when all pellets are eaten (level clear). */
  isLevelCleared() {
    return this.grid.isLevelCleared();
  }

  // --- Spawn accessors --------------------------------------------------------

  /** World position of the Math Man spawn tile (or null). */
  mathManSpawnWorld() {
    const s = this.grid.mathManSpawn;
    return s ? this.tileToWorld(s.col, s.row) : null;
  }

  /** World positions of the ghost spawn tiles. */
  ghostSpawnsWorld() {
    return this.grid.ghostSpawns.map(({ col, row }) => this.tileToWorld(col, row));
  }

  /** World positions of the fruit spawn tiles. */
  fruitSpawnsWorld() {
    return this.grid.fruitSpawns.map(({ col, row }) => this.tileToWorld(col, row));
  }

  // --- Level reset ------------------------------------------------------------

  /**
   * Rebuild the maze for the next level: reset the pure grid's pellet layer and
   * respawn the pellet/fruit sprite groups. Preserves the tilemap when the
   * layout is unchanged. (Property 8)
   * @param {number} [level] level to load (defaults to next level)
   */
  reset(level) {
    this.grid.reset(level);
    this._spawnPellets();
    this._spawnFruitPoints();
    return this;
  }

  /** Tear down Phaser display objects owned by the maze. */
  destroy() {
    this.pellets?.clear(true, true);
    this.fruitPoints?.clear(true, true);
    this.wallLayer?.destroy();
    this.map?.destroy();
    this._pelletSprites.clear();
  }
}
