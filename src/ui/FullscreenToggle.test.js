// Example (unit) tests for the accessible Fullscreen_Toggle DOM control
// (`createFullscreenToggle`). These are deliberately example-based, not
// property-based: the toggle is a DOM/UI concern (accessible name/role,
// aria-pressed, keyboard activation, graceful fallback) which the testing
// steering scopes to example/integration checks rather than PBT.
//
// The project's Vitest environment is `node` (see vite.config.js) with no
// jsdom dependency, and `createFullscreenToggle` accepts an injectable
// `document` plus an `onError` hook. So instead of a real DOM we drive it with
// a tiny hand-rolled fake document + surface element that exposes exactly the
// Fullscreen API surface the module reads (requestFullscreen / exitFullscreen /
// fullscreenElement / fullscreenEnabled) and an addEventListener that lets the
// test dispatch a `fullscreenchange`. No mocking of the module under test — we
// exercise the real builder and assert the resulting element + state.
//
// Covers Req 9.1 (accessible name/role), 9.2/9.3 (enter/exit requests),
// 9.4 (label + aria swap within 100 ms of a fullscreenchange), 9.5 (null when
// the API is unavailable), 9.6 (label resync + onError on a rejected request),
// and 9.7 (keyboard operability via Enter/Space on a native button).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFullscreenToggle } from './FullscreenToggle.js';

/**
 * A minimal fake DOM element implementing just the surface the module touches:
 * attributes, textContent/title, a style bag, class/id, event listeners, and
 * removal. `dispatch` synchronously fires listeners registered for an event.
 */
function makeElement(tag = 'div') {
  const listeners = new Map();
  const attributes = new Map();
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    className: '',
    id: '',
    type: '',
    title: '',
    textContent: '',
    parentNode: null,
    children: [],

    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },

    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },
    /** Test helper: fire every listener for `type` with a small fake event. */
    dispatch(type, event = {}) {
      const evt = { preventDefault() {}, stopPropagation() {}, ...event };
      for (const handler of listeners.get(type) ?? []) handler(evt);
    },
    /** Test helper: how many listeners remain for `type`. */
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
        this.parentNode = null;
      }
    },
  };
  return el;
}

/**
 * Build a fake `document` whose Fullscreen API is present by default. `opts`
 * lets a test drop parts of the API (to exercise the graceful-removal path) or
 * control what `requestFullscreen` resolves/rejects with.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]        value of `fullscreenEnabled`
 * @param {boolean} [opts.hasRequest=true]     whether the surface exposes requestFullscreen
 * @param {boolean} [opts.hasExit=true]        whether the document exposes exitFullscreen
 * @param {'resolve'|'reject'} [opts.requestOutcome='resolve'] how a request settles
 */
function makeFakeEnv(opts = {}) {
  const { enabled = true, hasRequest = true, hasExit = true, requestOutcome = 'resolve' } = opts;

  const head = makeElement('head');
  const doc = makeElement('#document');
  doc.head = head;

  // Live fullscreen state — the module's single source of truth.
  doc.fullscreenElement = null;
  doc.fullscreenEnabled = enabled;
  // Signal the standard (unprefixed) change-event family.
  doc.onfullscreenchange = null;

  doc.createElement = (tag) => makeElement(tag);

  // Track calls so tests can assert enter/exit were requested (Req 9.2, 9.3).
  const calls = { request: 0, exit: 0 };

  const surface = makeElement('div');
  surface.id = 'app';

  if (hasRequest) {
    surface.requestFullscreen = () => {
      calls.request += 1;
      if (requestOutcome === 'reject') {
        return Promise.reject(new Error('fullscreen request rejected'));
      }
      // A real request would flip document.fullscreenElement and fire the
      // change event; the browser does that asynchronously, so tests drive the
      // fullscreenchange explicitly via `enterFullscreen()` below.
      return Promise.resolve();
    };
  }

  if (hasExit) {
    doc.exitFullscreen = () => {
      calls.exit += 1;
      return Promise.resolve();
    };
  }

  /** Test helper: simulate the browser entering fullscreen + firing the event. */
  function enterFullscreen() {
    doc.fullscreenElement = surface;
    doc.dispatch('fullscreenchange');
  }
  /** Test helper: simulate the browser exiting fullscreen + firing the event. */
  function exitFullscreenState() {
    doc.fullscreenElement = null;
    doc.dispatch('fullscreenchange');
  }

  return { doc, surface, calls, enterFullscreen, exitFullscreenState };
}

describe('createFullscreenToggle — accessible name, role, and aria-pressed (Req 9.1, 9.7)', () => {
  it('renders a native button with role=button and an "Enter fullscreen" accessible name when not fullscreen', () => {
    const { doc, surface } = makeFakeEnv();

    const toggle = createFullscreenToggle(surface, { document: doc });
    expect(toggle).not.toBeNull();

    const { el } = toggle;
    expect(el.tagName).toBe('BUTTON');
    expect(el.type).toBe('button');
    expect(el.getAttribute('role')).toBe('button');
    // Visible label + accessible name state the action to be performed.
    expect(el.textContent).toBe('Enter fullscreen');
    expect(el.getAttribute('aria-label')).toBe('Enter fullscreen');
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects an already-fullscreen document with an "Exit fullscreen" name and aria-pressed=true', () => {
    const { doc, surface } = makeFakeEnv();
    doc.fullscreenElement = surface; // already fullscreen at construction time

    const { el } = createFullscreenToggle(surface, { document: doc });
    expect(el.textContent).toBe('Exit fullscreen');
    expect(el.getAttribute('aria-label')).toBe('Exit fullscreen');
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('createFullscreenToggle — label + aria swap on fullscreenchange within 100 ms (Req 9.4)', () => {
  // The relabel happens synchronously inside the fullscreenchange handler, so
  // there is no timer to advance — it is well within the 100 ms budget.
  it('swaps to "Exit fullscreen" when the document enters fullscreen', () => {
    const { doc, surface, enterFullscreen } = makeFakeEnv();
    const { el } = createFullscreenToggle(surface, { document: doc });

    expect(el.getAttribute('aria-pressed')).toBe('false');

    enterFullscreen();

    expect(el.textContent).toBe('Exit fullscreen');
    expect(el.getAttribute('aria-label')).toBe('Exit fullscreen');
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });

  it('swaps back to "Enter fullscreen" when the document exits fullscreen', () => {
    const { doc, surface, enterFullscreen, exitFullscreenState } = makeFakeEnv();
    const { el } = createFullscreenToggle(surface, { document: doc });

    enterFullscreen();
    expect(el.getAttribute('aria-pressed')).toBe('true');

    exitFullscreenState();
    expect(el.textContent).toBe('Enter fullscreen');
    expect(el.getAttribute('aria-label')).toBe('Enter fullscreen');
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('createFullscreenToggle — enter/exit requests through the Fullscreen API (Req 9.2, 9.3)', () => {
  it('requests entering fullscreen on activation while not fullscreen', () => {
    const { doc, surface, calls } = makeFakeEnv();
    const { el } = createFullscreenToggle(surface, { document: doc });

    el.dispatch('click');

    expect(calls.request).toBe(1);
    expect(calls.exit).toBe(0);
  });

  it('requests exiting fullscreen on activation while fullscreen', () => {
    const { doc, surface, calls, enterFullscreen } = makeFakeEnv();
    const { el } = createFullscreenToggle(surface, { document: doc });

    enterFullscreen(); // now in fullscreen
    el.dispatch('click');

    expect(calls.exit).toBe(1);
    expect(calls.request).toBe(0);
  });
});

describe('createFullscreenToggle — keyboard operability via Enter/Space (Req 9.7)', () => {
  // A native <button> fires a `click` on Enter/Space activation, and the module
  // wires enter/exit to `click`. So a click driven by keyboard activation must
  // request fullscreen exactly like a pointer activation, and the control is a
  // real focusable button reachable via Tab/Shift+Tab.
  it('activates (requests fullscreen) when Enter/Space produce a click', () => {
    const { doc, surface, calls } = makeFakeEnv();
    const { el } = createFullscreenToggle(surface, { document: doc });

    // Enter and Space both resolve to a native button `click`.
    el.dispatch('click'); // Enter
    el.dispatch('click'); // Space (now fullscreen state still not entered in fake) 

    // Both keyboard activations reached the Fullscreen API request path.
    expect(calls.request).toBe(2);
  });

  it('exposes a real focusable button element (role + native BUTTON tag)', () => {
    const { doc, surface } = makeFakeEnv();
    const { el } = createFullscreenToggle(surface, { document: doc });

    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('role')).toBe('button');
  });
});

describe('createFullscreenToggle — graceful removal when the API is unavailable (Req 9.5)', () => {
  it('returns null when the surface has no requestFullscreen', () => {
    const { doc, surface } = makeFakeEnv({ hasRequest: false });
    expect(createFullscreenToggle(surface, { document: doc })).toBeNull();
  });

  it('returns null when the document has no exitFullscreen', () => {
    const { doc, surface } = makeFakeEnv({ hasExit: false });
    expect(createFullscreenToggle(surface, { document: doc })).toBeNull();
  });

  it('returns null when fullscreen is not enabled', () => {
    const { doc, surface } = makeFakeEnv({ enabled: false });
    expect(createFullscreenToggle(surface, { document: doc })).toBeNull();
  });

  it('returns null when no surface element is provided', () => {
    const { doc } = makeFakeEnv();
    expect(createFullscreenToggle(null, { document: doc })).toBeNull();
  });
});

describe('createFullscreenToggle — label resync + onError on a rejected request (Req 9.6)', () => {
  it('leaves state unchanged, resyncs the label to the actual state, and notifies onError', async () => {
    const { doc, surface } = makeFakeEnv({ requestOutcome: 'reject' });
    const errors = [];
    const { el } = createFullscreenToggle(surface, {
      document: doc,
      onError: (err) => errors.push(err),
    });

    // Not fullscreen, so activation requests entering — which rejects.
    expect(el.getAttribute('aria-pressed')).toBe('false');
    el.dispatch('click');

    // Let the rejected promise's .catch() run.
    await Promise.resolve();
    await Promise.resolve();

    // Display state is unchanged (still not fullscreen) and the label was
    // resynced to the actual document.fullscreenElement (unchanged).
    expect(doc.fullscreenElement).toBeNull();
    expect(el.textContent).toBe('Enter fullscreen');
    expect(el.getAttribute('aria-pressed')).toBe('false');

    // The optional onError hook was notified with the rejection reason.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });
});

describe('createFullscreenToggle — destroy() detaches listeners and the button (cleanup)', () => {
  let toggle;
  let env;

  beforeEach(() => {
    env = makeFakeEnv();
    env.doc.head.appendChild(makeElement('meta')); // ensure head exists/append works
    toggle = createFullscreenToggle(env.surface, { document: env.doc });
    env.surface.appendChild(toggle.el); // pretend it was mounted
  });

  afterEach(() => {
    toggle = null;
    env = null;
  });

  it('removes the fullscreenchange listener and detaches the element, and is safe to call twice', () => {
    expect(env.doc.listenerCount('fullscreenchange')).toBe(1);

    toggle.destroy();

    expect(env.doc.listenerCount('fullscreenchange')).toBe(0);
    expect(toggle.el.parentNode).toBeNull();

    // Idempotent — a second destroy must not throw.
    expect(() => toggle.destroy()).not.toThrow();
  });
});
