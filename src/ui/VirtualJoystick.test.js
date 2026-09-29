// Example (unit) tests for the visible Virtual_Joystick DOM control
// (`createVirtualJoystick`). These are deliberately example-based, not
// property-based: the joystick is a DOM/UI + pointer concern (accessible
// group/name, normalized/clamped/deadzoned analog vector, multi-touch id
// isolation, recenter/onEnd, graceful headless fallback) which the testing
// steering scopes to example/integration checks rather than PBT.
//
// The project's Vitest environment is `node` (see vite.config.js) with no jsdom
// dependency, and `createVirtualJoystick` accepts an injectable `document`. So
// instead of a real DOM we drive it with a tiny hand-rolled fake document +
// element that exposes exactly the surface the module reads (createElement,
// style bag, attributes, addEventListener/dispatch, getBoundingClientRect,
// appendChild/remove). With no `window.PointerEvent` in node, the module takes
// its touch-event fallback path, which these tests exercise with synthetic
// TouchEvents carrying `changedTouches`.

import { describe, it, expect, beforeEach } from 'vitest';
import { createVirtualJoystick } from './VirtualJoystick.js';

/** A minimal fake element covering just what the module touches. */
function makeElement(tag = 'div') {
  const listeners = new Map();
  const attributes = new Map();
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    parentNode: null,
    children: [],
    // Default geometry: 132px base centered at (100,100) → radius 66.
    _rect: { left: 34, top: 34, width: 132, height: 132 },

    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },

    getBoundingClientRect() {
      const r = this._rect;
      return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
    },

    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },
    dispatch(type, event = {}) {
      const evt = { preventDefault() {}, stopPropagation() {}, ...event };
      for (const handler of listeners.get(type) ?? []) handler(evt);
    },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },

    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
        this.parentNode = null;
      }
    },
    querySelector() { return null; },
  };
  return el;
}

/** A fake document whose createElement yields fake elements. */
function makeDoc() {
  const doc = makeElement('#document');
  doc.createElement = (tag) => makeElement(tag);
  return doc;
}

/** Build a synthetic touch event for the fallback path. */
function touch(x, y, id = 1) {
  return { changedTouches: [{ clientX: x, clientY: y, identifier: id }] };
}

describe('createVirtualJoystick', () => {
  let doc;
  let root;

  beforeEach(() => {
    doc = makeDoc();
    root = makeElement('div');
  });

  it('returns a safe no-op stub when there is no document/root (headless)', () => {
    const j = createVirtualJoystick(null, { document: null });
    expect(j.el).toBeNull();
    // Calling the stub methods must not throw.
    expect(() => { j.destroy(); j.setVisible(true); j.resize(); }).not.toThrow();
  });

  it('mounts an accessible base group with a thumb child', () => {
    const j = createVirtualJoystick(root, { document: doc });
    expect(j.el).not.toBeNull();
    expect(j.el.getAttribute('role')).toBe('group');
    expect(j.el.getAttribute('aria-label')).toBe('Movement joystick');
    // touch-action:none so a drag never scrolls the page.
    expect(j.el.style.touchAction).toBe('none');
    // It is appended to the root and has a thumb child.
    expect(root.children).toContain(j.el);
    expect(j.el.children.length).toBe(1);
  });

  it('reports a forward (negative y) vector when pushed UP past the deadzone', () => {
    const updates = [];
    const j = createVirtualJoystick(root, { document: doc, onChange: (v) => updates.push(v) });
    // Base center is (100,100), radius 66. Push straight up to y=50 (dy=-50).
    j.el.dispatch('touchstart', touch(100, 100));
    j.el.dispatch('touchmove', touch(100, 50));
    const last = updates[updates.length - 1];
    expect(last.x).toBeCloseTo(0, 5);
    expect(last.y).toBeLessThan(0); // screen up = -y ⇒ forward
    expect(last.magnitude).toBeGreaterThan(0);
  });

  it('zeroes the vector inside the deadzone', () => {
    const updates = [];
    const j = createVirtualJoystick(root, { document: doc, onChange: (v) => updates.push(v) });
    j.el.dispatch('touchstart', touch(100, 100));
    // Move only 4px (radius 66 ⇒ magnitude ~0.06, below the 0.12 deadzone).
    j.el.dispatch('touchmove', touch(104, 100));
    const last = updates[updates.length - 1];
    expect(last.x).toBe(0);
    expect(last.y).toBe(0);
    expect(last.magnitude).toBe(0);
  });

  it('clamps the reported magnitude to 1 when pushed beyond the base edge', () => {
    const updates = [];
    const j = createVirtualJoystick(root, { document: doc, onChange: (v) => updates.push(v) });
    j.el.dispatch('touchstart', touch(100, 100));
    // Push far to the right (dx=+300, well past radius 66).
    j.el.dispatch('touchmove', touch(400, 100));
    const last = updates[updates.length - 1];
    expect(last.magnitude).toBeCloseTo(1, 5);
    expect(last.x).toBeCloseTo(1, 5); // clamped to the right edge
    expect(last.y).toBeCloseTo(0, 5);
  });

  it('recenters the thumb and calls onEnd on release', () => {
    let ended = 0;
    const j = createVirtualJoystick(root, { document: doc, onEnd: () => { ended += 1; } });
    j.el.dispatch('touchstart', touch(100, 100));
    j.el.dispatch('touchmove', touch(160, 100));
    const thumb = j.el.children[0];
    expect(thumb.style.transform).not.toBe('translate(-50%, -50%)');
    j.el.dispatch('touchend', touch(160, 100));
    expect(ended).toBe(1);
    expect(thumb.style.transform).toBe('translate(-50%, -50%)');
  });

  it('ignores a second concurrent finger so a turn button can be used at once', () => {
    const updates = [];
    const j = createVirtualJoystick(root, { document: doc, onChange: (v) => updates.push(v) });
    // First finger (id 1) anchors the joystick.
    j.el.dispatch('touchstart', touch(100, 100, 1));
    const countAfterAnchor = updates.length;
    // A second finger (id 2) elsewhere must not drive the joystick vector.
    j.el.dispatch('touchmove', touch(400, 400, 2));
    expect(updates.length).toBe(countAfterAnchor);
    // The original finger still drives it.
    j.el.dispatch('touchmove', touch(160, 100, 1));
    expect(updates.length).toBeGreaterThan(countAfterAnchor);
  });

  it('setVisible(false) hides the base and releases an active drag via onEnd', () => {
    let ended = 0;
    const j = createVirtualJoystick(root, { document: doc, onEnd: () => { ended += 1; } });
    j.el.dispatch('touchstart', touch(100, 100));
    j.setVisible(false);
    expect(j.el.style.display).toBe('none');
    expect(ended).toBe(1);
    j.setVisible(true);
    expect(j.el.style.display).toBe('block');
  });

  it('destroy removes listeners and detaches the base', () => {
    const j = createVirtualJoystick(root, { document: doc });
    const base = j.el;
    expect(base.listenerCount('touchstart')).toBe(1);
    j.destroy();
    expect(base.listenerCount('touchstart')).toBe(0);
    expect(root.children).not.toContain(base);
    // Idempotent.
    expect(() => j.destroy()).not.toThrow();
  });
});
