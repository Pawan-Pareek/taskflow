// TaskFlow weekly / monthly summary: pure logic, shared by the app and the server.
// Master copy: js/summary.js. The Edge Function uses a copy in supabase/functions/_shared/
// (run `node scripts/sync-summary.js` after editing this file).
//
// How "covered" is counted (finished-day method):
//   - A task is counted on the day it was FINISHED (completed_at), not the day it was due.
//   - For a day / week / month, the tasks counted are those due in it plus those finished in it.
//   - Done = finished in it. So a task due Monday and finished Wednesday is "missed" on Monday
//     and "done" on Wednesday; over the whole week it is one finished task.
//   - Weekly and monthly goals belong to the week / month they were made for and count as done
//     when finished by the end of it. Tasks on custom lists have no date and are left out.
(function (root) {
    'use strict';

    var TARGET = 80; // percent
    var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // ---- dates: local calendar days as 'YYYY-MM-DD' strings ----
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmt(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
    function weekStart(s) { var d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmt(d); } // Monday
    function weekEnd(s) { return addDays(weekStart(s), 6); }
    function monthStart(s) { var d = parse(s); return fmt(new Date(d.getFullYear(), d.getMonth(), 1)); }
    function monthEnd(s) { var d = parse(s); return fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
    function maxStr(a, b) { return a > b ? a : b; }
    function minStr(a, b) { return a < b ? a : b; }

    // The calendar day a timestamp falls on, in the given IANA time zone (or this device's zone)
    function dayOf(iso, tz) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        if (tz) {
            try {
                return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
            } catch (e) { /* unknown zone: fall through */ }
        }
        return fmt(d);
    }

    // ---- task helpers (tasks look like the app's tasks: type, dueDate, completed, completedAt) ----
    function kindOf(t) {
        if (t.type === 'weekly' || t.type === 'monthly') return t.type;
        if (t.type === 'custom') return 'custom';
        return 'daily';
    }
    // The day a finished task was finished. Older tasks have no timestamp: use their due date.
    function finishedDay(t, tz) {
        if (!t.completed) return '';
        return dayOf(t.completedAt, tz) || t.dueDate || '';
    }

    // tasks counted for [s, e] (daily tasks only) -> { planned, done }
    function countDaily(tasks, s, e, tz) {
        var planned = 0, done = 0;
        for (var i = 0; i < tasks.length; i++) {
            var t = tasks[i];
            if (kindOf(t) !== 'daily') continue;
            var due = t.dueDate || '';
            var fin = finishedDay(t, tz);
            var dueIn = due && due >= s && due <= e;
            var finIn = fin && fin >= s && fin <= e;
            if (dueIn || finIn) { planned++; if (finIn) done++; }
        }
        return { planned: planned, done: done };
    }

    // goals of one kind whose period ends in [s, e] -> { planned, done }
    function countGoals(tasks, kind, s, e, tz) {
        var planned = 0, done = 0;
        for (var i = 0; i < tasks.length; i++) {
            var t = tasks[i];
            if (kindOf(t) !== kind) continue;
            var due = t.dueDate || '';
            if (!due || due < s || due > e) continue;
            planned++;
            var fin = finishedDay(t, tz);
            if (fin && fin <= due) done++; // finished by the end of its week / month
        }
        return { planned: planned, done: done };
    }

    function pctOf(done, planned) { return planned > 0 ? Math.round((done / planned) * 100) : null; }

    // The bars: 7 days for a week; the weeks (cut at the month edges) for a month
    function segmentsFor(kind, anchor) {
        var out = [], i;
        if (kind === 'week') {
            var ws = weekStart(anchor);
            for (i = 0; i < 7; i++) {
                var day = addDays(ws, i);
                out.push({ key: day, label: DAY_NAMES[i], start: day, end: day });
            }
            return out;
        }
        var ms = monthStart(anchor), me = monthEnd(anchor);
        var cur = weekStart(ms), n = 1;
        while (cur <= me) {
            var s = maxStr(cur, ms), e = minStr(addDays(cur, 6), me);
            var sd = parse(s), ed = parse(e);
            var label = sd.getDate() === ed.getDate() ? String(sd.getDate()) : sd.getDate() + '-' + ed.getDate();
            out.push({ key: s, label: 'Week ' + n, sub: MONTH_NAMES[sd.getMonth()] + ' ' + label, start: s, end: e });
            cur = addDays(cur, 7);
            n++;
        }
        return out;
    }

    // Build the summary for the week or month containing `anchor` (a 'YYYY-MM-DD' day).
    // opts: { tz, today }
    function buildSummary(tasks, kind, anchor, opts) {
        opts = opts || {};
        var tz = opts.tz || '';
        var today = opts.today || fmt(new Date());
        var start = kind === 'week' ? weekStart(anchor) : monthStart(anchor);
        var end = kind === 'week' ? weekEnd(anchor) : monthEnd(anchor);

        // bars
        var items = segmentsFor(kind, anchor).map(function (seg) {
            var c = countDaily(tasks, seg.start, seg.end, tz);
            var planned = c.planned, done = c.done;
            if (kind === 'month') { // a week bar also counts the weekly goals made for that week
                var g = countGoals(tasks, 'weekly', seg.start, seg.end, tz);
                planned += g.planned; done += g.done;
            }
            return {
                key: seg.key, label: seg.label, sub: seg.sub || '', start: seg.start, end: seg.end,
                planned: planned, done: done, pct: pctOf(done, planned),
                future: seg.start > today, current: today >= seg.start && today <= seg.end
            };
        });

        // overall for the whole period (each task counted once)
        var daily = countDaily(tasks, start, end, tz);
        var weeklyGoals = countGoals(tasks, 'weekly', start, end, tz);
        var monthlyGoals = kind === 'month' ? countGoals(tasks, 'monthly', start, end, tz) : { planned: 0, done: 0 };
        var planned = daily.planned + weeklyGoals.planned + monthlyGoals.planned;
        var done = daily.done + weeklyGoals.done + monthlyGoals.done;
        var goalsPlanned = weeklyGoals.planned + monthlyGoals.planned;
        var goalsDone = weeklyGoals.done + monthlyGoals.done;

        // best bar: most tasks finished (first one wins a tie)
        var best = null;
        items.forEach(function (it) { if (it.done > 0 && (!best || it.done > best.done)) best = it; });

        // still open: tasks due in the period that are not finished, and goals for it not finished
        var carried = tasks.filter(function (t) {
            if (t.completed) return false;
            var k = kindOf(t);
            if (k === 'custom') return false;
            var due = t.dueDate || '';
            return due && due >= start && due <= end;
        }).sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });

        var pct = pctOf(done, planned);
        var needMore = planned > 0 ? Math.max(0, Math.ceil(TARGET / 100 * planned) - done) : 0;

        return {
            kind: kind, start: start, end: end, label: periodLabel(kind, anchor),
            items: items, planned: planned, done: done, pct: pct,
            goalsPlanned: goalsPlanned, goalsDone: goalsDone,
            best: best, carried: carried, needMore: needMore,
            inProgress: today >= start && today <= end,
            isFuture: today < start
        };
    }

    function periodLabel(kind, anchor) {
        if (kind === 'month') { var d = parse(anchor); return FULL_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
        var s = parse(weekStart(anchor)), e = parse(weekEnd(anchor));
        return MONTH_NAMES[s.getMonth()] + ' ' + s.getDate() + ' to ' + MONTH_NAMES[e.getMonth()] + ' ' + e.getDate() + ', ' + e.getFullYear();
    }

    // ---- wording ----
    function tierOf(pct) {
        if (pct === null) return 'none';
        if (pct >= TARGET) return 'cheer';
        if (pct >= 50) return 'nudge';
        return 'low';
    }

    var POOLS = {
        // a finished week
        'week:cheer': [
            'A strong week. You finished {done} of {planned} tasks. Keep this rhythm going.',
            '{pct}% of your tasks done this week. That is real consistency.',
            'You kept your promises to yourself this week. Well done.'
        ],
        'week:nudge': [
            'You got {done} of {planned} done. A little more focus next week and you will cross {target}%.',
            'Solid progress. {open} task{s} carried over, so pick the most important one to start with on Monday.',
            'More than half done. Small, steady steps are how targets get reached.'
        ],
        'week:low': [
            'Some weeks go differently. {done} done is still progress. Choose the two tasks that matter most and start there on Monday.',
            'Not the week you planned, and that is fine. Shrink the list, finish the first thing, and build momentum.',
            'Every restart counts. Carry forward only what really matters and aim for {target}% next week.'
        ],
        // a finished month
        'month:cheer': [
            'An excellent month. You finished {done} of {planned} tasks. That is the kind of month that builds habits.',
            '{pct}% of your tasks done this month. Your plans and your actions lined up.',
            'You made steady progress all month long. Be proud of it, then set the next one.'
        ],
        'month:nudge': [
            'You finished {done} of {planned} tasks. One more push each week and you will pass {target}% next month.',
            'More than half done. Look at what was left open, and keep only what still matters.',
            'A good base. Pick one habit from your best week and repeat it next month.'
        ],
        'month:low': [
            'This month was harder than planned. {done} done is still progress. Choose a small, realistic list for next month.',
            'A new month is a clean start. Set fewer tasks, finish them, and let the habit grow.',
            'Targets are reached one week at a time. Next month, aim for just {target}% of a lighter list.'
        ],
        // a period still running
        // (the headline above the message already says "On track" / "Within reach" / "Behind target")
        'now:cheer': [
            'Keep going and you will finish {this_period} strong.',
            'You are ahead of your {target}% target. Keep the pace.'
        ],
        'now:nudge': [
            'Finish {need} more task{need_s} to hit {target}% for {this_period}.',
            'A good start. {need} more and you are at {target}%.'
        ],
        'now:low': [
            'Plenty of time left. Finish {need} more task{need_s} to reach {target}%. Start with the smallest one.',
            'A slow start is still a start. Pick one task and finish it today.'
        ]
    };

    var HEADLINES = {
        cheer: { done: 'Target reached', now: 'On track' },
        nudge: { done: 'Almost there', now: 'Within reach' },
        low: { done: 'Time to reset', now: 'Behind target' },
        none: { done: 'No tasks planned', now: 'No tasks planned' }
    };

    function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }

    function fill(tpl, s) {
        var open = s.carried.length;
        var map = {
            done: s.done, planned: s.planned, pct: s.pct, target: TARGET,
            open: open, s: open === 1 ? '' : 's',
            need: s.needMore, need_s: s.needMore === 1 ? '' : 's',
            this_period: s.kind === 'month' ? 'the month' : 'the week'
        };
        return tpl.replace(/\{(\w+)\}/g, function (m, k) { return k in map ? String(map[k]) : m; });
    }

    // What to tell the user about a summary: { tier, headline, message, line }
    function describe(s) {
        var tier = tierOf(s.pct);
        var phase = s.inProgress ? 'now' : 'done';
        var headline = HEADLINES[tier][phase];
        var noun = s.kind === 'month' ? 'month' : 'week';
        if (tier === 'none') {
            return { tier: tier, headline: headline, message: s.inProgress ? 'Add tasks for this ' + noun + ' and your progress will show up here.' : 'You had no tasks planned this ' + noun + '.', line: '' };
        }
        var pool = POOLS[(s.inProgress ? 'now' : noun) + ':' + tier];
        var message = fill(pool[hash(s.kind + s.start) % pool.length], s);
        var line = s.done + ' of ' + s.planned + ' tasks done (' + s.pct + '%)' + (s.inProgress ? ' so far' : '');
        return { tier: tier, headline: headline, message: message, line: line };
    }

    // Text for the push notification
    function pushText(s) {
        var d = describe(s);
        var noun = s.kind === 'month' ? 'month' : 'week';
        return { title: 'Your ' + noun + ' in review: ' + d.headline, body: d.line + '. ' + d.message };
    }

    root.TaskSummary = {
        TARGET: TARGET,
        buildSummary: buildSummary, describe: describe, pushText: pushText, tierOf: tierOf,
        dates: { fmt: fmt, parse: parse, addDays: addDays, weekStart: weekStart, weekEnd: weekEnd, monthStart: monthStart, monthEnd: monthEnd, dayOf: dayOf },
        periodLabel: periodLabel
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
