// Copyright (c) 2026 Armando Valenz
// SPDX-License-Identifier: MIT
//
// VirtualJoystick — a VISIBLE, framework-free on-screen analog stick for the
// first-person 3D mode (FP3D_Mode) touch controls.
//
// This is a plain-DOM builder (NO Phaser, NO Three.js import): `FP3DScene`
// constructs one over the `#overlay-root` element declared in `index.html`,
// anchored bottom-LEFT, layered above the canvas alongside the turn buttons and
// the Fullscreen_Toggle. It mirrors the conventions of `FullscreenToggle.js` /
// `LessonModal.js`: an injectable `document`, self-contained inline styling
// (dark translucent base, yellow accent), and defensive guards so a missing DOM
// (headless/tests) makes construction a no-op rather than a crash.
//
// It does NOT contain any movement/turn logic — it only reports a normalized
// analog vector. The scene feeds that vector into the SAME framework-agnostic
// `resolveMovementVector` → `InputBuffer` seam the gestures and keyboard use, so
// there is exactly one movement pipeline.
//
// Behavior contract:
//   - Renders a circular BASE with a draggable THUMB, centered in the base at
//     rest. `role="group"` + an accessible name describe it to AT; it is a
//     POINTER control (keyboard players keep the full keyboard scheme), so it is
//     intentionally not in the tab order and never steals focus.
//   - On pointerdown/touchstart WITHIN the base it captures that pointer (by id,
//     so a second thumb can drive the turn buttons at the same time), and while
//     held reports `onChange({ x, y, magnitude })` on every move, where:
//       * x,y are in [-1, 1], CLAMPED to the base radius, screen convention
//         (x grows right, y grows DOWN — so pushing UP yields a NEGATIVE y),
//       * magnitude is the clamped push in [0, 1],
//       * inside a small deadzone the reported vector is zeroed.
//   - On release it recenters the thumb and calls `onEnd()`.
//   - `touch-action: none` on the base so dragging never scrolls the page.
//   - Sizing is responsive via CSS `clamp()`/`vmin` in the caller's stylesheet
//     when a class hook is present; a sensible pixel fallback is used otherwise.
//     The base pixel radius is measured live on each pointerdown (and on
//     `resize()`), so orientation changes / responsive resizes are honored
//     without caching a stale size.
//
// Pointer Events are used when available (with `setPointerCapture` for robust
// multi-touch tracking); a raw touch-event fallback covers platforms/tests
// without Pointer Events.

/** Palette shared with the other FP3D DOM controls. */
const COLORS = {
  base: 'rgba(4, 6, 16, 0.42)',
  baseBorder: 'rgba(255, 224, 0, 0.55)',
  thumb: 'rgba(255, 224, 0, 0.85)',
  thumbBorder: '#ffe000',
};

/** Default pixel geometry used when CSS-driven sizing is unavailable. */
const DEFAULTS = {
  size: 132, // base diameter in px (fallback; CSS clamp() overrides on real devices)
  deadzone: 0.12, // fraction of the radius treated as centered (no movement)
};

/**
 * Extract a single `{ clientX, clientY, id }` sample from a pointer OR touch
 * event, or `null` when none is present. For a `TouchEvent` the first
 * `changedTouches` entry is used with its `identifier`; for a `PointerEvent`
 * the event itself with its `pointerId`.
 * @param {PointerEvent|TouchEvent} e
 * @returns {{ clientX:number, clientY:number, id:(number|string) }|null}
 */
function samplePointer(e) {
  if (e && e.changedTouches && e.changedTouches.length) {
    const t = e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY, id: t.identifier };
  }
  if (e && typeof e.clientX === 'number') {
    return { clientX: e.clientX, clientY: e.clientY, id: e.pointerId != null ? e.pointerId : 'pointer' };
  }
  return null;
}

/**
 * Create the visible Virtual_Joystick control.
 *
 * @param {HTMLElement} root the overlay host to append the joystick into
 *   (e.g. `#overlay-root`). When absent, construction is a no-op returning a
 *   safe stub so callers never branch on null.
 * @param {object} [opts]
 * @param {(v:{x:number,y:number,magnitude:number}) => void} [opts.onChange]
 *   called on every drag update with a normalized, deadzoned vector.
 * @param {() => void} [opts.onEnd] called on release (thumb recentered).
 * @param {number} [opts.size] fallback base diameter in px.
 * @param {number} [opts.deadzone] deadzone as a fraction of the radius [0,1).
 * @param {string} [opts.ariaLabel] accessible name for the base group.
 * @param {Document} [opts.document] injectable document (defaults to global).
 * @returns {{ el: HTMLElement|null, destroy: () => void, setVisible: (v:boolean)=>void, resize: () => void }}
 */
export function createVirtualJoystick(root, opts = {}) {
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
  const onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : () => {};
  const deadzone = Number.isFinite(opts.deadzone) ? Math.max(0, Math.min(0.9, opts.deadzone)) : DEFAULTS.deadzone;
  const fallbackSize = Number.isFinite(opts.size) ? opts.size : DEFAULTS.size;
  const ariaLabel = opts.ariaLabel || 'Movement joystick';

  // Headless / no host: return a no-op stub so callers stay branch-free.
  if (!doc || !root || typeof doc.createElement !== 'function') {
    return { el: null, destroy() {}, setVisible() {}, resize() {} };
  }

  // --- Base (circular pad) ---------------------------------------------------
  const base = doc.createElement('div');
  base.className = 'fp3d-joystick';
  base.setAttribute('role', 'group');
  base.setAttribute('aria-label', ariaLabel);
  Object.assign(base.style, {
    position: 'absolute',
    boxSizing: 'border-box',
    // CSS class `.fp3d-joystick` (injected by the caller) provides responsive
    // width/height/inset via clamp()/vmin; these are the pixel fallbacks used
    // when that stylesheet is absent (e.g. tests).
    width: `${fallbackSize}px`,
    height: `${fallbackSize}px`,
    borderRadius: '50%',
    background: COLORS.base,
    border: `2px solid ${COLORS.baseBorder}`,
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    pointerEvents: 'auto',
    touchAction: 'none', // never scroll the page while steering
    userSelect: 'none',
    // Do not steal focus from the game surface / keyboard scheme.
    outline: 'none',
    zIndex: '20',
  });

  // --- Thumb (draggable knob) ------------------------------------------------
  const thumb = doc.createElement('div');
  thumb.className = 'fp3d-joystick-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  Object.assign(thumb.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '42%',
    height: '42%',
    borderRadius: '50%',
    background: COLORS.thumb,
    border: `2px solid ${COLORS.thumbBorder}`,
    boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
    transform: 'translate(-50%, -50%)',
    transition: 'transform 60ms ease-out',
    pointerEvents: 'none', // the base owns all pointer handling
    boxSizing: 'border-box',
  });
  base.appendChild(thumb);

  // Active-drag state. `pointerId` isolates this control's finger so the turn
  // buttons (a second thumb) can be used simultaneously.
  const active = { pointerId: null, cx: 0, cy: 0, radius: fallbackSize / 2 };

  /** Measure the base's live center + radius (honors CSS-driven responsive size). */
  function measure() {
    if (typeof base.getBoundingClientRect === 'function') {
      try {
        const r = base.getBoundingClientRect();
        if (r && r.width) {
          active.cx = r.left + r.width / 2;
          active.cy = r.top + r.height / 2;
          active.radius = r.width / 2;
          return;
        }
      } catch { /* fall through to fallback geometry */ }
    }
    active.radius = fallbackSize / 2;
  }

  /** Recenter the thumb and reset the transition to a quick spring-back. */
  function recenter() {
    thumb.style.transition = 'transform 90ms ease-out';
    thumb.style.transform = 'translate(-50%, -50%)';
  }

  /**
   * Compute + report the normalized vector for a raw client point, moving the
   * thumb to match (clamped to the base radius) and applying the deadzone.
   * @param {number} clientX
   * @param {number} clientY
   */
  function updateFrom(clientX, clientY) {
    const radius = active.radius || fallbackSize / 2;
    let dx = clientX - active.cx;
    let dy = clientY - active.cy;
    const dist = Math.hypot(dx, dy);

    // Clamp the visual thumb to the base edge.
    const clampedDist = Math.min(dist, radius);
    if (dist > radius && dist > 0) {
      const s = radius / dist;
      dx *= s;
      dy *= s;
    }
    // Move the thumb (no transition while actively dragging for a 1:1 feel).
    thumb.style.transition = 'none';
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Normalize to [-1, 1] and apply the radial deadzone.
    let nx = radius > 0 ? dx / radius : 0;
    let ny = radius > 0 ? dy / radius : 0;
    let magnitude = radius > 0 ? clampedDist / radius : 0;
    if (magnitude < deadzone) {
      nx = 0;
      ny = 0;
      magnitude = 0;
    }
    onChange({ x: nx, y: ny, magnitude });
  }

  // --- Pointer / touch wiring ------------------------------------------------
  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

  function onDown(e) {
    if (active.pointerId != null) return; // already tracking a finger
    const p = samplePointer(e);
    if (!p) return;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    active.pointerId = p.id;
    measure();
    // Capture so we keep getting moves even if the finger slides off the base.
    if (supportsPointer && p.id !== 'pointer' && typeof base.setPointerCapture === 'function') {
      try { base.setPointerCapture(p.id); } catch { /* capture is best-effort */ }
    }
    updateFrom(p.clientX, p.clientY);
  }

  function onMove(e) {
    if (active.pointerId == null) return;
    const p = samplePointer(e);
    if (!p || p.id !== active.pointerId) return; // only our finger drives it
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    updateFrom(p.clientX, p.clientY);
  }

  function onUp(e) {
    if (active.pointerId == null) return;
    const p = samplePointer(e);
    // A release from a different finger (e.g. a turn button) is ignored.
    if (p && p.id !== active.pointerId) return;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (supportsPointer && active.pointerId !== 'pointer' && typeof base.releasePointerCapture === 'function') {
      try { base.releasePointerCapture(active.pointerId); } catch { /* ignore */ }
    }
    active.pointerId = null;
    recenter();
    onEnd();
  }

  const handlers = [];
  const add = (type, fn, optsArg) => {
    base.addEventListener(type, fn, optsArg);
    handlers.push({ type, fn });
  };

  if (supportsPointer) {
    add('pointerdown', onDown);
    add('pointermove', onMove);
    add('pointerup', onUp);
    add('pointercancel', onUp);
  } else {
    // Touch fallback for platforms/tests without Pointer Events.
    add('touchstart', onDown, { passive: false });
    add('touchmove', onMove, { passive: false });
    add('touchend', onUp, { passive: false });
    add('touchcancel', onUp, { passive: false });
  }

  root.appendChild(base);

  /** Show/hide the joystick; releasing any active drag when hidden. */
  function setVisible(visible) {
    base.style.display = visible ? 'block' : 'none';
    if (!visible && active.pointerId != null) {
      active.pointerId = null;
      recenter();
      onEnd();
    }
  }

  /** Recompute cached geometry (call on resize / orientationchange). */
  function resize() {
    measure();
  }

  /** Remove listeners + detach. Safe to call more than once. */
  function destroy() {
    for (const { type, fn } of handlers) {
      try { base.removeEventListener(type, fn); } catch { /* ignore */ }
    }
    handlers.length = 0;
    try { base.remove(); } catch {
      if (base.parentNode) base.parentNode.removeChild(base);
    }
  }

  return { el: base, destroy, setVisible, resize };
}

export default createVirtualJoystick;
