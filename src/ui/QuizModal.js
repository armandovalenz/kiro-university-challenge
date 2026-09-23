// QuizModal — the accessible DOM form for the Einstein quiz (Req 4.1, 4.4,
// 4.5, 4.6, 9.2, 9.3).
//
// This is a plain-DOM builder (NO Phaser import): `QuizScene` constructs one
// over the `#overlay-root` element declared in `index.html`, calls `open()`
// with a question record + a submit callback, then reveals the outcome with
// `showResult()`. It mirrors the accessibility contract of `LessonModal`:
//   - role="dialog" + aria-modal, labelled by the prompt, described by choices.
//   - The choice list is a radiogroup; each option is role="radio".
//   - Keyboard: 1-N pick + submit a choice directly; Up/Down/Left/Right move
//     the selection; Enter submits the highlighted choice; Esc is ignored while
//     unanswered (a question must be answered — Req 4.5/4.6 — but Enter/Esc
//     dismiss the result panel after the outcome is shown).
//   - Focus moves into the dialog on open and is restored on close.
//
// Styling is inline and self-contained, echoing the UI-kit look (dark panel,
// yellow accents; green = correct, red = wrong) without depending on the art
// (Req 13.3, 13.5). Keeping this framework-free keeps the game logic testable
// and the DOM crisp / screen-reader friendly (design: DOM overlays for text UI).
//
// The modal is presentation-only: it never decides correctness. `QuizScene`
// runs the pure `QuizSystem.check` and drives `showResult()`.

let panelSeq = 0;

const COLORS = {
  panelBg: '#0d0d2b',
  text: '#ffffff',
  accent: '#ffe000', // UI-kit yellow
  correct: '#00ffab', // green
  wrong: '#ff5470', // red
  muted: '#b9b9d6',
  optionBg: '#1a1a44',
  optionBorder: '#3a3a6a',
};

export default class QuizModal {
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
    /** @type {Element|null} focus to restore on close. */
    this._prevFocus = null;

    /** @type {string[]} the choices currently rendered. */
    this._choices = [];
    /** @type {HTMLButtonElement[]} the option buttons, indexed by choice. */
    this._optionEls = [];
    /** @type {number} currently highlighted option index. */
    this._selected = 0;
    /** @type {boolean} whether a choice has been submitted (locks input). */
    this._answered = false;

    /** @type {((choice: string) => void)|null} submit callback (fires once). */
    this._onSubmit = null;
    /** @type {(() => void)|null} continue callback for the result view. */
    this._onContinue = null;

    this._keyHandler = this._keyHandler.bind(this);
    this._id = `quiz-panel-${++panelSeq}`;
  }

  /** @returns {boolean} whether the modal is currently shown. */
  isOpen() {
    return !!this.el;
  }

  /**
   * Build and show the quiz form for a question. Idempotent-safe: an already
   * open panel is closed first. No-op (returns false) when there is no DOM to
   * render into, so headless callers/tests never throw (silent-fallback).
   *
   * @param {{question?: string, choices?: string[], subject?: string, grade?: number}} question
   * @param {(choice: string) => void} onSubmit called once with the selected choice.
   * @returns {boolean} true when the panel was rendered.
   */
  open(question, onSubmit) {
    if (!this.doc || !this.root) return false;
    if (this.el) this.close();

    this._onSubmit = typeof onSubmit === 'function' ? onSubmit : null;
    this._onContinue = null;
    this._answered = false;
    this._selected = 0;
    this._prevFocus = this.doc.activeElement || null;
    this._choices = Array.isArray(question && question.choices)
      ? question.choices.filter((c) => typeof c === 'string')
      : [];

    const titleId = `${this._id}-title`;
    const groupId = `${this._id}-choices`;

    const panel = this.doc.createElement('div');
    panel.className = 'mm-quiz';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', titleId);
    Object.assign(panel.style, {
      boxSizing: 'border-box',
      maxWidth: '520px',
      width: 'min(92vw, 520px)',
      margin: 'auto',
      padding: '24px',
      background: COLORS.panelBg,
      color: COLORS.text,
      border: `3px solid ${COLORS.accent}`,
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      textAlign: 'center',
    });

    // Eyebrow: "Einstein Challenge · Math" — subject tag from the record.
    const eyebrow = this.doc.createElement('p');
    eyebrow.textContent = this._eyebrowText(question);
    Object.assign(eyebrow.style, {
      margin: '0 0 8px',
      color: COLORS.accent,
      fontWeight: '700',
      fontSize: '14px',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    });

    // Prompt.
    const title = this.doc.createElement('h2');
    title.id = titleId;
    title.textContent = (question && question.question) || 'Solve to survive!';
    Object.assign(title.style, {
      margin: '0 0 18px',
      color: COLORS.text,
      fontSize: '22px',
      lineHeight: '1.3',
    });

    // Choice radiogroup.
    const group = this.doc.createElement('div');
    group.id = groupId;
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', titleId);
    Object.assign(group.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      margin: '0 0 16px',
    });

    this._optionEls = this._choices.map((choice, i) => {
      const btn = this.doc.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
      btn.dataset.index = String(i);
      // Number prefix cues the 1-N keyboard shortcut (Req 4.4).
      btn.textContent = `${i + 1}. ${choice}`;
      Object.assign(btn.style, this._optionBaseStyle());
      btn.addEventListener('click', () => this._submit(i));
      btn.addEventListener('mouseenter', () => {
        if (!this._answered) this._highlight(i);
      });
      group.appendChild(btn);
      return btn;
    });

    // Feedback region (explanation on wrong / positive note on correct).
    const feedback = this.doc.createElement('div');
    feedback.id = `${this._id}-feedback`;
    feedback.setAttribute('aria-live', 'polite');
    Object.assign(feedback.style, {
      margin: '0',
      minHeight: '0',
      fontSize: '16px',
      lineHeight: '1.5',
    });

    // Keyboard hint.
    const hint = this.doc.createElement('p');
    hint.textContent = 'Press 1-' + Math.max(this._choices.length, 1) + ', or use arrows + Enter';
    Object.assign(hint.style, {
      margin: '14px 0 0',
      fontSize: '13px',
      color: COLORS.muted,
    });

    panel.appendChild(eyebrow);
    panel.appendChild(title);
    panel.appendChild(group);
    panel.appendChild(feedback);
    panel.appendChild(hint);

    this.root.appendChild(panel);
    this.el = panel;
    this._feedbackEl = feedback;
    this._hintEl = hint;
    this._titleId = titleId;

    // Reflect the initial highlight.
    this._highlight(0);

    // Capture keys on the panel (Req 4.4, 9.3).
    panel.addEventListener('keydown', this._keyHandler);

    // Focus the highlighted option for keyboard + screen-reader users (Req 9.3).
    try {
      (this._optionEls[0] || panel).focus();
    } catch {
      /* focus is best-effort */
    }
    return true;
  }

  /**
   * Reveal the outcome after a submission (Req 4.5, 4.6): always highlight the
   * correct answer; on a wrong answer also mark the player's pick red and show
   * the explanation. Adds a "Keep playing" continue affordance (button + Enter/
   * Space/Esc) that invokes `onContinue` once.
   *
   * @param {{correct: boolean, correctAnswer: string, explanation?: string}} result
   * @param {() => void} onContinue called once when the player continues.
   */
  showResult(result, onContinue) {
    if (!this.el) {
      // No DOM (headless) — resolve immediately so the flow never strands.
      if (typeof onContinue === 'function') onContinue();
      return;
    }
    this._answered = true;
    this._onContinue = typeof onContinue === 'function' ? onContinue : null;

    const correctAnswer = result && result.correctAnswer;
    const isCorrect = !!(result && result.correct);

    // Recolor options: green for the correct value; red for a wrong pick.
    this._optionEls.forEach((btn, i) => {
      const choice = this._choices[i];
      btn.disabled = true;
      btn.style.cursor = 'default';
      if (choice === correctAnswer) {
        btn.style.background = COLORS.correct;
        btn.style.borderColor = COLORS.correct;
        btn.style.color = COLORS.panelBg;
        btn.style.fontWeight = '700';
        btn.setAttribute('aria-checked', 'true');
      } else if (!isCorrect && i === this._selected) {
        btn.style.background = COLORS.wrong;
        btn.style.borderColor = COLORS.wrong;
        btn.style.color = COLORS.text;
        btn.setAttribute('aria-checked', 'false');
      } else {
        btn.setAttribute('aria-checked', 'false');
      }
    });

    // Feedback line + explanation.
    if (this._feedbackEl) {
      this._feedbackEl.textContent = '';
      const headline = this.doc.createElement('p');
      headline.textContent = isCorrect ? 'Correct! No life lost.' : 'Not quite — you lost a life.';
      Object.assign(headline.style, {
        margin: '4px 0 8px',
        fontWeight: '700',
        fontSize: '18px',
        color: isCorrect ? COLORS.correct : COLORS.wrong,
      });
      this._feedbackEl.appendChild(headline);

      if (!isCorrect && result && result.explanation) {
        const expl = this.doc.createElement('p');
        expl.textContent = result.explanation;
        Object.assign(expl.style, { margin: '0 0 8px', color: COLORS.text });
        this._feedbackEl.appendChild(expl);
      }

      const cont = this.doc.createElement('button');
      cont.type = 'button';
      cont.textContent = 'Keep playing';
      Object.assign(cont.style, {
        cursor: 'pointer',
        marginTop: '8px',
        padding: '10px 22px',
        fontSize: '16px',
        fontWeight: '700',
        color: COLORS.panelBg,
        background: COLORS.accent,
        border: 'none',
        borderRadius: '8px',
      });
      cont.addEventListener('click', () => this._continue());
      this._feedbackEl.appendChild(cont);
      this._continueBtn = cont;
    }

    if (this._hintEl) this._hintEl.textContent = 'Press Enter or Esc to continue';

    try {
      (this._continueBtn || this.el).focus();
    } catch {
      /* best-effort */
    }
  }

  /** Remove the panel from the DOM and restore focus. Safe when closed. */
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
    this._optionEls = [];
    this._feedbackEl = null;
    this._hintEl = null;
    this._continueBtn = null;
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

  /** Base inline style shared by every choice button. */
  _optionBaseStyle() {
    return {
      boxSizing: 'border-box',
      cursor: 'pointer',
      width: '100%',
      textAlign: 'left',
      padding: '12px 16px',
      fontSize: '17px',
      color: COLORS.text,
      background: COLORS.optionBg,
      border: `2px solid ${COLORS.optionBorder}`,
      borderRadius: '8px',
      transition: 'border-color 0.1s ease',
    };
  }

  /** Compose the eyebrow line ("Einstein Challenge · Math") from the record. */
  _eyebrowText(question) {
    const subject =
      question && typeof question.subject === 'string' && question.subject
        ? question.subject.charAt(0).toUpperCase() + question.subject.slice(1)
        : null;
    return subject ? `Einstein Challenge \u00b7 ${subject}` : 'Einstein Challenge';
  }

  /**
   * Move the highlight to option `i` (no submission). Updates the radio state
   * and the outline so mouse + keyboard selection stay in sync.
   * @param {number} i
   */
  _highlight(i) {
    if (this._answered) return;
    const n = this._optionEls.length;
    if (n === 0) return;
    this._selected = ((i % n) + n) % n; // wrap
    this._optionEls.forEach((btn, idx) => {
      const on = idx === this._selected;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.style.borderColor = on ? COLORS.accent : COLORS.optionBorder;
      btn.style.background = on ? '#26265c' : COLORS.optionBg;
    });
    try {
      this._optionEls[this._selected].focus();
    } catch {
      /* best-effort */
    }
  }

  /**
   * Submit the choice at index `i` exactly once (Req 4.4). Locks further input
   * and invokes the submit callback with the choice STRING (value-based check).
   * @param {number} i
   */
  _submit(i) {
    if (this._answered) return;
    const n = this._optionEls.length;
    if (n === 0) return;
    const idx = Math.min(Math.max(i, 0), n - 1);
    this._selected = idx;
    this._answered = true;
    const choice = this._choices[idx];
    const cb = this._onSubmit;
    this._onSubmit = null;
    if (cb) {
      try {
        cb(choice);
      } catch {
        /* never let the submit listener crash the game */
      }
    }
  }

  /** Invoke the continue callback once (after the result is shown). */
  _continue() {
    const cb = this._onContinue;
    this._onContinue = null;
    if (cb) {
      try {
        cb();
      } catch {
        /* never let the continue listener crash the game */
      }
    }
  }

  /**
   * Keyboard handling (Req 4.4, 9.3):
   *   - Before answering: digits 1-N submit that choice; arrows move the
   *     highlight; Enter/Space submit the highlighted choice; Esc is ignored
   *     (the question must be answered).
   *   - After answering: Enter/Space/Esc (or the button) continue.
   * @param {KeyboardEvent} e
   */
  _keyHandler(e) {
    const key = e.key;

    if (this._answered) {
      if (key === 'Enter' || key === 'Escape' || key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        this._continue();
      }
      return;
    }

    // Number keys pick + submit directly (1-based).
    if (/^[0-9]$/.test(key)) {
      const idx = parseInt(key, 10) - 1;
      if (idx >= 0 && idx < this._optionEls.length) {
        e.preventDefault();
        e.stopPropagation();
        this._submit(idx);
      }
      return;
    }

    switch (key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        this._highlight(this._selected + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        this._highlight(this._selected - 1);
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        e.stopPropagation();
        this._submit(this._selected);
        break;
      default:
        break;
    }
  }
}
