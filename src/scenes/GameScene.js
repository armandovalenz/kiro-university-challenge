// GameScene — the active gameplay scene (Task 9).
//
// Responsibilities:
//   - Build the maze (`Maze`) and spawn Math Man at the maze's spawn tile.
//   - Own the per-frame game loop: read arrow keys / WASD into Math Man's
//     buffered direction intent and advance movement (Req 1.1, 1.2).
//   - Eat pellets via Arcade overlap between Math Man and the maze pellet group,
//     removing each pellet and awarding points through `ScoreSystem`
//     (Req 1.4), with the pellet-eaten sound cue.
//   - Create the run's `ScoreSystem` and publish it on the registry as
//     `'scoreSystem'` so `UIScene` (and later Tasks 11/13/14/15/16) share one
//     instance.
//   - Launch `UIScene` in parallel to draw the HUD (Req 1.6).
//
//   - Detect ghost↔Math Man overlap, emit `mathman-caught`, freeze gameplay by
//     pausing the scene, and expose the catch→reset→resume hooks the quiz flow
//     uses (Task 11; Req 3.3, 3.4).
//
// The DOM quiz itself (Task 13), fruit + lessons (Task 14), level-progression
// transitions (Task 15), and pause/game-over (Task 16) are intentionally NOT
// implemented here — clean hooks are left where each will attach. `QuizScene`
// (Task 13) and `GameOverScene` (Task 16) are not registered yet, so this scene
// guards those launches and exposes `resumeAfterQuiz(result)` for Task 13 to
// resolve a catch.

import Phaser from 'phaser';
import { SPEEDS, DEFAULT_GRADE, GRADES, GHOST_PERSONALITIES, TIMINGS } from '../config.js';
import Maze from '../maze/Maze.js';
import MathMan from '../entities/MathMan.js';
import Ghost from '../entities/Ghost.js';
import Fruit from '../entities/Fruit.js';
import { ghostSpeedForGrade } from '../entities/ghostAI.js';
import ScoreSystem from '../systems/ScoreSystem.js';
import LessonBank from '../systems/LessonBank.js';
import { AudioEvent } from '../systems/AudioBus.js';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  /**
   * Receive scene data from MenuScene (`{ grade }`). Stored on the scene so the
   * quiz flow (Task 13) and ghost speed scaling (Task 10) can read it.
   * @param {{ grade?: number }} [data]
   */
  init(data = {}) {
    this.grade = GRADES.includes(data.grade) ? data.grade : DEFAULT_GRADE;
  }

  create() {
    // Shared systems from the registry (populated by BootScene).
    this.audio = this.registry.get('audio') || null;
    this.storage = this.registry.get('storage') || null;

    // Fresh score/lives/level tracker for this run. Published on the registry
    // so UIScene and later tasks read the same instance (Req 1.6).
    this.scoreSystem = new ScoreSystem();
    this.registry.set('scoreSystem', this.scoreSystem);

    // Build the maze (walls + pellet/fruit groups) and Math Man at its spawn.
    this.maze = new Maze(this, { level: this.scoreSystem.level });
    const spawn = this.maze.mathManSpawnWorld() || { x: 0, y: 0 };
    this.mathMan = new MathMan(this, spawn.x, spawn.y, this.maze, {
      speed: SPEEDS.mathMan,
    });

    // Spawn the four Einstein ghosts from the ghost house (Task 10). Each gets
    // a distinct color + personality; speed is scaled by the selected grade
    // (Req 3.1, 3.2, 3.6, 10.4). The overlap that emits 'mathman-caught' is
    // wired in `_setupGhostCollision` (Task 11).
    this.ghosts = this.add.group();
    this._spawnGhosts();

    // Fruit (Task 14) spawns at an `F` tile; its overlap grants a life + lesson.
    this.fruit = null;
    // Per-run bank of tagged micro-lessons; keeps the "vary between showings"
    // history across fruit collections (Req 5.5 / Property 14).
    this.lessonBank = new LessonBank();

    this._setupInput();
    this._setupPauseKey();
    this._setupPelletCollision();
    this._setupGhostCollision();
    this._setupFruitSpawn();

    // Guards a single catch→quiz→resume cycle so the per-frame overlap callback
    // (and multiple simultaneously-overlapping ghosts) can only trigger one
    // catch at a time. Cleared once the quiz is resolved (`resumeAfterQuiz`).
    this._caught = false;

    // HUD overlay runs in parallel over this (paused-safe) scene (Req 1.6).
    if (!this.scene.isActive('UIScene')) {
      this.scene.launch('UIScene');
    }

    // Mute toggle (Req 12.4) and gameplay music (Req 12.1). Silent no-ops when
    // audio / assets are unavailable.
    if (this.audio) {
      if (typeof this.audio.bindMuteKey === 'function') {
        this.audio.bindMuteKey(this);
      }
      if (typeof this.audio.play === 'function') {
        this.audio.play(AudioEvent.GAME_MUSIC);
      }
    }

    // Clean up the parallel HUD when this scene stops (restart / game over).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown, this);
  }

  update(time, delta) {
    if (!this.mathMan) return;

    this._pollInput();
    this.mathMan.tick(delta);

    // Advance each Einstein ghost's AI-driven movement (Task 10).
    if (this.ghosts) {
      const ghosts = this.ghosts.getChildren ? this.ghosts.getChildren() : [];
      for (const ghost of ghosts) {
        if (typeof ghost.tick === 'function') ghost.tick(delta);
      }
    }

    // Level-clear detection + transition is Task 15's responsibility; the hook
    // below is a safe no-op until then so clearing pellets never breaks.
    this._checkLevelClear();
  }

  // --- Input ------------------------------------------------------------------

  /** Wire arrow keys and WASD (Req 1.2). */
  _setupInput() {
    const kb = this.input.keyboard;
    this.cursors = kb ? kb.createCursorKeys() : null;
    this.wasd = kb
      ? kb.addKeys({
          up: Phaser.Input.Keyboard.KeyCodes.W,
          left: Phaser.Input.Keyboard.KeyCodes.A,
          down: Phaser.Input.Keyboard.KeyCodes.S,
          right: Phaser.Input.Keyboard.KeyCodes.D,
        })
      : null;
  }

  /**
   * Translate held keys into Math Man's queued direction intent. The entity's
   * turn buffering applies the turn only when tile-centered and unobstructed,
   * so polling every frame is safe and responsive.
   */
  _pollInput() {
    const c = this.cursors;
    const w = this.wasd;
    if (!c && !w) return;

    const down = (a, b) => (a && a.isDown) || (b && b.isDown);
    if (down(c && c.left, w && w.left)) this.mathMan.setDirection('left');
    else if (down(c && c.right, w && w.right)) this.mathMan.setDirection('right');
    else if (down(c && c.up, w && w.up)) this.mathMan.setDirection('up');
    else if (down(c && c.down, w && w.down)) this.mathMan.setDirection('down');
  }

  /**
   * Wire the pause toggle (Req 7.5). `P`/`Esc` launch the PauseScene overlay and
   * pause this scene, which halts update() + physics so all entity movement
   * freezes; PauseScene owns the matching resume. Kept separate from the
   * movement input (`_setupInput`) so the polling loop is untouched.
   *
   * A paused scene's keyboard input is also frozen, so these listeners only fire
   * while gameplay is active — during a quiz/lesson/pause overlay this scene is
   * already paused and cannot re-trigger.
   */
  _setupPauseKey() {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-P', this._pauseGame, this);
    kb.on('keydown-ESC', this._pauseGame, this);
  }

  /**
   * Enter the paused state (Req 7.5): play the pause cue, launch PauseScene over
   * this frozen frame, and pause this scene. Guarded so it never double-launches
   * while already paused or while the pause overlay is up.
   */
  _pauseGame() {
    if (this.scene.isPaused() || this.scene.isActive('PauseScene')) return;
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.PAUSE);
    }
    this.scene.launch('PauseScene');
    this.scene.pause();
  }

  // --- Ghosts -----------------------------------------------------------------

  /**
   * Spawn the four Einstein ghosts at the maze's ghost-house tiles, each with a
   * distinct color/personality (from config `GHOST_PERSONALITIES`) and a speed
   * scaled by the selected grade (Req 3.1, 3.2, 3.6, 10.4). Ghosts are added to
   * `this.ghosts` so Task 11 can attach the Math Man overlap.
   */
  _spawnGhosts() {
    const spawns = this.maze.ghostSpawnsWorld() || [];
    if (!spawns.length) return;
    const speed = ghostSpeedForGrade(this.grade);

    GHOST_PERSONALITIES.forEach((def, i) => {
      // Reuse spawn tiles cyclically if there are fewer than ghosts.
      const spawn = spawns[i % spawns.length];
      const ghost = new Ghost(this, spawn.x, spawn.y, this.maze, {
        color: def.color,
        colorKey: def.key,
        personality: def.personality,
        speed,
      });
      this.ghosts.add(ghost);
    });
  }

  // --- Pellets ----------------------------------------------------------------

  /**
   * Set up Arcade overlap between Math Man and the maze pellet group so moving
   * over a pellet eats it (Req 1.4). Pellet images are plain display objects;
   * enable Arcade bodies on them so `overlap` can fire.
   */
  _setupPelletCollision() {
    const pellets = this.maze.pellets;
    if (!pellets) return;
    const children = pellets.getChildren ? pellets.getChildren() : [];
    if (children.length) this.physics.world.enable(children);
    this.physics.add.overlap(this.mathMan, pellets, this._onEatPellet, null, this);
  }

  /**
   * Overlap handler: eat the pellet at its stored tile, award points, and play
   * the pellet cue. `Maze.eatPelletAt` removes + destroys the sprite and keeps
   * the pure grid model in sync (Property 7).
   * @param {Phaser.GameObjects.GameObject} _mathMan
   * @param {Phaser.GameObjects.Image} pellet
   */
  _onEatPellet(_mathMan, pellet) {
    const col = pellet.getData('col');
    const row = pellet.getData('row');
    const points = this.maze.eatPelletAt(col, row);
    if (points > 0) {
      this.scoreSystem.addScore(points);
      if (this.audio && typeof this.audio.play === 'function') {
        this.audio.play(AudioEvent.PELLET);
      }
    }
  }

  // --- Ghost catch → quiz → reset (Task 11) ----------------------------------

  /**
   * Set up the Arcade overlap between Math Man and the ghost group. When any
   * Einstein ghost overlaps Math Man, `_onMathManCaught` fires (Req 3.3). Both
   * MathMan and each Ghost enable an Arcade body in their constructors, so the
   * group overlap works without extra body wiring here.
   */
  _setupGhostCollision() {
    if (!this.mathMan || !this.ghosts) return;
    this.physics.add.overlap(this.mathMan, this.ghosts, this._onMathManCaught, null, this);
  }

  /**
   * Catch handler (Req 3.3). Plays the caught cue, emits `mathman-caught` for
   * any interested listeners/tests, freezes gameplay by pausing this scene
   * (which halts `update()` and thus all entity movement), and hands off to the
   * quiz.
   *
   * QuizScene is built in Task 13 and is not registered yet, so the launch is
   * guarded: when it is available we launch it with an `onResolved` callback
   * that routes back into {@link resumeAfterQuiz}; until then the scene is left
   * paused with a clear hook, which Task 13 replaces with the real quiz flow.
   *
   * @param {Phaser.GameObjects.GameObject} _mathMan
   * @param {import('../entities/Ghost.js').default} ghost the catching ghost
   */
  _onMathManCaught(_mathMan, ghost) {
    if (this._caught) return; // one catch at a time (guards the frame overlap)
    this._caught = true;

    // Caught cue (silent no-op when audio / asset is unavailable).
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.CAUGHT);
    }

    // Broadcast for other systems/tests. Payload carries the catching ghost.
    this.events.emit('mathman-caught', { ghost, grade: this.grade });

    // Freeze gameplay: pausing this scene stops its update() + physics, so all
    // entity movement halts while the question is open (Req 3.3, 4.7).
    this.scene.pause();

    if (this._isSceneRegistered('QuizScene')) {
      // Task 13 wiring: QuizScene resolves the question and calls the supplied
      // callback with `{ correct }`. `grade` picks a grade-appropriate question.
      this.scene.launch('QuizScene', {
        grade: this.grade,
        onResolved: (result) => this.resumeAfterQuiz(result),
      });
    }
    // else: QuizScene not built yet — leave GameScene paused. Task 13 will
    // register QuizScene and this branch becomes dead code. `resumeAfterQuiz`
    // is public so the quiz flow (or a manual trigger) can resolve the catch.
  }

  /**
   * Resolve a catch after the quiz returns (called by QuizScene in Task 13).
   * Wrong answers cost a life (Req 4.6); when no lives remain the run ends via
   * {@link _onGameOver}. Otherwise Math Man and the ghosts are reset to their
   * spawn positions (Req 3.4) and gameplay resumes.
   *
   * @param {{ correct?: boolean }} [result] outcome of the quiz.
   */
  resumeAfterQuiz(result = {}) {
    const correct = !!result.correct;

    // Wrong answer → lose one life (Req 4.6). ScoreSystem emits the HUD update
    // and its own game-over event; correct/wrong audio is the quiz flow's job.
    if (!correct) {
      this.scoreSystem.loseLife();
    }

    // No lives left → game over (Req 2.3); do not reset or resume.
    if (this.scoreSystem.isGameOver()) {
      this._onGameOver();
      return;
    }

    // Lives remain → reset entities to spawns (Req 3.4) and unfreeze.
    this.resetPositions();
    this._caught = false;
    if (this.scene.isPaused()) this.scene.resume();
  }

  /**
   * Reset Math Man and every ghost to their spawn tiles and clear movement
   * state (Req 3.4). Each entity owns its own `resetPosition()`.
   */
  resetPositions() {
    this.mathMan?.resetPosition?.();
    if (this.ghosts) {
      const ghosts = this.ghosts.getChildren ? this.ghosts.getChildren() : [];
      for (const ghost of ghosts) {
        ghost.resetPosition?.();
      }
    }
  }

  /**
   * Game-over hook (Req 2.3). GameOverScene is Task 16 and is not registered
   * yet, so its launch is guarded; until then the scene is left paused. Task 16
   * replaces this with the final-score / high-score screen and HUD teardown.
   */
  _onGameOver() {
    this._caught = false;
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.GAME_OVER);
    }
    if (this._isSceneRegistered('GameOverScene')) {
      this.scene.stop('UIScene');
      this.scene.start('GameOverScene', this.scoreSystem.snapshot());
    }
    // else: leave paused; Task 16 wires the GameOverScene transition.
  }

  /**
   * Whether a scene key is registered with the Scene Manager. Used to guard
   * launches of scenes added in later tasks (QuizScene → Task 13,
   * GameOverScene → Task 16) so this scene never targets a missing scene.
   * @param {string} key
   * @returns {boolean}
   */
  _isSceneRegistered(key) {
    const mgr = this.scene && this.scene.manager;
    return !!(mgr && typeof mgr.getScene === 'function' && mgr.getScene(key));
  }

  // --- Fruit → extra life → lesson (Task 14) ---------------------------------

  /**
   * Schedule periodic fruit spawns while the level is in progress (Req 5.1).
   * A looping timer spawns a fruit every `TIMINGS.fruitSpawnInterval` ms; when
   * this scene is paused (quiz/lesson/pause overlay) Phaser also pauses its
   * timers, so no fruit appears while gameplay is frozen. `_spawnFruit` is a
   * no-op while a fruit is already present, so at most one fruit exists at a
   * time.
   */
  _setupFruitSpawn() {
    if (!this.maze) return;
    const spawns = this.maze.fruitSpawnsWorld() || [];
    if (!spawns.length) return; // no `F` tiles in this layout → no fruit
    this._fruitTimer = this.time.addEvent({
      delay: TIMINGS.fruitSpawnInterval,
      loop: true,
      callback: this._spawnFruit,
      callbackScope: this,
    });
  }

  /**
   * Spawn a single fruit at one of the maze's `F` tiles and wire the Math Man
   * overlap that collects it (Req 5.1). Plays the "fruit spawned" cue. The
   * fruit auto-despawns after `TIMINGS.fruitLifetime` ms if left uncollected.
   */
  _spawnFruit() {
    if (this.fruit || !this.maze) return; // one fruit at a time
    const spawns = this.maze.fruitSpawnsWorld() || [];
    if (!spawns.length) return;

    // Pick a spawn tile (first tile; layouts define a single fruit point).
    const idx = Math.floor(Math.random() * spawns.length);
    const { x, y } = spawns[idx];
    const fruit = new Fruit(this, x, y);
    this.fruit = fruit;

    // Overlap → collect. Math Man and Fruit both carry Arcade bodies.
    this._fruitOverlap = this.physics.add.overlap(
      this.mathMan,
      fruit,
      this._onFruitCollected,
      null,
      this,
    );

    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.FRUIT_SPAWN);
    }

    // Remove the fruit if it is not collected within its lifetime.
    this._fruitTimeout = this.time.delayedCall(TIMINGS.fruitLifetime, () => {
      this._clearFruit();
    });
  }

  /**
   * Fruit overlap handler (Req 5.2, 5.3). Grants one extra life (capped at 10
   * by ScoreSystem, Property 2), plays the collect + 1-up cues, removes the
   * fruit, then pauses gameplay and launches the lesson overlay.
   * @param {Phaser.GameObjects.GameObject} _mathMan
   * @param {import('../entities/Fruit.js').default} fruit
   */
  _onFruitCollected(_mathMan, fruit) {
    if (!fruit || !fruit.active) return; // guard the per-frame overlap

    // Extra life, capped at LIVES_MAX = 10 (Req 5.2, 2.4, 2.5 / Property 2).
    this.scoreSystem.gainLife();

    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.FRUIT_COLLECT);
      this.audio.play(AudioEvent.EXTRA_LIFE);
    }

    // Remove the fruit + its timers so it cannot be collected twice.
    this._clearFruit();

    // Freeze gameplay and show the micro-lesson (Req 5.3). Selecting from the
    // per-run LessonBank varies the content between showings (Req 5.5).
    this.scene.pause();
    const lesson = this.lessonBank ? this.lessonBank.next() : null;
    if (this._isSceneRegistered('LessonScene')) {
      this.scene.launch('LessonScene', {
        lesson,
        onDismiss: () => this.resumeAfterLesson(),
      });
    } else {
      // Defensive: no LessonScene registered → don't strand the paused scene.
      this.resumeAfterLesson();
    }
  }

  /**
   * Resume gameplay after the lesson panel is dismissed (Req 5.4). Called by
   * LessonScene's dismiss callback; mirrors {@link resumeAfterQuiz}.
   */
  resumeAfterLesson() {
    if (this.scene.isPaused()) this.scene.resume();
  }

  /**
   * Remove the active fruit and cancel its collection overlap / lifetime timer.
   * Safe to call when no fruit is present.
   */
  _clearFruit() {
    if (this._fruitTimeout) {
      this._fruitTimeout.remove(false);
      this._fruitTimeout = null;
    }
    if (this._fruitOverlap) {
      this.physics.world.removeCollider(this._fruitOverlap);
      this._fruitOverlap = null;
    }
    if (this.fruit) {
      this.fruit.collect();
      this.fruit = null;
    }
  }

  // --- Level progression hook (Task 15) --------------------------------------

  /**
   * Detect a cleared maze each frame and advance to the next level (Req 1.5).
   * Fires once per clear: the `_levelTransition` guard blocks re-entry while a
   * transition is in flight, and after `_advanceLevel` rebuilds the pellet
   * layer `isLevelCleared()` is false again, so it will not re-trigger.
   */
  _checkLevelClear() {
    if (this._levelTransition) return;
    if (!this.maze || !this.maze.isLevelCleared()) return;
    this._advanceLevel();
  }

  /**
   * Level-clear transition (Req 1.5, 7.7). Plays the level-clear cue, advances
   * the run's level, and rebuilds the maze for it — preserving score, lives,
   * and the selected grade (only `ScoreSystem.level` changes; score/lives live
   * on the same `scoreSystem` and `this.grade` is untouched). Math Man and the
   * ghosts return to their spawns for the fresh level. Kept synchronous and
   * non-blocking so the game loop is never stalled.
   */
  _advanceLevel() {
    this._levelTransition = true;

    // Level-clear cue (silent no-op when audio / asset is unavailable).
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play(AudioEvent.LEVEL_CLEAR);
    }

    // Advance the level and rebuild the maze's pellet layer for it. Score and
    // lives are preserved automatically (nextLevel only bumps `level`); the
    // difficulty/grade lives on `this.grade` and is left alone.
    this.scoreSystem.nextLevel();
    this.maze.reset(this.scoreSystem.level);

    // `Maze.reset` refills the SAME `pellets` group with fresh display objects
    // that have no Arcade body. The Math Man↔pellets overlap wired in create()
    // still targets that group by reference, so enabling bodies on the new
    // sprites is all that is needed to make them eatable again — no new overlap
    // is added (calling `_setupPelletCollision()` would accumulate one collider
    // per level).
    const pellets = this.maze.pellets;
    const children = pellets && pellets.getChildren ? pellets.getChildren() : [];
    if (children.length) this.physics.world.enable(children);

    // Return Math Man and the ghosts to their spawn tiles for the new level.
    this.resetPositions();

    this._levelTransition = false;
  }

  // --- Teardown ---------------------------------------------------------------

  _onShutdown() {
    // Stop the parallel HUD so it does not linger over the next scene.
    if (this.scene.isActive('UIScene')) {
      this.scene.stop('UIScene');
    }
    // Cancel the fruit spawn timer and tear down any active fruit.
    if (this._fruitTimer) {
      this._fruitTimer.remove(false);
      this._fruitTimer = null;
    }
    this._clearFruit();
    this.maze?.destroy?.();
  }
}
