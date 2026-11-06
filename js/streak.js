// TaskFlow daily streak and habit rules: pure logic, shared by the app and the server.
// Master copy: js/streak.js. The Edge Functions use a copy in supabase/functions/_shared/
// (run `node scripts/sync-shared.js` after editing this file).
//
// Daily streak: a day counts when you finish at least 2 tasks, or every task you planned for it
// when you planned fewer than 2 (a day with nothing planned counts if you finish anything).
// Each week (Monday to Sunday) forgives one day that does not count: a rest day. A second one breaks
// the streak. Today never breaks the streak while it is still going on.
//
// Habits: one check-in per scheduled day. "Never miss twice": one missed day is forgiven, a second
// missed day in a row starts the challenge over.
(function (root) {
    'use strict';

    var DAILY_TARGET = 2;
    var MILESTONES = [7, 21, 30, 66, 100, 200, 365];
    var HABIT_TARGETS = [21, 66];
    var MAX_ACTIVE_HABITS = 3;
    var DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    // ---- dates: local calendar days as 'YYYY-MM-DD' strings ----
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmt(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
    function weekStart(s) { var d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmt(d); }
    function dayOf(iso, tz) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        if (tz) {
            try {
                return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
            } catch (e) { /* unknown zone */ }
        }
        return fmt(d);
    }

    // ---- daily streak ----
    function isDailyTask(t) { return t.type !== 'weekly' && t.type !== 'monthly' && t.type !== 'custom'; }
    function finishedDay(t, tz) {
        if (!t.completed) return '';
        return dayOf(t.completedAt, tz) || t.dueDate || '';
    }

    // Per day: tasks planned (due), planned tasks finished by their day, and tasks finished that day (any kind)
    function tally(tasks, tz) {
        var planned = {}, dueDone = {}, done = {}, first = '';
        for (var i = 0; i < tasks.length; i++) {
            var t = tasks[i];
            var fin = finishedDay(t, tz);
            if (fin) {
                done[fin] = (done[fin] || 0) + 1;
                if (!first || fin < first) first = fin;
            }
            if (isDailyTask(t) && t.dueDate) {
                planned[t.dueDate] = (planned[t.dueDate] || 0) + 1;
                if (!first || t.dueDate < first) first = t.dueDate;
                if (fin && fin <= t.dueDate) dueDone[t.dueDate] = (dueDone[t.dueDate] || 0) + 1;
            }
        }
        return { planned: planned, dueDone: dueDone, done: done, first: first };
    }

    function dayResult(tl, d) {
        var p = tl.planned[d] || 0, dd = tl.dueDone[d] || 0, n = tl.done[d] || 0;
        var ok = n >= DAILY_TARGET || (p > 0 && dd >= p) || (p === 0 && n >= 1);
        // how many more tasks to finish today for it to count
        var need = ok ? 0 : (p >= DAILY_TARGET ? Math.max(1, DAILY_TARGET - n) : Math.max(1, p - dd));
        return { planned: p, done: n, ok: ok, need: need };
    }

    // opts: { today, tz, maxDays }
    function computeStreak(tasks, opts) {
        opts = opts || {};
        var today = opts.today || fmt(new Date());
        var tl = tally(tasks, opts.tz || '');
        var start = tl.first;
        var limit = addDays(today, -(opts.maxDays || 400));
        if (start && start < limit) start = limit;

        var run = 0, best = 0, restWeek = null, restDay = null, status = {};
        if (start && start <= today) {
            for (var d = start; d <= today; d = addDays(d, 1)) {
                var r = dayResult(tl, d);
                if (r.ok) {
                    run++;
                    status[d] = 'done';
                } else if (d === today) {
                    status[d] = 'today'; // still going on: it cannot break the streak yet
                } else {
                    var wk = weekStart(d);
                    if (run > 0 && restWeek !== wk) {
                        restWeek = wk; restDay = d; status[d] = 'rest';
                    } else {
                        run = 0;
                        status[d] = (r.planned || r.done) ? 'missed' : 'empty';
                    }
                }
                if (run > best) best = run;
            }
        }

        var tr = dayResult(tl, today);
        var thisWeek = weekStart(today);
        var restUsedThisWeek = restWeek === thisWeek;
        var week = [];
        for (var i = 0; i < 7; i++) {
            var day = addDays(thisWeek, i);
            week.push({ day: day, letter: DAY_LETTERS[i], status: day > today ? 'future' : (status[day] || 'empty') });
        }
        var next = null;
        for (var m = 0; m < MILESTONES.length; m++) if (MILESTONES[m] > run) { next = MILESTONES[m]; break; }

        return {
            current: run,
            best: best,
            qualifiedToday: tr.ok,
            need: tr.need,
            todayPlanned: tr.planned,
            todayDone: tr.done,
            restUsedThisWeek: restUsedThisWeek,
            restDay: restUsedThisWeek ? restDay : null,
            // the streak ends tonight unless today counts (this week's rest day is already used)
            atRisk: run > 0 && !tr.ok && restUsedThisWeek,
            week: week,
            nextMilestone: next,
            isMilestone: tr.ok && MILESTONES.indexOf(run) >= 0
        };
    }

    // ---- habits ----
    // habit: { start_date, schedule: 'daily' | 'weekdays', target_days, checkins: ['YYYY-MM-DD', ...] }
    function isScheduled(h, d) {
        if (!h.start_date || d < h.start_date) return false;
        if (h.schedule === 'weekdays') { var w = parse(d).getDay(); return w >= 1 && w <= 5; }
        return true;
    }

    function habitProgress(h, today) {
        today = today || fmt(new Date());
        var checks = {};
        (h.checkins || []).forEach(function (c) { checks[c] = true; });
        var run = 0, prevMissed = false, restarts = 0, runStart = h.start_date, lastMiss = null;
        if (h.start_date) {
            for (var d = h.start_date; d < today; d = addDays(d, 1)) { // up to yesterday
                if (!isScheduled(h, d)) continue;
                if (checks[d]) {
                    run++;
                    prevMissed = false;
                } else if (prevMissed) {
                    // second missed day in a row: the challenge starts over
                    run = 0; restarts++; prevMissed = false; runStart = addDays(d, 1); lastMiss = d;
                } else {
                    prevMissed = true; lastMiss = d;
                }
            }
        }
        var scheduledToday = isScheduled(h, today);
        var checkedToday = !!checks[today];
        if (checkedToday) run++;
        var target = h.target_days || HABIT_TARGETS[0];
        return {
            run: run,
            target: target,
            pct: Math.min(100, Math.round((run / target) * 100)),
            daysLeft: Math.max(0, target - run),
            complete: run >= target,
            checkedToday: checkedToday,
            scheduledToday: scheduledToday,
            // yesterday (the last scheduled day) was missed: one more miss starts over
            onLastChance: prevMissed && scheduledToday && !checkedToday,
            restarts: restarts,
            runStart: runStart,
            lastMiss: lastMiss
        };
    }

    // Check-ins against scheduled days in [start, end], up to today (for the weekly / monthly summary)
    function habitPeriodStats(habits, start, end, today) {
        var scheduled = 0, checked = 0;
        var last = end < today ? end : today;
        (habits || []).forEach(function (h) {
            if (h.status === 'archived') return;
            var checks = {};
            (h.checkins || []).forEach(function (c) { checks[c] = true; });
            for (var d = start; d <= last; d = addDays(d, 1)) {
                if (!isScheduled(h, d)) continue;
                scheduled++;
                if (checks[d]) checked++;
            }
        });
        return { scheduled: scheduled, checked: checked };
    }

    root.TaskStreak = {
        DAILY_TARGET: DAILY_TARGET, MILESTONES: MILESTONES, HABIT_TARGETS: HABIT_TARGETS, MAX_ACTIVE_HABITS: MAX_ACTIVE_HABITS,
        computeStreak: computeStreak,
        isScheduled: isScheduled, habitProgress: habitProgress, habitPeriodStats: habitPeriodStats,
        dates: { fmt: fmt, parse: parse, addDays: addDays, weekStart: weekStart, dayOf: dayOf }
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
