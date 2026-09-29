// Copyright (c) 2026 Armando Valenz
// SPDX-License-Identifier: MIT
//
// FullscreenToggle — the accessible DOM control that enters/exits browser
// fullscreen for the game surface (Req 9).
//
// This is a plain-DOM builder (NO Phaser, NO Three.js import): `FP3DScene`
// constructs one over the `#overlay-root` element declared in `index.html`,
// layered above the canvas like `QuizModal`/`LessonModal`. It mirrors their
// conventions — a real, framework-free, keyboard-operable control with
// self-contained inline styling (dark panel, yellow accent) and defensive
// try/catch so a rejected request or missing API never crashes the game.
//
// Behavior contract (Req 9):
//   - A real <button> with role=button, an accessible name that states the
//     action ("Enter fullscreen" / "Exit fullscreen"), and aria-pressed
//     reflecting the current fullscreen state (Req 9.1, 9.7).
//   - click / Enter / Space request entering (requestFullscreen(surfaceEl)) or
//     exiting (exitFullscreen()) fullscreen through the Fullscreen API (Req 9.2,
//     9.3, 9.7). A native <button> already fires click on Enter/Space, so
//     keyboard operability comes for free and is reachable via Tab/Shift+Tab.
//   - Listens for `fullscreenchange` and relabels + resyncs aria within 100 ms
//     (Req 9.4). The single source of truth for state is the live
//     `document.fullscreenElement`, so an orientation change while fullscreen
//     (a browser resize) leaves the control and its state intact (Req 9.9).
//   - A rejected/failed request is caught; display state is left unchanged and
//     the label is resynced to the actual `document.fullscreenElement`, and an
//     optional `onError` hook is notified (Req 9.6).
//   - A visible :focus-visible focus indicator is provided (Req 9.8).
//   - Returns `null` when the Fullscreen API is unavailable, so the caller adds
//     no control and gameplay continues without error (Req 9.5).
//
// Vendor prefixes: the standard Fullscreen API is used when present, with a
// defensive fallback to the WebKit-prefixed names (older Safari/iOS) for the
// request/exit methods, the `fullscreenElement` accessor, and the change event.

const COLORS = {
  panelBg: '#0d0d2b',
  text: '#ffffff',
  accent: '#ffe000', // UI-kit yellow
};

/** A once-per-module id + style tag flag for the :focus-visible rule. */
let seq = 0;
let focusStyleInjected = false;

/**
 * Resolve the Fullscreen API surface for a given document/element, tolerating
 * vendor-prefixed (WebKit) names. Returns `null` when neither the standard nor
 * the prefixed API is available (Req 9.5).
 *
 * @param {Document} doc
 * @param {HTMLElement} surfaceEl the element to request fullscreen on
 * @returns {null | {
 *   changeEvent: string,
 *   isFullscreen: () => boolean,
 *   request: () => Promise<void>,
 *   exit: () => Promise<void>,
 * }}
 */
function resolveFullscreenApi(doc, surfaceEl) {
  if (!doc || !surfaceEl) return null;

  const requestFn =
    surfaceEl.requestFullscreen ||
    surfaceEl.webkitRequestFullscreen ||
    surfaceEl.webkitRequestFullScreen ||
    surfaceEl.mozRequestFullScreen ||
    surfaceEl.msRequestFullscreen ||
    null;

  const exitFn =
    doc.exitFullscreen ||
    doc.webkitExitFullscreen ||
    doc.webkitCancelFullScreen ||
    doc.mozCancelFullScreen ||
    doc.msExitFullscreen ||
    null;

  // `fullscreenEnabled` gates whether fullscreen is permitted at all; treat an
  // undefined flag (older prefixed impls) as "assume allowed if request exists".
  const enabled =
    doc.fullscreenEnabled ??
    doc.webkitFullscreenEnabled ??
    doc.mozFullScreenEnabled ??
    doc.msFullscreenEnabled;

  // Req 9.5: require both a request and exit path; bail out otherwise.
  if (!requestFn || !exitFn || enabled === false) return null;

  const currentElement = () =>
    doc.fullscreenElement ??
    doc.webkitFullscreenElement ??
    doc.mozFullScreenElement ??
    doc.msFullscreenElement ??
    null;

  // Pick the change-event name matching the available API family.
  let changeEvent = 'fullscreenchange';
  if (!('onfullscreenchange' in doc) && typeof doc.fullscreenElement === 'undefined') {
    if (typeof doc.webkitFullscreenElement !== 'undefined') changeEvent = 'webkitfullscreenchange';
    else if (typeof doc.mozFullScreenElement !== 'undefined') changeEvent = 'mozfullscreenchange';
    else if (typeof doc.msFullscreenElement !== 'undefined') changeEvent = 'MSFullscreenChange';
  }

  return {
    changeEvent,
    isFullscreen: () => currentElement() === surfaceEl || !!currentElement(),
    // Normalize to a Promise so callers can `.catch()` uniformly, even for the
    // older prefixed methods that returned void/undefined.
    request: () => {
      try {
        const r = requestFn.call(surfaceEl);
        return r && typeof r.then === 'function' ? r : Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },
    exit: () => {
      try {
        const r = exitFn.call(doc);
        return r && typeof r.then === 'function' ? r : Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

/** Inject a one-time stylesheet giving the toggle a visible focus ring (Req 9.8). */
function ensureFocusStyle(doc) {
  if (focusStyleInjected || !doc || !doc.head) return;
  try {
    const style = doc.createElement('style');
    style.setAttribute('data-mm-fullscreen', 'true');
    style.textContent =
      '.mm-fullscreen-toggle:focus-visible{outline:3px solid #ffffff;' +
      'outline-offset:2px;box-shadow:0 0 0 3px rgba(255,224,0,0.6);}' +
      '.mm-fullscreen-toggle:focus{outline:3px solid #ffffff;outline-offset:2px;}';
    doc.head.appendChild(style);
    focusStyleInjected = true;
  } catch {
    /* focus styling is best-effort */
  }
}

/**
 * Create the accessible Fullscreen_Toggle control.
 *
 * @param {HTMLElement} surfaceEl the game surface element to make fullscreen
 *   (e.g. the `#app`/`#game` container).
 * @param {object} [opts]
 * @param {(err: unknown) => void} [opts.onError] notified when a request fails
 *   (Req 9.6); optional.
 * @param {Document} [opts.document] injectable document (defaults to global).
 * @returns {{ el: HTMLButtonElement, destroy: () => void } | null}
 *   `null` when the Fullscreen API is unavailable (Req 9.5).
 */
export function createFullscreenToggle(surfaceEl, { onError, document: docOpt } = {}) {
  const doc = docOpt || (typeof document !== 'undefined' ? document : null);
  if (!doc || !surfaceEl) return null;

  const api = resolveFullscreenApi(doc, surfaceEl);
  if (!api) return null; // Req 9.5 — graceful removal, no error.

  ensureFocusStyle(doc);

  const id = `mm-fullscreen-${++seq}`;
  const button = doc.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = 'mm-fullscreen-toggle';
  // A native <button> already exposes role=button; set it explicitly so the
  // contract holds even if the tag is themed/overridden (Req 9.1, 9.7).
  button.setAttribute('role', 'button');
  Object.assign(button.style, {
    boxSizing: 'border-box',
    cursor: 'pointer',
    padding: '8px 14px',
    fontSize: '14px',
    fontWeight: '700',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: COLORS.panelBg,
    background: COLORS.accent,
    border: `2px solid ${COLORS.accent}`,
    borderRadius: '8px',
    lineHeight: '1',
    userSelect: 'none',
    touchAction: 'manipulation',
  });

  /**
   * Sync the label + aria-pressed to the live fullscreen state. This is the
   * single source of truth (Req 9.4, 9.6, 9.9) — never inferred from what we
   * *asked* for, only from `document.fullscreenElement`.
   */
  function sync() {
    const active = api.isFullscreen();
    const name = active ? 'Exit fullscreen' : 'Enter fullscreen';
    button.textContent = name;
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.title = name;
  }

  /** Toggle fullscreen; a rejected request leaves state unchanged (Req 9.6). */
  function toggle() {
    const active = api.isFullscreen();
    const action = active ? api.exit() : api.request(); // Req 9.2, 9.3
    Promise.resolve(action).catch((err) => {
      // Req 9.6: stay in the current display state, resync the label to the
      // actual state, and continue without error.
      sync();
      if (typeof onError === 'function') {
        try {
          onError(err);
        } catch {
          /* never let an error hook crash the game */
        }
      }
    });
  }

  // click covers pointer + native Enter/Space activation on a real <button>
  // (Req 9.2, 9.3, 9.7). Guard against the toggle also anchoring a joystick:
  // the touch/pointer handlers in FP3DScene skip points over this control.
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  // fullscreenchange is the authority for relabeling within 100 ms (Req 9.4).
  // Attach on the document with the vendor-appropriate event name.
  const onChange = () => sync();
  doc.addEventListener(api.changeEvent, onChange);

  // Initial paint reflects the current state.
  sync();

  /** Remove listeners + detach the button. Safe to call more than once. */
  function destroy() {
    try {
      doc.removeEventListener(api.changeEvent, onChange);
    } catch {
      /* ignore */
    }
    try {
      button.remove();
    } catch {
      if (button.parentNode) button.parentNode.removeChild(button);
    }
  }

  return { el: button, destroy };
}

export default createFullscreenToggle;
