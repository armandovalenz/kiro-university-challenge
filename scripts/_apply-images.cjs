// One-shot: add an optional `image` field to each science question whose topic
// has a manifest entry. Preserves 2-space indentation, field order, and all
// existing records; only appends `image` to matching science records.
const fs = require('fs');

const BANK = './public/assets/questions/math_man_question_bank_120.json';
const MANIFEST = './public/assets/questions/images/images-manifest.json';

const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Concise, student-friendly alt text per topic. Composed from the topic + the
// manifest description (not a raw dump) — short and specific.
const ALT = {
  plants: 'Labeled diagram of the internal structure of a plant leaf.',
  'earth-systems': 'Diagram showing how frost weathering slowly breaks apart rock to form a shelter.',
  'water-cycle': 'Diagram of the water cycle: evaporation, condensation, precipitation, and runoff.',
  'solar-system': "Diagram of Earth orbiting the Sun and spinning on its tilted axis through the seasons.",
  ecosystems: 'Food web diagram showing feeding links among many species in a lagoon ecosystem.',
  adaptations: 'Photo of pincushion cacti, desert plants adapted to survive with little water.',
  matter: 'Pressure-volume graph showing how carbon dioxide changes between gas and liquid states.',
  'human-body': 'Labeled diagram of the human respiratory system, including the lungs and airways.',
  'scientific-practice': "Diagram of chemical and transport processes that cycle elements through Earth's atmosphere.",
  cells: 'Diagram of the animal cell cycle, showing the stages a cell goes through as it divides.',
  photosynthesis: 'Simplified diagram of C4 photosynthesis, how some plants capture carbon dioxide.',
  'food-webs': 'Energy pyramid showing how energy decreases at each higher level of a food chain.',
  'chemical-changes': 'Historical illustration about the combustion of coal, an example of a chemical change.',
  'thermal-energy': 'Diagram illustrating how heat conducts through a material (thermal conductivity).',
  waves: 'Diagram comparing the sound waves of the three notes in an A major chord.',
  motion: 'Example distance-time graph used to describe the motion of an object.',
  gravity: 'Cross-section diagram of a gravity dam, which uses its own weight to hold back water.',
  'earth-structure': "Labeled cutaway diagram of Earth's internal layers from crust to core.",
  'plate-tectonics': 'Diagram of a divergent plate boundary where continental plates pull apart to form a rift.',
  weather: 'Photo of a 19th-century mercury barometer, an instrument that measures air pressure.',
  climate: 'Köppen climate classification map of South Asia, color-coded by climate type.',
  'body-systems': 'Simplified diagram of the human circulatory system and its path of blood flow.',
  homeostasis: 'Diagram sorting animals into thermoregulation groups by how they control body temperature.',
  atoms: 'Illustration of atomic structure, showing how particles fold into a larger shape.',
  'kinetic-energy': 'Diagram comparing the kinetic energy of a slow train and a fast high-speed train.',
  'heat-transfer': 'Model of heat transfer by convection, showing warm material rising and cool material sinking.',
  astronomy: 'Photo of a precision cam encoding Earth motion over thousands of years for a long-term clock.',
  mixtures: 'Process-flow diagram of the steps used to produce insulin, separating and purifying a mixture.',
  genetics: 'Diagram of the structure of DNA and its four base pairs.',
};

let count = 0;
const missingAlt = [];
for (const rec of bank) {
  if (rec.subject !== 'science') continue;
  const entry = manifest[rec.topic];
  if (!entry) continue; // 6 topics without images stay image-free
  const alt = ALT[rec.topic];
  if (!alt) { missingAlt.push(rec.topic); continue; }
  rec.image = {
    file: entry.file,
    alt,
    attribution: `${entry.artist} / ${entry.license} (Wikimedia Commons)`,
    license: entry.license,
    sourceUrl: entry.sourceUrl,
  };
  count += 1;
}

if (missingAlt.length) {
  console.error('MISSING ALT for topics:', [...new Set(missingAlt)]);
  process.exit(1);
}

fs.writeFileSync(BANK, JSON.stringify(bank, null, 2) + '\n', 'utf8');
console.log('Added image field to', count, 'science questions.');
