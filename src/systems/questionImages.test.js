// Integrity + passthrough tests for the optional per-question visual-aid images
// (see public/assets/questions/images/ASSETS.md). These guard the data↔asset
// seam and QuestionBank's image handling without a Phaser/WebGL runtime, so
// they stay framework-agnostic (reading the bundled JSON + image dir straight
// off disk, like importBoundary.test.js). Deterministic: no randomness in the
// integrity checks, no network.
//
// What is covered:
//   1. Every `image.file` referenced by a question actually exists in
//      public/assets/questions/images/ (no dangling references).
//   2. Every record that carries an `image` has a non-empty string `file` AND
//      `alt` (the two fields the UI requires to render the card).
//   3. QuestionBank keeps image-bearing records valid and returns the `image`
//      through `next()` (so QuizScene can pass it to QuizModal), AND still
//      serves records that have no image. A malformed image is dropped without
//      invalidating the question.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import QuestionBank, {
  isValidRecord,
  validateRecords,
  sanitizeImage,
} from './QuestionBank.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const BANK_PATH = join(REPO_ROOT, 'public/assets/questions/math_man_question_bank_120.json');
const IMAGES_DIR = join(REPO_ROOT, 'public/assets/questions/images');

/** The bundled question bank, parsed once. */
const BANK = JSON.parse(readFileSync(BANK_PATH, 'utf8'));
/** Records that carry an optional `image` object. */
const WITH_IMAGE = BANK.filter((q) => q && q.image);

describe('Question visual-aid images — data ↔ asset integrity', () => {
  it('the bundled bank is a non-empty array of records', () => {
    expect(Array.isArray(BANK)).toBe(true);
    expect(BANK.length).toBeGreaterThan(0);
  });

  it('every image.file referenced by a question exists on disk', () => {
    expect(WITH_IMAGE.length).toBeGreaterThan(0); // the feature is actually wired
    for (const q of WITH_IMAGE) {
      const file = q.image.file;
      const path = join(IMAGES_DIR, file);
      expect(existsSync(path), `missing image file "${file}" for question ${q.id}`).toBe(true);
    }
  });

  it('every record with an image has a non-empty string file and alt', () => {
    for (const q of WITH_IMAGE) {
      expect(typeof q.image.file).toBe('string');
      expect(q.image.file.trim(), `empty file on ${q.id}`).not.toBe('');
      expect(typeof q.image.alt).toBe('string');
      expect(q.image.alt.trim(), `empty alt on ${q.id}`).not.toBe('');
    }
  });

  it('image.file is a bare filename (no path), so the UI builds the runtime path', () => {
    for (const q of WITH_IMAGE) {
      expect(q.image.file).not.toMatch(/[\\/]/);
    }
  });

  it('only science questions carry images (math questions never do)', () => {
    for (const q of WITH_IMAGE) {
      expect(q.subject, `math question ${q.id} should not have an image`).toBe('science');
    }
  });

  it('every referenced image file is listed in images-manifest.json', () => {
    const manifest = JSON.parse(readFileSync(join(IMAGES_DIR, 'images-manifest.json'), 'utf8'));
    const manifestFiles = new Set(Object.values(manifest).map((m) => m.file));
    for (const q of WITH_IMAGE) {
      expect(manifestFiles.has(q.image.file), `${q.image.file} not in manifest`).toBe(true);
    }
  });
});

describe('QuestionBank — image passthrough and tolerance', () => {
  it('image-bearing records are valid and keep their image through validation', () => {
    for (const q of WITH_IMAGE) {
      expect(isValidRecord(q)).toBe(true);
    }
    const kept = validateRecords(WITH_IMAGE);
    expect(kept.length).toBe(WITH_IMAGE.length);
    for (const rec of kept) {
      expect(rec.image).toBeTruthy();
      expect(typeof rec.image.file).toBe('string');
      expect(typeof rec.image.alt).toBe('string');
    }
  });

  it('next() returns the full record including the image so QuizScene can pass it on', () => {
    // A tiny two-record pool: one with an image, one without, both grade 5.
    const withImg = {
      id: 'IMG-1', grade: 5, subject: 'science', topic: 'plants', difficulty: 'easy',
      question: 'Which part captures light?', choices: ['Leaf', 'Root'], answer: 'Leaf',
      explanation: 'Leaves capture light.',
      image: {
        file: 'plants.png',
        alt: 'Labeled diagram of a plant leaf.',
        attribution: 'Nishānt Omm / CC BY-SA 4.0 (Wikimedia Commons)',
        license: 'CC BY-SA 4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Leaf_Structure-hi.png',
      },
    };
    const noImg = {
      id: 'TXT-1', grade: 5, subject: 'science', topic: 'forces', difficulty: 'easy',
      question: 'Which force slows a sliding book?', choices: ['Friction', 'Light'], answer: 'Friction',
      explanation: 'Friction opposes motion.',
    };

    const bank = new QuestionBank();
    bank._ingest(validateRecords([withImg, noImg]), false);

    // Force selection of the image-bearing record (rng → index 0).
    const picked = bank.next(5, { topic: undefined }, [], () => 0);
    expect(picked).not.toBeNull();
    // Whichever is picked, the shape round-trips: an image-bearing record keeps
    // a well-formed image; a text-only record simply has none.
    if (picked.id === 'IMG-1') {
      expect(picked.image).toBeTruthy();
      expect(picked.image.file).toBe('plants.png');
      expect(picked.image.alt).toBe('Labeled diagram of a plant leaf.');
      expect(picked.image.attribution).toContain('Wikimedia Commons');
    } else {
      expect(picked.image).toBeUndefined();
    }

    // Explicitly exercise the text-only path too (avoid IMG-1 so the other is served).
    const other = bank.next(5, {}, ['IMG-1'], () => 0);
    expect(other.id).toBe('TXT-1');
    expect(other.image).toBeUndefined();
  });

  it('a malformed image is dropped without invalidating the question', () => {
    const base = {
      id: 'BAD-IMG', grade: 6, subject: 'science', topic: 'cells', difficulty: 'easy',
      question: 'What is the basic unit of life?', choices: ['Cell', 'Atom'], answer: 'Cell',
      explanation: 'The cell is the smallest unit of life.',
    };
    const malformedImages = [
      null,
      {},
      { file: '', alt: 'x' },
      { file: 'cells.png' }, // missing alt
      { alt: 'only alt' }, // missing file
      { file: '   ', alt: '   ' },
      'cells.png', // not an object
    ];
    for (const image of malformedImages) {
      const rec = { ...base, image };
      // Still a valid question (image is optional).
      expect(isValidRecord(rec)).toBe(true);
      // Sanitize drops just the image.
      const clean = sanitizeImage(rec);
      expect(clean.image).toBeUndefined();
      // The rest of the record is untouched.
      expect(clean.id).toBe(base.id);
      expect(clean.answer).toBe(base.answer);
    }

    // A well-formed image survives sanitize unchanged.
    const good = { ...base, image: { file: 'cells.png', alt: 'Animal cell cycle diagram.' } };
    expect(sanitizeImage(good).image).toEqual(good.image);
  });
});
