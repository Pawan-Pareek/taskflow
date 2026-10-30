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
    var typesRestored = false;
    function saveTypeMap(list) {
        try {
            var map = {};
            list.forEach(function(t) { if (isGoal(t)) map[t.id] = t.type; });
            localStorage.setItem(TYPE_KEY, JSON.stringify(map));
        } catch (e) {}
    }
    function applyKnownTypes(list) {
        var map = {};
        try { map = JSON.parse(localStorage.getItem(TYPE_KEY) || '{}'); } catch (e) {}
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

    var CATEGORIES = {
        personal: { name: 'Personal', color: '#7c5cd6' },
        work: { name: 'Work', color: '#2f6fd6' },
        shopping: { name: 'Shopping', color: '#1f9d68' },
        health: { name: 'Health', color: '#d9890b' },
        learning: { name: 'Learning', color: '#c8458a' }
    };

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
                        window.TaskSupabase.subscribeToChanges(u.id, async function() {
                            var updated = await window.TaskSupabase.getTodos(u.id);
                            if (Array.isArray(updated)) {
                                tasks = applyKnownTypes(updated);
                                App.render();
                            }
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

            // Category filter clicks
            document.querySelectorAll('[data-category]').forEach(function(el) {
                el.addEventListener('click', function(e) {
                    e.preventDefault();
                    var cat = this.getAttribute('data-category');
                    self.setCategory(cat);
                    SoundFX.play('pop');
                    self.closeDrawer();
                });
            });

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
                var category = (document.getElementById('quick-category-select') || {}).value || 'personal';
                var remindAt = fromLocalInput((document.getElementById('quick-remind-at') || {}).value);
                var type = (document.getElementById('quick-type-select') || {}).value || 'daily';
                var dueDate = (document.getElementById('quick-due-date') || {}).value || self.getTodayStr();

                self.addTask({
                    type: type,
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
                quickAddInput.focus();
                SoundFX.play('pop');
                showToast('Task added', 'success');

                // Auto-switch view so the new task is visible
                if (type !== 'daily' && currentFilter !== 'all' && currentFilter !== type) {
                    self.setFilter(type);
                } else if (type === 'daily' && (currentFilter === 'weekly' || currentFilter === 'monthly')) {
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
                    task.type = document.getElementById('edit-task-type').value;
                    task.dueDate = periodEnd(task.type, document.getElementById('edit-task-duedate').value || self.getTodayStr());

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
            var typeByView = { weekly: 'weekly', monthly: 'monthly', today: 'daily', upcoming: 'daily' };
            var typeSelect = document.getElementById('quick-type-select');
            if (typeSelect && typeByView[filter]) typeSelect.value = typeByView[filter];

            document.querySelectorAll('[data-filter]').forEach(function(el) {
                if (el.getAttribute('data-filter') === filter) {
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
                var catMeta = CATEGORIES[currentCategory];
                if (titleEl) titleEl.textContent = (catMeta ? catMeta.name : 'Category');
            } else {
                var titles = {
                    today: 'Today',
                    all: 'All tasks',
                    upcoming: 'Upcoming',
                    weekly: 'Weekly goals',
                    monthly: 'Monthly goals',
                    starred: 'Starred',
                    completed: 'Completed'
                };
                if (titleEl) titleEl.textContent = titles[currentFilter] || 'Tasks';
            }

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
                dueDate: periodEnd(type, data.dueDate || this.getTodayStr()),
                completed: false,
                starred: !!data.starred,
                subtasks: data.subtasks || [],
                createdAt: new Date().toISOString()
            };

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
                var todayTasks = tasks.filter(t => !isGoal(t) && t.dueDate === this.getTodayStr());
                var allDone = todayTasks.length > 0 && todayTasks.every(t => t.completed);

                if (allDone) {
                    showToast('All tasks for today are done', 'success');
                } else {
                    showToast('Task completed', 'success');
                }
            } else {
                delete task.completedAt;
                SoundFX.play('uncheck');
            }

            this.persistTasks();
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
            document.getElementById('edit-task-category').value = task.category || 'personal';
            document.getElementById('edit-task-remind').value = toLocalInput(task.remindAt);
            document.getElementById('edit-task-type').value = task.type || 'daily';
            document.getElementById('edit-task-duedate').value = task.dueDate || this.getTodayStr();

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
                if (currentCategory !== 'all' && t.category !== currentCategory) {
                    return false;
                }

                // Search query
                if (searchQuery) {
                    var matchTitle = t.title.toLowerCase().includes(searchQuery);
                    var matchNotes = (t.notes || '').toLowerCase().includes(searchQuery);
                    if (!matchTitle && !matchNotes) return false;
                }

                // Date filter: item's day / week / month must cover the selected date
                var goalView = currentCategory === 'all' && (currentFilter === 'weekly' || currentFilter === 'monthly');
                if (selectedDate && !goalView) {
                    var due = t.dueDate || '';
                    if (!due || selectedDate < periodStart(t.type, due) || selectedDate > due) return false;
                }

                // View Filter
                if (currentCategory === 'all') {
                    if (currentFilter === 'weekly' || currentFilter === 'monthly') {
                        return t.type === currentFilter && goalInPeriod(t, selectedDate || todayStr, todayStr);
                    }
                    if (currentFilter === 'today') {
                        if (selectedDate) return true;
                        return !isGoal(t) && (t.dueDate === todayStr || (!t.completed && t.dueDate < todayStr));
                    } else if (currentFilter === 'upcoming') {
                        if (selectedDate) return true;
                        return !isGoal(t) && t.dueDate > todayStr;
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

        render: function() {
            this.updateBadgeCounts();
            this.updateProgressCard();
            this.updateViewTitle();
            this.renderTaskList();
        },

        updateBadgeCounts: function() {
            var todayStr = this.getTodayStr();
            var counts = {
                all: tasks.filter(t => !t.completed).length,
                today: tasks.filter(t => !isGoal(t) && !t.completed && t.dueDate <= todayStr).length,
                upcoming: tasks.filter(t => !isGoal(t) && !t.completed && t.dueDate > todayStr).length,
                weekly: tasks.filter(t => t.type === 'weekly' && !t.completed && goalInPeriod(t, todayStr, todayStr)).length,
                monthly: tasks.filter(t => t.type === 'monthly' && !t.completed && goalInPeriod(t, todayStr, todayStr)).length,
                starred: tasks.filter(t => t.starred && !t.completed).length,
                completed: tasks.filter(t => t.completed).length
            };

            for (var key in counts) {
                var el = document.getElementById('count-' + key);
                if (el) el.textContent = counts[key];
            }
        },

        updateProgressCard: function() {
            var todayStr = this.getTodayStr();
            var todayTasks = tasks.filter(t => !isGoal(t) && t.dueDate === todayStr);
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

                var cat = CATEGORIES[task.category] || CATEGORIES.personal;
                var subtasks = task.subtasks || [];
                var completedSubtasks = subtasks.filter(st => st.completed).length;
                var remindBadge = task.remindAt
                    ? '<span class="badge-remind' + (task.reminded ? ' sent' : '') + '" title="' + (task.reminded ? 'Reminder sent' : 'Reminder set') + '">' + icon('bell') + remindLabel(task.remindAt) + '</span>'
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
                            <span class="badge-category" style="--cat-color: ${cat.color}">${cat.name}</span>
                            <span class="badge-priority priority-${task.priority}">
                                ${App.getPriorityLabel(task.priority)}
                            </span>
                            ${dateBadge}
                            ${remindBadge}
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
            if (!dueDate) return '';
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
