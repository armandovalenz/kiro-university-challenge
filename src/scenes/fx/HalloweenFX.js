// HalloweenFX — seasonal "dungeon" dressing for the 2D Splash and Menu scenes.
//
// Phaser-specific (scene visuals only; no game logic). Everything is generated
// at runtime from canvas drawings, so there are no new assets to load or lose
// (Req 13.5 spirit):
//   - a dark stone-brick wall (seeded, so it looks the same every visit),
//   - flaming wall torches: additive particle flames + a flickering warm light
//     pool (flicker maths shared with the FP3D torches via `flame.js`),
//   - rising embers, two layers of drifting fog, a few bats, and a vignette.
// Honors prefers-reduced-motion: flames are drawn static, light holds steady,
// fog doesn't drift and bats/embers are skipped.
//
// Layering: everything sits at negative depths so the scene's own UI (default
// depth 0) always draws on top and stays readable.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, HALLOWEEN } from '../../config.js';
import { flicker } from '../../systems/fp3d/flame.js';
import { seededRandom } from '../../systems/fp3d/wallDecor.js';

const TEX = {
  bricks: 'hw_bricks',
  glow: 'hw_glow',
  flame: 'hw_flame',
  fog: 'hw_fog',
  vignette: 'hw_vignette',
  bat: 'hw_bat',
  torch: 'hw_torch',
};

const DEPTH = {
  bricks: -100,
  dark: -95,
  light: -90,
  torch: -80,
  flame: -75,
  fog: -65,
  bats: -62,
  embers: -60,
  vignette: -50,
};

/** True when the user asked the OS/browser for reduced motion. */
export function isReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Create a canvas texture once per game and draw it with `draw(ctx, w, h)`. */
function canvasTexture(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext(), w, h);
  tex.refresh();
}

/** #rrggbb for a 0xRRGGBB colour scaled by `k` (clamped). */
function shade(hex, k) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  const r = c((hex >> 16) & 255);
  const g = c((hex >> 8) & 255);
  const b = c(hex & 255);
  return `rgb(${r},${g},${b})`;
}

function buildTextures(scene) {
  const H = HALLOWEEN;

  // Stone bricks in a running bond, each a slightly different shade, with a
  // darker bottom edge so they read as blocks.
  canvasTexture(scene, TEX.bricks, GAME_WIDTH, GAME_HEIGHT, (ctx, w, h) => {
    const rand = seededRandom(0x5eed_b1c5);
    ctx.fillStyle = shade(H.mortar, 1);
    ctx.fillRect(0, 0, w, h);
    const m = 2; // mortar gap
    for (let row = 0, y = 0; y < h; row++, y += H.brickH) {
      const offset = row % 2 === 0 ? 0 : -H.brickW / 2;
      for (let x = offset; x < w; x += H.brickW) {
        const k = 1 + (rand() * 2 - 1) * H.stoneVariance;
        ctx.fillStyle = shade(H.stone, k);
        ctx.fillRect(x + m, y + m, H.brickW - m * 2, H.brickH - m * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x + m, y + H.brickH - m - 3, H.brickW - m * 2, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x + m, y + m, H.brickW - m * 2, 2);
        // The odd crack.
        if (rand() < 0.12) {
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          const cx = x + m + rand() * (H.brickW - 8);
          ctx.moveTo(cx, y + m);
          ctx.lineTo(cx + 4 + rand() * 6, y + H.brickH * 0.5);
          ctx.lineTo(cx + rand() * 8, y + H.brickH - m);
          ctx.stroke();
        }
      }
    }
  });

  // Soft white radial blob: tinted for light pools and particles.
  const radial = (key, size, stops) => canvasTexture(scene, key, size, size, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  radial(TEX.glow, 256, [[0, 0.9], [0.35, 0.35], [1, 0]]);
  radial(TEX.flame, 32, [[0, 1], [0.3, 0.8], [0.7, 0.2], [1, 0]]);

  // Wispy fog: many faint overlapping blobs; tiles horizontally.
  canvasTexture(scene, TEX.fog, 512, 256, (ctx, w, h) => {
    const rand = seededRandom(0xf06f06);
    for (let i = 0; i < 70; i++) {
      const x = rand() * w;
      const y = h * (0.35 + rand() * 0.5);
      const r = 30 + rand() * 70;
      for (const dx of [-w, 0, w]) { // wrap so the tile seams don't show
        const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y - r, r * 2, r * 2);
      }
    }
  });

  // Vignette: clear centre, black edges.
  canvasTexture(scene, TEX.vignette, GAME_WIDTH, GAME_HEIGHT, (ctx, w, h) => {
    const r = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  // Bat silhouette.
  canvasTexture(scene, TEX.bat, 40, 20, (ctx) => {
    ctx.fillStyle = '#050307';
    ctx.beginPath();
    ctx.moveTo(20, 8);
    ctx.quadraticCurveTo(12, 0, 0, 4);
    ctx.quadraticCurveTo(6, 8, 4, 14);
    ctx.quadraticCurveTo(10, 10, 14, 14);
    ctx.quadraticCurveTo(17, 11, 20, 16);
    ctx.quadraticCurveTo(23, 11, 26, 14);
    ctx.quadraticCurveTo(30, 10, 36, 14);
    ctx.quadraticCurveTo(34, 8, 40, 4);
    ctx.quadraticCurveTo(28, 0, 20, 8);
    ctx.fill();
    ctx.fillStyle = '#ff3a1a'; // tiny glowing eyes
    ctx.fillRect(18, 8, 1.5, 1.5);
    ctx.fillRect(21, 8, 1.5, 1.5);
  });

  // Wall torch: iron bracket, wooden shaft, wrapped head (flame sits on top).
  canvasTexture(scene, TEX.torch, 28, 72, (ctx) => {
    ctx.fillStyle = '#6b4424'; // shaft
    ctx.fillRect(11, 14, 6, 50);
    ctx.fillStyle = '#4a2c14';
    ctx.fillRect(15, 14, 2, 50);
    ctx.fillStyle = '#2a1a10'; // pitch-soaked head
    ctx.fillRect(7, 2, 14, 14);
    ctx.fillStyle = '#3b2616';
    for (let y = 4; y < 16; y += 4) ctx.fillRect(7, y, 14, 1);
    ctx.fillStyle = '#3a3a42'; // bracket
    ctx.fillRect(4, 40, 20, 5);
    ctx.fillRect(2, 44, 4, 26);
    ctx.fillStyle = '#55555e';
    ctx.fillRect(4, 40, 20, 1);
  });
}

/**
 * Dress a scene as a flickering Halloween dungeon.
 * @param {Phaser.Scene} scene
 * @param {object} [opts]
 * @param {Array<{x:number,y:number,scale?:number}>} [opts.torches] torch
 *   positions (top of the torch head, where the flame sits)
 * @param {boolean} [opts.embers=true]
 * @param {boolean} [opts.bats=true]
 * @returns {{ reduced: boolean, destroy: () => void }}
 */
export function addHalloweenDungeon(scene, { torches = [], embers = true, bats = true } = {}) {
  const H = HALLOWEEN;
  const reduced = isReducedMotion();
  buildTextures(scene);

  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;

  scene.add.image(cx, cy, TEX.bricks).setDepth(DEPTH.bricks);
  scene.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, H.darkness).setDepth(DEPTH.dark);

  // --- Torches: light pool + drawn torch + flame -----------------------------
  const lights = [];
  torches.forEach((t, i) => {
    const s = t.scale || 1;
    const light = scene.add.image(t.x, t.y, TEX.glow)
      .setTint(H.lightColor)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(H.lightRadius * 2 * s, H.lightRadius * 2 * s)
      .setAlpha(H.lightAlpha)
      .setDepth(DEPTH.light);
    lights.push({ light, offset: i * 2.17, baseSize: H.lightRadius * 2 * s });

    scene.add.image(t.x, t.y - 2 * s, TEX.torch).setOrigin(0.5, 0).setScale(s).setDepth(DEPTH.torch);

    if (reduced) {
      // Static flame: three stacked additive blobs (core → outer).
      [[0xff5a10, 26, -8], [0xffb040, 18, -6], [0xfff4b0, 10, -4]].forEach(([c, size, dy]) => {
        scene.add.image(t.x, t.y + dy * s, TEX.flame)
          .setTint(c).setBlendMode(Phaser.BlendModes.ADD)
          .setDisplaySize(size * s, size * 1.5 * s)
          .setDepth(DEPTH.flame);
      });
      return;
    }

    scene.add.particles(t.x, t.y, TEX.flame, {
      x: { min: -5 * s, max: 5 * s },
      speedY: { min: -60 * s, max: -115 * s },
      speedX: { min: -14 * s, max: 14 * s },
      scale: { start: 0.95 * s, end: 0.1 * s },
      alpha: { start: 0.95, end: 0 },
      lifespan: { min: 380, max: 720 },
      frequency: 18,
      color: H.flameColors,
      colorEase: 'quad.out',
      blendMode: 'ADD',
    }).setDepth(DEPTH.flame);

    // A few sparks that fly higher than the flame.
    scene.add.particles(t.x, t.y - 8 * s, TEX.flame, {
      speedY: { min: -80 * s, max: -160 * s },
      speedX: { min: -30 * s, max: 30 * s },
      scale: { start: 0.18 * s, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 600, max: 1100 },
      frequency: 220,
      tint: H.emberColor,
      blendMode: 'ADD',
    }).setDepth(DEPTH.flame);
  });

  // --- Fog (two layers, different speeds) -------------------------------------
  const fogLow = scene.add.tileSprite(cx, GAME_HEIGHT - 110, GAME_WIDTH, 256, TEX.fog)
    .setTint(0x9a88b0).setAlpha(H.fogAlpha).setDepth(DEPTH.fog);
  const fogHigh = scene.add.tileSprite(cx, GAME_HEIGHT * 0.35, GAME_WIDTH, 256, TEX.fog)
    .setTint(0x6e6488).setAlpha(H.fogAlpha * 0.5).setDepth(DEPTH.fog);

  // --- Embers drifting up from the floor --------------------------------------
  if (embers && !reduced) {
    scene.add.particles(0, GAME_HEIGHT + 8, TEX.flame, {
      x: { min: 0, max: GAME_WIDTH },
      speedY: { min: -18, max: -45 },
      speedX: { min: -12, max: 12 },
      scale: { start: 0.2, end: 0 },
      alpha: { start: 0.85, end: 0 },
      lifespan: { min: 5000, max: 9000 },
      frequency: 140,
      tint: H.emberColor,
      blendMode: 'ADD',
    }).setDepth(DEPTH.embers);
  }

  // --- Bats --------------------------------------------------------------------
  // Tweens die with the scene (its TweenManager shuts down), so no manual
  // cleanup is needed for the flight loop.
  if (bats && !reduced) {
    for (let i = 0; i < H.bats; i++) {
      const s = 0.6 + Math.random() * 0.7;
      const bat = scene.add.image(-40, 0, TEX.bat).setDepth(DEPTH.bats).setAlpha(0.9).setScale(s);
      const fly = () => {
        const leftToRight = Math.random() < 0.5;
        const y0 = 40 + Math.random() * GAME_HEIGHT * 0.45;
        bat.setFlipX(!leftToRight);
        bat.x = leftToRight ? -40 : GAME_WIDTH + 40;
        bat.y = y0;
        const phase = Math.random() * Math.PI * 2;
        scene.tweens.add({
          targets: bat,
          x: leftToRight ? GAME_WIDTH + 40 : -40,
          duration: 4500 + Math.random() * 4000,
          delay: 600 + Math.random() * 5000,
          ease: 'Linear',
          onUpdate: (tw) => { bat.y = y0 + Math.sin(tw.progress * 14 + phase) * 18; },
          onComplete: fly,
        });
      };
      fly();
      // Wing flap.
      scene.tweens.add({
        targets: bat, scaleY: { from: s, to: s * 0.35 },
        duration: 110, yoyo: true, repeat: -1,
      });
    }
  }

  // --- Vignette -----------------------------------------------------------------
  scene.add.image(cx, cy, TEX.vignette).setAlpha(H.vignetteAlpha).setDepth(DEPTH.vignette);

  // --- Per-frame: light flicker + fog drift ----------------------------------
  const onUpdate = (time, delta) => {
    const tSec = time / 1000;
    for (const l of lights) {
      const f = flicker(tSec, l.offset, H.flickerAmount, reduced);
      l.light.setAlpha(H.lightAlpha * f);
      l.light.setDisplaySize(l.baseSize * (0.96 + 0.04 * f), l.baseSize * (0.96 + 0.04 * f));
    }
    if (!reduced) {
      fogLow.tilePositionX += H.fogSpeed * delta;
      fogHigh.tilePositionX -= H.fogSpeed * 0.6 * delta;
    }
  };
  scene.events.on('update', onUpdate);

  const destroy = () => {
    scene.events.off('update', onUpdate);
  };
  scene.events.once('shutdown', destroy);

  return { reduced, destroy };
}
