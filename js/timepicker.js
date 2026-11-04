// 12-hour time entry (hour, minute, AM/PM).
// The browser's own date/time pickers follow the computer's regional setting and cannot be forced to 12-hour,
// so the visible controls here are plain selects. The original <input> stays in the page, hidden, and keeps
// its normal value format ("YYYY-MM-DDTHH:mm" or "HH:mm"), so the rest of the app reads and writes it as before.
(function(window) {
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    function option(value, text, placeholder) {
        var o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        if (placeholder) { o.disabled = true; o.hidden = true; }
        return o;
    }

    function makeSelect(cls, label, placeholder) {
        var s = document.createElement('select');
        s.className = cls;
        s.setAttribute('aria-label', label);
        if (placeholder) {
            // Not "required": a hidden required select inside a form blocks that form's Save button.
            // An unchosen select is just shown in a muted colour (the .unset class).
            s.appendChild(option('', placeholder, true));
            s.classList.add('unset');
            s.addEventListener('change', function() { s.classList.toggle('unset', !s.value); });
        }
        return s;
    }

    // Hour 1-12, minute 00-59, AM/PM
    function buildTime(selectClass, withPlaceholders) {
        var wrap = document.createElement('div');
        wrap.className = 'rp-time';
        var hour = makeSelect(selectClass, 'Hour', withPlaceholders ? 'Hr' : '');
        var min = makeSelect(selectClass, 'Minute', withPlaceholders ? 'Min' : '');
        var ap = makeSelect(selectClass, 'AM or PM', withPlaceholders ? 'AM/PM' : '');
        for (var h = 1; h <= 12; h++) hour.appendChild(option(String(h), String(h)));
        for (var m = 0; m < 60; m++) min.appendChild(option(pad(m), pad(m)));
        ap.appendChild(option('AM', 'AM'));
        ap.appendChild(option('PM', 'PM'));
        wrap.appendChild(hour);
        wrap.appendChild(min);
        wrap.appendChild(ap);
        function muted() {
            [hour, min, ap].forEach(function(s) { s.classList.toggle('unset', withPlaceholders && !s.value); });
        }
        return {
            wrap: wrap, hour: hour, min: min, ap: ap,
            // {h24, min} when all three are chosen, otherwise null
            get: function() {
                if (!hour.value || !min.value || !ap.value) return null;
                return { h24: (parseInt(hour.value, 10) % 12) + (ap.value === 'PM' ? 12 : 0), min: parseInt(min.value, 10) };
            },
            set: function(h24, minute) {
                if (h24 === null) {
                    hour.value = ''; min.value = ''; ap.value = '';
                    if (!withPlaceholders) { hour.value = '12'; min.value = '00'; ap.value = 'AM'; }
                } else {
                    hour.value = String(h24 % 12 === 0 ? 12 : h24 % 12);
                    min.value = pad(minute);
                    ap.value = h24 >= 12 ? 'PM' : 'AM';
                }
                muted();
            },
            // Anything still unchosen gets a sensible default, so one tap gives a complete time
            fillMissing: function(dh, dm, dap) {
                if (!hour.value) hour.value = String(dh);
                if (!min.value) min.value = pad(dm);
                if (!ap.value) ap.value = dap;
                muted();
            }
        };
    }

    // Replace a datetime-local input with: date + hour / minute / AM-PM
    function attachDateTime(input, opts) {
        if (!input || input._timepicker) return;
        opts = opts || {};
        input._timepicker = true;
        var source = input;
        source.setAttribute('hidden', '');
        source.classList.add('rp-source');

        var wrap = document.createElement('div');
        wrap.className = 'remind-picker';
        var dateIn = document.createElement('input');
        dateIn.type = 'date';
        dateIn.id = source.id + '-date';
        dateIn.className = opts.dateClass || 'form-input';
        dateIn.classList.add('rp-date');
        if (source.getAttribute('data-placeholder')) dateIn.setAttribute('data-placeholder', source.getAttribute('data-placeholder'));
        if (opts.label) { dateIn.setAttribute('data-label', opts.label); dateIn.style.setProperty('--lbl-w', opts.labelWidth || '4em'); }
        dateIn.setAttribute('aria-label', opts.dateLabel || 'Reminder date');
        wrap.appendChild(dateIn);

        var time = buildTime(opts.selectClass || 'form-select', true);
        wrap.appendChild(time.wrap);
        var clear = null;
        if (opts.clearButton) {
            clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'icon-btn rp-clear';
            clear.setAttribute('aria-label', 'Remove reminder');
            clear.title = 'Remove reminder';
            clear.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-x"/></svg>';
            time.wrap.appendChild(clear);
        }
        source.insertAdjacentElement('afterend', wrap);
        var lab = source.id ? document.querySelector('label[for="' + source.id + '"]') : null;
        if (lab) lab.setAttribute('for', dateIn.id);

        function show() {
            time.wrap.classList.toggle('hidden', !dateIn.value);
            dateIn.classList.toggle('is-empty', !dateIn.value);
        }
        // hidden input -> controls
        function readSource() {
            var v = valueDesc.get.call(source);
            if (!v || v.length < 16) {
                dateIn.value = '';
                time.set(null);
            } else {
                dateIn.value = v.slice(0, 10);
                time.set(parseInt(v.slice(11, 13), 10), parseInt(v.slice(14, 16), 10));
            }
            show();
        }
        // controls -> hidden input
        function writeSource() {
            var t = time.get();
            var next = dateIn.value && t ? dateIn.value + 'T' + pad(t.h24) + ':' + pad(t.min) : '';
            if (next !== valueDesc.get.call(source)) {
                valueDesc.set.call(source, next);
                source.dispatchEvent(new Event('input', { bubbles: true }));
                source.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        dateIn.addEventListener('change', function() {
            if (dateIn.value && !time.get()) {
                var now = new Date();
                var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
                if (dateIn.value === today) {
                    // today: the next full hour (11:59 PM at the very end of the day)
                    var h = now.getHours() + 1;
                    if (h > 23) time.set(23, 59); else time.set(h, 0);
                } else {
                    time.set(9, 0); // another day: 9:00 AM
                }
            }
            if (!dateIn.value) time.set(null);
            show();
            writeSource();
        });
        [time.hour, time.min, time.ap].forEach(function(sel) {
            sel.addEventListener('change', function() {
                time.fillMissing(9, 0, 'AM');
                if (!dateIn.value) {
                    var d = new Date();
                    dateIn.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
                }
                show();
                writeSource();
            });
        });
        if (clear) clear.addEventListener('click', function() {
            valueDesc.set.call(source, '');
            readSource();
            source.dispatchEvent(new Event('input', { bubbles: true }));
            source.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Code elsewhere sets input.value directly (opening the edit window, clearing after adding a task)
        Object.defineProperty(source, 'value', {
            configurable: true,
            get: function() { return valueDesc.get.call(source); },
            set: function(v) { valueDesc.set.call(source, v); readSource(); }
        });
        readSource();
    }

    // Replace a time input ("HH:mm") with hour / minute / AM-PM
    function attachTime(input, opts) {
        if (!input || input._timepicker) return;
        opts = opts || {};
        input._timepicker = true;
        var source = input;
        source.setAttribute('hidden', '');
        source.classList.add('rp-source');
        var time = buildTime(opts.selectClass || 'form-select', false);
        time.wrap.classList.add('rp-time-only');
        source.insertAdjacentElement('afterend', time.wrap);
        var lab = source.id ? document.querySelector('label[for="' + source.id + '"]') : null;
        if (lab) { time.hour.id = source.id + '-hour'; lab.setAttribute('for', time.hour.id); }

        function readSource() {
            var v = valueDesc.get.call(source);
            if (/^\d{2}:\d{2}/.test(v)) time.set(parseInt(v.slice(0, 2), 10), parseInt(v.slice(3, 5), 10)); else time.set(null);
        }
        function writeSource() {
            var t = time.get();
            if (!t) return;
            var next = pad(t.h24) + ':' + pad(t.min);
            if (next !== valueDesc.get.call(source)) {
                valueDesc.set.call(source, next);
                source.dispatchEvent(new Event('input', { bubbles: true }));
                source.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        [time.hour, time.min, time.ap].forEach(function(sel) { sel.addEventListener('change', writeSource); });
        Object.defineProperty(source, 'value', {
            configurable: true,
            get: function() { return valueDesc.get.call(source); },
            set: function(v) { valueDesc.set.call(source, v); readSource(); }
        });
        readSource();
    }

    window.TimePicker = { attachDateTime: attachDateTime, attachTime: attachTime };
})(window);
