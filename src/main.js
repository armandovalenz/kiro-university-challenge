import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.js';
import BootScene from './scenes/BootScene.js';
import SplashScene from './scenes/SplashScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import UIScene from './scenes/UIScene.js';
import QuizScene from './scenes/QuizScene.js';
import LessonScene from './scenes/LessonScene.js';
import PauseScene from './scenes/PauseScene.js';
import GameOverScene from './scenes/GameOverScene.js';

// Scene list.
//
// Scenes are added incrementally in later tasks (Boot → Splash → Menu →
// Game + UI, with Quiz/Lesson/Pause/GameOver overlays). BootScene runs first:
// it preloads assets, wires up the systems, then hands off to SplashScene,
// which shows the logo and advances to MenuScene. MenuScene starts GameScene,
// which launches UIScene in parallel for the HUD. Overlay scenes
// (Quiz/Lesson/Pause/GameOver) are registered in later tasks.
const scenes = [
  BootScene,
  SplashScene,
  MenuScene,
  GameScene,
  UIScene,
  QuizScene,
  LessonScene,
  PauseScene,
  GameOverScene,
];

/** Phaser.Game configuration. */
const config = {
  type: Phaser.AUTO, // WebGL with automatic Canvas fallback (Req 8.3).
  parent: 'game', // Mount inside the #game container in index.html.
  backgroundColor: '#000000',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT, // Letterbox-fit into the viewport.
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      // Top-down maze game: no gravity; cheap AABB overlap checks only.
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: scenes,
};

// Instantiate the game once the module loads.
const game = new Phaser.Game(config);

export default game;
