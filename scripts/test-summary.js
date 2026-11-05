// Tests for js/summary.js. Run: node scripts/test-summary.js
const assert = require('assert');
require('../js/summary.js');
const S = globalThis.TaskSummary;
const D = S.dates;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok   ' + name); }
const at = (day, h) => { const p = day.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], h || 12).toISOString(); };
const task = (o) => Object.assign({ type: 'daily', completed: false, title: 't' }, o);

test('date helpers', () => {
    assert.strictEqual(D.weekStart('2026-11-05'), '2026-11-02'); // Thursday -> Monday
    assert.strictEqual(D.weekEnd('2026-11-05'), '2026-11-08');
    assert.strictEqual(D.weekStart('2026-11-08'), '2026-11-02'); // Sunday belongs to the week before
    assert.strictEqual(D.monthEnd('2026-02-10'), '2026-02-28');
    assert.strictEqual(D.monthStart('2026-11-30'), '2026-11-01');
});

test('time zone decides the finished day', () => {
    assert.strictEqual(D.dayOf('2026-11-04T20:00:00Z', 'UTC'), '2026-11-04');
    assert.strictEqual(D.dayOf('2026-11-04T20:00:00Z', 'Asia/Kolkata'), '2026-11-05');
    assert.strictEqual(D.dayOf('', 'UTC'), '');
});

const week = [
    task({ id: 'A', dueDate: '2026-11-02', completed: true, completedAt: at('2026-11-02') }),     // due Mon, done Mon
    task({ id: 'B', dueDate: '2026-11-03', completed: true, completedAt: at('2026-11-04') }),     // due Tue, done Wed (late)
    task({ id: 'C', dueDate: '2026-11-04' }),                                                      // due Wed, open
    task({ id: 'D', dueDate: '2026-11-05', completed: true, completedAt: at('2026-11-05') }),     // due Thu, done Thu
    task({ id: 'E', type: 'custom', completed: true, completedAt: at('2026-11-05') }),             // custom list: ignored
    task({ id: 'F', type: 'weekly', dueDate: '2026-11-08', completed: true, completedAt: at('2026-11-06') }), // goal done in time
    task({ id: 'G', type: 'weekly', dueDate: '2026-11-08' })                                        // goal open
];

test('week: totals count each task once, goals included, custom lists left out', () => {
    const s = S.buildSummary(week, 'week', '2026-11-04', { today: '2026-11-09' });
    assert.strictEqual(s.start, '2026-11-02');
    assert.strictEqual(s.end, '2026-11-08');
    assert.strictEqual(s.planned, 6); // A B C D + 2 goals
    assert.strictEqual(s.done, 4);    // A B D + goal F
    assert.strictEqual(s.pct, 67);
    assert.strictEqual(s.goalsPlanned, 2);
    assert.strictEqual(s.goalsDone, 1);
    assert.strictEqual(s.needMore, 1); // 80% of 6 = 5 (rounded up), 4 done
    assert.strictEqual(s.inProgress, false);
});

test('week: a late task is missed on its due day and done on the day it was finished', () => {
    const s = S.buildSummary(week, 'week', '2026-11-04', { today: '2026-11-09' });
    const by = {}; s.items.forEach(i => by[i.label] = i);
    assert.strictEqual(s.items.length, 7);
    assert.deepStrictEqual([by.Mon.planned, by.Mon.done], [1, 1]);
    assert.deepStrictEqual([by.Tue.planned, by.Tue.done], [1, 0]); // B due, not finished that day
    assert.deepStrictEqual([by.Wed.planned, by.Wed.done], [2, 1]); // C due + B finished
    assert.deepStrictEqual([by.Thu.planned, by.Thu.done], [1, 1]);
    assert.strictEqual(by.Fri.planned, 0);
    assert.strictEqual(by.Fri.pct, null);                           // empty day has no percentage
    assert.strictEqual(s.best.label, 'Mon');                         // first of the 1-done days
});

test('week: still-open list has the open task and the open goal', () => {
    const s = S.buildSummary(week, 'week', '2026-11-04', { today: '2026-11-09' });
    assert.deepStrictEqual(s.carried.map(t => t.id), ['C', 'G']);
});

test('older completed tasks without a timestamp count on their due date', () => {
    const s = S.buildSummary([task({ dueDate: '2026-11-03', completed: true })], 'week', '2026-11-03', { today: '2026-11-09' });
    assert.strictEqual(s.done, 1);
    assert.strictEqual(s.items[1].done, 1); // Tuesday
});

test('month: bars are the weeks, cut at the month edges', () => {
    const s = S.buildSummary([], 'month', '2026-11-15', { today: '2026-12-01' });
    assert.strictEqual(s.start, '2026-11-01');
    assert.strictEqual(s.end, '2026-11-30');
    assert.deepStrictEqual(s.items.map(i => i.start + '..' + i.end), [
        '2026-11-01..2026-11-01', '2026-11-02..2026-11-08', '2026-11-09..2026-11-15',
        '2026-11-16..2026-11-22', '2026-11-23..2026-11-29', '2026-11-30..2026-11-30'
    ]);
});

test('month: includes monthly goals and weekly goals ending in the month', () => {
    const tasks = week.concat([
        task({ id: 'M1', type: 'monthly', dueDate: '2026-11-30', completed: true, completedAt: at('2026-11-20') }),
        task({ id: 'M2', type: 'monthly', dueDate: '2026-11-30' })
    ]);
    const s = S.buildSummary(tasks, 'month', '2026-11-10', { today: '2026-12-02' });
    assert.strictEqual(s.planned, 8);  // 4 daily + 2 weekly goals + 2 monthly goals
    assert.strictEqual(s.done, 5);
    assert.strictEqual(s.goalsPlanned, 4);
});

test('goal finished after its period ended does not count as done in that period', () => {
    const s = S.buildSummary([task({ type: 'weekly', dueDate: '2026-11-08', completed: true, completedAt: at('2026-11-10') })],
        'week', '2026-11-04', { today: '2026-11-12' });
    assert.strictEqual(s.planned, 1);
    assert.strictEqual(s.done, 0);
});

test('tiers: 80 and above cheers, 50 to 79 nudges, below 50 motivates', () => {
    assert.strictEqual(S.tierOf(100), 'cheer');
    assert.strictEqual(S.tierOf(80), 'cheer');
    assert.strictEqual(S.tierOf(79), 'nudge');
    assert.strictEqual(S.tierOf(50), 'nudge');
    assert.strictEqual(S.tierOf(49), 'low');
    assert.strictEqual(S.tierOf(0), 'low');
    assert.strictEqual(S.tierOf(null), 'none');
});

test('a running period is described as in progress, a finished one as final', () => {
    const t = [task({ dueDate: '2026-11-03', completed: true, completedAt: at('2026-11-03') }), task({ dueDate: '2026-11-04' })];
    const running = S.describe(S.buildSummary(t, 'week', '2026-11-04', { today: '2026-11-04' }));
    const closed = S.describe(S.buildSummary(t, 'week', '2026-11-04', { today: '2026-11-10' }));
    assert.strictEqual(running.headline, 'Within reach');
    assert.ok(/so far/.test(running.line));
    assert.strictEqual(closed.headline, 'Almost there');
    assert.ok(!/so far/.test(closed.line));
});

test('no tasks gives a plain message, not a percentage', () => {
    const d = S.describe(S.buildSummary([], 'week', '2026-11-04', { today: '2026-11-10' }));
    assert.strictEqual(d.tier, 'none');
    assert.strictEqual(d.line, '');
});

test('every message is filled in and has no emoji', () => {
    const noEmoji = /\p{Extended_Pictographic}/u;
    for (const kind of ['week', 'month']) {
        for (let done = 0; done <= 10; done++) {
            for (const today of ['2026-11-04', '2026-12-20']) {
                const t = [];
                for (let i = 0; i < 10; i++) t.push(task({ dueDate: '2026-11-04', completed: i < done, completedAt: i < done ? at('2026-11-04') : undefined }));
                const d = S.describe(S.buildSummary(t, kind, '2026-11-04', { today }));
                assert.ok(!/[{}]/.test(d.message + d.line), 'unfilled placeholder: ' + d.message);
                assert.ok(!noEmoji.test(d.message + d.headline + d.line), 'emoji in message');
            }
        }
    }
});

test('push text is short and names the period', () => {
    const t = [task({ dueDate: '2026-11-03', completed: true, completedAt: at('2026-11-03') })];
    const p = S.pushText(S.buildSummary(t, 'week', '2026-11-04', { today: '2026-11-10' }));
    assert.ok(/week in review/.test(p.title));
    assert.ok(p.body.length < 220, 'body too long: ' + p.body.length);
});

console.log('\n' + passed + ' tests passed');
