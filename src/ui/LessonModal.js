// LessonModal — the accessible DOM panel that shows a fruit micro-lesson
// (Req 5.3, 5.4, 9.2, 9.3).
//
// This is a plain-DOM builder (NO Phaser import): `LessonScene` constructs one
// over the `#overlay-root` element declared in `index.html`, calls `open()`
// with a lesson, and is notified via a dismiss callback. The panel is a
// keyboard-operable modal dialog:
//   - role="dialog" + aria-modal, labelled by its title and described by body.
//   - Focus moves to the dismiss button on open and is restored on close.
//   - Enter / Space / Escape (and the button) dismiss it and resume the game.
//
// Styling is inline so the modal is self-contained and high-contrast, echoing
// the UI-kit look (dark panel, yellow accents) without depending on the art
// (Req 13.3, 13.5). Keeping this framework-free keeps the game logic testable
// and the DOM crisp/screen-reader friendly (design: DOM overlays for text UI).

let panelSeq = 0;

export default class LessonModal {
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
    this._id = `lesson-panel-${++panelSeq}`;
  }

  /**
   * Whether the modal is currently shown.
   * @returns {boolean}
   */
  isOpen() {
    return !!this.el;
  }

  /**
   * Build and show the panel for a lesson. Idempotent-safe: an already-open
   * panel is closed first. No-op (returns false) when there is no DOM to render
   * into, so headless callers/tests never throw (mirrors the silent-fallback
   * philosophy used elsewhere).
   *
   * @param {import('../systems/LessonBank.js').Lesson} lesson the lesson to show
   * @param {() => void} [onDismiss] called once when the panel is dismissed
   * @returns {boolean} true when the panel was rendered
   */
  open(lesson, onDismiss) {
    if (!this.doc || !this.root) return false;
    if (this.el) this.close();

    this._onDismiss = typeof onDismiss === 'function' ? onDismiss : null;
    this._prevFocus = this.doc.activeElement || null;

    const titleId = `${this._id}-title`;
    const bodyId = `${this._id}-body`;

    const panel = this.doc.createElement('div');
    panel.className = 'mm-lesson';
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

    // Eyebrow: extra life + subject/topic tag (Req 5.2 feedback, 9.1).
    const eyebrow = this.doc.createElement('p');
    eyebrow.textContent = this._eyebrowText(lesson);
    Object.assign(eyebrow.style, {
      margin: '0 0 8px',
      color: '#00ffab',
      fontWeight: '700',
      fontSize: '15px',
      letterSpacing: '0.04em',
    });

    const title = this.doc.createElement('h2');
    title.id = titleId;
    title.textContent = (lesson && lesson.title) || 'Did you know?';
    Object.assign(title.style, {
      margin: '0 0 12px',
      color: '#ffe000',
      fontSize: '24px',
      lineHeight: '1.2',
    });

    const body = this.doc.createElement('p');
    body.id = bodyId;
    body.textContent = (lesson && lesson.text) || '';
    Object.assign(body.style, {
      margin: '0 0 20px',
      fontSize: '18px',
      lineHeight: '1.5',
    });

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = 'Keep playing';
    Object.assign(button.style, {
      cursor: 'pointer',
      padding: '10px 22px',
      fontSize: '17px',
      fontWeight: '700',
      color: '#0d0d2b',
      background: '#ffe000',
      border: 'none',
      borderRadius: '8px',
    });
    button.addEventListener('click', () => this._dismiss());

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
    panel.appendChild(button);
    panel.appendChild(hint);

    this.root.appendChild(panel);
    this.el = panel;
    this._button = button;

    // Capture keys on the panel so Enter/Space/Esc dismiss it (Req 5.4, 9.3).
    panel.addEventListener('keydown', this._keyHandler);

    // Move focus into the dialog for keyboard + screen-reader users (Req 9.3).
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

  /** Compose the eyebrow line ("+1 life · Math") from the lesson tags. */
  _eyebrowText(lesson) {
    const subject =
      lesson && lesson.subject
        ? lesson.subject.charAt(0).toUpperCase() + lesson.subject.slice(1)
        : 'Fun fact';
    return `+1 life \u00b7 ${subject}`;
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
   * Keyboard handler: Enter, Space, and Escape all dismiss the lesson (Req 5.4).
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
