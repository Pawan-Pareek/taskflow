// TaskFlow quick parser: reads everyday task sentences on this device, no network.
// "I want to call Jenis at 12 pm tomorrow" -> { title: 'Call Jenis', date: <tomorrow>, time: '12:00' }
// Used as the fallback when the AI reader (supabase/functions/parse-task) is not reachable, and to decide
// whether a sentence has anything to read at all (hasCues).
(function (root) {
    'use strict';

    var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    var WD_SHORT = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
    var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    var MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    var WD_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmt(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
    function wdIndex(word) {
        var w = word.toLowerCase();
        var i = WEEKDAYS.indexOf(w);
        if (i >= 0) return i;
        var k = w.slice(0, w.indexOf('s') === 3 ? 5 : 4);
        if (WD_SHORT[w] !== undefined) return WD_SHORT[w];
        if (WD_SHORT[k] !== undefined) return WD_SHORT[k];
        return WD_SHORT[w.slice(0, 3)];
    }

    // Does the sentence mention a day, a time or a repeat? (decides whether reading it is worth it)
    var CUE_RE = new RegExp('\\b(today|tonight|tomorrow|tmrw?|tmr|kal|parso|day after|next|this (?:week|month)|in \\d+|in an? (?:hour|minute|day|week)|every|daily|weekly|monthly|weekdays?|noon|midnight|morning|afternoon|evening|night|o\'?clock|baje|subah|shaam|raat|' +
        WD_RE + '|' + MONTH_RE + ')\\b|\\d{1,2}\\s*(?:am|pm)\\b|\\b\\d{1,2}:\\d{2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)\\b|\\b\\d{1,2}/\\d{1,2}\\b', 'i');
    function hasCues(text) { return CUE_RE.test(text || ''); }

    // now: Date (defaults to the current time on this device)
    function parse(text, now) {
        now = now || new Date();
        var s = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var date = null, time = null, repeat = 'none', priority = null, m;

        function cut(re) { s = s.replace(re, ' '); }

        // repeats
        if ((m = s.match(/\b(?:every\s*day|daily|each day|roz)\b/i))) { repeat = 'daily'; cut(m[0]); }
        else if ((m = s.match(/\b(?:every\s*weekday|on weekdays|weekdays)\b/i))) { repeat = 'weekdays'; cut(m[0]); }
        else if ((m = s.match(new RegExp('\\bevery\\s+' + WD_RE + '\\b', 'i')))) {
            repeat = 'weekly';
            var wd = wdIndex(m[1]);
            date = addDays(today, (wd - today.getDay() + 7) % 7);
            cut(m[0]);
        }
        else if ((m = s.match(/\b(?:every\s*week|weekly)\b/i))) { repeat = 'weekly'; cut(m[0]); }
        else if ((m = s.match(/\b(?:every\s*month|monthly)\b/i))) { repeat = 'monthly'; cut(m[0]); }

        // priority
        if ((m = s.match(/\b(?:urgent(?:ly)?|asap)\b/i))) { priority = 'urgent'; cut(m[0]); }
        else if ((m = s.match(/\b(?:high priority|important)\b/i))) { priority = 'high'; cut(m[0]); }

        // relative times: "in 2 hours", "in 30 minutes"
        if ((m = s.match(/\bin\s+(\d+|an?|one)\s*(hours?|hrs?|minutes?|mins?)\b/i))) {
            var n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
            var later = new Date(now.getTime() + n * (/^h/i.test(m[2]) ? 3600000 : 60000));
            date = new Date(later.getFullYear(), later.getMonth(), later.getDate());
            time = pad2(later.getHours()) + ':' + pad2(later.getMinutes());
            cut(m[0]);
        }

        // dates
        if (!date) {
            if ((m = s.match(/\b(?:the\s+)?day after tomorrow\b|\bparso\b/i))) { date = addDays(today, 2); cut(m[0]); }
            else if ((m = s.match(/\b(?:tomorrow|tmrw?|tmr|kal)\b/i))) { date = addDays(today, 1); cut(m[0]); }
            else if ((m = s.match(/\btonight\b/i))) { date = today; if (!time) time = '21:00'; cut(m[0]); }
            else if ((m = s.match(/\btoday\b|\baaj\b/i))) { date = today; cut(m[0]); }
            else if ((m = s.match(/\bin\s+(\d+|an?|one|two|three)\s*(days?|weeks?)\b/i))) {
                var words = { a: 1, an: 1, one: 1, two: 2, three: 3 };
                var k = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : words[m[1].toLowerCase()];
                date = addDays(today, /^w/i.test(m[2]) ? 7 * k : k);
                cut(m[0]);
            }
            else if ((m = s.match(new RegExp('\\b(next|this|on|coming)?\\s*' + WD_RE + '\\b', 'i')))) {
                var target = wdIndex(m[2]);
                var diff = (target - today.getDay() + 7) % 7;
                if (m[1] && /next/i.test(m[1]) && diff === 0) diff = 7; // "next friday" said on a Friday = a week later
                date = addDays(today, diff);
                cut(m[0]);
            }
            else if ((m = s.match(new RegExp('\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONTH_RE + '\\b', 'i'))) ||
                     (m = s.match(new RegExp('\\b(?:on\\s+)?' + MONTH_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b', 'i')))) {
                var dayNum = /^\d/.test(m[1]) ? parseInt(m[1], 10) : parseInt(m[2], 10);
                var monName = /^\d/.test(m[1]) ? m[2] : m[1];
                var mon = MONTHS[monName.toLowerCase().slice(0, monName.toLowerCase().indexOf('sept') === 0 ? 4 : 3)];
                if (mon === undefined) mon = MONTHS[monName.toLowerCase().slice(0, 3)];
                var cand = new Date(today.getFullYear(), mon, dayNum);
                if (cand < today) cand = new Date(today.getFullYear() + 1, mon, dayNum);
                date = cand;
                cut(m[0]);
            }
            else if ((m = s.match(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})\b/))) { // day/month, as written in India and Europe
                var c2 = new Date(today.getFullYear(), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
                if (c2 < today) c2 = new Date(today.getFullYear() + 1, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
                date = c2;
                cut(m[0]);
            }
        }

        // clock times
        if (!time) {
            if ((m = s.match(/\b(?:at\s+|@\s*|by\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i))) {
                var h = parseInt(m[1], 10) % 12, mi = m[2] ? parseInt(m[2], 10) : 0;
                if (/p/i.test(m[3])) h += 12;
                time = pad2(h) + ':' + pad2(mi);
                cut(m[0]);
            } else if ((m = s.match(/\b(?:at\s+|@\s*|by\s+)?(\d{1,2}):(\d{2})\b/))) {
                var h2 = parseInt(m[1], 10);
                if (h2 >= 1 && h2 <= 6) h2 += 12; // "at 5:30" means the afternoon
                time = pad2(h2) + ':' + m[2];
                cut(m[0]);
            } else if ((m = s.match(/\b(?:at\s+)?(\d{1,2})\s*(?:o'?clock|baje)\b/i)) || (m = s.match(/\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|\/|days?|weeks?|hours?|mins?|minutes?))/i))) {
                var h3 = parseInt(m[1], 10);
                if (h3 >= 1 && h3 <= 6) h3 += 12;
                if (h3 <= 23) { time = pad2(h3) + ':00'; cut(m[0]); }
            }
        }
        if (!time) {
            if ((m = s.match(/\b(?:at\s+)?noon\b/i))) { time = '12:00'; cut(m[0]); }
            else if ((m = s.match(/\b(?:in the\s+|this\s+)?(?:morning|subah)\b/i))) { time = '09:00'; cut(m[0]); }
            else if ((m = s.match(/\b(?:in the\s+|this\s+)?afternoon\b/i))) { time = '14:00'; cut(m[0]); }
            else if ((m = s.match(/\b(?:in the\s+|this\s+)?(?:evening|shaam)\b/i))) { time = '18:00'; cut(m[0]); }
            else if ((m = s.match(/\b(?:at\s+)?(?:night|raat)\b/i))) { time = '21:00'; cut(m[0]); }
        }

        // A time with no day: today, or tomorrow when that time has already passed
        if (time && !date) {
            var nowMin = now.getHours() * 60 + now.getMinutes();
            var tMin = parseInt(time.slice(0, 2), 10) * 60 + parseInt(time.slice(3), 10);
            date = tMin > nowMin ? today : addDays(today, 1);
        }

        return { tasks: [{ title: cleanTitle(s), date: date ? fmt(date) : null, time: time, repeat: repeat, priority: priority, category: null, list: null, type: 'daily' }], source: 'device' };
    }

    function cleanTitle(s) {
        var t = s.replace(/\s+/g, ' ').trim();
        // "I want to ...", "remind me to ...", "please ..."
        t = t.replace(/^(?:hey\s+|ok\s+|okay\s+)?(?:please\s+)?(?:i\s+(?:want|need|have|have got|'ve got|wanna)\s+to\s+|i\s+(?:should|must|will|'ll)\s+|remind\s+me\s+(?:to\s+)?|don'?t\s+forget\s+to\s+|do\s+not\s+forget\s+to\s+|i\s+have\s+|need\s+to\s+|have\s+to\s+)/i, '');
        t = t.replace(/^(?:please\s+)/i, '');
        // leftovers like a trailing "at", "on", "by", "for", "and"
        for (var i = 0; i < 3; i++) t = t.replace(/\s+(?:at|on|by|for|and|the|this|next|of|in|to)$/i, '').replace(/^(?:at|on|by|for|and|to)\s+/i, '');
        t = t.replace(/\s+([,.!?])/g, '$1').replace(/[,.;:!\s]+$/, '').trim();
        if (!t) return '';
        return t.charAt(0).toUpperCase() + t.slice(1);
    }

    root.QuickParse = { parse: parse, hasCues: hasCues, cleanTitle: cleanTitle };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
