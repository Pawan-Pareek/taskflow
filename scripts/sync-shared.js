// Copies the shared logic files (masters in js/) to the Edge Functions' shared folder, so the app and
// the server count summaries, streaks and habits the same way. Run after editing any of them:
//   node scripts/sync-shared.js          (copy)
//   node scripts/sync-shared.js --check  (exit 1 if a copy is out of date)
const fs = require('fs');
const path = require('path');

const FILES = ['summary.js', 'streak.js'];
const check = process.argv.includes('--check');
let stale = 0;

for (const name of FILES) {
    const src = path.join(__dirname, '..', 'js', name);
    const dest = path.join(__dirname, '..', 'supabase', 'functions', '_shared', name);
    const out = '// GENERATED from js/' + name + ' by scripts/sync-shared.js. Do not edit here.\n' + fs.readFileSync(src, 'utf8');
    if (check) {
        const same = fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === out;
        if (!same) stale++;
        console.log((same ? 'up to date: ' : 'OUT OF DATE: ') + name);
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, out);
        console.log('copied ' + name);
    }
}
if (check && stale) { console.log('run: node scripts/sync-shared.js'); process.exit(1); }
