const fs = require('fs');
const d = JSON.parse(fs.readFileSync('./public/assets/questions/math_man_question_bank_120.json', 'utf8'));
const m = JSON.parse(fs.readFileSync('./public/assets/questions/images/images-manifest.json', 'utf8'));
const sci = d.filter((q) => q.subject === 'science');
const topics = [...new Set(sci.map((q) => q.topic))].sort();
console.log('science topics (' + topics.length + '):', JSON.stringify(topics));
console.log('NOT in manifest:', JSON.stringify(topics.filter((t) => !m[t])));
console.log('math count:', d.filter((q) => q.subject === 'math').length);
console.log('science count:', sci.length, 'total:', d.length, 'sci w/ manifest topic:', sci.filter((q) => m[q.topic]).length);
