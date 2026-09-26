// Pure, framework-agnostic maths for the FP3D torch flame effect.
//
// No Three.js / Phaser imports: the renderer feeds these numbers into a
// `THREE.Points` buffer and the torch point lights. Everything here is a
// stateless function of time (plus a per-particle seed), so a frame can be
// recomputed exactly and the maths is property-tested in `flame.test.js`.

/**
 * @typedef {object} FlameSeed  Per-particle constants drawn once at build time.
 * @property {number} phase  Life offset in [0, 1) so particles don't pulse together.
 * @property {number} speed  Life cycles per second (> 0).
 * @property {number} angle  Spawn direction around the flame axis, radians.
 * @property {number} spread Spawn radius as a fraction of `radius`, in [0, 1].
 */

/**
 * @typedef {object} FlameShape
 * @property {number} height  How far a particle rises over its life (> 0).
 * @property {number} radius  Base spawn radius (>= 0).
 * @property {number} sway    Max sideways sway amplitude (>= 0).
 */

/** Fractional part in [0, 1), also for negative inputs. */
function frac(v) {
  return v - Math.floor(v);
}

/**
 * Draw per-particle constants from a `[0, 1)` RNG.
 * @param {number} count
 * @param {() => number} rand
 * @param {{ minSpeed?: number, maxSpeed?: number }} [opts]
 * @returns {FlameSeed[]}
 */
export function makeFlameSeeds(count, rand, { minSpeed = 1.1, maxSpeed = 2.0 } = {}) {
  const n = Math.max(0, Math.floor(count));
  const seeds = [];
  for (let i = 0; i < n; i++) {
    seeds.push({
      phase: rand(),
      speed: minSpeed + (maxSpeed - minSpeed) * rand(),
      angle: rand() * Math.PI * 2,
      spread: Math.sqrt(rand()), // uniform over the disc, not bunched at the centre
    });
  }
  return seeds;
}

/**
 * Where one flame particle is at time `tSec`, relative to the flame base.
 * Particles rise from the base, narrow towards the tip (a teardrop), and sway
 * a little. `life` runs 0 → 1 and wraps, so the flame loops forever.
 * @param {FlameSeed} seed
 * @param {number} tSec
 * @param {FlameShape} shape
 * @returns {{ x: number, y: number, z: number, life: number }}
 */
export function flameParticle(seed, tSec, shape) {
  const life = frac(seed.phase + tSec * seed.speed);
  const taper = 1 - life; // wide at the base, narrow at the tip
  const r = shape.radius * seed.spread * taper;
  const sway = shape.sway * Math.sin((tSec * 3.1 + seed.angle) * 1.7) * life * taper * 2;
  return {
    x: Math.cos(seed.angle) * r + sway,
    y: shape.height * life,
    z: Math.sin(seed.angle) * r,
    life,
  };
}

/**
 * Flame colour over a particle's life: white-yellow core → orange → deep red,
 * fading to black. With additive blending black is invisible, so this is also
 * the fade-out. Components are in [0, 1] and brightness never increases.
 * @param {number} life in [0, 1]
 * @returns {{ r: number, g: number, b: number }}
 */
export function flameColor(life) {
  const t = Math.min(1, Math.max(0, life));
  const fade = (1 - t) * (1 - t);
  const r = fade;
  const g = fade * (0.85 - 0.6 * t);
  const b = fade * 0.35 * (1 - t);
  return { r, g, b };
}

/**
 * Smooth, bounded flicker multiplier for a torch's light and glow. A sum of
 * incommensurate sines looks irregular but stays in [1 − amount, 1 + amount].
 * Returns exactly 1 when `reduced` (prefers-reduced-motion, Req 7.4).
 * @param {number} tSec
 * @param {number} offset per-torch offset so torches don't flicker in sync
 * @param {number} amount in [0, 1)
 * @param {boolean} [reduced]
 */
export function flicker(tSec, offset, amount, reduced = false) {
  if (reduced || amount <= 0) return 1;
  const t = tSec + offset;
  const n = 0.5 * Math.sin(t * 7.3) + 0.3 * Math.sin(t * 13.1 + 1.7) + 0.2 * Math.sin(t * 23.7 + 4.1);
  return 1 + amount * n; // |n| <= 1
}
