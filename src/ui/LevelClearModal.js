// LevelClearModal — the accessible DOM panel announcing a cleared maze (a "win"
// in FP3D_Mode when every pellet has been eaten).
//
// This is a plain-DOM builder (NO Phaser, NO Three.js import), mirroring
// `LessonModal`: `FP3DScene` constructs one over the `#overlay-root` element
// declared in `index.html`, calls `open()` with the win info, and is notified
// via a dismiss callback. The panel is a keyboard-operable modal dialog:
//   - role="dialog" + aria-modal, labelled by its title and described by body.
//   - Focus moves to the "Next level" button on open, restored on close.
//   - Enter / Space / Escape (and the button) dismiss it and resume the game.
//
// Styling is inline so the modal is self-contained and high-contrast, echoing
// the UI-kit look (dark panel, yellow accents) but with a celebratory
// green/gold eyebrow so it clearly reads as a WIN rather than a quiz/lesson.
// Keeping this framework-free keeps the game logic testable and the DOM crisp/
// screen-reader friendly (design: DOM overlays for text UI).

let panelSeq = 0;

export default class LevelClearModal {
  /**
   * @param {HTMLElement|null} root the overlay root element (`#overlay-root`).
   * @param {object} [opts]
   * @param {Document} [opts.document] injectable document (defaults to global).
   */
  constructor(root, { document: doc } = {}) {
    /** @type {Document|null} */
    this.doc = doc || (typeof document !== 'undefined' ? document : null);
    /** @type {HTMLElement|null} */
    this.root = root || null;
    /** @type {HTMLElement|null} the panel element while open. */
    this.el = null;
    /** @type {(() => void)|null} current dismiss handler. */
    this._onDismiss = null;
    /** @type {Element|null} focus to restore on close. */
    this._prevFocus = null;
    this._keyHandler = this._keyHandler.bind(this);
    this._id = `levelclear-panel-${++panelSeq}`;
  }

  /**
   * Whether the modal is currently shown.
   * @returns {boolean}
   */
  isOpen() {
    return !!this.el;
  }

  /**
   * Build and show the panel for a cleared level. Idempotent-safe: an already-
   * open panel is closed first. No-op (returns false) when there is no DOM to
   * render into, so headless callers/tests never throw (mirrors the silent-
   * fallback philosophy used elsewhere).
   *
   * @param {object} [info] win info to render (all fields optional/defensive)
   * @param {number} [info.level] the cleared level number
   * @param {number} [info.score] the current score
   * @param {number} [info.fromGrade] grade before the win bump
   * @param {number} [info.toGrade] grade after the win bump
   * @param {() => void} [onDismiss] called once when the panel is dismissed
   * @returns {boolean} true when the panel was rendered
   */
  open(info, onDismiss) {
    if (!this.doc || !this.root) return false;
    if (this.el) this.close();

    const data = info || {};
    this._onDismiss = typeof onDismiss === 'function' ? onDismiss : null;
    this._prevFocus = this.doc.activeElement || null;

    const titleId = `${this._id}-title`;
    const bodyId = `${this._id}-body`;

    const panel = this.doc.createElement('div');
    panel.className = 'mm-level-clear';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', titleId);
    panel.setAttribute('aria-describedby', bodyId);
    Object.assign(panel.style, {
      boxSizing: 'border-box',
      maxWidth: '440px',
      width: 'min(90vw, 440px)',
      margin: 'auto',
      padding: '24px',
      background: '#0d0d2b',
      color: '#ffffff',
      border: '3px solid #ffe000',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      textAlign: 'center',
    });

    // Eyebrow: a green/gold "win" banner distinct from the lesson panel so the
    // screen reads unmistakably as a victory.
    const eyebrow = this.doc.createElement('p');
    eyebrow.textContent = '\uD83C\uDFC6 You cleared the maze!';
    Object.assign(eyebrow.style, {
      margin: '0 0 8px',
      color: '#00ffab',
      fontWeight: '700',
      fontSize: '15px',
      letterSpacing: '0.04em',
    });

    const title = this.doc.createElement('h2');
    title.id = titleId;
    title.textContent = 'Level Complete!';
    Object.assign(title.style, {
      margin: '0 0 12px',
      color: '#ffe000',
      fontSize: '26px',
      lineHeight: '1.2',
    });

    const body = this.doc.createElement('p');
    body.id = bodyId;
    body.textContent = this._bodyText(data);
    Object.assign(body.style, {
      margin: '0 0 8px',
      fontSize: '18px',
      lineHeight: '1.5',
    });

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = 'Next level';
    Object.assign(button.style, {
      cursor: 'pointer',
      marginTop: '12px',
      padding: '10px 22px',
      fontSize: '17px',
      fontWeight: '700',
      color: '#0d0d2b',
      background: '#ffe000',
      border: 'none',
      borderRadius: '8px',
      touchAction: 'manipulation',
    });
    // Belt-and-suspenders touch activation (BUG 1): respond to a direct
    // pointer/touch so a tap advances even if the game surface interferes with
    // the synthetic click; guard against a double-fire with the following click.
    let handledByPointer = false;
    const activate = (e) => {
      handledByPointer = true;
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      this._dismiss();
    };
    if (typeof window !== 'undefined' && 'PointerEvent' in window) {
      button.addEventListener('pointerdown', activate);
    } else {
      button.addEventListener('touchstart', activate, { passive: false });
    }
    button.addEventListener('click', (e) => {
      if (handledByPointer) { handledByPointer = false; return; }
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      this._dismiss();
    });

    const hint = this.doc.createElement('p');
    hint.textContent = 'Press Enter or Esc to continue';
    Object.assign(hint.style, {
      margin: '14px 0 0',
      fontSize: '13px',
      color: '#b9b9d6',
    });

    panel.appendChild(eyebrow);
    panel.appendChild(title);
    panel.appendChild(body);

    // Grade change line (only when the grade actually advanced), shown as its
    // own emphasized line so the progression is obvious.
    const gradeLine = this._gradeText(data);
    if (gradeLine) {
      const grade = this.doc.createElement('p');
      grade.textContent = gradeLine;
      Object.assign(grade.style, {
        margin: '0',
        fontSize: '17px',
        fontWeight: '700',
        color: '#00ffab',
      });
      panel.appendChild(grade);
    }

    panel.appendChild(button);
    panel.appendChild(hint);

    this.root.appendChild(panel);
    this.el = panel;
    this._button = button;

    // Capture keys on the panel so Enter/Space/Esc dismiss it.
    panel.addEventListener('keydown', this._keyHandler);

    // Move focus into the dialog for keyboard + screen-reader users.
    try {
      button.focus();
    } catch {
      /* focus is best-effort */
    }
    return true;
  }

  /**
   * Remove the panel from the DOM and restore focus. Safe to call when closed.
   */
  close() {
    if (this.el) {
      this.el.removeEventListener('keydown', this._keyHandler);
      try {
        this.el.remove();
      } catch {
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
      }
    }
    this.el = null;
    this._button = null;
    // Restore focus to whatever had it before the modal opened.
    if (this._prevFocus && typeof this._prevFocus.focus === 'function') {
      try {
        this._prevFocus.focus();
      } catch {
        /* ignore */
      }
    }
    this._prevFocus = null;
  }

  // --- Internals -------------------------------------------------------------

  /** Compose the stats line ("Level 1 cleared \u00b7 Score 1,230") defensively. */
  _bodyText(data) {
    const parts = [];
    if (Number.isFinite(data.level)) {
      parts.push(`Level ${data.level} cleared`);
    } else {
      parts.push('Maze cleared');
    }
    if (Number.isFinite(data.score)) {
      parts.push(`Score ${data.score.toLocaleString()}`);
    }
    return parts.join(' \u00b7 ');
  }

  /**
   * Compose the grade-change line ("Grade 5 \u2192 6") only when the grade
   * actually advanced. Returns an empty string otherwise so no line is shown.
   */
  _gradeText(data) {
    const from = data.fromGrade;
    const to = data.toGrade;
    if (Number.isFinite(from) && Number.isFinite(to) && to !== from) {
      return `Grade ${from} \u2192 ${to}`;
    }
    return '';
  }

  /** Dismiss the modal once: close it, then invoke the dismiss callback. */
  _dismiss() {
    const cb = this._onDismiss;
    this._onDismiss = null;
    this.close();
    if (cb) {
      try {
        cb();
      } catch {
        /* never let a dismiss listener crash the game */
      }
    }
  }

  /**
   * Keyboard handler: Enter, Space, and Escape all dismiss the announcement.
   * @param {KeyboardEvent} e
   */
  _keyHandler(e) {
    const key = e.key;
    if (key === 'Enter' || key === 'Escape' || key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      this._dismiss();
    }
  }
}
