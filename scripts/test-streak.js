// Tests for js/streak.js. Run: node scripts/test-streak.js
const assert = require('assert');
require('../js/streak.js');
const K = globalThis.TaskStreak;
const D = K.dates;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok   ' + name); }
const at = (day) => { const p = day.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12).toISOString(); };
const task = (o) => Object.assign({ type: 'daily', completed: false, title: 't' }, o);
// `planned` tasks due on `day`, the first `done` of them finished that day
function day(dayStr, planned, done) {
    const out = [];
    for (let i = 0; i < planned; i++) out.push(task({ dueDate: dayStr, completed: i < done, completedAt: i < done ? at(dayStr) : undefined }));
    return out;
}
// Thursday 2026-11-05 is "today" in most tests; that week runs Mon 11-02 .. Sun 11-08
const TODAY = '2026-11-05';

test('a day counts with 2 finished, or all planned when fewer than 2', () => {
    assert.strictEqual(K.computeStreak(day(TODAY, 5, 2), { today: TODAY }).qualifiedToday, true);
    assert.strictEqual(K.computeStreak(day(TODAY, 5, 1), { today: TODAY }).qualifiedToday, false);
    assert.strictEqual(K.computeStreak(day(TODAY, 1, 1), { today: TODAY }).qualifiedToday, true);
    assert.strictEqual(K.computeStreak(day(TODAY, 1, 0), { today: TODAY }).qualifiedToday, false);
});

test('how many more are needed today', () => {
    assert.strictEqual(K.computeStreak(day(TODAY, 5, 1), { today: TODAY }).need, 1);
    assert.strictEqual(K.computeStreak(day(TODAY, 5, 0), { today: TODAY }).need, 2);
    assert.strictEqual(K.computeStreak(day(TODAY, 1, 0), { today: TODAY }).need, 1);
    assert.strictEqual(K.computeStreak([], { today: TODAY }).need, 1);
});

test('consecutive counted days build the streak; today does not break it while it is going on', () => {
    const t = [].concat(day('2026-11-02', 2, 2), day('2026-11-03', 2, 2), day('2026-11-04', 3, 2), day(TODAY, 3, 0));
    const s = K.computeStreak(t, { today: TODAY });
    assert.strictEqual(s.current, 3);
    assert.strictEqual(s.qualifiedToday, false);
    assert.strictEqual(s.atRisk, false); // the rest day is still free this week
});

test('one rest day per week is forgiven, a second one breaks the streak', () => {
    const one = [].concat(day('2026-11-02', 2, 2), day('2026-11-03', 2, 0), day('2026-11-04', 2, 2));
    const s1 = K.computeStreak(one, { today: TODAY });
    assert.strictEqual(s1.current, 2);           // Mon + Wed, Tue was the rest day
    assert.strictEqual(s1.restUsedThisWeek, true);
    assert.strictEqual(s1.restDay, '2026-11-03');
    assert.strictEqual(s1.atRisk, true);         // today must count now

    const two = [].concat(day('2026-11-02', 2, 2), day('2026-11-03', 2, 0), day('2026-11-04', 2, 0));
    assert.strictEqual(K.computeStreak(two, { today: TODAY }).current, 0);
});

test('the rest day resets each Monday', () => {
    // Wed 10-28 missed (rest of week 10-26), Tue 11-03 missed (rest of week 11-02): both forgiven
    const t = [];
    for (let d = '2026-10-26'; d <= '2026-11-04'; d = D.addDays(d, 1)) {
        t.push(...day(d, 2, (d === '2026-10-28' || d === '2026-11-03') ? 0 : 2));
    }
    assert.strictEqual(K.computeStreak(t, { today: TODAY }).current, 8);
});

test('an empty day with nothing planned uses the rest day too', () => {
    const t = [].concat(day('2026-11-02', 2, 2), day('2026-11-04', 2, 2)); // nothing on Tuesday
    assert.strictEqual(K.computeStreak(t, { today: TODAY }).current, 2);
});

test('best streak is remembered after a break', () => {
    const t = [];
    for (let d = '2026-10-01'; d <= '2026-10-10'; d = D.addDays(d, 1)) t.push(...day(d, 2, 2)); // 10 days
    t.push(...day('2026-10-11', 2, 0), ...day('2026-10-12', 2, 0));                               // break (2 misses, same week)
    t.push(...day('2026-11-04', 2, 2));
    const s = K.computeStreak(t, { today: TODAY });
    assert.strictEqual(s.best, 10);
    assert.ok(s.current < 10);
});

test('finishing an overdue task counts on the day it is finished', () => {
    const t = [task({ dueDate: '2026-11-01', completed: true, completedAt: at(TODAY) }), task({ dueDate: '2026-11-01', completed: true, completedAt: at(TODAY) })];
    assert.strictEqual(K.computeStreak(t, { today: TODAY }).qualifiedToday, true);
});

test('week view and milestones', () => {
    const t = [];
    for (let d = '2026-10-30'; d <= TODAY; d = D.addDays(d, 1)) t.push(...day(d, 2, 2)); // 7 days ending today
    const s = K.computeStreak(t, { today: TODAY });
    assert.strictEqual(s.current, 7);
    assert.strictEqual(s.isMilestone, true);
    assert.strictEqual(s.nextMilestone, 21);
    assert.deepStrictEqual(s.week.map(w => w.status), ['done', 'done', 'done', 'done', 'future', 'future', 'future']);
    assert.deepStrictEqual(s.week.map(w => w.letter).join(''), 'MTWTFSS');
});

// ---- habits ----
const habit = (o) => Object.assign({ start_date: '2026-11-01', schedule: 'daily', target_days: 21, checkins: [] }, o);
const days = (from, to, skip) => { const out = []; for (let d = from; d <= to; d = D.addDays(d, 1)) if (!(skip || []).includes(d)) out.push(d); return out; };

test('habit: each check-in moves the challenge forward', () => {
    const p = K.habitProgress(habit({ checkins: days('2026-11-01', '2026-11-04') }), TODAY);
    assert.strictEqual(p.run, 4);
    assert.strictEqual(p.daysLeft, 17);
    assert.strictEqual(p.checkedToday, false);
    assert.strictEqual(p.scheduledToday, true);
});

test('habit: one missed day is forgiven (never miss twice)', () => {
    const p = K.habitProgress(habit({ checkins: days('2026-11-01', '2026-11-04', ['2026-11-03']) }), TODAY);
    assert.strictEqual(p.run, 3);
    assert.strictEqual(p.restarts, 0);
});

test('habit: missing yesterday puts today on last chance', () => {
    const p = K.habitProgress(habit({ checkins: days('2026-11-01', '2026-11-03') }), TODAY);
    assert.strictEqual(p.onLastChance, true);
});

test('habit: two missed days in a row start the challenge over', () => {
    const p = K.habitProgress(habit({ checkins: ['2026-11-01', '2026-11-02'] }), TODAY); // missed 3rd and 4th
    assert.strictEqual(p.run, 0);
    assert.strictEqual(p.restarts, 1);
    assert.strictEqual(p.runStart, TODAY);
});

test('habit: weekdays-only habits skip weekends', () => {
    const h = habit({ schedule: 'weekdays', start_date: '2026-11-02', checkins: days('2026-11-02', '2026-11-06') });
    const p = K.habitProgress(h, '2026-11-09'); // Monday after: Sat/Sun are not missed days
    assert.strictEqual(p.run, 5);
    assert.strictEqual(p.restarts, 0);
    assert.strictEqual(K.isScheduled(h, '2026-11-07'), false);
});

test('habit: 21 days completes the challenge, 66 continues it', () => {
    const h = habit({ checkins: days('2026-11-01', '2026-11-21') });
    const p = K.habitProgress(h, '2026-11-21');
    assert.strictEqual(p.run, 21);
    assert.strictEqual(p.complete, true);
    const p66 = K.habitProgress(Object.assign({}, h, { target_days: 66 }), '2026-11-21');
    assert.strictEqual(p66.complete, false);
    assert.strictEqual(p66.daysLeft, 45);
});

test('habit check-ins for a summary period', () => {
    const h = habit({ checkins: days('2026-11-02', '2026-11-05', ['2026-11-03']) });
    const s = K.habitPeriodStats([h], '2026-11-02', '2026-11-08', TODAY); // only up to today
    assert.deepStrictEqual(s, { scheduled: 4, checked: 3 });
});

console.log('\n' + passed + ' tests passed');
