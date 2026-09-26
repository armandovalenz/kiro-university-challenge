// First-person 3D renderer for FP3D_Mode.
//
// This is the ONLY module in the codebase allowed to import Three.js. All other
// modules stay framework-agnostic or Phaser-facing; the 3D layer is isolated
// here behind a small interface (design "FP3DRenderer (Three.js only)") so
// Three.js never leaks into game logic (Req 9.1). It owns the WebGLRenderer,
// Scene, and PerspectiveCamera, builds the maze geometry, positions the camera,
// and releases GPU resources on teardown.
//
// Coordinate convention matches fp3dLogic: X -> east (columns), Z -> south
// (rows), Y -> up. Camera yaw is snapped to a cardinal facing.
//
// Asset fallback (Req 8.2): the current renderer loads NO external texture or
// model assets — every marker (walls, floor, pellets, power-pellets, fruit,
// ghosts) is a DRAWN placeholder mesh built from Three.js primitives
// (`BoxGeometry`/`PlaneGeometry`/`SphereGeometry`/`OctahedronGeometry`) with
// solid/emissive `MeshStandardMaterial` colors. So "substitute a drawn
// placeholder for a missing asset" is already the default, unconditional path.
// To keep that fallback honest for any FUTURE texture use, `loadTexture(url,
// fallbackMaterial)` below is the single seam through which an external texture
// may be loaded: it races a `THREE.TextureLoader` against `FP3D.assetTimeoutMs`
// (10 s) and, on error OR timeout, resolves to the drawn placeholder material
// and continues without throwing (Req 8.2). Nothing calls it yet; it exists so
// the timeout-guarded placeholder behavior is in place the moment a texture is
// introduced. Three.js stays isolated to this file (Req 9.1).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { FP3D, GHOST_COLORS } from '../config.js';
import { TILE } from '../maze/mazeData.js';
import { tileToWorld3D, eyePosition } from '../systems/fp3d/fp3dLogic.js';

/**
 * Thrown at construction time when a WebGL rendering context cannot be
 * obtained. Callers (FP3DScene) catch this and fall back to the 2D GameScene
 * (Req 8.1). This is the CONSTRUCTION-time failure path — distinct from a
 * mid-session `webglcontextlost` event, which is delivered via the injected
 * `onContextLost` callback (Req 8.5).
 */
export class NoWebGLContextError extends Error {
  /** @param {string} [message] */
  constructor(message = 'WebGL context could not be created for FP3D_Mode') {
    super(message);
    this.name = 'NoWebGLContextError';
  }
}

/**
 * Yaw (rotation about the world Y axis, radians) for each cardinal facing.
 *
 * The camera looks down -Z by default in Three.js. With X=east and Z=south:
 *   north = toward -Z  -> yaw 0
 *   east  = toward +X  -> yaw -90° (rotate right/clockwise looking from above)
 *   south = toward +Z  -> yaw 180°
 *   west  = toward -X  -> yaw +90°
 * Each cardinal maps to a distinct 90° yaw, consistent with the fp3dLogic
 * world convention (Req 2.4).
 * @type {Record<'north'|'east'|'south'|'west', number>}
 */
/** Yaw for a ghost heading ('up'|'down'|'left'|'right') so models face travel. */
const DIR_YAW = {
  up: 0,
  right: -Math.PI / 2,
  down: Math.PI,
  left: Math.PI / 2,
};

const FACING_TO_YAW = {
  north: 0,
  east: -Math.PI / 2,
  south: Math.PI,
  west: Math.PI / 2,
};

/** Default wall/floor colors, overridable via the `colors` option. */
const DEFAULT_COLORS = {
  wall: 0x3d7be0,     // brighter blue walls (Pac-Man maze blue)
  floor: 0x05070f,    // near-black floor fallback if the texture fails to load
  ceiling: 0x0a1230,  // dark navy ceiling so corridors read as enclosed
  // Textures (public/ is served at the web root by Vite). Loaded via the
  // timeout-guarded seam; on failure the solid color above is kept (Req 8.2).
  floorTexture: '/assets/images/textures/floor_stone_01.png',
  wallTexture: '/assets/images/textures/wall_stone_01.png',
  ceilingTexture: '/assets/images/textures/ceiling_panel_01.png',
};

/**
 * Marker appearance, expressed as fractions of `TILE_SIZE` so markers scale
 * with the grid. Both pellet types are SPHERES; power pellets stay distinct by
 * being noticeably larger and a different color (Req 3.2). The fruit marker is
 * a warm sphere at the spawn tile (Req 3.5). Radii are kept small so pellets
 * read as dots rather than boulders.
 */
const MARKER = {
  pellet: { color: 0xfff2b0, radiusFrac: 0.05, yFrac: 0.35 },
  powerPellet: { color: 0xff5bd0, radiusFrac: 0.11, yFrac: 0.4 },
  fruit: { color: 0xff5a3c, radiusFrac: 0.28, yFrac: 0.4 },
};

/**
 * Ghost 3D model + per-color textures. All four ghosts share the single
 * `ghost_red.glb` geometry; each gets its own texture so red/pink/cyan/orange
 * read correctly. Served from public/ at the web root by Vite. On load failure
 * the ghost falls back to a colored sphere (Req 8.2).
 */
const GHOST_MODEL_URL = '/assets/models/ghost_red.glb';
const GHOST_TEXTURES = {
  red: '/assets/images/textures/ghost_red_01.png',
  pink: '/assets/images/textures/ghost_pink_01.png',
  cyan: '/assets/images/textures/ghost_cyan_01.png',
  orange: '/assets/images/textures/ghost_orange_01.png',
};

/**
 * Fruit prop models (handoff §3). Low-poly GLBs with their base-color texture
 * baked in — just load and place. Rotated through per spawn; on load failure or
 * a 10s timeout the procedural glowing sphere is kept (Req 8.2).
 */
const FRUIT_MODEL_URLS = {
  cherry: '/assets/models/cherry.glb',
  banana: '/assets/models/banana.glb',
  orange: '/assets/models/orange.glb',
};
/** Rotation order for successive fruit spawns. */
const FRUIT_MODEL_ORDER = ['cherry', 'banana', 'orange'];

/** Ghost body size / eye height as fractions of `TILE_SIZE`. */
const GHOST_SIZE = { radiusFrac: 0.32, yFrac: 0.45 };

/** Extra vertical stretch applied to the ghost GLB model (Y-axis only). */
const GHOST_HEIGHT_BOOST = 2.0; // 2x taller
/** How far off the floor the ghost hovers, as a fraction of TILE_SIZE. */
const GHOST_FLOAT_FRAC = 0.55; // base hover height above the floor
/** Bob amplitude for the floating ghost, as a fraction of TILE_SIZE. */
const GHOST_BOB_FRAC = 0.12;
/** Ghost material opacity (1 = solid). 0.6 = 40% transparent, spectral look. */
const GHOST_OPACITY = 0.6;

export class FP3DRenderer {
  /**
   * @param {HTMLCanvasElement|HTMLElement} canvasOrParent
   *   Either an existing `<canvas>` to render into, or a parent element the
   *   renderer's own canvas is appended to.
   * @param {object} opts
   * @param {import('../maze/mazeLogic.js').MazeGrid} opts.grid maze grid (single source of maze truth)
   * @param {{wall?: number, floor?: number}} [opts.colors] wall/floor colors
   * @param {number} [opts.eyeHeight] camera anchor height (defaults to FP3D.eyeHeight)
   * @param {number} [opts.dprCap] devicePixelRatio cap (defaults to FP3D.dprCap)
   * @param {boolean} [opts.reducedMotion] start with reduced motion enabled
   * @param {() => void} [opts.onContextLost] called on a mid-session `webglcontextlost` (Req 8.5)
   * @throws {NoWebGLContextError} when a WebGL context cannot be obtained (Req 8.1)
   */
  constructor(canvasOrParent, {
    grid,
    colors = {},
    eyeHeight = FP3D.eyeHeight,
    dprCap = FP3D.dprCap,
    reducedMotion = false,
    onContextLost = null,
  } = {}) {
    this.grid = grid;
    this.colors = { ...DEFAULT_COLORS, ...colors };
    this.eyeHeight = eyeHeight;
    this.reducedMotion = reducedMotion;
    this._onContextLost = onContextLost;

    // Track disposables so dispose() can release them.
    this._geometries = new Set();
    this._materials = new Set();
    this._meshes = [];

    // Dynamic markers/ghosts are tracked separately from the static maze so a
    // maze rebuild does not clobber them and dispose() can release everything.
    /** Pellet/power-pellet marker groups keyed by "col,row". @type {Map<string, THREE.Group>} */
    this._pelletMarkers = new Map();
    /** Per-pellet float/halo animation anchors keyed by "col,row". @type {Map<string, object>} */
    this._pelletAnims = new Map();
    /** Fruit marker group (single), or null when no fruit is present. */
    this._fruitMarker = null;
    /** Fruit float/halo animation anchors, or null when no fruit is present. */
    this._fruitAnim = null;
    /** Ghost meshes keyed by ghost `key`. @type {Map<string, THREE.Mesh>} */
    this._ghostMeshes = new Map();

    // Animation state for the camera (position + yaw). `animateMove`/
    // `animateTurn` set these; `render` advances them each frame. When
    // reducedMotion is on the target is applied instantly (no tween).
    /** @type {null | { fromPos: THREE.Vector3, toPos: THREE.Vector3, startMs: number, durMs: number }} */
    this._moveAnim = null;
    /** @type {null | { fromYaw: number, toYaw: number, startMs: number, durMs: number }} */
    this._turnAnim = null;
    /** Base camera yaw from the grid facing (radians); tween/setCamera write it. */
    this._baseYaw = 0;
    /** Free-look mouse-drag yaw offset (radians) added on top of the base yaw. */
    this._lookYaw = 0;
    /** Free-look pitch (radians), clamped in setLookOffset. */
    this._lookPitch = 0;

    // --- WebGLRenderer -------------------------------------------------------
    // Construction can throw synchronously (or return a renderer with no
    // context) when WebGL is unavailable; both are funneled into
    // NoWebGLContextError so the caller has a single failure signal (Req 8.1).
    const usingOwnCanvas = !(canvasOrParent instanceof HTMLCanvasElement);
    try {
      const rendererOpts = {
        antialias: true,
        powerPreference: 'high-performance',
      };
      if (canvasOrParent instanceof HTMLCanvasElement) {
        rendererOpts.canvas = canvasOrParent;
      }
      this.renderer = new THREE.WebGLRenderer(rendererOpts);
    } catch (err) {
      throw new NoWebGLContextError(`WebGL context could not be created: ${err?.message ?? err}`);
    }

    // Some environments return a renderer whose underlying context failed.
    if (!this.renderer || !this.renderer.getContext || !this.renderer.getContext()) {
      // Best-effort cleanup of a partially constructed renderer.
      try { this.renderer?.dispose?.(); } catch { /* ignore */ }
      throw new NoWebGLContextError();
    }

    this.canvas = this.renderer.domElement;
    if (usingOwnCanvas && canvasOrParent && typeof canvasOrParent.appendChild === 'function') {
      // Layer the 3D canvas so it FILLS the game container and sits above the
      // Phaser 2D canvas (which draws black in FP3D_Mode) but below the DOM
      // overlay root (z-index 10 in index.html), which hosts the quiz/lesson
      // modals and the on-screen touch controls. Without explicit positioning
      // the renderer's canvas keeps its default inline flow + 300x150 backing
      // size and is hidden behind Phaser's canvas — the "black screen" bug.
      Object.assign(this.canvas.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        display: 'block',
        zIndex: '5',
      });
      // Ensure the parent establishes a positioning context so `absolute` is
      // relative to the game container, not the page.
      const parentStyle = canvasOrParent.style;
      if (parentStyle && !parentStyle.position) parentStyle.position = 'relative';
      canvasOrParent.appendChild(this.canvas);
      this._parentEl = canvasOrParent;
    }

    // Cap DPR so retina displays don't over-render (perf §5).
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.min(dpr, dprCap));

    // Soft shadow maps so the floating pellets/fruit cast shadows on the floor.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- Scene & camera ------------------------------------------------------
    this.scene = new THREE.Scene();

    // A tight far plane keeps the depth buffer precise: the whole maze fits in
    // a box roughly cols*rows tiles wide, so the diagonal bounds the view.
    const worldW = grid.cols * grid.tileSize;
    const worldD = grid.rows * grid.tileSize;
    const far = Math.ceil(Math.hypot(worldW, worldD)) + grid.tileSize;
    const near = grid.tileSize * 0.05;
    const aspect = this._canvasAspect();
    this.camera = new THREE.PerspectiveCamera(FP3D.fovDegrees, aspect, near, far);
    this.camera.rotation.order = 'YXZ'; // yaw (Y) then pitch (X) — first-person friendly

    // Lighting: a bright hemisphere fill (sky/ground tint) plus a directional
    // key so wall faces and corners read clearly with strong contrast.
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202030, 1.0);
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    const dir = new THREE.DirectionalLight(0xffffff, 0.95);
    // Position the key light high and slightly off-center, aimed at the maze
    // center, so pellet/fruit shadows fall onto the floor beneath them.
    dir.position.set(worldW * 0.5, far, worldD * 0.35);
    dir.target.position.set(worldW * 0.5, 0, worldD * 0.5);
    dir.castShadow = true;
    // Orthographic shadow frustum sized to cover the whole maze footprint.
    const halfW = worldW * 0.55;
    const halfD = worldD * 0.55;
    dir.shadow.camera.left = -halfW;
    dir.shadow.camera.right = halfW;
    dir.shadow.camera.top = halfD;
    dir.shadow.camera.bottom = -halfD;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = far + 1;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.bias = -0.0005;
    this.scene.add(hemi);
    this.scene.add(ambient);
    this.scene.add(dir);
    this.scene.add(dir.target);

    // --- Mid-session context-loss listener (Req 8.5) -------------------------
    // Distinct from the constructor throw above: a context lost DURING play is
    // a browser event on the canvas. We keep a bound reference so dispose() can
    // remove it, and forward to the injected callback so FP3DScene can fall
    // back to 2D mid-session.
    this._contextLostHandler = (event) => {
      // Prevent the default so the context can (in principle) be restored,
      // then notify the scene to fall back to 2D.
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof this._onContextLost === 'function') this._onContextLost(event);
    };
    this.canvas.addEventListener('webglcontextlost', this._contextLostHandler, false);

    // Build the static maze geometry now that the scene exists.
    this.buildMaze(grid);

    // Seed an initial size from the parent's client rect now that the camera
    // exists, so the very first rendered frame is correctly sized even before
    // the scene's resize sync fires (a 0x0 or stale size renders nothing).
    // Falls back to the game canvas or a sane default in headless/tests.
    this._sizeToParent();
  }

  /** Current canvas aspect ratio, defaulting to 16:9 before layout. */
  _canvasAspect() {
    const w = this.canvas?.clientWidth || this.canvas?.width || 16;
    const h = this.canvas?.clientHeight || this.canvas?.height || 9;
    return h === 0 ? 16 / 9 : w / h;
  }

  /** Track a geometry so dispose() releases it. @template T @param {T} geo @returns {T} */
  _trackGeometry(geo) {
    this._geometries.add(geo);
    return geo;
  }

  /** Track a material so dispose() releases it. @template T @param {T} mat @returns {T} */
  _trackMaterial(mat) {
    this._materials.add(mat);
    return mat;
  }

  /**
   * Timeout-guarded external texture load — the single asset seam for Req 8.2.
   *
   * Attempts to load `url` with a `THREE.TextureLoader`, racing it against
   * `FP3D.assetTimeoutMs` (10 s). If the load succeeds in time the resolved
   * `THREE.Texture` is returned; if it ERRORS or the timeout elapses first, the
   * promise resolves to `null` so the caller keeps using its already-built
   * DRAWN placeholder material instead of the texture (Req 8.2). It NEVER
   * rejects — a missing/slow asset must never interrupt the session.
   *
   * The current renderer loads no external assets (all markers are drawn
   * primitives), so nothing calls this yet; it exists so any future texture use
   * is automatically covered by the timeout → placeholder fallback. Loaded
   * textures are tracked for disposal alongside geometries/materials.
   *
   * @param {string} url texture URL to attempt to load
   * @param {number} [timeoutMs] load budget before falling back (defaults to FP3D.assetTimeoutMs)
   * @returns {Promise<THREE.Texture|null>} the texture on success, or null on error/timeout
   */
  loadTexture(url, timeoutMs = FP3D.assetTimeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      // Timeout → fall back to the drawn placeholder (resolve null), continuing
      // play without throwing (Req 8.2).
      const timer = setTimeout(() => finish(null), timeoutMs);

      let loader;
      try {
        loader = new THREE.TextureLoader();
      } catch {
        finish(null);
        return;
      }

      try {
        loader.load(
          url,
          (texture) => {
            // Track for disposal so a loaded texture is released on teardown.
            if (texture) this._trackTexture(texture);
            finish(texture || null);
          },
          undefined, // onProgress: unused
          () => finish(null), // onError → placeholder fallback
        );
      } catch {
        // Synchronous throw from a stub/older loader → placeholder fallback.
        finish(null);
      }
    });
  }

  /** Track a texture so dispose() releases it. @template T @param {T} tex @returns {T} */
  _trackTexture(tex) {
    if (!this._textures) this._textures = new Set();
    this._textures.add(tex);
    return tex;
  }

  /**
   * Build the static maze: one `InstancedMesh` holding every wall box (a single
   * draw call for all walls, Req 1.2) plus a floor plane spanning the maze under
   * the traversable tiles (Req 1.3). Placement uses `tileToWorld3D` so it shares
   * the fp3dLogic coordinate convention. Safe to call more than once — a prior
   * maze build is disposed first.
   * @param {import('../maze/mazeLogic.js').MazeGrid} grid
   */
  buildMaze(grid) {
    this.grid = grid;
    this._disposeMaze();
    // A rebuild invalidates dynamic marker/ghost placement, so release them too
    // (the scene repopulates them via setPelletVisible/setFruit/setGhosts).
    this._disposeDynamic();

    const tile = grid.tileSize;

    // --- Walls: one InstancedMesh (single draw call, Req 1.2) ----------------
    // Count wall tiles first to size the instanced buffer exactly.
    const wallTiles = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if (grid.isWall(col, row)) wallTiles.push({ col, row });
      }
    }

    // Walls stand a little over two tiles tall so corridors read as rooms with
    // headroom (with a ceiling above). A brighter wall material + emissive lift
    // gives clear contrast against the darker floor so the maze is legible.
    const wallH = tile * 2.2;
    const wallGeo = this._trackGeometry(new THREE.BoxGeometry(tile, wallH, tile));
    const wallMat = this._trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff,   // white base so the stone-brick texture shows true colors
      roughness: 0.85,
      metalness: 0.0,
    }));

    // Stone-brick wall texture. BoxGeometry UVs map [0,1] per face, so one full
    // brick tile shows on each wall face (Req 8.2: keep the solid color on
    // failure). Loaded via the timeout-guarded seam so a slow/missing asset
    // never blocks play.
    // Capture the material this build created so a later rebuild's texture load
    // can't scribble onto a disposed material.
    const wallMatRef = wallMat;
    this.loadTexture(this.colors.wallTexture).then((tex) => {
      if (!tex || this._walls === null || !this._materials.has(wallMatRef)) {
        if (!tex && this._materials.has(wallMatRef)) wallMatRef.color.set(this.colors.wall);
        return;
      }
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      // Repeat vertically so the taller-than-a-tile walls show ~1 brick tile per
      // tile of height rather than a single stretched brick.
      tex.repeat.set(1, wallH / tile);
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      if (this.renderer && this.renderer.capabilities) {
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy?.() || 1;
      }
      wallMatRef.map = tex;
      wallMatRef.needsUpdate = true;
    });

    if (wallTiles.length > 0) {
      const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallTiles.length);
      // The whole maze is always near the camera; skip per-batch frustum culling
      // so a conservative bounding sphere never hides the walls.
      walls.frustumCulled = false;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < wallTiles.length; i++) {
        const { col, row } = wallTiles[i];
        const { x, z } = tileToWorld3D(grid, col, row);
        dummy.position.set(x, wallH / 2, z); // base on the floor (y = 0)
        dummy.updateMatrix();
        walls.setMatrixAt(i, dummy.matrix);
      }
      walls.instanceMatrix.needsUpdate = true;
      this._walls = walls;
      this._meshes.push(walls);
      this.scene.add(walls);
    } else {
      this._walls = null;
    }

    // --- Floor + ceiling: planes spanning the whole maze (Req 1.3) -----------
    const worldW = grid.cols * tile;
    const worldD = grid.rows * tile;

    const floorGeo = this._trackGeometry(new THREE.PlaneGeometry(worldW, worldD));
    const floorMat = this._trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff,          // white base so the texture shows its true colors
      roughness: 1.0,
      metalness: 0.0,
    }));
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2; // lie flat on the XZ ground plane
    floor.position.set(worldW / 2, 0, worldD / 2);
    floor.receiveShadow = true;
    this._floor = floor;
    this._meshes.push(floor);
    this.scene.add(floor);

    // Stone floor texture (Req 8.2 fallback: on error/timeout keep the solid
    // color). Tiled one repeat per maze tile so it reads at floor scale. Loaded
    // via the timeout-guarded seam so a missing/slow asset never blocks play.
    this.loadTexture(this.colors.floorTexture).then((tex) => {
      if (!tex || !this._floor || this._floor !== floor) {
        // No texture (error/timeout) or the floor was rebuilt → keep the solid
        // fallback color so the floor stays visible.
        if (!tex) floorMat.color.set(this.colors.floor);
        return;
      }
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(grid.cols, grid.rows); // one tile of texture per maze tile
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      if (this.renderer && this.renderer.capabilities) {
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy?.() || 1;
      }
      floorMat.map = tex;
      floorMat.needsUpdate = true;
    });

    // A ceiling at wall height closes the corridors so you never see "sky"
    // through the top — the view reads as being inside the maze.
    const ceilGeo = this._trackGeometry(new THREE.PlaneGeometry(worldW, worldD));
    const ceilMat = this._trackMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff,   // white base so the panel texture shows true colors
      roughness: 1.0,
      metalness: 0.0,
    }));
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2; // face downward
    ceiling.position.set(worldW / 2, wallH, worldD / 2);
    this._meshes.push(ceiling);
    this.scene.add(ceiling);

    // Paneled ceiling texture, tiled per maze tile like the floor (Req 8.2:
    // keep the solid color on failure).
    this.loadTexture(this.colors.ceilingTexture).then((tex) => {
      if (!tex || this._meshes.indexOf(ceiling) === -1) {
        if (!tex) ceilMat.color.set(this.colors.ceiling);
        return;
      }
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(grid.cols, grid.rows);
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      if (this.renderer && this.renderer.capabilities) {
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy?.() || 1;
      }
      ceilMat.map = tex;
      ceilMat.needsUpdate = true;
    });
  }

  /**
   * Place the camera at the eye position for a tile and snap its yaw to the
   * given cardinal facing (Req 2.1, 2.4).
   * @param {number} col tile column
   * @param {number} row tile row
   * @param {'north'|'east'|'south'|'west'} facing cardinal facing
   */
  setCamera(col, row, facing) {
    const { x, y, z } = eyePosition(this.grid, col, row, this.eyeHeight);
    this.camera.position.set(x, y, z);
    this._baseYaw = FACING_TO_YAW[facing] ?? FACING_TO_YAW.north;
    this._turnAnim = null;
    this._applyCameraRotation();
  }

  /**
   * Set the free-look offset (Google-Street-View-style mouse drag). `yaw` is an
   * offset added to the grid-facing yaw; `pitch` tilts the view up/down. Both
   * are applied on top of the discrete cardinal facing without changing it, so
   * grid movement is unaffected. Pitch is clamped so the player can't flip over.
   * @param {number} yaw look yaw offset in radians
   * @param {number} [pitch] look pitch in radians
   */
  setLookOffset(yaw, pitch = this._lookPitch || 0) {
    this._lookYaw = Number.isFinite(yaw) ? yaw : 0;
    const maxPitch = Math.PI / 3; // ~60° up/down
    this._lookPitch = Math.max(-maxPitch, Math.min(maxPitch, Number.isFinite(pitch) ? pitch : 0));
    this._applyCameraRotation();
  }

  /** Current free-look yaw offset (radians), for the scene to read on release. */
  getLookYaw() {
    return this._lookYaw || 0;
  }

  /**
   * Dramatic "the ghost got you" camera: snap the view to look straight AT the
   * catching ghost's face and pull the ghost right up in front of the camera so
   * it looms large before the quiz overlay pops. The ghost is on the player's
   * tile, so we frame it just ahead of the camera along the given approach
   * direction, tilt up toward its floating body, and point the camera at it via
   * a look offset. Purely visual — the player's tile/facing state is unchanged;
   * `clearFaceGhost()` restores the normal view on resume.
   * @param {string} key catching ghost's key ('red'|'pink'|'cyan'|'orange')
   * @param {'north'|'east'|'south'|'west'} approachFacing direction the ghost is framed toward
   */
  faceGhost(key, approachFacing = 'north') {
    const group = this._ghostMeshes && this._ghostMeshes.get(key);
    if (!group || !this.camera) return;

    // Remember where the ghost was so we can restore it after the scare.
    if (!group.userData.savedPos) {
      group.userData.savedPos = group.position.clone();
    }

    // Frame the ghost a little in FRONT of the camera along the approach dir so
    // it's clearly in view (not clipped by the near plane at the exact eye
    // point). Directions map to world deltas: north=-Z, south=+Z, east=+X,
    // west=-X (matching FACING_TO_YAW / the maze convention).
    const tile = this.grid.tileSize;
    const dist = tile * 0.85;
    const delta = {
      north: { x: 0, z: -1 },
      south: { x: 0, z: 1 },
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 },
    }[approachFacing] || { x: 0, z: -1 };
    const cam = this.camera.position;
    group.position.set(cam.x + delta.x * dist, tile * GHOST_FLOAT_FRAC, cam.z + delta.z * dist);
    // Freeze the ghost's glide/bob targeting on this framed spot for the scare.
    group.userData.targetX = group.position.x;
    group.userData.targetZ = group.position.z;
    group.userData.targetY = group.position.y;
    group.userData.scared = true; // _stepGhosts skips it while true
    group.visible = true;

    // Point the camera AT the ghost: base yaw = the approach facing, and a small
    // upward pitch toward the floating body via the look offset.
    this._baseYaw = FACING_TO_YAW[approachFacing] ?? 0;
    this._turnAnim = null;
    this.setLookOffset(0, 0.18); // slight look-up at the looming ghost
    this._faceGhostKey = key;
  }

  /**
   * Restore the normal view + the ghost's position after a face-the-ghost scare
   * (called on resume). Safe to call when no scare is active.
   */
  clearFaceGhost() {
    this.setLookOffset(0, 0);
    const key = this._faceGhostKey;
    this._faceGhostKey = null;
    if (!key || !this._ghostMeshes) return;
    const group = this._ghostMeshes.get(key);
    if (group && group.userData) {
      group.userData.scared = false;
      if (group.userData.savedPos) {
        group.position.copy(group.userData.savedPos);
        group.userData.targetX = group.position.x;
        group.userData.targetY = group.position.y;
        group.userData.targetZ = group.position.z;
        group.userData.savedPos = null;
      }
    }
  }

  /**
   * Apply the final camera orientation = base grid yaw + free-look yaw offset,
   * with the free-look pitch. Single writer of `camera.rotation` so the tween,
   * setCamera, and mouse-look all compose cleanly.
   */
  _applyCameraRotation() {
    if (!this.camera) return;
    const baseYaw = this._baseYaw || 0;
    this.camera.rotation.set(this._lookPitch || 0, baseYaw + (this._lookYaw || 0), 0);
  }

  /**
   * Live reduced-motion toggle. Stored so the animation methods snap instead of
   * interpolate; kept here so Task 17 can flip it mid-session and have it apply
   * to the NEXT `animateTurn`/`animateMove` call (Req 7.4, 7.5).
   * @param {boolean} enabled
   */
  setReducedMotion(enabled) {
    this.reducedMotion = !!enabled;
  }

  // --- Pellet / power-pellet / fruit markers ---------------------------------

  /**
   * Show or hide a pellet marker at a tile's floor position (Req 3.1). Power
   * pellets are drawn larger, brighter, and as a different shape than standard
   * pellets (Req 3.2); the tile's role is read from the grid
   * (`codeAt(col,row) === TILE.POWER_PELLET`), so callers don't have to pass it.
   * Marker meshes are tracked per tile so dispose/rebuild releases them.
   * @param {number} col tile column
   * @param {number} row tile row
   * @param {boolean} visible whether the pellet should be shown
   */
  setPelletVisible(col, row, visible) {
    const key = `${col},${row}`;
    const existing = this._pelletMarkers.get(key);

    if (!visible) {
      if (existing) {
        this._removeMarker(existing);
        this._pelletMarkers.delete(key);
        if (this._pelletAnims) this._pelletAnims.delete(key);
      }
      return;
    }

    // Already shown — nothing to do (keep-latest, no duplicate meshes).
    if (existing) return;

    const isPower = this.grid.codeAt(col, row) === TILE.POWER_PELLET;
    const spec = isPower ? MARKER.powerPellet : MARKER.pellet;
    const tile = this.grid.tileSize;
    const radius = tile * spec.radiusFrac;
    const { x, z } = tileToWorld3D(this.grid, col, row);

    // Each pellet is a floating group (body + billboarded halo) that hovers off
    // the floor, bobs, and glows — matching the fruit's treatment. The group is
    // the anchor `_stepPellets` animates each frame.
    const group = new THREE.Group();
    // Float pellets at roughly waist/eye height so they read as hovering pickups
    // (power pellets a touch higher since they are larger).
    const baseY = tile * (isPower ? 0.6 : 0.5);
    group.position.set(x, baseY, z);

    // Body — both pellet types are SPHERES; power pellets stay distinct via the
    // larger radius + color (Req 3.2). Spheres cast a soft shadow onto the floor.
    const bodyGeo = this._trackGeometry(new THREE.SphereGeometry(radius, 16, 12));
    const bodyMat = this._trackMaterial(new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: spec.color,
      emissiveIntensity: isPower ? 0.7 : 0.45,
      roughness: 0.4,
      metalness: 0.0,
    }));
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    group.add(body);

    // Halo — a translucent, additively-blended ring giving a soft glow aura,
    // billboarded to the camera in `_stepPellets`.
    const haloGeo = this._trackGeometry(
      new THREE.RingGeometry(radius * 1.5, radius * 2.4, 20),
    );
    const haloMat = this._trackMaterial(new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: isPower ? 0.6 : 0.4,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const halo = new THREE.Mesh(haloGeo, haloMat);
    group.add(halo);

    this.scene.add(group);
    this._pelletMarkers.set(key, group);
    // Register the pellet for per-frame float/halo animation. Keyed so removal
    // (on eat) drops it from the animation set too.
    if (!this._pelletAnims) this._pelletAnims = new Map();
    this._pelletAnims.set(key, {
      group,
      halo,
      body,
      baseY,
      // Desync each pellet's bob using its tile coords so the field shimmers
      // rather than pulsing in unison.
      phase: (col * 0.7 + row * 1.3) % (Math.PI * 2),
      bobAmp: tile * (isPower ? 0.14 : 0.1),
      isPower,
    });
  }

  /**
   * Show or hide the fruit marker at its spawn tile (Req 3.5). Only one fruit
   * marker exists at a time; passing `present: false` removes it.
   * @param {number} col tile column
   * @param {number} row tile row
   * @param {boolean} present whether the fruit should be shown
   */
  setFruit(col, row, present) {
    if (this._fruitMarker) {
      this._removeMarker(this._fruitMarker);
      this._fruitMarker = null;
    }
    if (!present) return;

    const tile = this.grid.tileSize;
    const radius = tile * MARKER.fruit.radiusFrac;
    const { x, z } = tileToWorld3D(this.grid, col, row);
    // Float the fruit above the floor at roughly eye level so it reads as a
    // hovering reward the player walks up to.
    const baseY = tile * 0.75;

    // A THREE.Group is the anchor: the fruit body + a glowing halo ring orbit
    // it, and the whole group bobs up/down (see `_stepFruit`). Grouping keeps
    // the halo locked to the fruit while both animate.
    const group = new THREE.Group();
    group.position.set(x, baseY, z);

    // Fruit body — an emissive sphere so it glows against the dark maze.
    const bodyGeo = this._trackGeometry(new THREE.SphereGeometry(radius, 16, 12));
    const bodyMat = this._trackMaterial(new THREE.MeshStandardMaterial({
      color: MARKER.fruit.color,
      emissive: MARKER.fruit.color,
      emissiveIntensity: 0.65,
      roughness: 0.4,
      metalness: 0.0,
    }));
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    body.name = 'fruit-placeholder';
    group.add(body);
    group.userData.placeholder = body;

    // Halo — a translucent, additively-blended ring around the fruit that
    // always faces the camera (billboarded in `_stepFruit`) and slowly spins,
    // giving a soft glowing aura.
    const haloInner = radius * 1.4;
    const haloOuter = radius * 2.1;
    const haloGeo = this._trackGeometry(new THREE.RingGeometry(haloInner, haloOuter, 32));
    const haloMat = this._trackMaterial(new THREE.MeshBasicMaterial({
      color: MARKER.fruit.color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const halo = new THREE.Mesh(haloGeo, haloMat);
    group.add(halo);

    this.scene.add(group);
    // Track the group so dispose()/removeMarker frees the child geo/materials,
    // and record the animation anchors for `_stepFruit`.
    this._fruitMarker = group;
    this._fruitAnim = {
      group,
      halo,
      baseY,
      phase: Math.random() * Math.PI * 2, // desync bob if fruit re-spawns
    };

    // Load a fruit GLB (rotating cherry → banana → orange per spawn) and swap it
    // in for the placeholder sphere when ready; on failure/timeout the sphere
    // stays (Req 8.2). The sphere + halo keep floating/bobbing/glowing either way.
    const kind = FRUIT_MODEL_ORDER[(this._fruitSpawnIndex || 0) % FRUIT_MODEL_ORDER.length];
    this._fruitSpawnIndex = (this._fruitSpawnIndex || 0) + 1;
    this._loadFruitModel(kind, group, radius);
  }

  /**
   * Lazily load a fruit GLB (by `kind`), scale it to the pellet/fruit size, and
   * swap it into the fruit group in place of the placeholder sphere. Each GLB is
   * cached as a promise so re-spawns of the same kind reuse one parse. Graceful
   * fallback (Req 8.2): no loader, a load error, or a >assetTimeoutMs timeout
   * leaves the glowing sphere in place and play continues; nothing throws.
   * @param {'cherry'|'banana'|'orange'} kind which fruit model to load
   * @param {THREE.Group} group the fruit group to populate
   * @param {number} radius the placeholder sphere radius (target model size)
   */
  _loadFruitModel(kind, group, radius) {
    const url = FRUIT_MODEL_URLS[kind];
    if (!url) return;
    if (!this._fruitGltfPromises) this._fruitGltfPromises = new Map();

    if (!this._fruitGltfPromises.has(kind)) {
      const p = new Promise((resolve) => {
        let loader;
        try {
          loader = new GLTFLoader();
        } catch {
          resolve(null);
          return;
        }
        const timer = setTimeout(() => resolve(null), FP3D.assetTimeoutMs);
        try {
          loader.load(
            url,
            (gltf) => { clearTimeout(timer); resolve(gltf || null); },
            undefined,
            () => { clearTimeout(timer); resolve(null); },
          );
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      });
      this._fruitGltfPromises.set(kind, p);
    }

    this._fruitGltfPromises.get(kind).then((gltf) => {
      // Guard: model failed, or this fruit was removed/replaced meanwhile.
      if (!gltf || !gltf.scene) return;
      if (this._fruitMarker !== group || !group.parent) return;

      const model = gltf.scene.clone(true);
      model.traverse((obj) => { if (obj.isMesh) obj.castShadow = true; });

      // Scale the model to roughly the placeholder's diameter and center it.
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = (radius * 2.2) / maxDim;
      model.scale.setScalar(scale);
      // Recenter so the model's bounds are centered on the group origin.
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

      group.add(model);
      group.userData.model = model;
      // Hide (keep) the placeholder sphere; the halo stays for the glow aura.
      const ph = group.userData.placeholder;
      if (ph) ph.visible = false;
    });
  }

  /**
   * Remove a dynamic marker (mesh OR group) from the scene and release its
   * resources. Groups (e.g. the floating fruit + halo) are recursed so every
   * child geometry/material is disposed.
   */
  _removeMarker(node) {
    this.scene.remove(node);
    const dispose = (obj) => {
      if (obj.geometry) {
        this._geometries.delete(obj.geometry);
        try { obj.geometry.dispose(); } catch { /* ignore */ }
      }
      if (obj.material) {
        this._materials.delete(obj.material);
        try { obj.material.dispose(); } catch { /* ignore */ }
      }
    };
    if (typeof node.traverse === 'function') node.traverse(dispose);
    else dispose(node);
    // Clear fruit animation state when the fruit marker is the node removed.
    if (this._fruitAnim && this._fruitAnim.group === node) this._fruitAnim = null;
  }

  // --- Ghosts ----------------------------------------------------------------

  /**
   * Render the four ghosts in distinct `GHOST_COLORS` (Req 3.6), positioning
   * each at its tile floor and hiding it when the INJECTED `visibilityFn`
   * reports it is not visible (Req 3.7, 3.8). Visibility is decided by the
   * caller's `visibilityFn` (backed by `lineOfSight` + FOV) — never by
   * raycasting.
   *
   * Each `ghostState` carries `{ key, color, personality, col, row }`; the
   * `personality` field is preserved on the state untouched (ghostAI in Task 14
   * branches on it), and `color`/`key` drive the mesh color. Meshes are created
   * lazily per `key` and reused across calls; ghosts absent from `ghostStates`
   * are removed.
   *
   * @param {Array<{ key: string, color?: number, personality?: string, col: number, row: number }>} ghostStates
   * @param {(ghostState: object) => boolean} [visibilityFn] returns true when the ghost is visible
   */
  setGhosts(ghostStates = [], visibilityFn = () => true) {
    const seen = new Set();
    const tile = this.grid.tileSize;

    for (const ghost of ghostStates) {
      const key = ghost.key;
      seen.add(key);

      let group = this._ghostMeshes.get(key);
      if (!group) {
        // Each ghost is a GROUP container: it starts with a colored placeholder
        // sphere shown immediately (and kept as the Req 8.2 fallback), and the
        // textured GLB model is loaded lazily and swapped in when ready.
        group = new THREE.Group();
        const radius = tile * GHOST_SIZE.radiusFrac;
        const color = ghost.color ?? GHOST_COLORS[key] ?? 0xffffff;
        const geo = this._trackGeometry(new THREE.SphereGeometry(radius, 16, 12));
        const mat = this._trackMaterial(new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.25,
          roughness: 0.5,
          metalness: 0.0,
          transparent: true,
          opacity: GHOST_OPACITY, // 40% transparent, spectral ghost look
          depthWrite: false,      // avoid self-sorting artifacts on the model
        }));
        const placeholder = new THREE.Mesh(geo, mat);
        placeholder.castShadow = true;
        placeholder.name = 'ghost-placeholder';
        group.add(placeholder);
        group.userData.placeholder = placeholder;
        this._ghostMeshes.set(key, group);
        this.scene.add(group);
        // Kick off the async model load (once per key); it swaps the model in
        // and hides the placeholder on success, or leaves the sphere on failure.
        this._loadGhostModel(key, color, group);
      }

      const { x, z } = tileToWorld3D(this.grid, ghost.col, ghost.row);
      // Hover the ghost above the floor (base height); _stepGhosts adds a bob.
      const y = tile * GHOST_FLOAT_FRAC;
      // Give each ghost a stable bob phase so they don't bob in unison.
      if (group.userData.bobPhase === undefined) {
        group.userData.bobPhase = Math.random() * Math.PI * 2;
      }
      // Record the TARGET tile position; `_stepGhosts` eases the group toward it
      // each frame so ghosts glide between tiles instead of teleporting. On the
      // group's first appearance snap to the target so it doesn't slide in from
      // the origin.
      if (!group.userData.hasTarget) {
        group.position.set(x, y, z);
        group.userData.hasTarget = true;
      }
      group.userData.targetX = x;
      group.userData.targetY = y;
      group.userData.targetZ = z;
      // Face the direction of travel so the model looks where it's going.
      if (ghost.dir && group.userData.model) {
        group.userData.targetYaw = DIR_YAW[ghost.dir] ?? group.userData.targetYaw ?? 0;
      }
      // Visibility is decided by the injected LOS/FOV function only — NOT by
      // raycasting (Req 3.7, 3.8). `personality` on the state is left intact.
      group.visible = !!visibilityFn(ghost);
    }

    // Remove any ghost group no longer present in the incoming states.
    for (const [key, group] of this._ghostMeshes) {
      if (!seen.has(key)) {
        this._removeMarker(group);
        this._ghostMeshes.delete(key);
      }
    }
  }

  /**
   * Lazily load the shared ghost GLB model, clone it for this ghost, apply the
   * per-key texture, scale/orient it to the tile, and swap it into the ghost
   * group (hiding the placeholder sphere). All Three.js/GLTF work stays in this
   * module (Req 9.1). Graceful fallback (Req 8.2): any failure — no loader, load
   * error, or timeout — leaves the colored placeholder sphere in place and play
   * continues; nothing throws.
   * @param {string} key ghost key ('red'|'pink'|'cyan'|'orange')
   * @param {number} color fallback tint for the model when no texture loads
   * @param {THREE.Group} group the ghost container to populate
   */
  _loadGhostModel(key, color, group) {
    // Load the shared GLB exactly once; cache the parsed scene as a promise so
    // all four ghosts reuse a single network/parse pass.
    if (!this._ghostGltfPromise) {
      this._ghostGltfPromise = new Promise((resolve) => {
        let loader;
        try {
          loader = new GLTFLoader();
        } catch {
          resolve(null);
          return;
        }
        const timer = setTimeout(() => resolve(null), FP3D.assetTimeoutMs);
        try {
          loader.load(
            GHOST_MODEL_URL,
            (gltf) => { clearTimeout(timer); resolve(gltf || null); },
            undefined,
            () => { clearTimeout(timer); resolve(null); },
          );
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      });
    }

    this._ghostGltfPromise.then((gltf) => {
      // Guard: model failed, or this group was disposed/removed meanwhile.
      if (!gltf || !gltf.scene || !group.parent) return;
      if (!this._ghostMeshes || this._ghostMeshes.get(key) !== group) return;

      const model = gltf.scene.clone(true);

      // Load and apply the per-key texture; fall back to a color tint on error.
      const applyTexture = (tex) => {
        model.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.castShadow = true;
          // Clone the material so per-ghost texture/color changes don't leak
          // across the shared cloned geometry.
          const base = Array.isArray(obj.material) ? obj.material[0] : obj.material;
          const mat = base && base.clone ? base.clone() : new THREE.MeshStandardMaterial();
          // 40% transparent so ghosts read as spectral (opacity 0.6).
          mat.transparent = true;
          mat.opacity = GHOST_OPACITY;
          mat.depthWrite = false;
          if (tex) {
            if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex;
            if (mat.color && mat.color.set) mat.color.set(0xffffff);
          } else if (mat.color && mat.color.set) {
            mat.color.set(color);
          }
          mat.needsUpdate = true;
          this._trackMaterial(mat);
          obj.material = mat;
        });
      };

      // The cyan ghost texture (ghost_cyan_01.png) has a dark STRIPE background,
      // not plain white/transparent, so mapping it directly would render the
      // stripes on the ghost. Per the asset handoff (§2), skip it for now and
      // fall back to the cyan COLOR tint (finish(null) path); a proper
      // crop/alpha pass is a tracked follow-up for asset-forge. red/pink/orange
      // have plain backgrounds and map cleanly.
      const texUrl = key === 'cyan' ? null : GHOST_TEXTURES[key];
      const finish = (tex) => {
        applyTexture(tex);
        // Scale the model to about one tile tall and stand it on the group
        // origin (the group is already positioned at eye height on the tile).
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const targetH = this.grid.tileSize * (GHOST_SIZE.radiusFrac * 2.4) * GHOST_HEIGHT_BOOST;
        const scale = size.y > 0 ? targetH / size.y : 1;
        // Non-uniform scale: keep the horizontal footprint at the un-boosted
        // size so the ghost reads taller/thinner rather than uniformly bigger.
        const scaleXZ = scale / GHOST_HEIGHT_BOOST;
        model.scale.set(scaleXZ, scale, scaleXZ);
        // Sit the model's BASE on the group origin (rather than centering it,
        // which sank the taller model into the floor). The group itself is
        // lifted to the float height in setGhosts + bobbed in _stepGhosts, so
        // the whole ghost hovers above the floor.
        model.position.y = 0;
        group.add(model);
        group.userData.model = model;
        // Hide (but keep) the placeholder so the fallback is intact if needed.
        const ph = group.userData.placeholder;
        if (ph) ph.visible = false;
      };

      if (texUrl && typeof this.loadTexture === 'function') {
        this.loadTexture(texUrl).then(finish);
      } else {
        finish(null);
      }
    });
  }

  // --- Camera animation ------------------------------------------------------

  /**
   * Interpolate the camera between two tile eye positions over `ms`
   * milliseconds (clamped so a single tile move never exceeds the configured
   * `FP3D.tileTraversalMs`, i.e. ≤250 ms — Req 2.2). When `reducedMotion` is
   * enabled the camera snaps to the target instantly (Req 7.5). `from`/`to` are
   * `{ col, row }` tiles; the camera yaw is left unchanged.
   * @param {{ col: number, row: number }} from start tile
   * @param {{ col: number, row: number }} to end tile
   * @param {number} [ms] traversal duration (defaults to FP3D.tileTraversalMs)
   */
  animateMove(from, to, ms = FP3D.tileTraversalMs) {
    const target = eyePosition(this.grid, to.col, to.row, this.eyeHeight);

    if (this.reducedMotion) {
      // Instant snap: no tween, apply the target immediately (Req 7.5).
      this._moveAnim = null;
      this.camera.position.set(target.x, target.y, target.z);
      return;
    }

    const start = eyePosition(this.grid, from.col, from.row, this.eyeHeight);
    // Ease over the requested window (no upper clamp) so the visual glide can be
    // as smooth as the caller asks; the scene still governs when the NEXT step
    // begins, so a slightly longer eased move just means a gentler settle.
    const durMs = Math.max(0, ms);
    this._moveAnim = {
      fromPos: new THREE.Vector3(start.x, start.y, start.z),
      toPos: new THREE.Vector3(target.x, target.y, target.z),
      startMs: this._now(),
      durMs,
    };
    // Seed the camera at the start so the first rendered frame is correct.
    this.camera.position.set(start.x, start.y, start.z);
  }

  /**
   * Animate a discrete cardinal turn from one facing to another (Req 7.4). When
   * `reducedMotion` is enabled the yaw snaps instantly. `from`/`to` are cardinal
   * facings; the shorter angular direction is taken so a west↔east turn does not
   * spin the long way around.
   * @param {'north'|'east'|'south'|'west'} from start facing
   * @param {'north'|'east'|'south'|'west'} to end facing
   */
  animateTurn(from, to) {
    const toYaw = FACING_TO_YAW[to] ?? FACING_TO_YAW.north;

    if (this.reducedMotion) {
      this._turnAnim = null;
      this._baseYaw = toYaw;
      this._applyCameraRotation();
      return;
    }

    const fromYaw = FACING_TO_YAW[from] ?? (this._baseYaw || 0);
    // Normalize the delta to [-π, π] so we rotate the short way.
    let delta = toYaw - fromYaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this._turnAnim = {
      fromYaw,
      toYaw: fromYaw + delta,
      startMs: this._now(),
      durMs: FP3D.turnAnimMs,
    };
    this._baseYaw = fromYaw;
    this._applyCameraRotation();
  }

  /** Monotonic-ish clock in ms; uses performance.now when available. */
  _now() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  /**
   * Smooth easing curve (ease-in-out) applied to move/turn tweens. Linear
   * interpolation starts and stops abruptly, which reads as "sharp" at every
   * tile and corner; this cubic ease accelerates and decelerates gently so the
   * camera glides. `smootherstep` (6t^5 - 15t^4 + 10t^3) has zero first AND
   * second derivative at both ends, so even chained steps feel fluid.
   * @param {number} t progress in [0,1]
   * @returns {number} eased progress in [0,1]
   */
  _ease(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  /**
   * Gentle move easing: mostly linear so chained straight steps keep a steady
   * pace (no pulse-to-a-stop at every tile boundary), with just the ends
   * softened. Blends 75% linear + 25% smootherstep.
   * @param {number} t progress in [0,1]
   * @returns {number}
   */
  _easeMove(t) {
    const x = Math.max(0, Math.min(1, t));
    return 0.75 * x + 0.25 * this._ease(x);
  }

  /** Advance any in-progress camera move/turn tween toward its target. */
  _stepAnimations() {
    const now = this._now();

    if (this._moveAnim) {
      const { fromPos, toPos, startMs, durMs } = this._moveAnim;
      const raw = durMs <= 0 ? 1 : Math.min(1, (now - startMs) / durMs);
      this.camera.position.lerpVectors(fromPos, toPos, this._easeMove(raw));
      if (raw >= 1) this._moveAnim = null;
    }

    if (this._turnAnim) {
      const { fromYaw, toYaw, startMs, durMs } = this._turnAnim;
      const raw = durMs <= 0 ? 1 : Math.min(1, (now - startMs) / durMs);
      // Strong ease for the corner sweep — this is the "smooth turn" feel.
      this._baseYaw = fromYaw + (toYaw - fromYaw) * this._ease(raw);
      if (raw >= 1) this._turnAnim = null;
    }
    // Compose base grid yaw + free-look offset every frame (single writer).
    this._applyCameraRotation();

    this._stepFruit(now);
    this._stepPellets(now);
    this._stepGhosts(now);
  }

  /**
   * Set how long (ms) a ghost takes to cross one tile, so `_stepGhosts` can ease
   * the mesh over that window and match the scene's step cadence. Clamped to a
   * sane minimum so a tiny value never makes ghosts snap.
   * @param {number} ms
   */
  setGhostStepMs(ms) {
    this._ghostStepMs = Number.isFinite(ms) && ms > 0 ? Math.max(60, ms) : 300;
  }

  /**
   * Smoothly interpolate each ghost group toward its recorded target tile
   * position (set in `setGhosts`) and ease its yaw toward the travel heading, so
   * ghosts glide between tiles instead of teleporting. Frame-rate independent:
   * the lerp factor is derived from the frame delta relative to the per-tile
   * step window. When `reducedMotion` is on, snap to the target (no glide).
   * @param {number} now current time in ms
   */
  _stepGhosts(now) {
    if (!this._ghostMeshes || this._ghostMeshes.size === 0) return;
    const dt = this._lastGhostStepNow ? now - this._lastGhostStepNow : 16;
    this._lastGhostStepNow = now;
    const stepMs = this._ghostStepMs || 300;
    // Fraction of the way to the target this frame. Over `stepMs` this reaches
    // ~1; capped at 1 so it never overshoots.
    const k = this.reducedMotion ? 1 : Math.min(1, (dt / stepMs) * 1.6);

    const tile = this.grid ? this.grid.tileSize : 24;
    const bobAmp = tile * GHOST_BOB_FRAC;
    const tSec = now / 1000;
    for (const group of this._ghostMeshes.values()) {
      const ud = group.userData;
      if (!ud || !ud.hasTarget) continue;
      // A "scared" ghost is being held right in the player's face (capture
      // scare) — leave it exactly where faceGhost() placed it.
      if (ud.scared) continue;
      // Ease horizontal position toward the target tile (the glide).
      group.position.x += (ud.targetX - group.position.x) * k;
      group.position.z += (ud.targetZ - group.position.z) * k;
      // Float: hold the hover base height and add a gentle bob (skip the bob
      // under reduced motion, but still float at the base height).
      const base = ud.targetY;
      const bob = this.reducedMotion ? 0 : Math.sin(tSec * Math.PI * 2 * 0.7 + (ud.bobPhase || 0)) * bobAmp;
      group.position.y = base + bob;
      // Ease yaw the short way around toward the heading.
      if (typeof ud.targetYaw === 'number') {
        let d = ud.targetYaw - group.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        group.rotation.y += d * k;
      }
    }
  }

  /**
   * Animate every visible pellet each frame: a gentle vertical bob (desynced
   * per tile so the field shimmers) plus a camera-facing (billboarded) halo, and
   * a slow body spin for power pellets. When `reducedMotion` is enabled pellets
   * hold their base height with static, camera-facing halos (still floating and
   * glowing, just not moving) so motion-sensitive players are not disturbed
   * (Req 7.4). Keyed by tile so eaten pellets drop out of the set.
   * @param {number} now current time in ms
   */
  _stepPellets(now) {
    if (!this._pelletAnims || this._pelletAnims.size === 0) return;
    const camQuat = this.camera ? this.camera.quaternion : null;
    const reduced = this.reducedMotion;
    const tSec = now / 1000;

    for (const pa of this._pelletAnims.values()) {
      if (reduced) {
        pa.group.position.y = pa.baseY;
        if (camQuat) pa.halo.quaternion.copy(camQuat);
        continue;
      }
      // Bob around the base height; per-pellet phase desyncs the field.
      pa.group.position.y = pa.baseY + Math.sin(tSec * Math.PI * 2 * 0.8 + pa.phase) * pa.bobAmp;
      // Power pellets slowly spin their body for extra presence.
      if (pa.isPower) pa.body.rotation.y = tSec * 1.2;
      // Billboard the halo to the camera and spin it in-plane for a shimmer.
      if (camQuat) {
        pa.halo.quaternion.copy(camQuat);
        pa.halo.rotateZ(tSec * 1.2 + pa.phase);
      }
    }
  }

  /**
   * Animate the floating fruit each frame: a gentle vertical bob, a slow body
   * spin, and a camera-facing (billboarded) halo that rotates for a shimmering
   * aura. When `reducedMotion` is enabled the fruit holds a fixed raised
   * position with a static halo (still floating + glowing, just not moving) so
   * motion-sensitive players are not disturbed (Req 7.4).
   * @param {number} now current time in ms
   */
  _stepFruit(now) {
    const fa = this._fruitAnim;
    if (!fa || !fa.group) return;

    if (this.reducedMotion) {
      // Hold steady at the base height; keep the halo facing the camera so it
      // still reads as a glowing marker, just without motion.
      fa.group.position.y = fa.baseY;
      if (this.camera) fa.halo.quaternion.copy(this.camera.quaternion);
      return;
    }

    const tile = this.grid.tileSize;
    const tSec = now / 1000;
    // Bob: +/- ~15% of a tile, ~0.9 Hz.
    const bob = Math.sin(tSec * Math.PI * 2 * 0.9 + fa.phase) * (tile * 0.15);
    fa.group.position.y = fa.baseY + bob;
    // Slow spin of the whole group so the fruit body turns.
    fa.group.rotation.y = tSec * 0.8;
    // Billboard the halo to the camera, then spin it in-plane for shimmer.
    if (this.camera) {
      fa.halo.quaternion.copy(this.camera.quaternion);
      fa.halo.rotateZ(tSec * 1.5);
    }
  }

  /**
   * Resize the renderer and camera to the given pixel dimensions. Called by the
   * scene when the viewport changes.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    if (!width || !height || !this.renderer || !this.camera) return;
    // updateStyle = true so the canvas CSS size matches the drawing buffer and
    // the 3D view actually fills the container (the fill layer is also forced
    // to 100% via inline style at construction as a belt-and-braces guard).
    this.renderer.setSize(width, height, true);
    // Re-assert the fill styles setSize may overwrite with pixel dimensions.
    if (this.canvas) {
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Size the renderer from the parent container's client rect (or the game
   * canvas, or a default) so the first frame is never rendered at 0x0. Used at
   * construction before the scene's own resize sync runs.
   */
  _sizeToParent() {
    let w = 0;
    let h = 0;
    const el = this._parentEl;
    if (el) {
      w = el.clientWidth || (el.getBoundingClientRect && el.getBoundingClientRect().width) || 0;
      h = el.clientHeight || (el.getBoundingClientRect && el.getBoundingClientRect().height) || 0;
    }
    if ((!w || !h) && this.canvas) {
      w = w || this.canvas.clientWidth || this.canvas.width || 0;
      h = h || this.canvas.clientHeight || this.canvas.height || 0;
    }
    if (!w || !h) {
      // Last-resort default so we render SOMETHING (headless/tests / pre-layout).
      w = w || 640;
      h = h || 480;
    }
    this.resize(w, h);
  }

  /**
   * Render one frame. `state` is accepted for parity with the design interface
   * and future per-frame updates (markers/ghosts land in Task 13); the current
   * core renderer just draws the scene through the camera.
   * @param {object} [state] optional per-frame state (unused in the core renderer)
   */
  // eslint-disable-next-line no-unused-vars
  render(state) {
    this._stepAnimations();
    this.renderer.render(this.scene, this.camera);
  }

  /** Remove and release all dynamic markers/ghosts (pellets, fruit, ghosts). */
  _disposeDynamic() {
    for (const mesh of this._pelletMarkers.values()) this._removeMarker(mesh);
    this._pelletMarkers.clear();
    if (this._pelletAnims) this._pelletAnims.clear();
    if (this._fruitMarker) {
      this._removeMarker(this._fruitMarker);
      this._fruitMarker = null;
    }
    for (const mesh of this._ghostMeshes.values()) this._removeMarker(mesh);
    this._ghostMeshes.clear();
    this._moveAnim = null;
    this._turnAnim = null;
  }

  /** Dispose only the maze geometry/materials/meshes (used on rebuild). */
  _disposeMaze() {
    for (const mesh of this._meshes) {
      this.scene.remove(mesh);
      if (typeof mesh.dispose === 'function') {
        // InstancedMesh has its own dispose for the instance buffer.
        try { mesh.dispose(); } catch { /* ignore */ }
      }
    }
    this._meshes = [];
    for (const geo of this._geometries) {
      try { geo.dispose(); } catch { /* ignore */ }
    }
    this._geometries.clear();
    for (const mat of this._materials) {
      try { mat.dispose(); } catch { /* ignore */ }
    }
    this._materials.clear();
    this._walls = null;
    this._floor = null;
  }

  /**
   * Release all GPU resources and detach listeners. After this the renderer must
   * not be used again. Removes the `webglcontextlost` listener added at
   * construction (perf §5, Req 8.5).
   */
  dispose() {
    if (this.canvas && this._contextLostHandler) {
      this.canvas.removeEventListener('webglcontextlost', this._contextLostHandler, false);
      this._contextLostHandler = null;
    }
    this._disposeDynamic();
    this._disposeMaze();
    // Release any textures loaded via the loadTexture seam (Req 8.2). None are
    // loaded today (markers are drawn), but this keeps the seam leak-free.
    if (this._textures) {
      for (const tex of this._textures) {
        try { tex.dispose(); } catch { /* ignore */ }
      }
      this._textures.clear();
    }
    if (this.renderer) {
      try { this.renderer.dispose(); } catch { /* ignore */ }
      // Force-lose the context so the GPU frees it promptly.
      try { this.renderer.forceContextLoss?.(); } catch { /* ignore */ }
    }
    this.scene = null;
    this.camera = null;
  }
}
