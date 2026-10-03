// Copyright (c) 2026 Armando Valenz
// SPDX-License-Identifier: MIT
//
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
//
// Optional visual aid: when a question carries an `image` object (science
// questions only — see QuestionBank.sanitizeImage), the modal renders a WHITE
// image card with a drop shadow above the choices, plus a tiny muted
// attribution caption (so CC-BY / CC-BY-SA credit is satisfied in-product).
// The white fill matters because many of the diagrams are transparent PNGs
// that would be unreadable on the dark panel. The card is purely decorative:
// not focusable, excluded from the a11y tree beyond its `alt`, and an `onerror`
// hides the WHOLE card so a missing/broken image never shows a broken-image
// icon or blocks the quiz (graceful fallback — .kiro/steering/tech.md).

// Config is framework-agnostic (no Phaser/Three.js), so importing the asset
// base path here keeps the modal a plain-DOM builder.
import { QUESTION_IMAGE_BASE_PATH } from '../config.js';

let panelSeq = 0;

const COLORS = {
  // Jeopardy "board" blues (deep royal → near-black navy) themed for Halloween.
  panelBg: '#0b1437', // deep board navy
  panelBg2: '#070b22', // darker toward the edges (radial board glow)
  tileBg: '#13205e', // Jeopardy clue-tile blue
  tileBg2: '#0c1746', // tile gradient bottom
  tileHover: '#1b2f85', // lit clue tile on hover/highlight
  tileBorder: '#2a3f8f',
  text: '#ffffff',
  accent: '#ffe000', // UI-kit yellow (kept for compatibility)
  gold: '#ffcf3f', // Jeopardy gilded gold
  goldDeep: '#b8860b', // dark gold for bevel shadow
  pumpkin: '#ff8a2a', // Halloween pumpkin orange
  pumpkinDeep: '#c2410c', // deep ember orange
  correct: '#00ffab', // green
  wrong: '#ff5470', // red
  muted: '#b9b9d6',
  optionBg: '#13205e', // (legacy alias retained; tiles now use tileBg)
  optionBorder: '#2a3f8f',
};

/**
 * One-time injection of the keyframes + shared classes the Jeopardy-Halloween
 * quiz theme uses (gilded border glow, title flicker, correct/wrong pulses).
 * Mirrors the one-time `<style>` pattern used by FullscreenToggle, so the modal
 * stays a self-contained plain-DOM builder with no external CSS dependency.
 * All motion is gated by `prefers-reduced-motion` at the call sites, so this
 * only defines the animations — it never forces them on.
 * @param {Document} doc
 */
let quizStyleInjected = false;
function ensureQuizStyle(doc) {
  if (quizStyleInjected || !doc || !doc.head) return;
  try {
    const style = doc.createElement('style');
    style.setAttribute('data-mm-quiz-theme', 'true');
    style.textContent = [
      '@keyframes mmQuizBorderGlow{',
      '0%,100%{box-shadow:0 0 0 2px rgba(255,207,63,0.55),0 0 18px 2px rgba(255,138,42,0.35),0 18px 48px rgba(0,0,0,0.7);}',
      '50%{box-shadow:0 0 0 2px rgba(255,207,63,0.9),0 0 30px 6px rgba(255,138,42,0.6),0 18px 48px rgba(0,0,0,0.7);}}',
      '@keyframes mmQuizTitleFlicker{',
      '0%,100%{opacity:1;text-shadow:0 0 6px rgba(255,207,63,0.7),0 2px 0 #4a2a00;}',
      '45%{opacity:0.92;text-shadow:0 0 10px rgba(255,207,63,0.95),0 2px 0 #4a2a00;}',
      '55%{opacity:0.86;text-shadow:0 0 4px rgba(255,207,63,0.5),0 2px 0 #4a2a00;}}',
      '@keyframes mmQuizTileIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}',
      '@keyframes mmQuizCorrect{0%{box-shadow:0 0 0 0 rgba(0,255,171,0.0);}',
      '30%{box-shadow:0 0 18px 4px rgba(0,255,171,0.8);}100%{box-shadow:0 0 10px 1px rgba(0,255,171,0.4);}}',
      '@keyframes mmQuizWrong{0%,100%{transform:translateX(0);}20%{transform:translateX(-6px);}',
      '40%{transform:translateX(6px);}60%{transform:translateX(-4px);}80%{transform:translateX(4px);}}',
      '.mm-quiz-tile{animation:mmQuizTileIn 260ms ease both;}',
      '.mm-quiz-reduced .mm-quiz-tile{animation:none;}',
    ].join('');
    doc.head.appendChild(style);
    quizStyleInjected = true;
  } catch {
    /* theme styling is best-effort */
  }
}

/** True when the OS/browser asked for reduced motion. Guarded for tests. */
function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

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
    /** @type {HTMLElement|null} the optional visual-aid card (image + caption). */
    this._imageFigure = null;
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

    ensureQuizStyle(this.doc);
    this._reducedMotion = prefersReducedMotion();

    this._onSubmit = typeof onSubmit === 'function' ? onSubmit : null;
    this._onContinue = null;
    this._answered = false;
    this._selected = 0;
    this._imageFigure = null;
    this._prevFocus = this.doc.activeElement || null;
    this._choices = Array.isArray(question && question.choices)
      ? question.choices.filter((c) => typeof c === 'string')
      : [];

    const titleId = `${this._id}-title`;
    const groupId = `${this._id}-choices`;

    const panel = this.doc.createElement('div');
    panel.className = this._reducedMotion ? 'mm-quiz mm-quiz-reduced' : 'mm-quiz';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', titleId);
    Object.assign(panel.style, {
      boxSizing: 'border-box',
      maxWidth: '540px',
      width: 'min(92vw, 540px)',
      margin: 'auto',
      padding: '22px',
      // Jeopardy "board": a radial navy glow over a deep board base.
      background: `radial-gradient(130% 100% at 50% 0%, ${COLORS.panelBg} 0%, ${COLORS.panelBg2} 78%)`,
      color: COLORS.text,
      // Gilded gold inner edge + pumpkin outer ring = a Halloween-Jeopardy frame.
      border: `2px solid ${COLORS.gold}`,
      outline: `3px solid ${COLORS.pumpkinDeep}`,
      outlineOffset: '2px',
      borderRadius: '14px',
      boxShadow: this._reducedMotion
        // Static gilded glow when motion is reduced.
        ? `0 0 0 2px rgba(255,207,63,0.7), 0 0 22px 3px rgba(255,138,42,0.45), 0 18px 48px rgba(0,0,0,0.7)`
        : `0 18px 48px rgba(0,0,0,0.7)`, // animated glow added below
      animation: this._reducedMotion ? 'none' : 'mmQuizBorderGlow 2.8s ease-in-out infinite',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      textAlign: 'center',
    });

    // Eyebrow: "Einstein Challenge · Math" — subject tag from the record.
    const eyebrow = this.doc.createElement('p');
    eyebrow.textContent = this._eyebrowText(question);
    Object.assign(eyebrow.style, {
      margin: '0 0 10px',
      color: COLORS.pumpkin,
      fontWeight: '800',
      fontSize: '13px',
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      textShadow: '0 0 8px rgba(255,138,42,0.55)',
    });

    // Prompt.
    const title = this.doc.createElement('h2');
    title.id = titleId;
    title.textContent = (question && question.question) || 'Solve to survive!';
    Object.assign(title.style, {
      margin: '0 0 18px',
      color: COLORS.gold,
      fontSize: '23px',
      fontWeight: '800',
      lineHeight: '1.3',
      letterSpacing: '0.01em',
      textShadow: '0 0 6px rgba(255,207,63,0.7), 0 2px 0 #4a2a00',
      animation: this._reducedMotion ? 'none' : 'mmQuizTitleFlicker 4.5s ease-in-out infinite',
    });

    // Optional visual aid (science questions). Rendered ABOVE the choices,
    // decorative-with-alt (not focusable). Guarded so a missing/broken image
    // never blocks the quiz — `onerror` hides the figure so the question works
    // text-only (graceful fallback; .kiro/steering/tech.md). The tiny caption
    // carries CC-BY/CC-BY-SA attribution in-product.
    const imageFigure = this._buildImageFigure(question);
    if (imageFigure) this._imageFigure = imageFigure;

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
      btn.className = 'mm-quiz-tile';
      Object.assign(btn.style, this._optionBaseStyle());
      btn.style.touchAction = 'manipulation';
      // Staggered deal-in so the tiles cascade onto the board (gated by the
      // mm-quiz-reduced class, which disables the animation entirely).
      btn.style.animationDelay = `${i * 70}ms`;
      // Belt-and-suspenders touch activation (BUG 1): respond to a direct
      // pointer/touch so a tap always submits even if something upstream on the
      // game surface interferes with the synthetic click. A pointer-handled
      // activation swallows the following click to avoid a double submit
      // (mirrors the `handledByPointer` pattern in FP3DScene). The existing
      // click + keyboard handlers stay intact; role=radio / aria-checked are
      // unchanged (they are driven by `_submit`/`_highlight`).
      let handledByPointer = false;
      const activate = (e) => {
        handledByPointer = true;
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this._submit(i);
      };
      if (typeof window !== 'undefined' && 'PointerEvent' in window) {
        btn.addEventListener('pointerdown', activate);
      } else {
        btn.addEventListener('touchstart', activate, { passive: false });
      }
      btn.addEventListener('click', (e) => {
        if (handledByPointer) { handledByPointer = false; return; }
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this._submit(i);
      });
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
    if (this._imageFigure) panel.appendChild(this._imageFigure);
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
      btn.style.transform = 'translateY(0)';
      if (choice === correctAnswer) {
        btn.style.background = COLORS.correct;
        btn.style.borderColor = COLORS.correct;
        btn.style.color = COLORS.panelBg;
        btn.style.fontWeight = '800';
        btn.style.textShadow = 'none';
        // Winning clue tile pulses with a green glow (gated).
        btn.style.boxShadow = `0 0 14px 2px rgba(0,255,171,0.6)`;
        if (!this._reducedMotion) btn.style.animation = 'mmQuizCorrect 600ms ease-out both';
        btn.setAttribute('aria-checked', 'true');
      } else if (!isCorrect && i === this._selected) {
        btn.style.background = COLORS.wrong;
        btn.style.borderColor = COLORS.wrong;
        btn.style.color = COLORS.text;
        btn.style.textShadow = 'none';
        btn.style.boxShadow = `0 0 12px 1px rgba(255,84,112,0.55)`;
        // A short "wrong buzzer" shake on the mistaken pick (gated).
        if (!this._reducedMotion) btn.style.animation = 'mmQuizWrong 420ms ease-in-out both';
        btn.setAttribute('aria-checked', 'false');
      } else {
        // Dim the non-answers so the correct tile stands out on the board.
        btn.style.opacity = '0.5';
        btn.setAttribute('aria-checked', 'false');
      }
    });

    // Feedback line + explanation.
    if (this._feedbackEl) {
      this._feedbackEl.textContent = '';
      const headline = this.doc.createElement('p');
      headline.textContent = isCorrect ? 'Correct! No life lost.' : 'Not quite — you lost a life.';
      Object.assign(headline.style, {
        margin: '6px 0 8px',
        fontWeight: '800',
        fontSize: '18px',
        letterSpacing: '0.02em',
        color: isCorrect ? COLORS.correct : COLORS.wrong,
        textShadow: isCorrect
          ? '0 0 10px rgba(0,255,171,0.5)'
          : '0 0 10px rgba(255,84,112,0.5)',
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
        marginTop: '10px',
        padding: '11px 24px',
        fontSize: '16px',
        fontWeight: '800',
        letterSpacing: '0.04em',
        color: '#2a1800',
        background: `linear-gradient(180deg, ${COLORS.gold} 0%, ${COLORS.goldDeep} 100%)`,
        border: `2px solid ${COLORS.pumpkinDeep}`,
        borderRadius: '10px',
        boxShadow: '0 0 14px rgba(255,138,42,0.5), inset 0 1px 0 rgba(255,255,255,0.4)',
        touchAction: 'manipulation',
      });
      // Belt-and-suspenders touch activation for "Keep playing" (BUG 1): the
      // same direct pointer/touch path as the answer buttons, guarded against a
      // double-fire with the following click.
      let contHandledByPointer = false;
      const contActivate = (e) => {
        contHandledByPointer = true;
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this._continue();
      };
      if (typeof window !== 'undefined' && 'PointerEvent' in window) {
        cont.addEventListener('pointerdown', contActivate);
      } else {
        cont.addEventListener('touchstart', contActivate, { passive: false });
      }
      cont.addEventListener('click', (e) => {
        if (contHandledByPointer) { contHandledByPointer = false; return; }
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this._continue();
      });
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
    // The figure is a child of the panel, so removing the panel already detaches
    // it; drop the reference so a stale card can never be re-appended.
    this._imageFigure = null;
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
      padding: '13px 16px',
      fontSize: '17px',
      fontWeight: '700',
      color: COLORS.text,
      // Beveled "clue tile": a top-lit blue gradient with a gold base shadow.
      background: `linear-gradient(180deg, ${COLORS.tileBg} 0%, ${COLORS.tileBg2} 100%)`,
      border: `2px solid ${COLORS.tileBorder}`,
      borderRadius: '10px',
      textShadow: '0 1px 0 rgba(0,0,0,0.6)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -3px 0 rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.4)',
      transition: 'transform 0.08s ease, border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease',
    };
  }

  /**
   * Build the optional visual-aid card for a question, or return null when the
   * record carries no usable `image`. The card is a WHITE rounded box with a
   * drop shadow (so transparent-PNG diagrams read clearly on the dark panel),
   * holding a size-capped `<img>` and a tiny muted attribution caption below.
   *
   * Robustness contract (graceful fallback — .kiro/steering/tech.md):
   *   - A missing/empty `file` or `alt` yields no card (null).
   *   - `onerror` on the img hides the WHOLE card (image + caption), so a
   *     broken/missing file never shows a broken-image icon or blocks the quiz.
   *   - The card is decorative: `aria-hidden` on the wrapper, img not focusable
   *     (no tabindex), so focus management, the radiogroup, and keyboard flow
   *     are untouched; the `alt` still describes the diagram for AT that read it.
   *
   * @param {{image?: {file?: string, alt?: string, attribution?: string}}} question
   * @returns {HTMLElement|null}
   */
  _buildImageFigure(question) {
    if (!this.doc) return null;
    const img = question && question.image;
    const file = img && typeof img.file === 'string' ? img.file.trim() : '';
    const alt = img && typeof img.alt === 'string' ? img.alt.trim() : '';
    if (!file || !alt) return null;

    // Build the runtime URL the same way other public assets are referenced
    // (web-root-relative, no leading slash — Vite serves public/ at /).
    const src = `${QUESTION_IMAGE_BASE_PATH}${file}`;

    // Wrapper: not focusable, hidden from the a11y tree (the img's alt carries
    // the description); it is removed wholesale on `close()`.
    const figure = this.doc.createElement('figure');
    figure.setAttribute('aria-hidden', 'true');
    Object.assign(figure.style, {
      margin: '0 0 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    });

    // The visible WHITE card with rounded corners + drop shadow.
    const card = this.doc.createElement('div');
    Object.assign(card.style, {
      boxSizing: 'border-box',
      background: '#ffffff',
      borderRadius: '10px',
      padding: '10px',
      maxWidth: '320px',
      width: '100%',
      // Gilded frame + warm Halloween glow + depth shadow under the box.
      border: `2px solid ${COLORS.gold}`,
      boxShadow: '0 0 16px rgba(255,138,42,0.4), 0 8px 20px rgba(0,0,0,0.55)',
    });

    const el = this.doc.createElement('img');
    el.src = src;
    el.alt = alt;
    el.setAttribute('loading', 'eager');
    // Decorative: never a tab stop, never participates in focus/keyboard flow.
    el.tabIndex = -1;
    el.setAttribute('draggable', 'false');
    Object.assign(el.style, {
      display: 'block',
      width: '100%',
      height: 'auto',
      maxHeight: 'clamp(120px, 26vh, 240px)',
      objectFit: 'contain',
    });
    // Graceful failure: hide the WHOLE card (image + caption) on load error so a
    // missing/broken image never shows a broken-image icon or blocks the quiz.
    el.addEventListener('error', () => {
      try {
        figure.style.display = 'none';
      } catch {
        /* best-effort */
      }
    });
    card.appendChild(el);
    figure.appendChild(card);

    // Tiny, muted attribution caption (CC-BY / CC-BY-SA credit in-product).
    const attribution =
      img && typeof img.attribution === 'string' ? img.attribution.trim() : '';
    if (attribution) {
      const caption = this.doc.createElement('figcaption');
      caption.textContent = attribution;
      Object.assign(caption.style, {
        margin: '6px 0 0',
        fontSize: '10px',
        lineHeight: '1.3',
        color: COLORS.muted,
        opacity: '0.75',
        textAlign: 'center',
        maxWidth: '320px',
      });
      figure.appendChild(caption);
    }

    return figure;
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
      // Selected clue tile lights up: gold edge, brighter blue, a slight lift
      // and an outer gold glow — the "picked clue" feel from the board.
      btn.style.borderColor = on ? COLORS.gold : COLORS.tileBorder;
      btn.style.background = on
        ? `linear-gradient(180deg, ${COLORS.tileHover} 0%, ${COLORS.tileBg} 100%)`
        : `linear-gradient(180deg, ${COLORS.tileBg} 0%, ${COLORS.tileBg2} 100%)`;
      btn.style.transform = on ? 'translateY(-1px)' : 'translateY(0)';
      btn.style.boxShadow = on
        ? `inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 1px ${COLORS.gold}, 0 0 14px rgba(255,207,63,0.5), 0 3px 8px rgba(0,0,0,0.5)`
        : 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -3px 0 rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.4)';
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
