// Copies js/summary.js (the master) to the Edge Functions' shared folder, so the app and the
// server count and word summaries the same way. Run after editing js/summary.js:
//   node scripts/sync-summary.js          (copy)
//   node scripts/sync-summary.js --check  (exit 1 if the copy is out of date)
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'js', 'summary.js');
const dest = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'summary.js');
const body = fs.readFileSync(src, 'utf8');
const out = '// GENERATED from js/summary.js by scripts/sync-summary.js. Do not edit here.\n' + body;

if (process.argv.includes('--check')) {
    const same = fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === out;
    console.log(same ? 'summary copy is up to date' : 'summary copy is OUT OF DATE: run node scripts/sync-summary.js');
    process.exit(same ? 0 : 1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('copied to ' + path.relative(process.cwd(), dest));
