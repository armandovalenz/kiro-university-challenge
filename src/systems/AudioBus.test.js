// Property-based tests for the AudioBus event→sound map and mute/no-op
// behavior (mandatory PBT — see .kiro/steering/testing.md).
//
// Owns Property 20 (every game event maps to a sound), Property 21 (mute
// persists and never affects gameplay), and Property 22 (missing audio is a
// silent no-op). Tests use Vitest + fast-check and are named after the Core
// Property they validate, carrying the requirement trace.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import AudioBus, {
  AudioEvent,
  AudioType,
  EVENT_SOUND,
  MINIMUM_EVENT_SET,
  resolveSound,
} from './AudioBus.js';
import ScoreSystem from './ScoreSystem.js';

const eventArb = fc.constantFrom(...MINIMUM_EVENT_SET);

describe('AudioBus — Property 20: Every game event maps to a sound', () => {
  // **Validates: Requirements 12.2**
  // For any event in the minimum event set, the bus resolves a defined sound key
  // (the event→sound map is total over that list).
  it('resolveSound is total over MINIMUM_EVENT_SET with a valid type and >= 1 key', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const entry = resolveSound(event);
        expect(entry).not.toBeNull();
        expect([AudioType.MUSIC, AudioType.SFX]).toContain(entry.type);
        expect(Array.isArray(entry.keys)).toBe(true);
        expect(entry.keys.length).toBeGreaterThanOrEqual(1);
        // Every key is a non-empty string.
        for (const key of entry.keys) {
          expect(typeof key).toBe('string');
          expect(key.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('the minimum event set is exactly the declared AudioEvent values and all mapped', () => {
    expect(MINIMUM_EVENT_SET.slice().sort()).toEqual(Object.values(AudioEvent).slice().sort());
    for (const event of MINIMUM_EVENT_SET) {
      expect(Object.prototype.hasOwnProperty.call(EVENT_SOUND, event)).toBe(true);
    }
  });

  it('unknown events resolve to null (map is not accidentally total over junk)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (MINIMUM_EVENT_SET.includes(s)) return;
        expect(resolveSound(s)).toBeNull();
      }),
    );
  });
});

/**
 * A minimal stub scene: no real audio, a mute flag the bus can set, and a cache
 * reporting whichever keys we say "loaded". Lets us drive AudioBus without Phaser.
 */
function makeStubScene(loadedKeys = []) {
  const set = new Set(loadedKeys);
  return {
    sound: {
      mute: false,
      locked: false,
      play() {},
      add() {
        return { play() {}, stop() {}, destroy() {}, once() {}, setVolume() {} };
      },
      once() {},
    },
    cache: { audio: { exists: (k) => set.has(k) } },
    tweens: null,
    input: null,
  };
}

/** In-memory Storage-like stub tracking the persisted audioMuted flag. */
function makeMuteStorage(initialMuted = false) {
  let state = { audioMuted: initialMuted };
  return {
    load: () => ({ ...state }),
    save: (patch) => {
      state = { ...state, ...patch };
    },
    get muted() {
      return state.audioMuted;
    },
  };
}

describe('AudioBus — Property 21: Mute persists and never affects gameplay', () => {
  // **Validates: Requirements 9.4, 12.4, 12.5**
  it('setMuted reports and persists the flag, and restores it on init', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }), (toggles) => {
        const storage = makeMuteStorage(false);
        AudioBus.init(makeStubScene(), storage);

        for (const value of toggles) {
          AudioBus.setMuted(value);
          expect(AudioBus.isMuted()).toBe(value);
          expect(storage.muted).toBe(value);
        }

        // Restored on the next init from the persisted flag.
        const last = toggles[toggles.length - 1];
        AudioBus.init(makeStubScene(), storage);
        expect(AudioBus.isMuted()).toBe(last);
      }),
    );
  });

  it('toggling mute never changes score, lives, level, or simulation state', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 20 }), fc.integer({ min: 1, max: 1000 }), (toggles, points) => {
        const score = new ScoreSystem();
        score.addScore(points);
        score.nextLevel();
        const before = score.snapshot();

        AudioBus.init(makeStubScene(), makeMuteStorage());
        for (const value of toggles) AudioBus.setMuted(value);

        // Gameplay state is entirely untouched by mute operations (Req 12.5).
        expect(score.snapshot()).toEqual(before);
      }),
    );
  });
});

describe('AudioBus — Property 22: Missing audio is a silent no-op', () => {
  // **Validates: Requirements 12.6**
  // For any cue whose audio asset failed to load, playing it does nothing and
  // does not throw.
  it('playing events/sfx/music with no loaded assets never throws', () => {
    fc.assert(
      fc.property(eventArb, fc.string(), (event, rawKey) => {
        // Stub scene reports NO loaded audio keys → every cue is a no-op.
        AudioBus.init(makeStubScene([]), makeMuteStorage());
        expect(() => AudioBus.play(event)).not.toThrow();
        expect(() => AudioBus.sfx(rawKey)).not.toThrow();
        expect(() => AudioBus.music(rawKey)).not.toThrow();
        expect(() => AudioBus.stopMusic()).not.toThrow();
      }),
    );
  });

  it('with a null scene, all playback entry points are safe no-ops', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        AudioBus.init(null, makeMuteStorage());
        expect(() => AudioBus.play(event)).not.toThrow();
        expect(() => AudioBus.sfx('sfx_pellet_0')).not.toThrow();
        expect(() => AudioBus.music('music_game')).not.toThrow();
      }),
    );
  });
});
