// Example (unit) tests for the FP3D_Mode Interaction_Indicator HUD.
//
// Scope: the framework-agnostic *behavior* of FP3DRenderer's Crosshair +
// Interaction_Indicator DOM HUD (Req 6.1–6.6, Req 1.2). These are example-based
// tests, not property tests — the indicator is DOM/visual UI, so per the
// testing steering it is verified by examples, not fast-check.
//
// FP3DRenderer is the ONLY module that imports Three.js and it builds a real
// WebGLRenderer in its constructor, which cannot run headlessly. There is no
// jsdom/happy-dom in this repo and the Vitest env is `node`, and no existing
// renderer test establishes a harness. So to exercise the REAL HUD methods
// (not a reimplementation) we:
//   1. mock `three` + the GLTFLoader with tiny permissive stubs so construction
//      succeeds without a GPU (the 3D scene graph is irrelevant to the HUD), and
//   2. install a minimal DOM stub (only the handful of element APIs the HUD
//      uses) as `globalThis.document`, and pass a *parent element* (not a bare
//      canvas) so `_buildHud()` runs and the real setters drive real DOM nodes.
// The assertions below hit the unmodified HUD code paths — nothing is weakened
// to accommodate the stubs.

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

// --- Mock Three.js -----------------------------------------------------------
// A permissive auto-stub: every named export is a constructor that returns a
// Proxy whose every property is a chainable no-op function or a nested stub
// object. This lets the constructor's scene/camera/light/material/geometry/
// InstancedMesh/Group churn (and buildMaze) complete without a real Three.js.
// The HUD holds NO Three.js objects, so none of this affects what we assert.
vi.mock('three', () => {
  // A chainable stub scene-graph node. Every accessed member is a nested stub
  // node or a no-op method that returns the node, so the constructor's
  // position/rotation/scale/set/copy/add churn just works. Crucially this is a
  // Proxy over an OBJECT (not a function) and it never fabricates `then`, a
  // Symbol, or `constructor` — otherwise the module/namespace could look
  // thenable and hang `await import`.
  const makeNode = () => {
    // The backing is a FUNCTION so a node is both callable (as a method) and
    // navigable (as a sub-object). Any unknown property lazily becomes another
    // node, so `dir.target.position.set(...)` and `mesh.geometry.dispose()`
    // both resolve without knowing Three's shape.
    const backing = function stubNode() { return backing; };
    backing.style = {};
    backing.width = 640;
    backing.height = 480;
    backing.clientWidth = 640;
    backing.clientHeight = 480;
    return new Proxy(backing, {
      get(target, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        if (prop === 'getContext') return () => ({});
        if (prop === 'getMaxAnisotropy') return () => 1;
        if (prop === 'domElement') {
          if (!target.__canvas) {
            target.__canvas = {
              style: {}, width: 640, height: 480, clientWidth: 640, clientHeight: 480,
              addEventListener() {}, removeEventListener() {},
            };
          }
          return target.__canvas;
        }
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        // Lazily create a nested callable node for any other member.
        target[prop] = makeNode();
        return target[prop];
      },
      set(target, prop, value) {
        // Function objects have read-only `name`/`length`; ignore writes to
        // those so `node.name = '...'` (used for lights) never throws.
        try { target[prop] = value; } catch { /* read-only stub prop; ignore */ }
        return true;
      },
      apply() { return makeNode(); },
    });
  };

  // Explicit, plain module namespace. Constructors return a stub node; the
  // ALL-CAPS enum constants Three exposes resolve to their own name.
  const CONSTRUCTORS = [
    'WebGLRenderer', 'Scene', 'PerspectiveCamera', 'OrthographicCamera',
    'Color', 'FogExp2', 'Fog', 'HemisphereLight', 'AmbientLight',
    'DirectionalLight', 'PointLight', 'Object3D', 'Group', 'Mesh',
    'InstancedMesh', 'BoxGeometry', 'PlaneGeometry', 'SphereGeometry',
    'OctahedronGeometry', 'BufferGeometry', 'BufferAttribute', 'Float32BufferAttribute',
    'MeshStandardMaterial', 'MeshBasicMaterial', 'PointsMaterial', 'SpriteMaterial',
    'Points', 'Sprite', 'Vector2', 'Vector3', 'Quaternion', 'Matrix4', 'Euler',
    'TextureLoader', 'Texture', 'CanvasTexture', 'AxesHelper', 'Box3',
  ];
  const three = {};
  for (const name of CONSTRUCTORS) {
    three[name] = function ThreeCtor() { return makeNode(); };
  }
  const CONSTS = [
    'PCFSoftShadowMap', 'RepeatWrapping', 'ClampToEdgeWrapping', 'SRGBColorSpace',
    'LinearSRGBColorSpace', 'AdditiveBlending', 'NormalBlending', 'DoubleSide',
    'FrontSide', 'BackSide', 'NearestFilter', 'LinearFilter',
  ];
  for (const c of CONSTS) three[c] = c;
  three.MathUtils = {
    degToRad: (d) => (d * Math.PI) / 180,
    clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  };
  three.default = three;
  return three;
});

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  // .load never invokes its callbacks, so no async model work runs in tests.
  GLTFLoader: class { load() {} },
}));

// Import AFTER the mocks are registered.
const { FP3DRenderer } = await import('./FP3DRenderer.js');
const { MazeGrid } = await import('../maze/mazeLogic.js');

// --- Minimal DOM stub --------------------------------------------------------
// Supports exactly the element API the HUD touches: className, style (Object
// .assign target), setAttribute, appendChild, querySelector('.class'),
// textContent, animate() -> { cancel }, parentNode, removeChild.
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this._attrs = {};
    this.animateCalls = 0;
  }

  setAttribute(k, v) { this._attrs[k] = String(v); }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  // Only class selectors of the form ".foo" are used by the HUD.
  querySelector(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    const walk = (node) => {
      for (const c of node.children) {
        if (cls && String(c.className).split(/\s+/).includes(cls)) return c;
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }

  animate() {
    this.animateCalls += 1;
    const anim = { cancelled: false, cancel() { this.cancelled = true; } };
    this._lastAnim = anim;
    return anim;
  }
}

let originalDocument;
let originalHTMLCanvasElement;

beforeEach(() => {
  originalDocument = globalThis.document;
  originalHTMLCanvasElement = globalThis.HTMLCanvasElement;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
  };
  // The renderer does `canvasOrParent instanceof HTMLCanvasElement`. In the
  // node env this global is absent; define a stub so the check is defined. Our
  // parent is a FakeElement (not a canvas), so the renderer takes the
  // parent-element path and builds the HUD.
  globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
});

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.HTMLCanvasElement = originalHTMLCanvasElement;
  vi.restoreAllMocks();
});

// The HUD is what these tests exercise. The renderer's constructor also builds
// the full Three.js maze scene (walls, floor, lights, torches, portraits, model
// loads) — all irrelevant to the DOM HUD and expensive/loopy against a stubbed
// Three.js. Neutralize just that scene-building so construction reaches
// `_buildHud()` quickly; the real HUD methods (setInteractionIndicator,
// _applyHudReducedMotion, _disposeHud, MAX_INDICATOR_LABEL) are left untouched.
beforeEach(() => {
  vi.spyOn(FP3DRenderer.prototype, 'buildMaze').mockImplementation(function noBuild(grid) {
    this.grid = grid;
    this._walls = null;
  });
});

/** Build a renderer whose HUD is active by passing a parent element. */
function makeRenderer(opts = {}) {
  const parent = new FakeElement('div');
  const grid = new MazeGrid(); // real default level-1 layout (single source of truth)
  const renderer = new FP3DRenderer(parent, { grid, ...opts });
  return { renderer, parent };
}

/** The indicator DOM node the HUD built, plus its label child. */
function hud(renderer) {
  const indicator = renderer._indicatorEl;
  const label = renderer._indicatorLabelEl;
  const dot = indicator ? indicator.querySelector('.fp3d-interaction-dot') : null;
  return { indicator, label, dot };
}

describe('FP3DRenderer Interaction_Indicator (Req 6)', () => {
  it('builds a hidden crosshair + indicator HUD with a dot and a label node', () => {
    const { renderer } = makeRenderer();
    const { indicator, label, dot } = hud(renderer);

    // The HUD really built (proves construction + _buildHud ran, not skipped).
    expect(indicator).toBeTruthy();
    expect(label).toBeTruthy();
    expect(dot).toBeTruthy(); // the "dot" affordance (Req 6.1)

    // Starts hidden until something is targeted (Req 6.2).
    expect(indicator.style.display).toBe('none');
    expect(renderer._crosshairEl.style.display).toBe('none');

    renderer.dispose?.();
  });

  it('shows a dot + label within range on setInteractionIndicator(label) (Req 6.1)', () => {
    const { renderer } = makeRenderer();

    renderer.setInteractionIndicator('OPEN');
    const { indicator, label, dot } = hud(renderer);

    expect(indicator.style.display).toBe('flex'); // shown, not hidden
    expect(dot).toBeTruthy(); // dot present
    expect(label.textContent).toBe('OPEN'); // the action label prompts a Tap

    renderer.dispose?.();
  });

  it('caps the action label at MAX_INDICATOR_LABEL (24) characters (Req 6.1)', () => {
    const { renderer } = makeRenderer();
    expect(FP3DRenderer.MAX_INDICATOR_LABEL).toBe(24);

    const long = 'X'.repeat(50);
    renderer.setInteractionIndicator(long);
    const { label } = hud(renderer);

    expect(label.textContent.length).toBe(24);
    expect(label.textContent).toBe('X'.repeat(24));
    // Stored label is also truncated to the cap.
    expect(renderer._indicatorLabel.length).toBe(24);

    renderer.dispose?.();
  });

  it('hides the indicator when nothing is targeted: setInteractionIndicator(null) (Req 6.2, 6.5, 6.6)', () => {
    const { renderer } = makeRenderer();
    const { indicator, label } = hud(renderer);

    renderer.setInteractionIndicator('COLLECT');
    expect(indicator.style.display).toBe('flex');

    // No/out-of-range/removed target -> the scene passes null; hidden this frame
    // (synchronous => well within the 100 ms bound).
    renderer.setInteractionIndicator(null);
    expect(indicator.style.display).toBe('none');
    expect(label.textContent).toBe('');
    expect(renderer._indicatorLabel).toBe(null);

    renderer.dispose?.();
  });

  it('treats an empty-string label as "no target" and hides (Req 6.2)', () => {
    const { renderer } = makeRenderer();
    renderer.setInteractionIndicator('USE LADDER');
    expect(hud(renderer).indicator.style.display).toBe('flex');

    renderer.setInteractionIndicator('');
    expect(hud(renderer).indicator.style.display).toBe('none');
    expect(renderer._indicatorLabel).toBe(null);

    renderer.dispose?.();
  });

  it('updates the label when the targeted Interactable changes (Req 6.3)', () => {
    const { renderer } = makeRenderer();
    const { indicator, label } = hud(renderer);

    renderer.setInteractionIndicator('OPEN');
    expect(label.textContent).toBe('OPEN');

    // Target changes to a different Interactable: label swaps, still shown, and
    // it is applied synchronously (<= 100 ms bound, Req 6.3).
    renderer.setInteractionIndicator('COLLECT');
    expect(label.textContent).toBe('COLLECT');
    expect(indicator.style.display).toBe('flex');

    renderer.dispose?.();
  });

  it('drops the non-essential pulse under Reduced_Motion while show/hide still works (Req 6.4)', () => {
    const { renderer } = makeRenderer({ reducedMotion: true });
    const { indicator, dot } = hud(renderer);

    // Showing still works with reduced motion on...
    renderer.setInteractionIndicator('OPEN');
    expect(indicator.style.display).toBe('flex');
    // ...but the non-essential pulse animation is suppressed: no WAAPI pulse is
    // started and the CSS animation is explicitly cleared.
    expect(dot.animateCalls).toBe(0);
    expect(dot.style.animation).toBe('none');

    // Hiding still works too.
    renderer.setInteractionIndicator(null);
    expect(indicator.style.display).toBe('none');

    renderer.dispose?.();
  });

  it('runs the pulse when Reduced_Motion is OFF, and suppresses it after toggling on (Req 6.4)', () => {
    const { renderer } = makeRenderer({ reducedMotion: false });
    const { dot } = hud(renderer);

    // With motion allowed, showing a label starts the subtle pulse.
    renderer.setInteractionIndicator('OPEN');
    expect(dot.animateCalls).toBeGreaterThan(0);

    // Toggling reduced motion on suppresses the pulse immediately (setReducedMotion
    // re-applies the HUD motion policy).
    renderer.setReducedMotion(true);
    expect(dot.style.animation).toBe('none');

    // Still shows/hides afterward.
    expect(hud(renderer).indicator.style.display).toBe('flex');
    renderer.setInteractionIndicator(null);
    expect(hud(renderer).indicator.style.display).toBe('none');

    renderer.dispose?.();
  });

  it('tears down the HUD on dispose so no stale prompt remains (Req 6.6)', () => {
    const { renderer, parent } = makeRenderer();
    renderer.setInteractionIndicator('OPEN');
    const hudEl = renderer._hudEl;
    expect(parent.children).toContain(hudEl); // HUD was mounted

    renderer.dispose?.();

    // HUD DOM is torn down (removed from its parent) and the indicator handle
    // is cleared, so no stale prompt can linger.
    expect(renderer._indicatorEl).toBe(null);
    expect(parent.children).not.toContain(hudEl);
  });
});
