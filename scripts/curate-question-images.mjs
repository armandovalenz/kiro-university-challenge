#!/usr/bin/env node
// One-shot curation: fetch freely-licensed visual aids from Wikimedia Commons
// for each distinct SCIENCE topic in the question bank, download a web-ready PNG
// into public/assets/questions/images/, and emit a manifest + attributions.
//
// Licensing: only CC0 / Public Domain / CC-BY / CC-BY-SA files are accepted.
// Attribution (artist + license + source) is recorded for every downloaded file.
// Throttled + retries on HTTP 429 to respect the Wikimedia API. Resumes: topics
// already present in the manifest with a valid file on disk are skipped.
//
// Build-time tool, NOT shipped game code. Run: node scripts/curate-question-images.mjs

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const OUT_DIR = 'public/assets/questions/images';
const MANIFEST = path.join(OUT_DIR, 'images-manifest.json');
const MIN_BYTES = 6000; // reject tiny icon downloads (diagrams can be small SVG-rendered PNGs)
const UA = 'MathMan-EduGame/1.0 (educational question visual aids; non-commercial)';

const TOPIC_QUERIES = {
  plants: 'leaf anatomy diagram',
  ecosystems: 'food web diagram',
  adaptations: 'cactus desert plant',
  matter: 'states of matter diagram',
  mixtures: 'filtration separation mixture diagram',
  forces: 'forces push pull diagram',
  energy: 'potential energy spring',
  'earth-systems': 'weathering erosion diagram',
  'water-cycle': 'water cycle diagram',
  'solar-system': 'earth rotation day night diagram',
  'human-body': 'human respiratory system diagram',
  'scientific-practice': 'scientific method diagram',
  cells: 'animal cell diagram',
  photosynthesis: 'photosynthesis diagram',
  'food-webs': 'ecological pyramid energy diagram',
  'chemical-changes': 'combustion fire chemical change',
  'thermal-energy': 'heat conduction diagram',
  waves: 'sound wave diagram',
  motion: 'distance time graph',
  gravity: 'gravity diagram',
  'earth-structure': 'earth internal structure diagram',
  'plate-tectonics': 'divergent boundary diagram',
  weather: 'barometer',
  climate: 'koppen climate classification map',
  genetics: 'DNA structure diagram',
  'natural-selection': 'natural selection diagram',
  'body-systems': 'circulatory system diagram',
  homeostasis: 'thermoregulation diagram',
  'chemical-reactions': 'chemical reaction equation diagram',
  atoms: 'atomic structure diagram',
  'kinetic-energy': 'kinetic energy diagram',
  'potential-energy': 'gravitational potential energy diagram',
  'heat-transfer': 'convection diagram',
  'earth-history': 'stratigraphy fossil layers diagram',
  astronomy: 'axial tilt seasons diagram',
};

const ACCEPT_LICENSE = /^(cc0|pd|cc-by|cc-by-sa)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(url, { json = false } = {}, tries = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode === 429 || res.statusCode === 503) {
        res.resume();
        if (tries >= 5) { reject(new Error('HTTP ' + res.statusCode + ' after retries')); return; }
        const wait = 2000 * (tries + 1);
        setTimeout(() => request(url, { json }, tries + 1).then(resolve, reject), wait);
        return;
      }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        request(res.headers.location, { json }, tries).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      if (json) {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      } else {
        resolve(res);
      }
    }).on('error', reject);
  });
}

async function getJSON(url) { return request(url, { json: true }); }

async function download(url, dest) {
  const res = await request(url, { json: false });
  await new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    res.pipe(f);
    f.on('finish', () => f.close(() => resolve()));
    f.on('error', reject);
  });
}

const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function searchTopic(term) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search'
    + '&gsrsearch=' + encodeURIComponent(term)
    + '&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=800&format=json';
  const json = await getJSON(api);
  const pages = json && json.query && json.query.pages ? Object.values(json.query.pages) : [];
  pages.sort((a, b) => (a.index || 999) - (b.index || 999));
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0];
    if (!ii) continue;
    const meta = ii.extmetadata || {};
    const license = (meta.License && meta.License.value) || '';
    if (!/^image\//.test(ii.mime || '')) continue;
    if (!ACCEPT_LICENSE.test(license)) continue;
    const thumb = ii.thumburl && ii.thumburl.split('?')[0];
    if (!thumb) continue;
    return {
      title: p.title, thumbUrl: thumb, descriptionUrl: ii.descriptionurl,
      license: (meta.LicenseShortName && meta.LicenseShortName.value) || license,
      licenseCode: license, artist: stripHtml(meta.Artist && meta.Artist.value) || 'Unknown',
      description: stripHtml(meta.ImageDescription && meta.ImageDescription.value),
    };
  }
  return null;
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = loadManifest();
  for (const [topic, term] of Object.entries(TOPIC_QUERIES)) {
    const file = topic + '.png';
    const dest = path.join(OUT_DIR, file);
    // Resume: skip topics already captured with a valid-size file on disk.
    if (manifest[topic] && fs.existsSync(dest) && fs.statSync(dest).size >= MIN_BYTES) {
      console.log('HAVE  ', topic);
      continue;
    }
    try {
      const hit = await searchTopic(term);
      if (!hit) { console.log('SKIP  ', topic, '(no acceptable-license result)'); await sleep(1500); continue; }
      await download(hit.thumbUrl, dest);
      const bytes = fs.statSync(dest).size;
      if (bytes < MIN_BYTES) { fs.unlinkSync(dest); delete manifest[topic]; console.log('SKIP  ', topic, '(too small ' + bytes + 'B)'); await sleep(1500); continue; }
      manifest[topic] = {
        file, license: hit.license, licenseCode: hit.licenseCode, artist: hit.artist,
        sourceUrl: hit.descriptionUrl, commonsTitle: hit.title, description: hit.description, bytes,
      };
      console.log('OK    ', topic, '->', file, '[' + hit.license + ']', Math.round(bytes / 1024) + 'kB');
    } catch (e) {
      console.log('ERROR ', topic, e.message);
    }
    await sleep(3500); // throttle: be polite to the Wikimedia API
  }
  // Drop the undersized forces.png captured in the first pass so it is re-fetched.
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log('\nManifest now has', Object.keys(manifest).length, 'of', Object.keys(TOPIC_QUERIES).length, 'topics.');
}

main();
