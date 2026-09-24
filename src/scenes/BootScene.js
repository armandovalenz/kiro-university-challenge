// BootScene — the first scene. Preloads all art + audio, wires up the
// framework-agnostic systems (Storage, AudioBus, QuestionBank), then hands off
// to SplashScene.
//
// Responsibilities (Task 4):
//   - Preload image assets (logo/hero/ui-kit as images; mascot + collectibles
//     sheets as spritesheets) and the mapped audio clips (Req 13.1, 13.2, 12.3,
//     12.7, 11.1).
//   - Track load failures via a loader error handler so later scenes can fall
//     back to drawn shapes/text or silent audio (Req 13.5, 12.6).
//   - Load + validate the bundled question bank via QuestionBank.load()
//     (Req 4.2, 4.9).
//   - Initialize Storage + AudioBus, then start SplashScene (Req 8.2).

import Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  TILE_SIZE,
  IMAGE_ASSETS,
  AUDIO_BASE_PATH,
  QUESTION_BANK_PATH,
} from '../config.js';
import Storage from '../systems/Storage.js';
import AudioBus from '../systems/AudioBus.js';
import QuestionBank from '../systems/QuestionBank.js';

/** Registry key under which the set of failed-to-load asset keys is stored. */
export const MISSING_ASSETS_KEY = 'missingAssets';

/**
 * Placeholder frame size for sprite sheets whose real frame geometry is not yet
 * wired. The collectibles sheet (`05_collectibles_and_math_icons.png`) still
 * uses this until its frame map is defined (entity tasks 8/14); a wrong frame
 * size only mis-slices frames, it does not error. The MASCOT sheet now loads
 * with its true geometry (IMAGE_ASSETS.mascotSheetFrame) so MathMan can render
 * the real art.
 */
const SHEET_FRAME = { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE };

/**
 * Audio load manifest: audio key → WAV file (relative to AUDIO_BASE_PATH),
 * derived from the design's Event → sound mapping. The same source file may be
 * loaded under several keys (e.g. `start.wav`); the full event→key routing and
 * crossfades live in AudioBus (Task 17).
 */
const AUDIO_ASSETS = [
  { key: 'music_title', file: 'start.wav' },
  { key: 'music_menu', file: 'start.wav' },
  { key: 'sfx_intro', file: 'start.wav' },
  { key: 'music_game_intro', file: 'siren0_firstloop.wav' },
  { key: 'music_game', file: 'siren0.wav' },
  { key: 'music_score', file: 'score.mp3' },
  { key: 'music_jeopardy', file: 'jeopardy.mp3' },
  { key: 'sfx_pellet_0', file: 'eat_dot_0.wav' },
  { key: 'sfx_pellet_1', file: 'eat_dot_1.wav' },
  { key: 'sfx_fruit_spawn', file: 'credit.wav' },
  { key: 'sfx_fruit', file: 'eat_fruit.wav' },
  { key: 'sfx_1up', file: 'extend.wav' },
  { key: 'sfx_caught', file: 'eat_ghost.wav' },
  { key: 'sfx_correct', file: 'intermission.wav' },
  { key: 'sfx_wrong', file: 'death_0.wav' },
  { key: 'sfx_death_0', file: 'death_0.wav' },
  { key: 'sfx_death_1', file: 'death_1.wav' },
  { key: 'sfx_level_clear', file: 'intermission.wav' },
  { key: 'music_gameover', file: 'death_1.wav' },
  { key: 'sfx_highscore', file: 'extend.wav' },
  { key: 'sfx_select', file: 'credit.wav' },
  { key: 'sfx_pause', file: 'credit.wav' },
];

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
    /** @type {Set<string>} keys of assets that failed to load. */
    this.missingAssets = new Set();
  }

  preload() {
    // Track any asset that fails to load so later scenes can fall back to
    // drawn shapes / silent audio (Req 13.5, 12.6).
    this.load.on('loaderror', (fileObj) => {
      if (fileObj && fileObj.key) this.missingAssets.add(fileObj.key);
    });

    // --- Images ---------------------------------------------------------------
    this.load.image(IMAGE_ASSETS.logo.key, IMAGE_ASSETS.logo.path);
    this.load.image(IMAGE_ASSETS.hero.key, IMAGE_ASSETS.hero.path);
    this.load.image(IMAGE_ASSETS.uiKit.key, IMAGE_ASSETS.uiKit.path);
    this.load.image(IMAGE_ASSETS.einsteinPoster.key, IMAGE_ASSETS.einsteinPoster.path);

    // --- Sprite sheets --------------------------------------------------------
    this.load.spritesheet(
      IMAGE_ASSETS.mascotSheet.key,
      IMAGE_ASSETS.mascotSheet.path,
      IMAGE_ASSETS.mascotSheetFrame,
    );
    this.load.spritesheet(
      IMAGE_ASSETS.collectibles.key,
      IMAGE_ASSETS.collectibles.path,
      SHEET_FRAME,
    );

    // --- Audio ----------------------------------------------------------------
    for (const { key, file } of AUDIO_ASSETS) {
      this.load.audio(key, `${AUDIO_BASE_PATH}${file}`);
    }

    // Simple loading text so the boot step is visible on slower connections.
    this._loadingText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Loading…', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffff00',
      })
      .setOrigin(0.5);
  }

  async create() {
    // Expose which assets are missing so later scenes can choose fallbacks.
    this.registry.set(MISSING_ASSETS_KEY, this.missingAssets);

    // Initialize persistence + audio. Storage and QuestionBank are class-based
    // (Tasks 2 & 12); we construct ONE instance of each here and stash it in the
    // registry so every later scene shares the same object. AudioBus stays a
    // singleton (Task 17 owns its full version) and is handed the Storage
    // INSTANCE so it can restore/persist the mute flag (Req 12.4).
    const storage = new Storage();
    storage.load();
    this.registry.set('storage', storage);

    AudioBus.init(this, storage);
    this.registry.set('audio', AudioBus);

    // Load + validate the question bank. Invalid records are dropped and a
    // built-in fallback set is used if the file fails entirely (Req 4.2, 4.9).
    const questionBank = new QuestionBank();
    try {
      if (this._loadingText) this._loadingText.setText('Loading questions…');
      // load() resolves to a boolean (true = JSON bank, false = fallback set)
      // and never rejects, but guard anyway so boot can never wedge.
      await questionBank.load({ path: QUESTION_BANK_PATH });
    } catch {
      // Defensive: ensure a usable fallback set even on an unexpected rejection.
      await questionBank.load({ fetchImpl: () => Promise.reject(new Error('boot')) });
    }
    this.registry.set('questionBank', questionBank);
    this.registry.set('questionCount', questionBank.size);

    this._advance();
  }

  /**
   * Transition to SplashScene. SplashScene is added in Task 5; until then this
   * guards the transition so booting never throws — it only starts the next
   * scene when that scene key is actually registered.
   */
  _advance() {
    const nextKey = 'SplashScene';
    if (this.scene.manager.keys[nextKey]) {
      this.scene.start(nextKey);
      return;
    }
    // SplashScene not registered yet: show a placeholder so the boot pipeline
    // is verifiable on its own.
    if (this._loadingText) {
      this._loadingText.setText('Boot complete.\nSplashScene not yet registered.');
      this._loadingText.setAlign('center');
    }
  }
}
