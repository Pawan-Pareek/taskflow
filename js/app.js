// TaskFlow Main Application Logic
(function(window) {
    var tasks = [];
    var currentFilter = 'today'; // 'today', 'all', 'upcoming', 'starred', 'completed'
    var currentCategory = 'all';
    var searchQuery = '';
    var currentSort = 'priority'; // 'priority', 'dueDate', 'createdAt', 'alphabetical'
    var editingTaskId = null;
    var selectedDate = ''; // 'YYYY-MM-DD' date filter ('' = off)

    var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Local-time date helpers (avoid UTC shifts from toISOString)
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function parseDate(str) {
        var p = String(str).split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }
    // Goals store dueDate as the END of their period (Sunday / last day of month),
    // so overdue + sort logic keeps working; the start is derived from it.
    function periodEnd(type, dateStr) {
        var d = parseDate(dateStr);
        if (type === 'weekly') {
            d.setDate(d.getDate() + 6 - ((d.getDay() + 6) % 7)); // Monday-based week
            return fmtDate(d);
        }
        if (type === 'monthly') return fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        return dateStr;
    }
    function periodStart(type, dueDate) {
        var d = parseDate(dueDate);
        if (type === 'weekly') { d.setDate(d.getDate() - 6); return fmtDate(d); }
        if (type === 'monthly') return fmtDate(new Date(d.getFullYear(), d.getMonth(), 1));
        return dueDate;
    }
    function isGoal(t) { return t.type === 'weekly' || t.type === 'monthly'; }
    // Custom list: user-named, no due date. Reminders work as on any other task.
    function isCustom(t) { return t.type === 'custom'; }
    function isDated(t) { return !isGoal(t) && !isCustom(t); }

    // Recurring tasks: completing one adds the next occurrence
    var REPEAT_LABELS = { daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' };
    function nextOccurrence(rule, from, day) {
        var d = parseDate(from);
        if (rule === 'weekly') { d.setDate(d.getDate() + 7); return fmtDate(d); }
        if (rule === 'monthly') {
            var last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
            return fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, Math.min(day || d.getDate(), last)));
        }
        do { d.setDate(d.getDate() + 1); } while (rule === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6));
        return fmtDate(d);
    }
    // The next due date is always after both the old due date and today, so finishing a
    // task late never piles up copies in the past.
    function nextRecurDue(t, todayStr) {
        var floor = t.dueDate > todayStr ? t.dueDate : todayStr;
        var next = nextOccurrence(t.repeat, t.dueDate, t.repeatDay);
        for (var guard = 0; next <= floor && guard < 50000; guard++) next = nextOccurrence(t.repeat, next, t.repeatDay);
        return next;
    }
    function isRecurring(t) { return !!t.repeat && isDated(t) && !!t.dueDate; }

    var CUSTOM_NAME_KEY = 'taskflow_custom_list_name';
    var DEFAULT_CUSTOM_NAME = 'My list';
    function customName() {
        try { return localStorage.getItem(CUSTOM_NAME_KEY) || DEFAULT_CUSTOM_NAME; } catch (e) { return DEFAULT_CUSTOM_NAME; }
    }

    // Up to five user-named lists. The first keeps the id "custom" so lists made before this existed still match.
    var LISTS_KEY = 'taskflow_custom_lists';
    var MAX_LISTS = 5;
    function cleanLists(list) {
        if (!Array.isArray(list)) return null;
        var seen = {};
        var out = [];
        list.forEach(function(l) {
            if (!l || typeof l.id !== 'string' || !/^[a-z0-9]+$/i.test(l.id) || seen[l.id]) return;
            var name = String(l.name || '').trim().slice(0, 40);
            if (!name) return;
            seen[l.id] = true;
            out.push({ id: l.id, name: name });
        });
        return out.length ? out.slice(0, MAX_LISTS) : null;
    }
    function loadLists() {
        try {
            var saved = cleanLists(JSON.parse(localStorage.getItem(LISTS_KEY)));
            if (saved) return saved;
        } catch (e) {}
        return [{ id: 'custom', name: customName() }];
    }
    var customLists = loadLists();
    var currentList = customLists[0].id;
    function listOf(t) {
        var id = t.list || 'custom';
        return customLists.some(function(l) { return l.id === id; }) ? id : customLists[0].id;
    }
    function listName(id) {
        var l = customLists.find(function(x) { return x.id === id; });
        return (l || customLists[0]).name;
    }
    // The type pickers show one entry per list ("list:<id>"); a task stores type "custom" plus its list id
    function parseTypeValue(v) {
        return v && v.indexOf('list:') === 0 ? { type: 'custom', list: v.slice(5) } : { type: v || 'daily' };
    }
    function typeValueOf(t) { return isCustom(t) ? 'list:' + listOf(t) : (t.type || 'daily'); }
    function isListValue(v) { return !!v && v.indexOf('list:') === 0; }

    // Reminder helpers: remindAt is stored as a UTC ISO string, edited as local time
    function toLocalInput(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return fmtDate(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    function fromLocalInput(val) {
        if (!val) return '';
        var d = new Date(val);
        return isNaN(d.getTime()) ? '' : d.toISOString();
    }
    function remindLabel(iso) {
        var d = new Date(iso);
        var today = fmtDate(new Date());
        var day = fmtDate(d) === today ? 'Today' : MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
        return day + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    function icon(name) {
        return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
    }
    function shortDate(str) {
        var d = parseDate(str);
        var label = MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
        return d.getFullYear() === new Date().getFullYear() ? label : label + ', ' + d.getFullYear();
    }

    function icon(name) {
        return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
    }
    function shortDate(str) {
        var d = parseDate(str);
        var label = MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
        return d.getFullYear() === new Date().getFullYear() ? label : label + ', ' + d.getFullYear();
    }

    var FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    function periodLabel(type, dateStr) {
        var end = parseDate(periodEnd(type, dateStr));
        if (type === 'monthly') return FULL_MONTHS[end.getMonth()] + ' ' + end.getFullYear();
        var start = parseDate(periodStart(type, fmtDate(end)));
        return MONTH_NAMES[start.getMonth()] + ' ' + start.getDate() + ' – ' + MONTH_NAMES[end.getMonth()] + ' ' + end.getDate() + ', ' + end.getFullYear();
    }

    // A goal belongs to the period it was created for. Unfinished goals from past periods
    // also "roll over" into the CURRENT period so they stay visible.
    function goalRolledOver(t, todayStr) {
        if (!isGoal(t) || t.completed || !t.dueDate) return false;
        return t.dueDate < periodStart(t.type, periodEnd(t.type, todayStr));
    }
    function goalInPeriod(t, viewDate, todayStr) {
        var end = t.dueDate;
        if (!end) return false;
        if (viewDate >= periodStart(t.type, end) && viewDate <= end) return true;
        if (goalRolledOver(t, todayStr)) {
            return viewDate >= periodStart(t.type, periodEnd(t.type, todayStr)) && viewDate <= periodEnd(t.type, todayStr);
        }
        return false;
    }

    // Remember goal types on this device. If the cloud table has no goal_type column,
    // the type would otherwise be lost on every reload / realtime refresh.
    var TYPE_KEY = 'taskflow_goal_types';
    var REPEAT_KEY = 'taskflow_repeat_rules';
    var LIST_KEY = 'taskflow_task_lists';
    var typesRestored = false;
    function saveTypeMap(list) {
        try {
            var map = {};
            var rmap = {};
            var lmap = {};
            list.forEach(function(t) {
                if (isGoal(t) || isCustom(t)) map[t.id] = t.type;
                if (isCustom(t) && t.list && t.list !== 'custom') lmap[t.id] = t.list;
                if (t.repeat) rmap[t.id] = { r: t.repeat, d: t.repeatDay || 0 };
            });
            localStorage.setItem(TYPE_KEY, JSON.stringify(map));
            localStorage.setItem(REPEAT_KEY, JSON.stringify(rmap));
            localStorage.setItem(LIST_KEY, JSON.stringify(lmap));
        } catch (e) {}
    }
    function applyKnownTypes(list) {
        var map = {};
        try { map = JSON.parse(localStorage.getItem(TYPE_KEY) || '{}'); } catch (e) {}
        var rmap = {};
        try { rmap = JSON.parse(localStorage.getItem(REPEAT_KEY) || '{}'); } catch (e) {}
        var lmap = {};
        try { lmap = JSON.parse(localStorage.getItem(LIST_KEY) || '{}'); } catch (e) {}
        list.forEach(function(t) {
            if (t.type === 'custom' && (!t.list || t.list === 'custom') && lmap[t.id]) {
                t.list = lmap[t.id];
                typesRestored = true;
            }
            if (!t.repeat && rmap[t.id]) {
                t.repeat = rmap[t.id].r;
                t.repeatDay = rmap[t.id].d || undefined;
                typesRestored = true;
            }
        });
        // The cloud column defaults to 'daily', so treat 'daily' like "unknown" when we
        // remember this task as a goal; the restored type is then written back to the cloud.
        list.forEach(function(t) {
            if ((!t.type || t.type === 'daily') && map[t.id]) {
                t.type = map[t.id];
                typesRestored = true;
            }
        });
        return list;
    }

    // Comparable fingerprint of a task list, ignoring how the cloud formats times or orders rows
    function taskSignature(list) {
        return JSON.stringify(list.slice().sort(function(a, b) { return a.id < b.id ? -1 : 1; }).map(function(t) {
            var r = t.remindAt ? new Date(t.remindAt).getTime() : 0;
            return [t.id, t.title, t.notes || '', t.priority, t.category, t.type || 'daily', t.list || 'custom', t.repeat || '', t.repeatDay || 0,
                r, !!t.reminded, t.dueDate || '', !!t.completed, !!t.starred, t.subtasks || []];
        }));
    }

    // Categories are per user and editable. A task stores the category id, so renaming never
    // detaches tasks. The list lives on this device and, when signed in, in the cloud.
    var CATEGORIES_KEY = 'taskflow_categories';
    var MAX_ADDED_CATEGORIES = 6; // categories the user adds, on top of the starting five
    var CATEGORY_COLORS = ['#7c5cd6', '#2f6fd6', '#1f9d68', '#d9890b', '#c8458a', '#d6453d', '#0f9aa8', '#6b7280'];
    var DEFAULT_CATEGORIES = [
        { id: 'personal', name: 'Personal', color: '#7c5cd6' },
        { id: 'work', name: 'Work', color: '#2f6fd6' },
        { id: 'shopping', name: 'Shopping', color: '#1f9d68' },
        { id: 'health', name: 'Health', color: '#d9890b' },
        { id: 'learning', name: 'Learning', color: '#c8458a' }
    ];

    function cleanCategories(list) {
        if (!Array.isArray(list)) return null;
        var seen = {};
        var out = [];
        list.forEach(function(c) {
            if (!c || typeof c.id !== 'string' || !c.id || seen[c.id]) return;
            var name = String(c.name || '').trim().slice(0, 24);
            if (!name) return;
            seen[c.id] = true;
            out.push({ id: c.id, name: name, color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CATEGORY_COLORS[0] });
        });
        return out.length ? out.slice(0, MAX_CATEGORIES) : null;
    }

    function loadCategories() {
        try {
            var saved = cleanCategories(JSON.parse(localStorage.getItem(CATEGORIES_KEY)));
            if (saved) return saved;
        } catch (e) {}
        return DEFAULT_CATEGORIES.map(function(c) { return Object.assign({}, c); });
    }

    var MAX_CATEGORIES = DEFAULT_CATEGORIES.length + MAX_ADDED_CATEGORIES;
    function addedCount(list) {
        return list.filter(function(c) { return !DEFAULT_CATEGORIES.some(function(d) { return d.id === c.id; }); }).length;
    }

    var categoryList = loadCategories();

    // Resolve a task's category; an id we do not know (deleted, or not synced yet) shows as the first one
    function categoryOf(id) {
        for (var i = 0; i < categoryList.length; i++) if (categoryList[i].id === id) return categoryList[i];
        return categoryList[0];
    }

    var PRIORITY_WEIGHTS = {
        urgent: 4,
        high: 3,
        medium: 2,
        low: 1
    };

    // Helper: Toast Notifications
    window.showToast = function(msg, type) {
        var container = document.getElementById('toast-container');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast-pill ' + (type || 'info');
        toast.innerHTML = '<span>' + msg + '</span>';
        container.appendChild(toast);
        setTimeout(function() {
            toast.classList.add('fade-out');
            setTimeout(function() { toast.remove(); }, 300);
        }, 3200);
    };

    var App = {
        init: async function() {
            TaskAuth.init();
            this.setupEventListeners();
            this.setupMobileGestures();
            this.setupConnectMobileModal();
            this.setupThemeToggle();
            this.setupSoundToggle();
            this.setupCustomList();
            this.setupCategories();
            this.setupNotifAlerts();

            // Check server and update status indicator
            this.checkSyncStatus();
            
            // Listen to login/logout events
            window.addEventListener('taskflow:login', async (e) => {
                await this.loadTasks();
            });

            window.addEventListener('taskflow:logout', () => {
                tasks = [];
                this.render();
            });

            // Roll over to the new day / week / month without a page reload
            var lastDay = this.getTodayStr();
            var checkNewDay = function() {
                var now = App.getTodayStr();
                if (now !== lastDay) {
                    lastDay = now;
                    App.render();
                }
            };
            setInterval(checkNewDay, 60000);
            document.addEventListener('visibilitychange', function() { if (!document.hidden) checkNewDay(); });

            // In-app reminders while the page is open and this device is not push-subscribed
            setInterval(function() { App.checkLocalReminders(); }, 20000);
            document.addEventListener('visibilitychange', function() { if (!document.hidden) App.checkLocalReminders(); });

            // Render initial date and counts immediately
            this.updateViewTitle();
            this.render();

            // If user already authenticated, load tasks
            if (TaskAPI.getCurrentUser()) {
                await this.loadTasks();
                // Opened from a reminder notification: show that task
                var openId = new URLSearchParams(window.location.search).get('task');
                if (openId && tasks.some(function(t) { return t.id === openId; })) {
                    this.openEditModal(openId);
                    history.replaceState(null, '', window.location.pathname);
                }
            }
        },

        checkLocalReminders: function() {
            if (window.TaskPush && TaskPush.isOn()) return; // the server pushes to this device
            var now = Date.now();
            var changed = false;
            tasks.forEach(function(t) {
                if (!t.remindAt || t.reminded || t.completed) return;
                var at = new Date(t.remindAt).getTime();
                if (isNaN(at) || at > now) return;
                t.reminded = true;
                changed = true;
                // Don't announce reminders that are more than 6 hours late
                if (now - at < 6 * 3600 * 1000) {
                    showToast('Reminder: ' + t.title, 'info');
                    SoundFX.play('fanfare');
                    if (window.TaskPush) TaskPush.showLocal('Reminder', t.title, t.id);
                }
            });
            if (changed) this.persistTasks();
        },

        checkSyncStatus: async function() {
            var isConnected = await TaskAPI.checkServer();
            var badge = document.getElementById('sync-status-badge');
            var text = document.getElementById('sync-status-text');
            if (badge && text) {
                if (window.TaskSupabase && window.TaskSupabase.isEnabled()) {
                    badge.className = 'status-indicator online';
                    text.textContent = 'Supabase Cloud Synced';
                } else if (isConnected) {
                    badge.className = 'status-indicator online';
                    text.textContent = 'Server Synced';
                } else {
                    badge.className = 'status-indicator offline';
                    text.textContent = 'Offline / Local';
                }
            }
        },

        loadTasks: async function() {
            try {
                var fetched = await TaskAPI.getTodos();
                if (Array.isArray(fetched)) {
                    tasks = applyKnownTypes(fetched);
                } else if (fetched && typeof fetched === 'object' && !fetched.error) {
                    tasks = applyKnownTypes([fetched]);
                } else {
                    tasks = [];
                }
                this.render();
                this.syncCustomLists();
                this.syncCategories();

                // Heal the cloud copy if goal types had to be restored from this device
                if (typesRestored) {
                    typesRestored = false;
                    TaskAPI.saveTodos(tasks).catch(function() {});
                }

                // Setup Supabase Realtime multi-device sync
                if (!this._realtimeSubscribed && window.TaskSupabase && window.TaskSupabase.isEnabled()) {
                    var u = TaskAPI.getCurrentUser();
                    if (u) {
                        this._realtimeSubscribed = true;
                        // Saving writes every task, so each save echoes back as one change per task.
                        // Wait for the burst to settle, and skip the rebuild when nothing really changed:
                        // replacing the list under the cursor made hovered rows flicker.
                        var syncTimer = null;
                        window.TaskSupabase.subscribeToChanges(u.id, function() {
                            clearTimeout(syncTimer);
                            syncTimer = setTimeout(async function() {
                                var updated = await window.TaskSupabase.getTodos(u.id);
                                if (!Array.isArray(updated)) return;
                                var next = applyKnownTypes(updated);
                                if (taskSignature(next) === taskSignature(tasks)) return;
                                tasks = next;
                                App.render();
                            }, 400);
                        });
                    }
                }
            } catch(e) {
                console.error('Error loading tasks:', e);
                tasks = [];
                this.render();
            }
        },

        persistTasks: function() {
            saveTypeMap(tasks);
            // Instant optimistic update: render to screen immediately!
            this.render();
            // Background save & sync
            TaskAPI.saveTodos(tasks).catch(function(e) {
                console.warn('Background sync warning:', e);
            });
        },

        setupEventListeners: function() {
            var self = this;

            // Filter Navigation clicks (sidebar + mobile drawer)
            document.querySelectorAll('[data-filter]').forEach(function(el) {
                el.addEventListener('click', function(e) {
                    e.preventDefault();
                    var filter = this.getAttribute('data-filter');
                    self.setFilter(filter);
                    SoundFX.play('pop');
                    // Close mobile drawer if open
                    self.closeDrawer();
                });
            });

            // Category filter buttons are built in applyCategories()

            // Default Due Date to today
            var dueDateInput = document.getElementById('quick-due-date');
            if (dueDateInput && !dueDateInput.value) {
                dueDateInput.value = self.getTodayStr();
            }

            var quickAddInput = document.getElementById('quick-add-input');
            var quickAddBtn = document.getElementById('btn-quick-add-submit');

            // Single Add Task handler — called by button click OR Enter key
            function doAddTask() {
                var text = quickAddInput ? quickAddInput.value.trim() : '';

                if (!text) {
                    if (quickAddInput) quickAddInput.focus();
                    var quickCard = document.querySelector('.quick-add-card');
                    if (quickCard) {
                        quickCard.classList.remove('shake');
                        void quickCard.offsetWidth;
                        quickCard.classList.add('shake');
                        setTimeout(function() { quickCard.classList.remove('shake'); }, 500);
                    }
                    showToast('Type a task first', 'info');
                    return;
                }

                var priority = (document.getElementById('quick-priority-select') || {}).value || 'medium';
                // Anything the user leaves on its name label gets a sensible default
                var category = (document.getElementById('quick-category-select') || {}).value || (currentCategory !== 'all' ? currentCategory : categoryList[0].id);
                var remindAt = fromLocalInput((document.getElementById('quick-remind-at') || {}).value);
                var typeChoice = parseTypeValue((document.getElementById('quick-type-select') || {}).value);
                var type = typeChoice.type;
                var list = typeChoice.list;
                var dueDate = (document.getElementById('quick-due-date') || {}).value || self.getTodayStr();
                var repeatSelect = document.getElementById('quick-repeat-select');
                var repeat = type === 'daily' && repeatSelect && repeatSelect.value !== 'none' ? repeatSelect.value : '';

                self.addTask({
                    type: type,
                    list: list,
                    repeat: repeat,
                    remindAt: remindAt,
                    title: text,
                    notes: '',
                    priority: priority,
                    category: category,
                    dueDate: dueDate,
                    completed: false,
                    starred: false,
                    subtasks: []
                });

                quickAddInput.value = '';
                var remindInput = document.getElementById('quick-remind-at');
                if (remindInput) remindInput.value = '';
                if (repeatSelect) repeatSelect.value = ''; // don't carry a repeat onto the next task
                quickAddInput.focus();
                SoundFX.play('pop');
                showToast('Task added', 'success');

                // Auto-switch view so the new task is visible
                if (type === 'custom' && currentFilter !== 'all' && (currentFilter !== 'custom' || currentList !== listOf({ list: list }))) {
                    currentList = listOf({ list: list });
                    self.setFilter('custom');
                } else if (type !== 'daily' && type !== 'custom' && currentFilter !== 'all' && currentFilter !== type) {
                    self.setFilter(type);
                } else if (type === 'daily' && (currentFilter === 'weekly' || currentFilter === 'monthly' || currentFilter === 'custom')) {
                    self.setFilter('today');
                } else if (currentFilter === 'completed') {
                    self.setFilter('today');
                } else if (currentCategory !== 'all' && currentCategory !== category) {
                    self.setFilter('all');
                } else {
                    self.renderTaskList();
                }
            }

            // Button click (type=button, no form submit triggered)
            if (quickAddBtn) {
                quickAddBtn.addEventListener('click', function() {
                    doAddTask();
                });
            }

            // Enter key inside the text input
            if (quickAddInput) {
                quickAddInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        doAddTask();
                    }
                });
            }

            // Date filter: show tasks/goals that cover the selected date
            var dateFilterInput = document.getElementById('date-filter-input');
            var dateFilterClear = document.getElementById('btn-clear-date-filter');
            if (dateFilterInput) {
                dateFilterInput.addEventListener('change', function(e) {
                    selectedDate = e.target.value || '';
                    self.render();
                    SoundFX.play('pop');
                });
            }
            if (dateFilterClear) {
                dateFilterClear.addEventListener('click', function() {
                    selectedDate = '';
                    if (dateFilterInput) dateFilterInput.value = '';
                    self.render();
                });
            }

            // Week / month navigation for the goal views
            function shiftPeriod(dir) {
                var d = parseDate(selectedDate || self.getTodayStr());
                if (currentFilter === 'monthly') d = new Date(d.getFullYear(), d.getMonth() + dir, 1);
                else d.setDate(d.getDate() + 7 * dir);
                selectedDate = fmtDate(d);
                if (dateFilterInput) dateFilterInput.value = selectedDate;
                self.render();
                SoundFX.play('pop');
            }
            var prevPeriodBtn = document.getElementById('btn-period-prev');
            var nextPeriodBtn = document.getElementById('btn-period-next');
            var thisPeriodBtn = document.getElementById('btn-period-current');
            if (prevPeriodBtn) prevPeriodBtn.addEventListener('click', function() { shiftPeriod(-1); });
            if (nextPeriodBtn) nextPeriodBtn.addEventListener('click', function() { shiftPeriod(1); });
            if (thisPeriodBtn) {
                thisPeriodBtn.addEventListener('click', function() {
                    selectedDate = '';
                    if (dateFilterInput) dateFilterInput.value = '';
                    self.render();
                });
            }

            // Search input
            var searchInput = document.getElementById('global-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', function(e) {
                    searchQuery = e.target.value.toLowerCase().trim();
                    self.renderTaskList();
                });
            }

            // Sort Selector
            var sortSelect = document.getElementById('sort-selector');
            if (sortSelect) {
                sortSelect.addEventListener('change', function(e) {
                    currentSort = e.target.value;
                    SoundFX.play('pop');
                    self.renderTaskList();
                });
            }

            // Mobile Drawer toggle buttons
            var openDrawerBtn = document.getElementById('btn-open-drawer');
            var closeDrawerBtn = document.getElementById('btn-close-drawer');
            var drawerOverlay = document.getElementById('drawer-overlay');
            if (openDrawerBtn) openDrawerBtn.addEventListener('click', () => self.openDrawer());
            if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', () => self.closeDrawer());
            if (drawerOverlay) drawerOverlay.addEventListener('click', () => self.closeDrawer());

            // Task Edit / Detail Modal
            var editModal = document.getElementById('task-edit-modal');
            var editForm = document.getElementById('task-edit-form');
            var closeEditBtn = document.getElementById('btn-close-edit-modal');
            var cancelEditBtn = document.getElementById('btn-cancel-edit');
            var deleteInEditBtn = document.getElementById('btn-delete-in-edit');

            if (closeEditBtn) closeEditBtn.addEventListener('click', () => self.closeEditModal());
            if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => self.closeEditModal());

            if (deleteInEditBtn) {
                deleteInEditBtn.addEventListener('click', function() {
                    if (editingTaskId && confirm('Are you sure you want to delete this task?')) {
                        self.deleteTask(editingTaskId);
                        self.closeEditModal();
                    }
                });
            }

            if (editForm) {
                editForm.addEventListener('submit', function(e) {
                    e.preventDefault();
                    if (!editingTaskId) return;
                    var task = tasks.find(t => t.id === editingTaskId);
                    if (!task) return;

                    task.title = document.getElementById('edit-task-title').value.trim();
                    task.notes = document.getElementById('edit-task-notes').value.trim();
                    task.priority = document.getElementById('edit-task-priority').value;
                    task.category = document.getElementById('edit-task-category').value;
                    var newRemind = fromLocalInput(document.getElementById('edit-task-remind').value);
                    if (newRemind !== (task.remindAt || '')) {
                        task.remindAt = newRemind;
                        task.reminded = false;
                        task.remindDirty = true; // re-arm the reminder in the cloud
                    }
                    var typeChoice = parseTypeValue(document.getElementById('edit-task-type').value);
                    task.type = typeChoice.type;
                    if (typeChoice.type === 'custom') task.list = typeChoice.list; else delete task.list;
                    var repeatVal = document.getElementById('edit-task-repeat').value;
                    task.dueDate = isCustom(task) ? '' : periodEnd(task.type, document.getElementById('edit-task-duedate').value || self.getTodayStr());

                    task.repeat = task.type === 'daily' ? repeatVal : '';
                    task.repeatDay = task.repeat ? parseDate(task.dueDate).getDate() : undefined;

                    self.persistTasks();
                    self.closeEditModal();
                    showToast('Task updated', 'info');
                    SoundFX.play('pop');
                });
            }

            // Subtask Add within Edit Modal
            var addSubtaskBtn = document.getElementById('btn-add-subtask');
            var subtaskInput = document.getElementById('new-subtask-input');
            if (addSubtaskBtn && subtaskInput) {
                var handleAddSubtask = function() {
                    var title = subtaskInput.value.trim();
                    if (!title || !editingTaskId) return;
                    var task = tasks.find(t => t.id === editingTaskId);
                    if (!task) return;
                    if (!task.subtasks) task.subtasks = [];
                    task.subtasks.push({
                        id: 'st_' + Date.now() + '_' + Math.floor(Math.random() * 100),
                        title: title,
                        completed: false
                    });
                    subtaskInput.value = '';
                    self.renderEditSubtasks(task);
                    self.persistTasks();
                    SoundFX.play('pop');
                };

                addSubtaskBtn.addEventListener('click', handleAddSubtask);
                subtaskInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSubtask();
                    }
                });
            }

            // Settings Modal & Data Management
            var settingsBtn = document.getElementById('btn-open-settings');
            var settingsModal = document.getElementById('settings-modal');
            var closeSettingsBtn = document.getElementById('btn-close-settings');
            var supabaseUrlInput = document.getElementById('supabase-url-input');
            var supabaseKeyInput = document.getElementById('supabase-key-input');
            var supabaseStatusPill = document.getElementById('supabase-status-pill');
            var btnSaveSupabase = document.getElementById('btn-save-supabase');
            var btnDisconnectSupabase = document.getElementById('btn-disconnect-supabase');

            function updateSupabasePill() {
                if (!supabaseStatusPill) return;
                if (window.TaskSupabase && window.TaskSupabase.isEnabled()) {
                    supabaseStatusPill.textContent = 'Synced';
                    supabaseStatusPill.classList.add('on');
                } else {
                    supabaseStatusPill.textContent = 'Offline';
                    supabaseStatusPill.classList.remove('on');
                }
            }

            if (settingsBtn) {
                settingsBtn.addEventListener('click', () => {
                    if (supabaseUrlInput && window.TaskSupabase) supabaseUrlInput.value = window.TaskSupabase.getUrl();
                    if (supabaseKeyInput && window.TaskSupabase) supabaseKeyInput.value = window.TaskSupabase.getKey();
                    updateSupabasePill();
                    settingsModal.classList.remove('hidden');
                    SoundFX.play('pop');
                });
            }
            if (closeSettingsBtn) {
                closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
            }

            if (btnSaveSupabase) {
                btnSaveSupabase.addEventListener('click', async function() {
                    var rawUrl = (supabaseUrlInput ? supabaseUrlInput.value : '').trim();
                    var key = (supabaseKeyInput ? supabaseKeyInput.value : '').trim();
                    var url = (window.TaskSupabase && window.TaskSupabase.formatUrl) ? window.TaskSupabase.formatUrl(rawUrl) : rawUrl;
                    if (supabaseUrlInput) supabaseUrlInput.value = url;

                    if (!url || !key) {
                        showToast('Please enter both Project URL and Anon Key', 'info');
                        return;
                    }

                    btnSaveSupabase.disabled = true;
                    btnSaveSupabase.textContent = 'Connecting...';

                    try {
                        await window.TaskSupabase.saveConfig(url, key);
                        updateSupabasePill();
                        self.checkSyncStatus();
                        showToast('Connected and synced', 'success');
                        SoundFX.play('fanfare');

                        // Sync current tasks up to Supabase if any exist
                        if (tasks.length > 0) {
                            var u = TaskAPI.getCurrentUser();
                            if (u) await window.TaskSupabase.saveTodos(tasks, u.id);
                        }
                        await self.loadTasks();
                    } catch(err) {
                        alert('Connection Failed:\n' + err.message);
                    } finally {
                        btnSaveSupabase.disabled = false;
                        btnSaveSupabase.textContent = 'Save & Connect';
                    }
                });
            }

            if (btnDisconnectSupabase) {
                btnDisconnectSupabase.addEventListener('click', async function() {
                    if (window.TaskSupabase) {
                        await window.TaskSupabase.saveConfig('', '');
                    }
                    if (supabaseUrlInput) supabaseUrlInput.value = '';
                    if (supabaseKeyInput) supabaseKeyInput.value = '';
                    updateSupabasePill();
                    self.checkSyncStatus();
                    showToast('Switched to Local Mode', 'info');
                });
            }

            // Reminders: clear button + notification settings
            var clearRemindBtn = document.getElementById('btn-clear-remind');
            if (clearRemindBtn) {
                clearRemindBtn.addEventListener('click', function() {
                    document.getElementById('edit-task-remind').value = '';
                    self.refreshDateInputs();
                });
            }

            var enablePushBtn = document.getElementById('btn-enable-push');
            var disablePushBtn = document.getElementById('btn-disable-push');
            var pushPill = document.getElementById('push-status-pill');
            var pushHelp = document.getElementById('push-help-text');

            function updatePushUI() {
                if (!pushPill || !window.TaskPush) return;
                var on = TaskPush.isOn();
                var blockedNow = TaskPush.permission() === 'denied';
                pushPill.textContent = on ? 'On' : (blockedNow ? 'Blocked' : 'Off');
                pushPill.classList.toggle('on', on);
                if (enablePushBtn) enablePushBtn.classList.toggle('hidden', on);
                if (disablePushBtn) disablePushBtn.classList.toggle('hidden', !on);
                if (pushHelp) pushHelp.textContent = on ? 'Reminders will arrive on this device, even when the app is closed.' : TaskPush.blocker();
            }

            if (settingsBtn) settingsBtn.addEventListener('click', updatePushUI);

            if (enablePushBtn) {
                enablePushBtn.addEventListener('click', async function() {
                    enablePushBtn.disabled = true;
                    try {
                        await TaskPush.enable();
                        showToast('Notifications enabled on this device', 'success');
                        SoundFX.play('fanfare');
                        TaskPush.showLocal('TaskFlow reminders are on', 'You will be notified at the time you set on a task.', 'taskflow-welcome');
                    } catch (err) {
                        showToast(err.message || 'Could not enable notifications', 'info');
                    } finally {
                        enablePushBtn.disabled = false;
                        updatePushUI();
                    }
                });
            }
            if (disablePushBtn) {
                disablePushBtn.addEventListener('click', async function() {
                    await TaskPush.disable();
                    showToast('Notifications turned off on this device', 'info');
                    updatePushUI();
                });
            }

            // Export JSON
            var exportBtn = document.getElementById('btn-export-json');
            if (exportBtn) {
                exportBtn.addEventListener('click', function() {
                    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
                    var downloadAnchor = document.createElement('a');
                    downloadAnchor.setAttribute("href", dataStr);
                    downloadAnchor.setAttribute("download", "taskflow-backup-" + self.getTodayStr() + ".json");
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                    showToast('Backup downloaded', 'success');
                });
            }

            // Import JSON
            var importInput = document.getElementById('import-json-file');
            if (importInput) {
                importInput.addEventListener('change', function(e) {
                    var file = e.target.files[0];
                    if (!file) return;
                    var reader = new FileReader();
                    reader.onload = async function(evt) {
                        try {
                            var imported = JSON.parse(evt.target.result);
                            if (Array.isArray(imported)) {
                                tasks = imported;
                                await self.persistTasks();
                                showToast('Tasks imported', 'success');
                                SoundFX.play('fanfare');
                                settingsModal.classList.add('hidden');
                            } else {
                                alert('Invalid JSON structure. Expected a list of tasks.');
                            }
                        } catch(err) {
                            alert('Failed to parse JSON file.');
                        }
                    };
                    reader.readAsText(file);
                });
            }

            // Keyboard Shortcuts: '/' for search, 'n' for new task
            window.addEventListener('keydown', function(e) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                    if (e.key === 'Escape') {
                        e.target.blur();
                        self.closeAllModals();
                    }
                    return;
                }

                if (e.key === '/') {
                    e.preventDefault();
                    if (searchInput) searchInput.focus();
                } else if (e.key === 'n' || e.key === 'N') {
                    e.preventDefault();
                    if (quickAddInput) {
                        quickAddInput.focus();
                        quickAddInput.scrollIntoView({ behavior: 'smooth' });
                    }
                } else if (e.key === 'Escape') {
                    self.closeAllModals();
                }
            });
        },

        setupThemeToggle: function() {
            var toggleBtns = document.querySelectorAll('.btn-theme-toggle');
            var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

            function effectiveTheme() {
                return document.documentElement.getAttribute('data-theme') || (mq && mq.matches ? 'dark' : 'light');
            }
            function paintToggle() {
                toggleBtns.forEach(b => b.innerHTML = effectiveTheme() === 'dark' ? icon('sun') : icon('moon'));
            }
            function applyTheme(theme) {
                document.documentElement.setAttribute('data-theme', theme);
                try { localStorage.setItem('taskflow_theme_choice', theme); } catch (e) {}
                paintToggle();
            }

            var saved = null;
            try { saved = localStorage.getItem('taskflow_theme_choice'); } catch (e) {}
            if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
            paintToggle();
            if (mq && mq.addEventListener) mq.addEventListener('change', paintToggle);

            toggleBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var nowTheme = effectiveTheme() === 'dark' ? 'light' : 'dark';
                    applyTheme(nowTheme);
                    SoundFX.play('pop');
                });
            });
        },

        // Custom lists: add, rename, delete (up to five). Due-date inputs hide while a list is the selected type.
        setupCustomList: function() {
            var self = this;
            var nav = document.getElementById('custom-list-nav');
            var addBtn = document.getElementById('btn-add-list');
            if (addBtn) {
                addBtn.addEventListener('click', function() {
                    if (customLists.length >= MAX_LISTS) {
                        showToast('You can have up to ' + MAX_LISTS + ' lists. Delete one to add another.', 'info');
                        return;
                    }
                    var name = prompt('Name your new list');
                    if (name === null) return;
                    name = name.trim().slice(0, 40);
                    if (!name) return;
                    var id = 'l' + Date.now().toString(36);
                    customLists.push({ id: id, name: name });
                    self.commitLists();
                    currentList = id;
                    self.setFilter('custom');
                    SoundFX.play('pop');
                    self.closeDrawer();
                });
            }
            if (nav) {
                nav.addEventListener('click', function(e) {
                    var rename = e.target.closest('[data-rename]');
                    var del = e.target.closest('[data-delete]');
                    var open = e.target.closest('[data-list]');
                    if (rename) {
                        var rid = rename.getAttribute('data-rename');
                        var next = prompt('Rename this list', listName(rid));
                        if (next === null) return;
                        next = next.trim().slice(0, 40);
                        if (!next) return;
                        customLists.find(function(l) { return l.id === rid; }).name = next;
                        self.commitLists();
                        SoundFX.play('pop');
                        showToast('List renamed', 'success');
                    } else if (del) {
                        var did = del.getAttribute('data-delete');
                        if (customLists.length <= 1) { showToast('Keep at least one list', 'info'); return; }
                        var inList = tasks.filter(function(t) { return isCustom(t) && listOf(t) === did; });
                        var fallback = customLists.find(function(l) { return l.id !== did; });
                        var msg = 'Delete "' + listName(did) + '"?' + (inList.length ? ' Its ' + inList.length + ' task' + (inList.length === 1 ? '' : 's') + ' will move to "' + fallback.name + '".' : '');
                        if (!confirm(msg)) return;
                        inList.forEach(function(t) { t.list = fallback.id; });
                        customLists = customLists.filter(function(l) { return l.id !== did; });
                        if (currentList === did) currentList = customLists[0].id;
                        if (inList.length) self.persistTasks();
                        self.commitLists();
                        self.render();
                        if (currentFilter === 'custom') self.setFilter('custom');
                    } else if (open) {
                        currentList = open.getAttribute('data-list');
                        self.setFilter('custom');
                        SoundFX.play('pop');
                        self.closeDrawer();
                    }
                });
            }
            var quickType = document.getElementById('quick-type-select');
            var editType = document.getElementById('edit-task-type');
            if (quickType) quickType.addEventListener('change', function() { self.syncDueDateInputs(); });
            if (editType) editType.addEventListener('change', function() { self.syncDueDateInputs(); });
            this.applyCustomLists();
            this.syncDueDateInputs();
            ['input', 'change'].forEach(function(ev) {
                document.addEventListener(ev, function(e) {
                    if (e.target && e.target.matches && e.target.matches('input[type="date"], input[type="datetime-local"]')) self.refreshDateInputs();
                });
            });
        },

        // Save after a local change: this device now, then the cloud (latest edit wins)
        commitLists: function() {
            try { localStorage.setItem(LISTS_KEY, JSON.stringify(customLists)); } catch (e) {}
            this.applyCustomLists();
            this.updateViewTitle();
            var u = TaskAPI.getCurrentUser();
            if (u && window.TaskSupabase && TaskSupabase.isEnabled()) TaskSupabase.saveCustomLists(u.id, customLists);
        },

        // Apply lists that arrived from the cloud without writing them back
        setListsFromCloud: function(list) {
            var clean = cleanLists(list);
            if (!clean || JSON.stringify(clean) === JSON.stringify(customLists)) return;
            customLists = clean;
            if (!customLists.some(function(l) { return l.id === currentList; })) currentList = customLists[0].id;
            try { localStorage.setItem(LISTS_KEY, JSON.stringify(customLists)); } catch (e) {}
            this.applyCustomLists();
            this.updateViewTitle();
            this.renderTaskList();
        },

        // Pull the lists from the cloud (or publish this device's), then keep listening for changes
        syncCustomLists: async function() {
            var u = TaskAPI.getCurrentUser();
            if (!u || !window.TaskSupabase || !TaskSupabase.isEnabled()) return;
            var cloud = await TaskSupabase.getCustomLists(u.id);
            if (cloud === null) return; // table missing or offline: keep this device's lists
            if (cloud.lists && cloud.lists.length) {
                this.setListsFromCloud(cloud.lists);
            } else if (cloud.legacyName && customLists.length === 1 && customLists[0].name === DEFAULT_CUSTOM_NAME) {
                // Only the old single-list name exists in the cloud: it is the first list
                customLists[0].name = cloud.legacyName;
                this.commitLists();
            } else if (JSON.stringify(customLists) !== JSON.stringify([{ id: 'custom', name: DEFAULT_CUSTOM_NAME }])) {
                TaskSupabase.saveCustomLists(u.id, customLists);
            }
            if (!this._settingsSubscribed) {
                this._settingsSubscribed = true;
                TaskSupabase.subscribeToSettings(u.id, function(payload) {
                    var row = payload && payload.new;
                    if (!row) return;
                    if (row.custom_lists) App.setListsFromCloud(row.custom_lists);
                    else if (row.custom_list_name && row.custom_list_name !== customLists[0].name && customLists.length === 1) {
                        customLists[0].name = row.custom_list_name;
                        App.commitLists();
                    }
                    if (row.categories) App.setCategoriesFromCloud(row.categories);
                });
            }
        },

        // Sidebar rows and the two type pickers follow the lists
        applyCustomLists: function() {
            var nav = document.getElementById('custom-list-nav');
            if (nav) {
                nav.innerHTML = '';
                var many = customLists.length > 1;
                customLists.forEach(function(l) {
                    var li = document.createElement('li');
                    li.className = 'nav-custom-row';
                    var active = currentFilter === 'custom' && currentCategory === 'all' && currentList === l.id;
                    li.innerHTML =
                        '<button type="button" class="nav-item-btn' + (active ? ' active' : '') + '" data-filter="custom" data-list="' + l.id + '" id="nav-filter-' + l.id + '">' +
                        icon('list').replace('class="icon"', 'class="icon nav-icon"') +
                        '<span class="nav-label" id="' + (l.id === 'custom' ? 'custom-list-label' : 'list-label-' + l.id) + '">' + App.escapeHtml(l.name) + '</span>' +
                        '<span class="nav-badge-count" id="count-' + l.id + '">0</span></button>' +
                        '<button type="button" class="icon-btn nav-rename-btn" data-rename="' + l.id + '" id="btn-rename-' + l.id + '" title="Rename this list" aria-label="Rename ' + App.escapeHtml(l.name) + '">' + icon('pencil') + '</button>' +
                        (many ? '<button type="button" class="icon-btn nav-rename-btn nav-delete-btn" data-delete="' + l.id + '" title="Delete this list" aria-label="Delete ' + App.escapeHtml(l.name) + '">' + icon('trash') + '</button>' : '');
                    nav.appendChild(li);
                });
            }
            var addBtn = document.getElementById('btn-add-list');
            if (addBtn) {
                var full = customLists.length >= MAX_LISTS;
                addBtn.classList.toggle('is-full', full);
                addBtn.querySelector('span').textContent = full ? 'List limit reached (' + MAX_LISTS + ')' : 'New list';
            }
            [['quick-type-select', true], ['edit-task-type', false]].forEach(function(pair) {
                var sel = document.getElementById(pair[0]);
                if (!sel) return;
                var prev = sel.value;
                sel.innerHTML = '';
                var add = function(value, text, flags) {
                    var o = document.createElement('option');
                    o.value = value; o.textContent = text;
                    if (flags) { o.disabled = true; o.hidden = true; }
                    sel.appendChild(o);
                };
                if (pair[1]) add('', 'Task type', true);
                add('daily', 'Daily task');
                add('weekly', 'Weekly goal');
                add('monthly', 'Monthly goal');
                customLists.forEach(function(l) { add('list:' + l.id, l.name); });
                var exists = Array.prototype.some.call(sel.options, function(o) { return o.value === prev; });
                sel.value = exists ? prev : (pair[1] ? '' : 'daily');
            });
            this.updateBadgeCounts();
            this.syncDueDateInputs();
        },

        // ---- Notification alerts: user-made schedules, sent by the send-notification-alerts Edge Function ----
        setupNotifAlerts: function() {
            var self = this;
            var MAX_ALERTS = 5;
            var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            var PRESETS = {
                morning: { name: 'Morning nudge', kind: 'nudge', send_time: '08:00', days: '0,1,2,3,4,5,6', subject: 'Plan your day', message: 'Good morning! Take a minute to add what you want to get done today.' },
                night: { name: 'Night summary', kind: 'remaining', send_time: '21:00', days: '0,1,2,3,4,5,6', subject: '', message: 'Here is what is still open from today.' }
            };
            var modal = document.getElementById('notif-alert-modal');
            var form = document.getElementById('notif-alert-form');
            var listEl = document.getElementById('notif-alert-list');
            if (!modal || !form || !listEl) return;
            var alerts = [];
            var editingId = null;

            var cloudOn = function() { return !!(window.TaskSupabase && TaskSupabase.isEnabled() && TaskAPI.getCurrentUser()); };
            var $ = function(id) { return document.getElementById(id); };
            var daysSummary = function(days) {
                var set = days.split(',').map(Number);
                if (set.length === 7) return 'Every day';
                if (set.length === 5 && [1, 2, 3, 4, 5].every(function(d) { return set.indexOf(d) >= 0; })) return 'Weekdays';
                return set.slice().sort().map(function(d) { return DAY_NAMES[d]; }).join(', ');
            };
            var timeLabel = function(hhmm) {
                var p = hhmm.split(':');
                var d = new Date(); d.setHours(+p[0], +p[1], 0, 0);
                return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            };

            // Day chips
            var dayBox = $('ea-days');
            DAY_NAMES.forEach(function(n, i) {
                var b = document.createElement('button');
                b.type = 'button'; b.className = 'day-chip'; b.textContent = n[0]; b.title = n;
                b.setAttribute('data-day', i); b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', n);
                b.addEventListener('click', function() { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); });
                dayBox.appendChild(b);
            });
            var getDays = function() {
                return [].slice.call(dayBox.children).filter(function(b) { return b.getAttribute('aria-pressed') === 'true'; })
                    .map(function(b) { return b.getAttribute('data-day'); }).join(',');
            };
            var setDays = function(days) {
                var set = days.split(',');
                [].forEach.call(dayBox.children, function(b) { b.setAttribute('aria-pressed', set.indexOf(b.getAttribute('data-day')) >= 0 ? 'true' : 'false'); });
            };
            var showError = function(msg) { var e = $('ea-error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); };

            var render = function() {
                listEl.innerHTML = '';
                var empty = $('notif-alert-empty');
                if (!cloudOn()) {
                    empty.textContent = 'Notification alerts need cloud sync. Sign in with your synced account to use them.';
                    empty.classList.remove('hidden');
                } else if (!alerts.length) {
                    empty.textContent = 'No alerts yet. Create your own or start from a quick start below.';
                    empty.classList.remove('hidden');
                } else {
                    empty.classList.add('hidden');
                }
                alerts.forEach(function(a) {
                    var row = document.createElement('div');
                    row.className = 'notif-alert-row';
                    row.innerHTML =
                        '<button type="button" class="notif-alert-main" data-id="' + a.id + '">' +
                        '<span class="notif-alert-name">' + App.escapeHtml(a.name) + '</span>' +
                        '<span class="notif-alert-meta">' + timeLabel(a.send_time) + ' · ' + daysSummary(a.days) + ' · ' + ({ remaining: 'Remaining tasks', reminder: 'Just a reminder' }[a.kind] || 'Add-tasks nudge') + '</span></button>' +
                        '<label class="switch" title="' + (a.enabled ? 'On' : 'Off') + '"><input type="checkbox" data-toggle="' + a.id + '"' + (a.enabled ? ' checked' : '') + ' aria-label="Enable ' + App.escapeHtml(a.name) + '"><span class="switch-track"></span></label>';
                    listEl.appendChild(row);
                });
                var add = $('btn-add-notif-alert');
                add.disabled = !cloudOn() || alerts.length >= MAX_ALERTS;
                add.lastChild.textContent = alerts.length >= MAX_ALERTS ? 'Limit reached (' + MAX_ALERTS + ')' : 'New alert';
                document.querySelectorAll('#notif-alert-presets .chip-btn').forEach(function(b) { b.disabled = add.disabled; });
            };

            self.refreshNotifAlerts = async function() {
                var u = TaskAPI.getCurrentUser();
                alerts = (cloudOn() && await TaskSupabase.listNotifAlerts(u.id)) || [];
                render();
            };

            var openEditor = function(a) {
                editingId = a.id || null;
                $('notif-alert-heading').textContent = editingId ? 'Edit notification alert' : 'New notification alert';
                $('ea-name').value = a.name || '';
                $('ea-kind').value = a.kind || 'nudge';
                $('ea-time').value = a.send_time || '08:00';
                $('ea-subject').value = a.subject || '';
                $('ea-message').value = a.message || '';
                setDays(a.days || '0,1,2,3,4,5,6');
                showError('');
                $('btn-delete-notif-alert').classList.toggle('hidden', !editingId);
                $('btn-test-notif-alert').classList.toggle('hidden', !editingId);
                modal.classList.remove('hidden');
                SoundFX.play('pop');
            };
            var close = function() { modal.classList.add('hidden'); };

            $('btn-add-notif-alert').addEventListener('click', function() { openEditor({}); });
            document.querySelectorAll('#notif-alert-presets .chip-btn').forEach(function(b) {
                b.addEventListener('click', function() { openEditor(PRESETS[b.getAttribute('data-preset')]); });
            });
            $('btn-close-notif-alert').addEventListener('click', close);
            modal.addEventListener('click', function(e) { if (e.target === modal) close(); });

            listEl.addEventListener('click', function(e) {
                var main = e.target.closest('.notif-alert-main');
                if (main) openEditor(alerts.find(function(a) { return a.id === main.getAttribute('data-id'); }) || {});
            });
            listEl.addEventListener('change', async function(e) {
                var id = e.target.getAttribute('data-toggle');
                if (!id) return;
                var a = alerts.find(function(x) { return x.id === id; });
                var ok = await TaskSupabase.setNotifAlertEnabled(id, e.target.checked);
                if (ok) { a.enabled = e.target.checked; showToast(e.target.checked ? 'Alert on' : 'Alert off', 'success'); }
                else { e.target.checked = !e.target.checked; showToast('Could not update the alert', 'error'); }
            });

            form.addEventListener('submit', async function(e) {
                e.preventDefault();
                var name = $('ea-name').value.trim();
                var days = getDays();
                if (!name) return showError('Give the alert a name.');
                if (!$('ea-time').value) return showError('Pick a time.');
                if (!days) return showError('Pick at least one day.');
                if (!editingId && alerts.length >= MAX_ALERTS) return showError('You can have up to ' + MAX_ALERTS + ' alerts. Delete one first.');
                var existing = alerts.find(function(a) { return a.id === editingId; });
                var payload = {
                    name: name.slice(0, 40), kind: $('ea-kind').value, send_time: $('ea-time').value, days: days,
                    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
                    subject: $('ea-subject').value.trim(), message: $('ea-message').value.trim(),
                    enabled: existing ? existing.enabled : true
                };
                if (editingId) payload.id = editingId;
                try {
                    await TaskSupabase.saveNotifAlert(TaskAPI.getCurrentUser().id, payload);
                    close();
                    await self.refreshNotifAlerts();
                    SoundFX.play('pop');
                    showToast('Alert saved', 'success');
                } catch (err) {
                    showError('Could not save. Run the notification alerts SQL in Supabase first. (' + err.message + ')');
                }
            });

            $('btn-delete-notif-alert').addEventListener('click', async function() {
                if (!editingId || !confirm('Delete this alert?')) return;
                if (await TaskSupabase.deleteNotifAlert(editingId)) {
                    close();
                    await self.refreshNotifAlerts();
                    showToast('Alert deleted', 'success');
                } else showError('Could not delete the alert.');
            });

            $('btn-test-notif-alert').addEventListener('click', async function() {
                var btn = this;
                btn.disabled = true;
                showError('');
                try {
                    await TaskSupabase.sendTestNotifAlert(editingId);
                    showToast('Test notification sent to your devices', 'success');
                } catch (err) {
                    showError('Test failed: ' + err.message);
                } finally { btn.disabled = false; }
            });

            var settingsBtn = $('btn-open-settings');
            if (settingsBtn) settingsBtn.addEventListener('click', function() { self.refreshNotifAlerts(); });
            render();
        },

        // ---- Categories: sidebar, pickers, manager dialog, cloud sync ----
        setupCategories: function() {
            var self = this;
            var modal = document.getElementById('category-modal');
            var list = document.getElementById('category-edit-list');
            if (!modal || !list) return;
            var open = function() { self.renderCategoryEditor(); modal.classList.remove('hidden'); SoundFX.play('pop'); };
            var close = function() { modal.classList.add('hidden'); };
            document.getElementById('btn-manage-categories').addEventListener('click', open);
            document.getElementById('btn-close-categories').addEventListener('click', close);
            document.getElementById('btn-done-categories').addEventListener('click', close);
            modal.addEventListener('click', function(e) { if (e.target === modal) close(); });

            document.getElementById('btn-add-category').addEventListener('click', function() {
                if (addedCount(categoryList) >= MAX_ADDED_CATEGORIES) { showToast('You can add up to ' + MAX_ADDED_CATEGORIES + ' categories of your own. Delete one to add another.', 'info'); return; }
                var used = categoryList.map(function(c) { return c.color; });
                var color = CATEGORY_COLORS.find(function(c) { return used.indexOf(c) < 0; }) || CATEGORY_COLORS[categoryList.length % CATEGORY_COLORS.length];
                categoryList.push({ id: 'c' + Date.now().toString(36), name: 'New category', color: color });
                self.commitCategories();
                self.renderCategoryEditor();
                var inputs = list.querySelectorAll('.category-name-input');
                var last = inputs[inputs.length - 1];
                if (last) { last.focus(); last.select(); }
            });

            list.addEventListener('change', function(e) {
                var row = e.target.closest('.category-edit-row');
                if (!row) return;
                var cat = categoryList.find(function(c) { return c.id === row.getAttribute('data-id'); });
                if (!cat) return;
                if (e.target.classList.contains('category-name-input')) {
                    var name = e.target.value.trim().slice(0, 24);
                    if (!name) { e.target.value = cat.name; return; }
                    cat.name = name;
                } else if (e.target.classList.contains('category-color-input')) {
                    cat.color = e.target.value;
                }
                self.commitCategories();
            });

            list.addEventListener('click', function(e) {
                var btn = e.target.closest('.category-delete-btn');
                if (!btn) return;
                var id = btn.closest('.category-edit-row').getAttribute('data-id');
                if (categoryList.length <= 1) { showToast('Keep at least one category', 'info'); return; }
                var cat = categoryList.find(function(c) { return c.id === id; });
                var inUse = tasks.filter(function(t) { return categoryOf(t.category).id === id; }).length;
                var fallback = categoryList.find(function(c) { return c.id !== id; });
                var msg = 'Delete "' + cat.name + '"?' + (inUse ? ' Its ' + inUse + ' task' + (inUse === 1 ? '' : 's') + ' will move to "' + fallback.name + '".' : '');
                if (!confirm(msg)) return;
                if (inUse) {
                    tasks.forEach(function(t) { if (categoryOf(t.category).id === id) t.category = fallback.id; });
                    self.persistTasks();
                }
                categoryList = categoryList.filter(function(c) { return c.id !== id; });
                if (currentCategory === id) self.setCategory('all');
                self.commitCategories();
                self.renderCategoryEditor();
                self.render();
            });

            this.applyCategories();
        },

        renderCategoryEditor: function() {
            var list = document.getElementById('category-edit-list');
            if (!list) return;
            list.innerHTML = '';
            categoryList.forEach(function(c) {
                var row = document.createElement('div');
                row.className = 'category-edit-row';
                row.setAttribute('data-id', c.id);
                row.innerHTML =
                    '<input type="color" class="category-color-input" value="' + c.color + '" aria-label="Color">' +
                    '<input type="text" class="form-input category-name-input" maxlength="24" value="' + App.escapeHtml(c.name) + '" aria-label="Category name">' +
                    '<button type="button" class="icon-btn category-delete-btn" title="Delete category" aria-label="Delete ' + App.escapeHtml(c.name) + '">' + icon('trash') + '</button>';
                list.appendChild(row);
            });
            var add = document.getElementById('btn-add-category');
            if (add) {
                var n = addedCount(categoryList);
                add.disabled = n >= MAX_ADDED_CATEGORIES;
                add.lastChild.textContent = 'Add category (' + n + '/' + MAX_ADDED_CATEGORIES + ' added)';
            }
        },

        // Rebuild the sidebar list and both pickers from categoryList, keeping the current selections
        applyCategories: function() {
            var nav = document.getElementById('category-list');
            if (nav) {
                nav.innerHTML = '';
                categoryList.forEach(function(c) {
                    var li = document.createElement('li');
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'nav-item-btn' + (currentCategory === c.id ? ' active' : '');
                    btn.setAttribute('data-category', c.id);
                    btn.id = 'cat-filter-' + c.id;
                    var dot = document.createElement('span');
                    dot.className = 'category-dot';
                    dot.style.background = c.color;
                    var label = document.createElement('span');
                    label.className = 'nav-label';
                    label.textContent = c.name;
                    btn.appendChild(dot);
                    btn.appendChild(label);
                    btn.addEventListener('click', function() {
                        App.setCategory(c.id);
                        SoundFX.play('pop');
                        App.closeDrawer();
                    });
                    li.appendChild(btn);
                    nav.appendChild(li);
                });
            }
            ['quick-category-select', 'edit-task-category'].forEach(function(id) {
                var sel = document.getElementById(id);
                if (!sel) return;
                var prev = sel.value;
                sel.innerHTML = '';
                if (id === 'quick-category-select') {
                    var ph = document.createElement('option');
                    ph.value = ''; ph.textContent = 'Category'; ph.disabled = true; ph.hidden = true;
                    sel.appendChild(ph);
                }
                categoryList.forEach(function(c) {
                    var o = document.createElement('option');
                    o.value = c.id;
                    o.textContent = c.name;
                    sel.appendChild(o);
                });
                sel.value = categoryList.some(function(c) { return c.id === prev; }) ? prev : (id === 'quick-category-select' ? '' : categoryList[0].id);
            });
            this.updateViewTitle();
        },

        // Save after a local change: this device now, then the cloud (latest edit wins)
        commitCategories: function() {
            try { localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categoryList)); } catch (e) {}
            this.applyCategories();
            this.renderTaskList();
            var u = TaskAPI.getCurrentUser();
            if (u && window.TaskSupabase && TaskSupabase.isEnabled()) TaskSupabase.saveCategories(u.id, categoryList);
        },

        // Apply a list that arrived from the cloud without writing it back
        setCategoriesFromCloud: function(list) {
            var clean = cleanCategories(list);
            if (!clean || JSON.stringify(clean) === JSON.stringify(categoryList)) return;
            categoryList = clean;
            try { localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categoryList)); } catch (e) {}
            if (currentCategory !== 'all' && !categoryList.some(function(c) { return c.id === currentCategory; })) currentCategory = 'all';
            this.applyCategories();
            this.renderCategoryEditor();
            this.renderTaskList();
        },

        syncCategories: async function() {
            var u = TaskAPI.getCurrentUser();
            if (!u || !window.TaskSupabase || !TaskSupabase.isEnabled()) return;
            var cloud = await TaskSupabase.getCategories(u.id);
            if (cloud === null) return; // column missing or offline: keep this device's list
            if (cloud.length) this.setCategoriesFromCloud(cloud);
            else if (JSON.stringify(categoryList) !== JSON.stringify(DEFAULT_CATEGORIES)) TaskSupabase.saveCategories(u.id, categoryList);
        },

        syncDueDateInputs: function() {
            var quickType = document.getElementById('quick-type-select');
            var editType = document.getElementById('edit-task-type');
            var quickDate = document.getElementById('quick-due-date');
            var editGroup = document.getElementById('edit-duedate-group');
            if (quickDate && quickType) (quickDate.closest('.field-stack') || quickDate).classList.toggle('hidden', isListValue(quickType.value));
            if (editGroup && editType) editGroup.classList.toggle('hidden', isListValue(editType.value));
            var quickRepeat = document.getElementById('quick-repeat-select');
            var editRepeat = document.getElementById('edit-repeat-group');
            if (quickRepeat && quickType) quickRepeat.classList.toggle('hidden', (quickType.value || 'daily') !== 'daily');
            if (editRepeat && editType) editRepeat.classList.toggle('hidden', editType.value !== 'daily');
        },

        setupSoundToggle: function() {
            var soundBtns = document.querySelectorAll('.btn-sound-toggle');
            function updateIcons(enabled) {
                soundBtns.forEach(b => b.innerHTML = enabled ? icon('bell') : icon('bell-off'));
            }
            updateIcons(SoundFX.isEnabled());

            soundBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var enabled = SoundFX.toggle();
                    updateIcons(enabled);
                    showToast(enabled ? 'Sounds on' : 'Sounds off', 'info');
                });
            });
        },

        setupConnectMobileModal: function() {
            var modal = document.getElementById('mobile-connect-modal');
            var openBtns = document.querySelectorAll('.btn-open-connect-mobile');
            var closeBtn = document.getElementById('btn-close-mobile-modal');
            var qrCanvas = document.getElementById('mobile-qr-canvas');
            var mobileUrlEl = document.getElementById('mobile-connect-url');
            var copyUrlBtn = document.getElementById('btn-copy-mobile-url');

            var updateModalContent = async function() {
                var info = await TaskAPI.getServerInfo();
                var mobileUrl = info.lanUrl || window.location.origin;

                // If running on localhost or 127.0.0.1, try to find local network IP from server info
                if (mobileUrlEl) {
                    mobileUrlEl.textContent = mobileUrl;
                }

                if (qrCanvas && window.QRCodeGenerator) {
                    QRCodeGenerator.renderCanvas(mobileUrl, qrCanvas, {
                        size: 220,
                        padding: 12,
                        colorDark: '#0f172a',
                        colorLight: '#ffffff'
                    });
                }
            };

            openBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    if (modal) {
                        modal.classList.remove('hidden');
                        SoundFX.play('pop');
                        updateModalContent();
                    }
                });
            });

            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    modal.classList.add('hidden');
                });
            }

            if (copyUrlBtn) {
                copyUrlBtn.addEventListener('click', function() {
                    var url = mobileUrlEl.textContent;
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(url).then(function() {
                            showToast('Link copied', 'success');
                            SoundFX.play('pop');
                        });
                    }
                });
            }
        },

        setupMobileGestures: function() {
            // Touch gestures for mobile swipe
            var taskList = document.getElementById('task-list');
            if (!taskList) return;

            var touchStartX = 0;
            var touchStartY = 0;
            var activeItem = null;

            taskList.addEventListener('touchstart', function(e) {
                var item = e.target.closest('.task-item');
                if (!item) return;
                activeItem = item;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }, { passive: true });

            taskList.addEventListener('touchmove', function(e) {
                if (!activeItem) return;
                var currentX = e.touches[0].clientX;
                var currentY = e.touches[0].clientY;
                var diffX = currentX - touchStartX;
                var diffY = currentY - touchStartY;

                // If scrolling vertically, cancel horizontal swipe
                if (Math.abs(diffY) > Math.abs(diffX)) return;

                if (diffX > 0 && diffX < 120) {
                    // Swipe right hint (complete)
                    activeItem.style.transform = 'translateX(' + diffX + 'px)';
                    activeItem.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                } else if (diffX < 0 && diffX > -120) {
                    // Swipe left hint (delete)
                    activeItem.style.transform = 'translateX(' + diffX + 'px)';
                    activeItem.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                }
            }, { passive: true });

            taskList.addEventListener('touchend', function(e) {
                if (!activeItem) return;
                var item = activeItem;
                var id = item.getAttribute('data-task-id');
                var diffX = e.changedTouches[0].clientX - touchStartX;

                item.style.transform = '';
                item.style.borderColor = '';
                activeItem = null;

                if (diffX > 80) {
                    // Complete task
                    App.toggleTaskComplete(id);
                } else if (diffX < -80) {
                    // Delete task
                    if (confirm('Delete this task?')) {
                        App.deleteTask(id);
                    }
                }
            });
        },

        openDrawer: function() {
            var drawer = document.getElementById('app-sidebar');
            var overlay = document.getElementById('drawer-overlay');
            if (drawer) drawer.classList.add('mobile-open');
            if (overlay) overlay.classList.remove('hidden');
            SoundFX.play('pop');
        },

        closeDrawer: function() {
            var drawer = document.getElementById('app-sidebar');
            var overlay = document.getElementById('drawer-overlay');
            if (drawer) drawer.classList.remove('mobile-open');
            if (overlay) overlay.classList.add('hidden');
        },

        closeAllModals: function() {
            document.querySelectorAll('.modal-backdrop').forEach(function(m) {
                if (m.id !== 'auth-modal' || TaskAPI.getCurrentUser()) {
                    m.classList.add('hidden');
                }
            });
            this.closeDrawer();
        },

        setFilter: function(filter) {
            currentFilter = filter;
            currentCategory = 'all';

            // Keep the quick-add type in sync with the view the user is in
            var typeByView = { weekly: 'weekly', monthly: 'monthly', custom: 'list:' + currentList, today: 'daily', upcoming: 'daily' };
            var typeSelect = document.getElementById('quick-type-select');
            if (typeSelect && typeByView[filter]) typeSelect.value = typeByView[filter];
            this.syncDueDateInputs();

            document.querySelectorAll('[data-filter]').forEach(function(el) {
                if (el.getAttribute('data-filter') === filter && (filter !== 'custom' || el.getAttribute('data-list') === currentList)) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });

            document.querySelectorAll('[data-category]').forEach(el => el.classList.remove('active'));

            this.updateViewTitle();
            this.renderTaskList();
        },

        setCategory: function(category) {
            currentCategory = category;
            currentFilter = 'all';

            document.querySelectorAll('[data-category]').forEach(function(el) {
                if (el.getAttribute('data-category') === category) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });

            document.querySelectorAll('[data-filter]').forEach(el => el.classList.remove('active'));

            this.updateViewTitle();
            this.renderTaskList();
        },

        updateViewTitle: function() {
            var titleEl = document.getElementById('current-view-title');
            var subtitleEl = document.getElementById('current-view-date');

            if (currentCategory !== 'all') {
                var catMeta = categoryList.find(function(c) { return c.id === currentCategory; });
                if (titleEl) titleEl.textContent = (catMeta ? catMeta.name : 'Category');
            } else {
                var titles = {
                    today: 'Today',
                    all: 'All tasks',
                    upcoming: 'Upcoming',
                    weekly: 'Weekly goals',
                    monthly: 'Monthly goals',
                    custom: listName(currentList),
                    starred: 'Starred',
                    completed: 'Completed'
                };
                if (titleEl) titleEl.textContent = titles[currentFilter] || 'Tasks';
            }

            // A list with no dates has nothing for the date filter to act on
            var dateFilterBox = document.querySelector('.date-filter-container');
            if (dateFilterBox) dateFilterBox.classList.toggle('hidden', currentCategory === 'all' && currentFilter === 'custom');

            var periodNav = document.getElementById('period-nav');
            var inGoalView = currentCategory === 'all' && (currentFilter === 'weekly' || currentFilter === 'monthly');
            if (periodNav) periodNav.classList.toggle('hidden', !inGoalView);
            if (inGoalView) {
                var viewDate = selectedDate || this.getTodayStr();
                var isCurrent = periodEnd(currentFilter, viewDate) === periodEnd(currentFilter, this.getTodayStr());
                var labelEl = document.getElementById('period-nav-label');
                if (labelEl) labelEl.textContent = periodLabel(currentFilter, viewDate) + (isCurrent ? ' (current)' : '');
                var curBtn = document.getElementById('btn-period-current');
                if (curBtn) {
                    curBtn.textContent = currentFilter === 'monthly' ? 'This month' : 'This week';
                    curBtn.classList.toggle('hidden', isCurrent);
                }
            }

            if (subtitleEl) {
                var options = { weekday: 'long', month: 'short', day: 'numeric' };
                if (selectedDate) {
                    subtitleEl.textContent = 'Showing items for ' + parseDate(selectedDate).toLocaleDateString(undefined, options);
                } else {
                    subtitleEl.textContent = new Date().toLocaleDateString(undefined, options);
                }
            }
        },

        getTodayStr: function() {
            return fmtDate(new Date());
        },

        addTask: function(data) {
            var type = data.type || 'daily';
            var newTask = {
                id: 'task_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                type: type,
                remindAt: data.remindAt || '',
                reminded: false,
                remindDirty: !!data.remindAt,
                title: data.title,
                notes: data.notes || '',
                priority: data.priority || 'medium',
                category: data.category || 'personal',
                repeat: type === 'daily' ? (data.repeat || '') : '',
                dueDate: type === 'custom' ? '' : periodEnd(type, data.dueDate || this.getTodayStr()),
                completed: false,
                starred: !!data.starred,
                subtasks: data.subtasks || [],
                createdAt: new Date().toISOString()
            };

            if (type === 'custom') newTask.list = listOf({ list: data.list });
            if (newTask.repeat) newTask.repeatDay = parseDate(newTask.dueDate).getDate();
            tasks.unshift(newTask);
            this.persistTasks();
        },

        toggleTaskComplete: function(id) {
            var task = tasks.find(t => t.id === id);
            if (!task) return;

            task.completed = !task.completed;
            if (task.completed) {
                task.completedAt = new Date().toISOString();
                SoundFX.play('check');

                // Check if all today's tasks are finished
                var todayTasks = tasks.filter(t => isDated(t) && t.dueDate === this.getTodayStr());
                var allDone = todayTasks.length > 0 && todayTasks.every(t => t.completed);

                if (isRecurring(task) && !task.spawnedId) {
                    var next = this.spawnNextOccurrence(task);
                    showToast('Done. Next one: ' + shortDate(next.dueDate), 'success');
                } else if (allDone) {
                    showToast('All tasks for today are done', 'success');
                } else {
                    showToast('Task completed', 'success');
                }
            } else {
                delete task.completedAt;
                SoundFX.play('uncheck');
                // Undoing a recurring task removes the copy that was added for it, if untouched
                if (task.spawnedId) {
                    var copy = tasks.find(t => t.id === task.spawnedId);
                    if (copy && !copy.completed) {
                        tasks = tasks.filter(t => t.id !== copy.id);
                        TaskAPI.deleteTodo(copy.id);
                    }
                    delete task.spawnedId;
                }
            }

            this.persistTasks();
        },

        // Add the next occurrence of a recurring task (same details, fresh checklist, shifted reminder)
        spawnNextOccurrence: function(task) {
            var nextDue = nextRecurDue(task, this.getTodayStr());
            var copy = {
                id: 'task_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                type: 'daily',
                repeat: task.repeat,
                repeatDay: task.repeatDay,
                remindAt: '',
                reminded: false,
                title: task.title,
                notes: task.notes || '',
                priority: task.priority,
                category: task.category,
                dueDate: nextDue,
                completed: false,
                starred: !!task.starred,
                subtasks: (task.subtasks || []).map(function(st, i) {
                    return { id: 'st_' + Date.now() + '_' + i, title: st.title, completed: false };
                }),
                createdAt: new Date().toISOString()
            };
            if (task.remindAt) {
                var r = new Date(task.remindAt);
                if (!isNaN(r.getTime())) {
                    var offset = Math.round((new Date(r.getFullYear(), r.getMonth(), r.getDate()) - parseDate(task.dueDate)) / 86400000);
                    var at = parseDate(nextDue);
                    at.setDate(at.getDate() + offset);
                    at.setHours(r.getHours(), r.getMinutes(), 0, 0);
                    copy.remindAt = at.toISOString();
                    copy.remindDirty = true;
                }
            }
            task.spawnedId = copy.id;
            tasks.unshift(copy);
            return copy;
        },

        toggleStar: function(id) {
            var task = tasks.find(t => t.id === id);
            if (!task) return;
            task.starred = !task.starred;
            SoundFX.play('pop');
            this.persistTasks();
        },

        deleteTask: function(id) {
            tasks = tasks.filter(t => t.id !== id);
            TaskAPI.deleteTodo(id);
            SoundFX.play('delete');
            showToast('Task deleted', 'info');
            this.persistTasks();
        },

        openEditModal: function(id) {
            var task = tasks.find(t => t.id === id);
            if (!task) return;

            editingTaskId = id;
            document.getElementById('edit-task-title').value = task.title;
            document.getElementById('edit-task-notes').value = task.notes || '';
            document.getElementById('edit-task-priority').value = task.priority || 'medium';
            document.getElementById('edit-task-category').value = categoryOf(task.category).id;
            document.getElementById('edit-task-remind').value = toLocalInput(task.remindAt);
            document.getElementById('edit-task-type').value = typeValueOf(task);
            document.getElementById('edit-task-duedate').value = task.dueDate || this.getTodayStr();
            document.getElementById('edit-task-repeat').value = task.repeat || '';
            this.syncDueDateInputs();
            this.refreshDateInputs();

            this.renderEditSubtasks(task);

            var modal = document.getElementById('task-edit-modal');
            modal.classList.remove('hidden');
            SoundFX.play('pop');
        },

        closeEditModal: function() {
            var modal = document.getElementById('task-edit-modal');
            modal.classList.add('hidden');
            editingTaskId = null;
        },

        renderEditSubtasks: function(task) {
            var container = document.getElementById('edit-subtasks-list');
            if (!container) return;
            container.innerHTML = '';

            var subtasks = task.subtasks || [];
            if (subtasks.length === 0) {
                container.innerHTML = '<div class="subtask-empty-hint">No checklist items yet.</div>';
                return;
            }

            subtasks.forEach(function(st, index) {
                var row = document.createElement('div');
                row.className = 'subtask-item-row' + (st.completed ? ' completed' : '');
                row.innerHTML = `
                    <button type="button" class="subtask-check-btn" data-st-index="${index}">
                        ${st.completed ? icon('check') : ''}
                    </button>
                    <span class="subtask-title-text">${App.escapeHtml(st.title)}</span>
                    <button type="button" class="subtask-delete-btn" data-st-delete-index="${index}" title="Remove item" aria-label="Remove item">${icon('x')}</button>
                `;

                row.querySelector('.subtask-check-btn').addEventListener('click', function() {
                    st.completed = !st.completed;
                    SoundFX.play(st.completed ? 'check' : 'uncheck');
                    App.renderEditSubtasks(task);
                    App.persistTasks();
                });

                row.querySelector('.subtask-delete-btn').addEventListener('click', function() {
                    subtasks.splice(index, 1);
                    SoundFX.play('delete');
                    App.renderEditSubtasks(task);
                    App.persistTasks();
                });

                container.appendChild(row);
            });
        },

        filterTasks: function() {
            var todayStr = this.getTodayStr();

            return tasks.filter(function(t) {
                // Category filter
                if (currentCategory !== 'all' && categoryOf(t.category).id !== currentCategory) {
                    return false;
                }

                // Search query
                if (searchQuery) {
                    var matchTitle = t.title.toLowerCase().includes(searchQuery);
                    var matchNotes = (t.notes || '').toLowerCase().includes(searchQuery);
                    if (!matchTitle && !matchNotes) return false;
                }

                // Date filter: item's day / week / month must cover the selected date
                var goalView = currentCategory === 'all' && (currentFilter === 'weekly' || currentFilter === 'monthly' || currentFilter === 'custom');
                if (selectedDate && !goalView) {
                    var due = t.dueDate || '';
                    if (!due || selectedDate < periodStart(t.type, due) || selectedDate > due) return false;
                }

                // View Filter
                if (currentCategory === 'all') {
                    if (currentFilter === 'weekly' || currentFilter === 'monthly') {
                        return t.type === currentFilter && goalInPeriod(t, selectedDate || todayStr, todayStr);
                    }
                    if (currentFilter === 'custom') {
                        return isCustom(t) && listOf(t) === currentList;
                    }
                    if (currentFilter === 'today') {
                        if (selectedDate) return isDated(t);
                        return isDated(t) && (t.dueDate === todayStr || (!t.completed && t.dueDate < todayStr));
                    } else if (currentFilter === 'upcoming') {
                        if (selectedDate) return isDated(t);
                        return isDated(t) && t.dueDate > todayStr;
                    } else if (currentFilter === 'starred') {
                        return t.starred;
                    } else if (currentFilter === 'completed') {
                        return t.completed;
                    }
                }

                return true;
            });
        },

        sortTasks: function(taskList) {
            return taskList.sort(function(a, b) {
                // Keep incomplete items before completed items
                if (a.completed !== b.completed) {
                    return a.completed ? 1 : -1;
                }

                if (currentSort === 'priority') {
                    var pA = PRIORITY_WEIGHTS[a.priority] || 0;
                    var pB = PRIORITY_WEIGHTS[b.priority] || 0;
                    if (pA !== pB) return pB - pA;
                    return (a.dueDate || '').localeCompare(b.dueDate || '');
                } else if (currentSort === 'dueDate') {
                    return (a.dueDate || '').localeCompare(b.dueDate || '');
                } else if (currentSort === 'alphabetical') {
                    return a.title.localeCompare(b.title);
                } else if (currentSort === 'createdAt') {
                    return (b.createdAt || '').localeCompare(a.createdAt || '');
                }
                return 0;
            });
        },

        // Mark empty date inputs so CSS can show a hint (iOS renders them blank)
        refreshDateInputs: function() {
            document.querySelectorAll('input[type="date"], input[type="datetime-local"]').forEach(function(el) {
                el.classList.toggle('is-empty', !el.value);
            });
        },

        render: function() {
            this.refreshDateInputs();
            this.updateBadgeCounts();
            this.updateProgressCard();
            this.updateViewTitle();
            this.renderTaskList();
        },

        updateBadgeCounts: function() {
            var todayStr = this.getTodayStr();
            var counts = {
                all: tasks.filter(t => !t.completed).length,
                today: tasks.filter(t => isDated(t) && !t.completed && t.dueDate <= todayStr).length,
                upcoming: tasks.filter(t => isDated(t) && !t.completed && t.dueDate > todayStr).length,
                weekly: tasks.filter(t => t.type === 'weekly' && !t.completed && goalInPeriod(t, todayStr, todayStr)).length,
                monthly: tasks.filter(t => t.type === 'monthly' && !t.completed && goalInPeriod(t, todayStr, todayStr)).length,
                starred: tasks.filter(t => t.starred && !t.completed).length,
                completed: tasks.filter(t => t.completed).length
            };

            customLists.forEach(function(l) {
                counts[l.id] = tasks.filter(function(t) { return isCustom(t) && !t.completed && listOf(t) === l.id; }).length;
            });
            for (var key in counts) {
                var el = document.getElementById('count-' + key);
                if (el) el.textContent = counts[key];
            }
        },

        updateProgressCard: function() {
            var todayStr = this.getTodayStr();
            var todayTasks = tasks.filter(t => isDated(t) && t.dueDate === todayStr);
            var completedCount = todayTasks.filter(t => t.completed).length;
            var totalCount = todayTasks.length;

            var percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            var bar = document.getElementById('progress-bar-fill');
            var text = document.getElementById('progress-ratio-text');
            var percentText = document.getElementById('progress-percentage-text');

            if (bar) bar.style.width = percentage + '%';
            if (text) text.textContent = completedCount + ' of ' + totalCount + ' completed';
            if (percentText) percentText.textContent = percentage + '%';
        },

        renderTaskList: function() {
            var container = document.getElementById('task-list');
            if (!container) return;
            container.innerHTML = '';

            var filtered = this.filterTasks();
            var sorted = this.sortTasks(filtered);

            if (sorted.length === 0) {
                var emptyMsg = searchQuery ? 'No tasks found matching "' + this.escapeHtml(searchQuery) + '"' : 'Nothing to show in this view.';
                container.innerHTML = `
                    <div class="empty-state-card">
                        <div class="empty-icon">${icon('inbox')}</div>
                        <h3>No tasks</h3>
                        <p>${emptyMsg}</p>
                    </div>
                `;
                return;
            }

            sorted.forEach(function(task) {
                var item = document.createElement('div');
                item.className = 'task-item' + (task.completed ? ' completed' : '') + ' priority-' + task.priority;
                item.setAttribute('data-task-id', task.id);

                var cat = categoryOf(task.category);
                var subtasks = task.subtasks || [];
                var completedSubtasks = subtasks.filter(st => st.completed).length;
                var remindBadge = task.remindAt
                    ? '<span class="badge-remind' + (task.reminded ? ' sent' : '') + '" title="' + (task.reminded ? 'Reminder sent' : 'Reminder set') + '">' + icon('bell') + remindLabel(task.remindAt) + '</span>'
                    : '';
                var repeatBadge = isRecurring(task)
                    ? '<span class="badge-repeat" title="Repeats automatically">' + icon('repeat') + REPEAT_LABELS[task.repeat] + '</span>'
                    : '';
                var subtaskBadge = subtasks.length > 0
                    ? `<span class="badge-subtasks">${icon('check')}${completedSubtasks}/${subtasks.length}</span>` 
                    : '';

                var dateBadge = App.formatDateBadge(task.dueDate, task.completed, task.type);
                if (goalRolledOver(task, App.getTodayStr()) && currentFilter === task.type) {
                    dateBadge = '<span class="badge-date badge-rollover" title="Unfinished from an earlier ' + (task.type === 'monthly' ? 'month' : 'week') + '">' + icon('repeat') + 'Rolled over</span>' + dateBadge;
                }

                item.innerHTML = `
                    <button type="button" class="task-checkbox" role="checkbox" aria-checked="${task.completed ? 'true' : 'false'}" aria-label="Mark &quot;${App.escapeHtml(task.title)}&quot; ${task.completed ? 'incomplete' : 'complete'}">
                        <span class="check-icon">${task.completed ? icon('check') : ''}</span>
                    </button>
                    <div class="task-content">
                        <div class="task-title-row">
                            <span class="task-title">${App.escapeHtml(task.title)}</span>
                        </div>
                        ${task.notes ? `<p class="task-notes-snippet">${App.escapeHtml(task.notes)}</p>` : ''}
                        <div class="task-meta-row">
                            <span class="badge-category" style="--cat-color: ${cat.color}">${App.escapeHtml(cat.name)}</span>
                            <span class="badge-priority priority-${task.priority}">
                                ${App.getPriorityLabel(task.priority)}
                            </span>
                            ${dateBadge}
                            ${remindBadge}
                            ${repeatBadge}
                            ${subtaskBadge}
                        </div>
                    </div>
                    <div class="task-actions">
                        <button type="button" class="btn-action btn-star ${task.starred ? 'active' : ''}" title="Star task" aria-label="${task.starred ? 'Unstar' : 'Star'} task" aria-pressed="${task.starred ? 'true' : 'false'}">
                            ${icon('star')}
                        </button>
                        <button type="button" class="btn-action btn-edit" title="Edit task details" aria-label="Edit task">
                            ${icon('pencil')}
                        </button>
                        <button type="button" class="btn-action btn-delete" title="Delete task" aria-label="Delete task">
                            ${icon('trash')}
                        </button>
                    </div>
                `;

                // Event Listeners
                item.querySelector('.task-checkbox').addEventListener('click', function(e) {
                    e.stopPropagation();
                    App.toggleTaskComplete(task.id);
                });

                item.querySelector('.btn-star').addEventListener('click', function(e) {
                    e.stopPropagation();
                    App.toggleStar(task.id);
                });

                item.querySelector('.btn-edit').addEventListener('click', function(e) {
                    e.stopPropagation();
                    App.openEditModal(task.id);
                });

                item.querySelector('.btn-delete').addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (confirm('Delete "' + task.title + '"?')) {
                        App.deleteTask(task.id);
                    }
                });

                // Clicking task card opens edit details
                item.querySelector('.task-content').addEventListener('click', function() {
                    App.openEditModal(task.id);
                });

                container.appendChild(item);
            });
        },

        formatDateBadge: function(dueDate, isCompleted, type) {
            if (!dueDate || type === 'custom') return '';
            var today = this.getTodayStr();
            var tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            var tomorrowStr = fmtDate(tomorrow);

            if (type === 'weekly' || type === 'monthly') {
                var s = parseDate(periodStart(type, dueDate));
                var e = parseDate(dueDate);
                var label = type === 'monthly'
                    ? MONTH_NAMES[e.getMonth()] + ' ' + e.getFullYear()
                    : MONTH_NAMES[s.getMonth()] + ' ' + s.getDate() + ' – ' + MONTH_NAMES[e.getMonth()] + ' ' + e.getDate();
                var cls = (dueDate < today && !isCompleted && !goalRolledOver({ type: type, dueDate: dueDate, completed: false }, today)) ? ' overdue' : '';
                return '<span class="badge-date badge-goal' + cls + '">' + (type === 'monthly' ? 'Month: ' : 'Week: ') + label + '</span>';
            }

            if (dueDate === today) {
                return '<span class="badge-date today">Today</span>';
            } else if (dueDate === tomorrowStr) {
                return '<span class="badge-date tomorrow">Tomorrow</span>';
            } else if (dueDate < today && !isCompleted) {
                return '<span class="badge-date overdue">Overdue · ' + shortDate(dueDate) + '</span>';
            } else {
                return '<span class="badge-date">' + shortDate(dueDate) + '</span>';
            }
        },

        getPriorityLabel: function(priority) {
            var labels = {
                urgent: 'Urgent',
                high: 'High priority',
                medium: 'Medium',
                low: 'Low'
            };
            return labels[priority] || 'Medium';
        },

        escapeHtml: function(str) {
            if (!str) return '';
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
    };

    window.TaskApp = App;
    document.addEventListener('DOMContentLoaded', function() {
        App.init();
    });
})(window);
