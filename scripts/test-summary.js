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

// ---- trend ----
// n tasks due on the Monday of the week `weeksAgo` before 2026-11-02, `done` of them finished that day
function weekTasks(weeksAgo, n, done, late) {
    const mon = D.addDays('2026-11-02', -7 * weeksAgo);
    const out = [];
    for (let i = 0; i < n; i++) {
        const finished = i < done;
        out.push(task({ dueDate: mon, completed: finished, completedAt: finished ? at(late && i === 0 ? D.addDays(mon, 2) : mon) : undefined }));
    }
    return out;
}

test('trend: 12 points, oldest first, ending with the current week', () => {
    const tr = S.buildTrend([], 'week', '2026-11-04', { today: '2026-11-04' });
    assert.strictEqual(tr.points.length, 12);
    assert.strictEqual(tr.points[11].start, '2026-11-02');
    assert.strictEqual(tr.points[0].start, D.addDays('2026-11-02', -77));
    assert.strictEqual(tr.points[11].inProgress, true);
    assert.strictEqual(tr.points[11].label, 'Nov 2');
});

test('trend: empty weeks are gaps, not zero', () => {
    const tr = S.buildTrend(weekTasks(1, 4, 2), 'week', '2026-11-04', { today: '2026-11-04' });
    assert.strictEqual(tr.points[10].pct, 50);
    assert.strictEqual(tr.points[9].pct, null);
});

test('trend: rising completion reads as up, falling as down, flat as steady', () => {
    const today = { today: '2026-11-04' };
    const rising = [].concat(weekTasks(8, 10, 4), weekTasks(7, 10, 4), weekTasks(6, 10, 5), weekTasks(5, 10, 5),
        weekTasks(4, 10, 8), weekTasks(3, 10, 8), weekTasks(2, 10, 9), weekTasks(1, 10, 9));
    const up = S.buildTrend(rising, 'week', '2026-11-04', today);
    assert.strictEqual(up.change.direction, 'up');
    assert.strictEqual(up.change.delta, 40); // (85 avg) - (45 avg)
    assert.strictEqual(up.change.window, 4);
    assert.ok(/^Up 40 points, last 4 weeks$/.test(S.describeTrend(up).text));

    const falling = [].concat(weekTasks(2, 10, 9), weekTasks(1, 10, 3));
    assert.strictEqual(S.buildTrend(falling, 'week', '2026-11-04', today).change.direction, 'down');

    const flat = [].concat(weekTasks(2, 10, 7), weekTasks(1, 10, 7));
    assert.strictEqual(S.buildTrend(flat, 'week', '2026-11-04', today).change.direction, 'steady');
});

test('trend: the running week is not used for up / down', () => {
    const t = [].concat(weekTasks(2, 10, 5), weekTasks(1, 10, 5), weekTasks(0, 10, 10));
    assert.strictEqual(S.buildTrend(t, 'week', '2026-11-04', { today: '2026-11-04' }).change.direction, 'steady');
});

test('trend: not enough history says so', () => {
    const tr = S.buildTrend(weekTasks(1, 4, 2), 'week', '2026-11-04', { today: '2026-11-04' });
    assert.strictEqual(tr.change, null);
    assert.strictEqual(S.describeTrend(tr).direction, 'none');
});

test('trend: on time counts tasks finished by their due date', () => {
    const tr = S.buildTrend(weekTasks(1, 4, 3, true), 'week', '2026-11-04', { today: '2026-11-04' }); // 1 of the 3 finished late
    const p = tr.points[10];
    assert.strictEqual(p.due, 4);
    assert.strictEqual(p.onTime, 2);
    assert.strictEqual(p.onTimePct, 50);
    assert.strictEqual(p.pct, 75); // still 3 of 4 completed that week
});

test('trend: monthly points are calendar months', () => {
    const tr = S.buildTrend([], 'month', '2026-11-15', { today: '2026-11-15' });
    assert.strictEqual(tr.points.length, 12);
    assert.strictEqual(tr.points[11].start, '2026-11-01');
    assert.strictEqual(tr.points[0].start, '2025-12-01');
    assert.strictEqual(tr.points[11].label, 'Nov');
});

console.log('\n' + passed + ' tests passed');
