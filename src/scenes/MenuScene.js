// MenuScene — the start menu (Task 6).
//
// Responsibilities:
//   - Show the Math Man logo (`02_logo.png`) over a drawn blueprint background
//     (deep blue + technical grid; see `_buildBackground`), a Play button, a
//     5/6/7 grade selector, and the current high score from Storage (Req 7.3,
//     10.1, 11.2, 13.3).
//   - Default the grade selection to the persisted `lastDifficulty` (or the
//     DEFAULT_GRADE), and persist changes via `storage.setDifficulty` (Req 10.2,
//     10.5).
//   - Start a game by handing the chosen grade to GameScene (Req 7.4).
//   - Style controls with UI-kit cues (`06_ui_kit.png`) where practical (Req
//     13.3) and fall back to drawn shapes/text whenever art is missing (Req
//     13.5).
//
// GameScene is built in Task 9. Until it is registered this scene guards the
// transition (mirroring BootScene/SplashScene): it only starts GameScene when
// that key exists, otherwise it shows a placeholder so build/run never throws.

import Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  IMAGE_ASSETS,
  GRADES,
  DEFAULT_GRADE,
  DEFAULT_RENDER_MODE,
  BLUEPRINT,
} from '../config.js';
import { MISSING_ASSETS_KEY } from './BootScene.js';
import { AudioEvent } from '../systems/AudioBus.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
    /** @type {number} currently selected grade. */
    this._grade = DEFAULT_GRADE;
    /** @type {'2d'|'3d'} currently selected render mode (Req 6.1–6.3). */
    this._renderMode = DEFAULT_RENDER_MODE;
    /** Guard so we only start a game once. */
    this._started = false;
    /** @type {Phaser.GameObjects.Text[]} grade selector buttons. */
    this._gradeButtons = [];
    /** @type {Phaser.GameObjects.Text[]} render-mode toggle buttons. */
    this._renderModeButtons = [];
  }

  create() {
    this.cameras.main.setBackgroundColor('#000000');

    const cx = GAME_WIDTH / 2;

    // Shared references pulled from the registry (populated by BootScene).
    this._missing = this.registry.get(MISSING_ASSETS_KEY) || new Set();
    this._storage = this.registry.get('storage') || null;
    this._audio = this.registry.get('audio') || null;

    // Restore the persisted grade (or default) so it preselects (Req 10.2, 10.5).
    this._grade = this._loadPersistedGrade();
    // Restore the persisted render mode (or default '2d') so it preselects
    // (Req 6.3, 6.6). Unavailable/invalid storage → '2d'.
    this._renderMode = this._loadPersistedRenderMode();

    this._buildBackground();
    this._buildLogo(cx, GAME_HEIGHT * 0.16);
    this._buildGradeSelector(cx, GAME_HEIGHT * 0.46);
    this._buildRenderModeToggle(cx, GAME_HEIGHT * 0.63);
    this._buildPlayButton(cx, GAME_HEIGHT * 0.78);
    this._buildHighScore(cx, GAME_HEIGHT - 48);
    this._buildHint(cx, GAME_HEIGHT - 20);

    this._bindInput();

    // Start the menu music (Req 12.1). Silent no-op if the asset is missing.
    if (this._audio && typeof this._audio.play === 'function') {
      this._audio.play(AudioEvent.MENU);
    }
  }

  // --- Persistence -----------------------------------------------------------

  /**
   * Read the persisted difficulty, falling back to DEFAULT_GRADE when storage
   * is unavailable or the value is invalid (Req 10.2, 10.5).
   * @returns {number}
   */
  _loadPersistedGrade() {
    if (this._storage && typeof this._storage.get === 'function') {
      try {
        const { lastDifficulty } = this._storage.get();
        if (GRADES.includes(lastDifficulty)) return lastDifficulty;
      } catch {
        /* fall through to default */
      }
    }
    return DEFAULT_GRADE;
  }

  /**
   * Read the persisted render mode, falling back to DEFAULT_RENDER_MODE ('2d')
   * when storage is unavailable or the value is invalid (Req 6.3, 6.6).
   * @returns {'2d'|'3d'}
   */
  _loadPersistedRenderMode() {
    if (this._storage && typeof this._storage.get === 'function') {
      try {
        const { renderMode } = this._storage.get();
        if (renderMode === '2d' || renderMode === '3d') return renderMode;
      } catch {
        /* fall through to default */
      }
    }
    return DEFAULT_RENDER_MODE;
  }

  // --- Layout builders -------------------------------------------------------

  /**
   * Draw a "blueprint" background: a deep blue base with a lighter-blue technical
   * grid drawn on top (brighter lines every few cells). This replaces the dimmed
   * hero photo with a clean, on-theme, high-contrast backdrop that keeps the
   * foreground text/buttons readable (Req 11.2, 9.2). Purely drawn, so it needs
   * no art asset and can never fail to load (Req 13.5).
   */
  _buildBackground() {
    // Base fill (a subtle two-tone: darker at the very top, blueprint navy below).
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, BLUEPRINT.base);
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT * 0.25, GAME_WIDTH, GAME_HEIGHT * 0.5, BLUEPRINT.baseTop)
      .setOrigin(0.5)
      .setAlpha(0.5);

    // Grid lines drawn with a single Graphics object (cheap; one draw call).
    const g = this.add.graphics();
    const { cell, boldEvery, grid, gridBold } = BLUEPRINT;

    // Vertical lines.
    let col = 0;
    for (let x = 0; x <= GAME_WIDTH; x += cell, col += 1) {
      const bold = col % boldEvery === 0;
      g.lineStyle(bold ? 1.5 : 1, bold ? gridBold : grid, bold ? 0.5 : 0.28);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, GAME_HEIGHT);
      g.strokePath();
    }

    // Horizontal lines.
    let row = 0;
    for (let y = 0; y <= GAME_HEIGHT; y += cell, row += 1) {
      const bold = row % boldEvery === 0;
      g.lineStyle(bold ? 1.5 : 1, bold ? gridBold : grid, bold ? 0.5 : 0.28);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(GAME_WIDTH, y);
      g.strokePath();
    }

    // A soft vignette so the edges recede and the centered content pops.
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000010)
      .setAlpha(0.15);
  }

  /**
   * Show the logo, or a styled text title if the logo failed to load
   * (Req 11.2, 13.5).
   */
  _buildLogo(cx, cy) {
    if (this._assetAvailable(IMAGE_ASSETS.logo.key)) {
      const logo = this.add.image(cx, cy, IMAGE_ASSETS.logo.key).setOrigin(0.5);
      const maxW = GAME_WIDTH * 0.7;
      const maxH = GAME_HEIGHT * 0.28;
      const scale = Math.min(1, maxW / logo.width, maxH / logo.height);
      logo.setScale(scale);
    } else {
      this.add
        .text(cx, cy, 'MATH MAN', {
          fontFamily: 'monospace',
          fontSize: '64px',
          fontStyle: 'bold',
          color: '#ffff00',
          stroke: '#0033ff',
          strokeThickness: 8,
          align: 'center',
        })
        .setOrigin(0.5);
    }
  }

  /**
   * Build the 5/6/7 grade selector. Buttons are drawn with UI-kit-styled text
   * chips; the selected grade is highlighted. Clicking one persists the choice
   * and plays the selection cue (Req 10.1, 10.5, 12.2, 13.3).
   */
  _buildGradeSelector(cx, cy) {
    this.add
      .text(cx, cy - 44, 'SELECT GRADE', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const spacing = 110;
    const startX = cx - spacing;
    this._gradeButtons = GRADES.map((grade, i) => {
      const x = startX + i * spacing;
      const label = this.add
        .text(x, cy, `${grade}th`, {
          fontFamily: 'monospace',
          fontSize: '28px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#1b1b3a',
          padding: { x: 18, y: 10 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      label.on('pointerover', () => {
        if (grade !== this._grade) label.setColor('#ffff88');
      });
      label.on('pointerout', () => this._refreshGradeButtons());
      label.on('pointerdown', () => this._selectGrade(grade));

      // Stash the grade on the object for keyboard cycling / refresh.
      label.setData('grade', grade);
      return label;
    });

    this._refreshGradeButtons();
  }

  /**
   * Build the 2D / 3D Render_Mode toggle (Req 6.1, 6.2, 6.3). Styled to match
   * the grade selector: two clickable chips, the selected one highlighted, with
   * keyboard access (T toggles, and ←/→ also cycle when appropriate). The choice
   * is persisted via `storage.setRenderMode` and preselected from storage. FP3D
   * mode is strictly opt-in — the default chip is "2D".
   */
  _buildRenderModeToggle(cx, cy) {
    this.add
      .text(cx, cy - 40, 'RENDER MODE', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const modes = [
      { mode: '2d', label: '2D' },
      { mode: '3d', label: '3D (first-person)' },
    ];
    const spacing = 170;
    const startX = cx - spacing / 2;
    this._renderModeButtons = modes.map((m, i) => {
      const x = startX + i * spacing;
      const label = this.add
        .text(x, cy, m.label, {
          fontFamily: 'monospace',
          fontSize: '22px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#1b1b3a',
          padding: { x: 14, y: 8 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      label.on('pointerover', () => {
        if (m.mode !== this._renderMode) label.setColor('#ffff88');
      });
      label.on('pointerout', () => this._refreshRenderModeButtons());
      label.on('pointerdown', () => this._selectRenderMode(m.mode));

      label.setData('mode', m.mode);
      return label;
    });

    this._refreshRenderModeButtons();
  }

  /**
   * Build the Play button styled with UI-kit cues; falls back to a drawn chip.
   * (Req 7.3, 7.4, 13.3, 13.5)
   */
  _buildPlayButton(cx, cy) {
    const button = this.add
      .text(cx, cy, '▶  PLAY', {
        fontFamily: 'monospace',
        fontSize: '36px',
        fontStyle: 'bold',
        color: '#ffff00',
        backgroundColor: '#003366',
        padding: { x: 36, y: 16 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on('pointerover', () => button.setColor('#ffffff'));
    button.on('pointerout', () => button.setColor('#ffff00'));
    button.on('pointerdown', () => this._startGame());

    // Gentle pulse to draw the eye.
    this.tweens.add({
      targets: button,
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    this._playButton = button;
  }

  /** Show the current high score read from Storage (Req 7.3). */
  _buildHighScore(cx, cy) {
    let highScore = 0;
    if (this._storage && typeof this._storage.get === 'function') {
      try {
        highScore = this._storage.get().highScore || 0;
      } catch {
        highScore = 0;
      }
    }
    this.add
      .text(cx, cy, `HIGH SCORE: ${highScore}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#00ffff',
      })
      .setOrigin(0.5);
  }

  _buildHint(cx, cy) {
    this.add
      .text(cx, cy, 'Arrows/1-3: grade · T: 2D/3D · Enter/Space: play · M: mute', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
  }

  // --- Input -----------------------------------------------------------------

  _bindInput() {
    const kb = this.input.keyboard;
    if (!kb) return;

    // Left/right (and A/D) cycle the grade selection.
    kb.on('keydown-LEFT', () => this._cycleGrade(-1));
    kb.on('keydown-A', () => this._cycleGrade(-1));
    kb.on('keydown-RIGHT', () => this._cycleGrade(1));
    kb.on('keydown-D', () => this._cycleGrade(1));

    // Number keys pick a grade directly (1 → 5th, 2 → 6th, 3 → 7th).
    kb.on('keydown-ONE', () => this._selectGrade(GRADES[0]));
    kb.on('keydown-TWO', () => this._selectGrade(GRADES[1]));
    kb.on('keydown-THREE', () => this._selectGrade(GRADES[2]));

    // Toggle the 2D/3D render mode (Req 6.1, 6.2).
    kb.on('keydown-T', () => this._toggleRenderMode());

    // Confirm / start.
    kb.on('keydown-ENTER', () => this._startGame());
    kb.on('keydown-SPACE', () => this._startGame());

    // Mute toggle (Req 12.4) — AudioBus binds this itself; harmless if absent.
    if (this._audio && typeof this._audio.bindMuteKey === 'function') {
      this._audio.bindMuteKey(this);
    }
  }

  /** Move the grade selection by `delta` positions within GRADES. */
  _cycleGrade(delta) {
    const i = GRADES.indexOf(this._grade);
    const base = i === -1 ? 0 : i;
    const next = (base + delta + GRADES.length) % GRADES.length;
    this._selectGrade(GRADES[next]);
  }

  /**
   * Select a grade, persist it, refresh the UI, and play the selection cue.
   * No-op (beyond a refresh) if the grade is unchanged (Req 10.5, 12.2).
   * @param {number} grade
   */
  _selectGrade(grade) {
    if (!GRADES.includes(grade)) return;
    const changed = grade !== this._grade;
    this._grade = grade;

    if (changed && this._storage && typeof this._storage.setDifficulty === 'function') {
      try {
        this._storage.setDifficulty(grade);
      } catch {
        /* persistence is best-effort; never crash the menu */
      }
    }

    if (changed && this._audio && typeof this._audio.play === 'function') {
      this._audio.play(AudioEvent.MENU_SELECT);
    }

    this._refreshGradeButtons();
  }

  /** Highlight the selected grade button and reset the others. */
  _refreshGradeButtons() {
    for (const button of this._gradeButtons) {
      const selected = button.getData('grade') === this._grade;
      button.setColor(selected ? '#000000' : '#ffffff');
      button.setBackgroundColor(selected ? '#ffff00' : '#1b1b3a');
    }
  }

  /**
   * Select a render mode, persist it, refresh the UI, and play the selection
   * cue. No-op (beyond a refresh) if unchanged (Req 6.2, 6.3, 6.6).
   * @param {'2d'|'3d'} mode
   */
  _selectRenderMode(mode) {
    if (mode !== '2d' && mode !== '3d') return;
    const changed = mode !== this._renderMode;
    this._renderMode = mode;

    if (changed && this._storage && typeof this._storage.setRenderMode === 'function') {
      try {
        this._storage.setRenderMode(mode);
      } catch {
        /* persistence is best-effort; never crash the menu */
      }
    }

    if (changed && this._audio && typeof this._audio.play === 'function') {
      this._audio.play(AudioEvent.MENU_SELECT);
    }

    this._refreshRenderModeButtons();
  }

  /** Flip between the two render modes (keyboard T). */
  _toggleRenderMode() {
    this._selectRenderMode(this._renderMode === '3d' ? '2d' : '3d');
  }

  /** Highlight the selected render-mode chip and reset the other. */
  _refreshRenderModeButtons() {
    for (const button of this._renderModeButtons) {
      const selected = button.getData('mode') === this._renderMode;
      button.setColor(selected ? '#000000' : '#ffffff');
      button.setBackgroundColor(selected ? '#00ffcc' : '#1b1b3a');
    }
  }

  // --- Transition ------------------------------------------------------------

  /**
   * Start a game, passing the chosen grade to the render mode's scene (Req 6.2,
   * 6.3, 7.4). When the selected render mode is '3d' this launches `FP3DScene`;
   * otherwise it launches the 2D `GameScene`. Both launches are guarded the same
   * way (only start when the scene is registered) so a missing scene shows a
   * placeholder instead of throwing — mirroring BootScene/SplashScene.
   */
  _startGame() {
    if (this._started) return;
    this._started = true;

    if (this._audio && typeof this._audio.play === 'function') {
      this._audio.play(AudioEvent.MENU_SELECT);
    }

    // Pick the scene by render mode. FP3D is opt-in; if its scene ever fails to
    // obtain a WebGL context it falls back to GameScene itself (Task 16 wiring
    // in FP3DScene), so the menu simply honors the persisted choice here.
    const nextKey = this._renderMode === '3d' ? 'FP3DScene' : 'GameScene';
    if (this.scene.manager.keys[nextKey]) {
      this.scene.start(nextKey, { grade: this._grade });
      return;
    }

    // Selected scene not registered: show a placeholder so the menu flow is
    // verifiable on its own (Req 13.5 spirit — never throw).
    this._started = false; // allow retry once the scene lands
    this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT * 0.88,
        `${nextKey} not registered.\nWould start at grade ${this._grade} in ${this._renderMode.toUpperCase()} mode.`,
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#ff8888',
          align: 'center',
        },
      )
      .setOrigin(0.5);
  }

  // --- Helpers ---------------------------------------------------------------

  /**
   * Whether an image asset is usable: the texture exists AND it was not flagged
   * as failed in the BootScene missing-assets set (Req 13.5).
   * @param {string} key
   * @returns {boolean}
   */
  _assetAvailable(key) {
    return this.textures.exists(key) && !(this._missing && this._missing.has(key));
  }
}
