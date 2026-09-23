// AudioBus — the game's single audio entry point over the Phaser Sound Manager.
//
// This file has two clearly separated halves:
//
//   1. A PURE, Phaser-free layer — the `AudioEvent` constants and the
//      `EVENT_SOUND` map (plus `resolveSound` / `MINIMUM_EVENT_SET`). This
//      layer imports NO Phaser and is fully unit/property testable on its own
//      (Task 18 property-tests Property 20 event→sound totality against it).
//
//   2. The `AudioBus` singleton — a thin playback wrapper that resolves an
//      event to its sound entry and drives Phaser's sound manager (music
//      crossfades, alternating/sequenced SFX, autoplay-unlock deferral, and
//      mute). It touches Phaser only through the `scene` handed to `init()`, so
//      it can still be exercised in tests with a stub/null scene (Property 21
//      mute persistence, Property 22 missing-asset no-op).
//
// Audio is mixed on TWO fixed-volume channels under a single global mute:
//   - music plays at `MUSIC_VOLUME` (0.45),
//   - one-shot effects play at `SFX_VOLUME` (0.9).
// The `M` key mutes both channels together (Phaser `sound.mute` is global);
// there is no per-channel mute.
//
// The public surface used by BootScene (`init`, `setMuted`, `isMuted`, `sfx`,
// `music`, `stopMusic`) is preserved; everything else is additive.
//
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 9.4
// Properties:
//   Property 20 — the event→sound map is total over the minimum event set.
//   Property 21 — mute persists, restores on init, and never touches gameplay.
//   Property 22 — a cue whose asset failed to load is a silent no-op.

// =============================================================================
// PURE LAYER — no Phaser. Safe to import in tests without a runtime.
// =============================================================================

/** Whether a cue is background music or a one-shot sound effect. */
export const AudioType = Object.freeze({
  MUSIC: 'music',
  SFX: 'sfx',
});

/**
 * Stable, engine-agnostic event names. Scenes trigger cues by event
 * (`AudioBus.play(AudioEvent.PELLET)`) rather than by raw audio key, so the
 * key routing lives in exactly one place (the `EVENT_SOUND` map below).
 */
export const AudioEvent = Object.freeze({
  TITLE: 'title', // splash / title shown (Req 12.1)
  MENU: 'menu', // menu shown (Req 12.1)
  GAME_START: 'gameStart', // game start / intro jingle (Req 12.2)
  GAME_MUSIC: 'gameMusic', // gameplay running loop (Req 12.1, 12.8)
  QUIZ_MUSIC: 'quizMusic', // quiz-thinking loop while a question is on screen
  PELLET: 'pellet', // pellet eaten (Req 12.2)
  FRUIT_SPAWN: 'fruitSpawn', // fruit spawned (Req 12.2)
  FRUIT_COLLECT: 'fruitCollect', // fruit collected / bonus (Req 12.2)
  EXTRA_LIFE: 'extraLife', // extra life gained / 1-up (Req 12.2)
  CAUGHT: 'caught', // Einstein catches Math Man (Req 12.2)
  CORRECT: 'correct', // quiz answered correctly (Req 12.2)
  WRONG: 'wrong', // quiz answered incorrectly (Req 12.2)
  LIFE_LOST: 'lifeLost', // life lost (Req 12.2)
  LEVEL_CLEAR: 'levelClear', // level cleared (Req 12.2)
  GAME_OVER: 'gameOver', // game over (Req 12.1, 12.2)
  HIGH_SCORE: 'highScore', // new high score (Req 12.2)
  MENU_SELECT: 'menuSelect', // menu navigation / selection (Req 12.2)
  PAUSE: 'pause', // pause / unpause (Req 12.2)
});

/**
 * The minimum set of events that MUST resolve to a sound (Req 12.1 music
 * states + the Req 12.2 event list). Property 20 asserts the `EVENT_SOUND` map
 * is total over this list. It is simply every declared `AudioEvent`.
 * @type {ReadonlyArray<string>}
 */
export const MINIMUM_EVENT_SET = Object.freeze(Object.values(AudioEvent));

/**
 * The event → sound routing table (Req 12.2). This is PURE DATA: each entry
 * names its playback `type`, the ordered `keys` (Phaser audio keys loaded in
 * BootScene), whether music should `loop`, and an optional multi-key `mode`:
 *
 *   - `alternate` — cycle through keys on successive plays (pellet chomp).
 *   - `sequence`  — play the keys back-to-back as one cue (death jingle).
 *   - (music with 2 keys) — first key is a one-shot lead-in, the last key is
 *     the seamless loop body (Pac-Man siren authored as intro + loop).
 *
 * Keeping this a plain object (not baked into playback code) is what lets Task
 * 18 property-test totality without a Phaser runtime.
 *
 * @type {Readonly<Record<string, {type: string, keys: string[], loop?: boolean, mode?: 'alternate'|'sequence'}>>}
 */
export const EVENT_SOUND = Object.freeze({
  // TITLE / MENU / GAME_MUSIC all route to the SAME looped score track so the
  // intro, menu, and gameplay share one continuous piece of music (see the
  // "same track already playing" guard in `_startMusic`, which keeps it
  // seamless across the Splash → Menu → Game transitions).
  [AudioEvent.TITLE]: { type: AudioType.MUSIC, keys: ['music_score'], loop: true },
  [AudioEvent.MENU]: { type: AudioType.MUSIC, keys: ['music_score'], loop: true },
  [AudioEvent.GAME_START]: { type: AudioType.SFX, keys: ['sfx_intro'] },
  [AudioEvent.GAME_MUSIC]: {
    // Gameplay background music: score.mp3, looped.
    type: AudioType.MUSIC,
    keys: ['music_score'],
    loop: true,
  },
  [AudioEvent.QUIZ_MUSIC]: {
    // Quiz-thinking music: jeopardy.mp3, looped. Replaces the score while a
    // question is on screen and is exempt from overlay ducking (full volume).
    type: AudioType.MUSIC,
    keys: ['music_jeopardy'],
    loop: true,
  },
  [AudioEvent.PELLET]: {
    type: AudioType.SFX,
    keys: ['sfx_pellet_0', 'sfx_pellet_1'],
    mode: 'alternate',
  },
  [AudioEvent.FRUIT_SPAWN]: { type: AudioType.SFX, keys: ['sfx_fruit_spawn'] },
  [AudioEvent.FRUIT_COLLECT]: { type: AudioType.SFX, keys: ['sfx_fruit'] },
  [AudioEvent.EXTRA_LIFE]: { type: AudioType.SFX, keys: ['sfx_1up'] },
  [AudioEvent.CAUGHT]: { type: AudioType.SFX, keys: ['sfx_caught'] },
  [AudioEvent.CORRECT]: { type: AudioType.SFX, keys: ['sfx_correct'] },
  [AudioEvent.WRONG]: { type: AudioType.SFX, keys: ['sfx_wrong'] },
  [AudioEvent.LIFE_LOST]: {
    type: AudioType.SFX,
    keys: ['sfx_death_0', 'sfx_death_1'],
    mode: 'sequence',
  },
  [AudioEvent.LEVEL_CLEAR]: { type: AudioType.SFX, keys: ['sfx_level_clear'] },
  [AudioEvent.GAME_OVER]: { type: AudioType.MUSIC, keys: ['music_gameover'], loop: false },
  [AudioEvent.HIGH_SCORE]: { type: AudioType.SFX, keys: ['sfx_highscore'] },
  [AudioEvent.MENU_SELECT]: { type: AudioType.SFX, keys: ['sfx_select'] },
  [AudioEvent.PAUSE]: { type: AudioType.SFX, keys: ['sfx_pause'] },
});

/**
 * Resolve an event to its sound entry (pure). Returns `null` for unknown
 * events. Over `MINIMUM_EVENT_SET` this never returns null and every entry has
 * at least one key — that totality is Property 20.
 * @param {string} event one of `AudioEvent`.
 * @returns {{type: string, keys: string[], loop?: boolean, mode?: string}|null}
 */
export function resolveSound(event) {
  return Object.prototype.hasOwnProperty.call(EVENT_SOUND, event)
    ? EVENT_SOUND[event]
    : null;
}

// =============================================================================
// PLAYBACK LAYER — the AudioBus singleton (touches Phaser only via `scene`).
//
// Two fixed-volume channels under a shared global mute: music at `MUSIC_VOLUME`
// and one-shot effects at `SFX_VOLUME`. These are independent volumes, but a
// single `sound.mute` (the `M` key) silences both together.
// =============================================================================

/** Fixed music-channel volume. */
const MUSIC_VOLUME = 0.45;
/** Fixed sfx-channel volume. */
const SFX_VOLUME = 0.9;
/** Fraction of `MUSIC_VOLUME` the music ducks to while an overlay is open. */
const DUCK_FACTOR = 0.1;
/** Duck / unduck fade duration (ms). */
const DUCK_FADE_MS = 450;

/**
 * Robustly set a Phaser sound's volume, tolerating stub sounds and older APIs.
 * @param {any} sound
 * @param {number} v
 */
function setVolume(sound, v) {
  if (!sound) return;
  try {
    if (typeof sound.setVolume === 'function') sound.setVolume(v);
    else sound.volume = v;
  } catch {
    /* ignore */
  }
}

export const AudioBus = {
  /** @type {Phaser.Scene | null} the scene providing `sound`/`cache`/`input`. */
  _scene: null,
  /** @type {import('./Storage.js').default | null} for mute persistence. */
  _storage: null,
  /** @type {Phaser.Sound.BaseSound | null} currently playing music track. */
  _music: null,
  /** @type {string | null} the audio key of the current music track. */
  _musicKey: null,
  /** @type {boolean} whether music is currently ducked for an open overlay. */
  _ducked: false,
  /**
   * @type {boolean} whether the current music track is exempt from overlay
   * ducking (the quiz-thinking track plays at full music volume even while the
   * quiz overlay is "ducking" the score).
   */
  _noDuckMusic: false,
  /** @type {boolean} */
  _muted: false,
  /** @type {Record<string, number>} per-event index for `alternate` SFX. */
  _alt: Object.create(null),
  /** @type {(() => void) | null} deferred playback awaiting the autoplay unlock. */
  _pending: null,
  /** @type {boolean} whether an unlock listener is currently armed. */
  _unlockArmed: false,

  /**
   * Bind the Phaser sound manager and restore the persisted mute state.
   * Tolerates a null/stub scene (used by tests) — playback simply no-ops.
   * @param {Phaser.Scene} scene any active scene (provides `scene.sound`).
   * @param {object} [storage] the Storage instance (for mute persistence).
   * @returns {AudioBus}
   */
  init(scene, storage = null) {
    this._scene = scene || null;
    this._storage = storage;
    this._music = null;
    this._musicKey = null;
    this._ducked = false;
    this._noDuckMusic = false;
    this._alt = Object.create(null);
    this._pending = null;
    this._unlockArmed = false;

    // Restore persisted mute (Req 12.4). Property 21: it is reapplied on init.
    let muted = false;
    if (storage && typeof storage.load === 'function') {
      try {
        muted = !!storage.load().audioMuted;
      } catch {
        muted = false;
      }
    }
    this.setMuted(muted, { persist: false });
    return this;
  },

  // --- Mute ------------------------------------------------------------------

  /** @returns {boolean} whether audio is currently muted. */
  isMuted() {
    return this._muted;
  },

  /**
   * Set global mute on the Phaser sound manager and persist it (Req 12.4).
   * Muting only touches the audio layer — never score, lives, level, or timing
   * (Req 12.5, Property 21).
   * @param {boolean} value
   * @param {{persist?: boolean}} [opts] internal: skip persistence on restore.
   * @returns {boolean} the effective mute state.
   */
  setMuted(value, { persist = true } = {}) {
    this._muted = !!value;
    if (this._hasScene()) {
      try {
        this._scene.sound.mute = this._muted;
      } catch {
        /* ignore sound-manager quirks */
      }
    }
    if (persist && this._storage && typeof this._storage.save === 'function') {
      try {
        this._storage.save({ audioMuted: this._muted });
      } catch {
        /* persistence is best-effort; never crash gameplay */
      }
    }
    return this._muted;
  },

  /**
   * Flip the mute state and persist it. Handy for the `M` key.
   * @returns {boolean} the new mute state.
   */
  toggleMute() {
    return this.setMuted(!this._muted);
  },

  /**
   * Bind the `M` key on a scene to toggle mute (Req 12.4). Does not assume any
   * particular scene exists; any scene with keyboard input can call this.
   * @param {Phaser.Scene} scene a scene with `input.keyboard`.
   * @returns {() => void} an unbind function.
   */
  bindMuteKey(scene) {
    const kb = scene && scene.input && scene.input.keyboard;
    if (!kb || typeof kb.on !== 'function') return () => {};
    const handler = () => this.toggleMute();
    kb.on('keydown-M', handler);
    return () => {
      try {
        kb.off('keydown-M', handler);
      } catch {
        /* ignore */
      }
    };
  },

  // --- Event-driven playback (preferred entry point for scenes) --------------

  /**
   * Play the cue mapped to an event (Req 12.1, 12.2). Music events crossfade /
   * lead-in; SFX events honor `alternate`/`sequence` modes. Unknown events and
   * missing assets are silent no-ops (Req 12.6, Property 22).
   * @param {string} event one of `AudioEvent`.
   */
  play(event) {
    const entry = resolveSound(event);
    if (!entry) return;
    if (entry.type === AudioType.MUSIC) {
      if (!this._hasScene()) return;
      this._deferUntilUnlocked(() => this._playMusicEntry(entry));
    } else {
      this._playSfxEntry(entry, event);
    }
  },

  // --- Low-level API (stable; used by BootScene and callers with raw keys) ---

  /**
   * Play a one-shot sound effect by raw key. No-op when muted or when the key
   * is missing (Req 12.5, 12.6).
   * @param {string} key a loaded audio key.
   */
  sfx(key) {
    if (this._muted || !this._hasScene()) return;
    if (!this._hasAudio(key)) return; // missing asset → silent (Property 22)
    try {
      this._scene.sound.play(key, { volume: SFX_VOLUME });
    } catch {
      /* silent no-op on playback error */
    }
  },

  /**
   * Crossfade to a (optionally looping) music track by raw key. Deferred until
   * the autoplay unlock if the sound manager is still locked (Req 12.6).
   * @param {string} key a loaded audio key.
   * @param {{loop?: boolean}} [opts]
   */
  music(key, { loop = true } = {}) {
    if (!this._hasScene() || !this._hasAudio(key)) return; // missing → silent
    this._deferUntilUnlocked(() => this._startMusic(key, !!loop));
  },

  /** Stop and release the current music track (and any crossfade tweens). */
  stopMusic() {
    if (this._music) {
      this._killTweens(this._music);
      try {
        this._music.stop();
        this._music.destroy();
      } catch {
        /* ignore */
      }
      this._music = null;
      this._musicKey = null;
      this._noDuckMusic = false;
    }
  },

  // --- Music ducking (overlays) ----------------------------------------------

  /**
   * Duck the music to a low background level while an overlay (quiz, lesson,
   * pause) is open (Req 12.7). Independent of mute; a no-op with no scene or no
   * current track, but the ducked state is remembered so a track (re)started
   * later starts ducked.
   */
  duckMusic() {
    this._setDucked(true);
  },

  /** Restore the music to full channel volume when the overlay closes. */
  unduckMusic() {
    this._setDucked(false);
  },

  /** @private @returns {number} the target music volume for the current duck state. */
  _duckLevel() {
    // A track flagged `_noDuckMusic` (the quiz-thinking loop) always plays at
    // full music volume, ignoring the overlay duck state.
    return this._ducked && !this._noDuckMusic ? MUSIC_VOLUME * DUCK_FACTOR : MUSIC_VOLUME;
  },

  /**
   * @private Remember the duck state and, if music is playing, smoothly fade the
   * current track to the matching level. Reuses `_killTweens` so rapid
   * open/close cycles do not stack tweens. Safe when there is no scene or no
   * current music (the state is simply remembered).
   * @param {boolean} ducked
   */
  _setDucked(ducked) {
    this._ducked = !!ducked;
    if (!this._music || !this._hasScene()) return;

    const target = this._duckLevel();
    this._killTweens(this._music);

    const music = this._music;
    // Establish the final volume DETERMINISTICALLY now — do not rely on the
    // fade tween's interpolation to land it (streaming MP3s do not reliably
    // honor a tweened `volume`). The tween below is then only a cosmetic ramp.
    setVolume(music, target);

    const tweens = this._scene && this._scene.tweens;
    if (tweens && typeof tweens.add === 'function') {
      tweens.add({
        targets: music,
        volume: target,
        duration: DUCK_FADE_MS,
        onComplete: () => setVolume(music, target),
      });
    }
  },

  // --- Internals -------------------------------------------------------------

  /** @private @returns {boolean} whether a usable Phaser sound manager exists. */
  _hasScene() {
    return !!(this._scene && this._scene.sound);
  },

  /**
   * @private Whether an audio key decoded successfully. A missing/failed asset
   * returns false so the cue becomes a silent no-op (Req 12.6, Property 22).
   * @param {string} key
   * @returns {boolean}
   */
  _hasAudio(key) {
    try {
      return !!(
        this._scene &&
        this._scene.cache &&
        this._scene.cache.audio &&
        this._scene.cache.audio.exists(key)
      );
    } catch {
      return false;
    }
  },

  /**
   * @private Run `fn` now, or defer it until the sound manager unlocks after
   * the first user gesture (autoplay policy, Req 12.6). Only the latest pending
   * action is kept — the current music intent supersedes any earlier one.
   * @param {() => void} fn
   */
  _deferUntilUnlocked(fn) {
    if (!this._hasScene()) return;
    if (this._scene.sound.locked) {
      this._pending = fn;
      this._armUnlock();
      return;
    }
    fn();
  },

  /** @private Arm one-shot listeners that flush the pending action on unlock. */
  _armUnlock() {
    if (this._unlockArmed || !this._hasScene()) return;
    this._unlockArmed = true;
    const run = () => {
      this._unlockArmed = false;
      const fn = this._pending;
      this._pending = null;
      if (fn) {
        try {
          fn();
        } catch {
          /* never let a deferred cue crash the game */
        }
      }
    };
    try {
      this._scene.sound.once('unlocked', run);
    } catch {
      /* ignore */
    }
    // Fallback: the first gesture leaving Splash also flushes the queue.
    const input = this._scene.input;
    if (input && typeof input.once === 'function') {
      try {
        input.once('pointerdown', run);
      } catch {
        /* ignore */
      }
      if (input.keyboard && typeof input.keyboard.once === 'function') {
        try {
          input.keyboard.once('keydown', run);
        } catch {
          /* ignore */
        }
      }
    }
  },

  /**
   * @private Play a music entry: single track, or an intro lead-in that hands
   * off to a looping body once it completes.
   * @param {{keys: string[], loop?: boolean}} entry
   */
  _playMusicEntry(entry) {
    const keys = entry.keys.filter((k) => this._hasAudio(k));
    if (!keys.length) return; // every key missing → silent (Property 22)
    if (keys.length === 1) {
      this._startMusic(keys[0], !!entry.loop);
      return;
    }
    // First key is the one-shot lead-in; the last key is the looping body.
    const intro = keys[0];
    const body = keys[keys.length - 1];
    this._startMusic(intro, false);
    const introSound = this._music;
    if (introSound && typeof introSound.once === 'function') {
      introSound.once('complete', () => this._startMusic(body, !!entry.loop));
    } else {
      this._startMusic(body, !!entry.loop);
    }
  },

  /**
   * @private Switch music so that EXACTLY ONE track is ever audible.
   *
   * On a real track change the PREVIOUS track is hard-stopped IMMEDIATELY and
   * synchronously (kill its tweens, then `stop()`/`destroy()`), then the NEW
   * track is created and faded IN from silence up to the current duck level.
   * We never rely on a fade-out tween's deferred `onComplete` to stop the old
   * track — that was the source of the music-stacking bug: during rapid
   * transitions (quiz open → answer → RESUME) the fade-out tween was
   * interrupted/orphaned and the previous track kept playing forever, letting
   * several music instances overlap. Hard-stopping up front makes overlap
   * impossible under any timing.
   *
   * Re-triggering the SAME key (e.g. the shared score track across
   * Splash → Menu → Game, or an idempotent GAME_MUSIC re-play) is seamless: it
   * does not recreate the sound, it just re-asserts the current volume.
   * @param {string} key
   * @param {boolean} loop
   */
  _startMusic(key, loop) {
    const scene = this._scene;

    // Same track already playing → keep it seamless (don't recreate the sound).
    // Re-triggering the shared score track (Splash → Menu → Game) must NOT
    // restart it. Just make sure it is audible at the current duck level.
    if (this._music && this._musicKey === key) {
      setVolume(this._music, this._duckLevel());
      return;
    }

    // REAL switch to a different key: hard-stop the current track NOW, before
    // creating the new one. Synchronous — no deferred onComplete — so no old
    // track can survive into the next switch.
    const prev = this._music;
    if (prev) {
      this._killTweens(prev);
      try {
        prev.stop();
        prev.destroy();
      } catch {
        /* ignore */
      }
    }
    // Nothing is playing while we spin up the new track.
    this._music = null;

    // Returning to the gameplay/score track means we are back to normal game
    // music — the overlay that ducked (lesson/pause) is being replaced. Clear
    // the duck state so the score deterministically plays at full MUSIC_VOLUME,
    // regardless of any in-flight duck/unduck tween racing GameScene's RESUME.
    // Only the score track resets the duck; other tracks keep default behavior.
    if (key === 'music_score') {
      this._ducked = false;
    }
    // The quiz-thinking track is exempt from overlay ducking; every other track
    // ducks normally. Determine this BEFORE computing the target so `_duckLevel`
    // is correct for the new track.
    this._noDuckMusic = key === 'music_jeopardy';

    // Create the new track already AT its target volume — deterministic, no
    // from-silence fade-in (that fade-in was what left the streaming MP3 at a
    // wrong level). The previous track is already hard-stopped above.
    const target = this._duckLevel();
    let next;
    try {
      next = scene.sound.add(key, { loop, volume: target });
      next.play();
    } catch {
      // Could not start the new track. The previous one is already stopped, so
      // this simply results in silence; the next music event will recover.
      return;
    }

    this._music = next;
    this._musicKey = key;
    // Re-assert the target volume deterministically after play().
    setVolume(next, target);
  },

  /** @private Stop any crossfade tweens still targeting a sound. */
  _killTweens(target) {
    const tweens = this._scene && this._scene.tweens;
    if (tweens && typeof tweens.killTweensOf === 'function') {
      try {
        tweens.killTweensOf(target);
      } catch {
        /* ignore */
      }
    }
  },

  /**
   * @private Play an SFX entry, honoring `alternate` (cycle keys) and
   * `sequence` (back-to-back) modes. No-op when muted or all keys are missing.
   * @param {{keys: string[], mode?: string}} entry
   * @param {string} event the event name (for the alternate cursor).
   */
  _playSfxEntry(entry, event) {
    if (this._muted || !this._hasScene()) return;
    const keys = entry.keys.filter((k) => this._hasAudio(k));
    if (!keys.length) return; // all missing → silent (Property 22)

    if (entry.mode === 'sequence') {
      this._playSequence(keys);
      return;
    }

    let key;
    if (entry.mode === 'alternate') {
      const i = this._alt[event] || 0;
      key = keys[i % keys.length];
      this._alt[event] = i + 1;
    } else {
      key = keys[0];
    }
    try {
      this._scene.sound.play(key, { volume: SFX_VOLUME });
    } catch {
      /* silent no-op */
    }
  },

  /**
   * @private Play a list of keys back-to-back as a single cue (e.g. the two
   * death clips). Each clip starts when the previous one completes.
   * @param {string[]} keys already-filtered, existing audio keys.
   */
  _playSequence(keys) {
    const scene = this._scene;
    let i = 0;
    const playNext = () => {
      if (i >= keys.length) return;
      const key = keys[i];
      i += 1;
      let snd;
      try {
        snd = scene.sound.add(key);
      } catch {
        playNext();
        return;
      }
      setVolume(snd, SFX_VOLUME);
      if (snd && typeof snd.once === 'function') {
        snd.once('complete', () => {
          try {
            snd.destroy();
          } catch {
            /* ignore */
          }
          playNext();
        });
      }
      try {
        snd.play();
      } catch {
        playNext();
      }
    };
    playNext();
  },
};

export default AudioBus;
