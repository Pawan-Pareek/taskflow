// TaskFlow Main Application Logic
(function(window) {
    var tasks = [];
    var currentFilter = 'today'; // 'today', 'all', 'upcoming', 'starred', 'completed'
    var currentCategory = 'all';
    var searchQuery = '';
    var currentSort = 'priority'; // 'priority', 'dueDate', 'createdAt', 'alphabetical'
    var editingTaskId = null;

    var CATEGORIES = {
        personal: { name: 'Personal', icon: '👤', color: '#8b5cf6' },
        work: { name: 'Work', icon: '💼', color: '#3b82f6' },
        shopping: { name: 'Shopping', icon: '🛒', color: '#10b981' },
        health: { name: 'Health', icon: '🏃', color: '#f59e0b' },
        learning: { name: 'Learning', icon: '📚', color: '#ec4899' }
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

            // Render initial date and counts immediately
            this.updateViewTitle();
            this.render();

            // If user already authenticated, load tasks
            if (TaskAPI.getCurrentUser()) {
                await this.loadTasks();
            }
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
                    tasks = fetched;
                } else if (fetched && typeof fetched === 'object' && !fetched.error) {
                    tasks = [fetched];
                } else {
                    tasks = [];
                }
                this.render();

                // Setup Supabase Realtime multi-device sync
                if (!this._realtimeSubscribed && window.TaskSupabase && window.TaskSupabase.isEnabled()) {
                    var u = TaskAPI.getCurrentUser();
                    if (u) {
                        this._realtimeSubscribed = true;
                        window.TaskSupabase.subscribeToChanges(u.id, async function() {
                            var updated = await window.TaskSupabase.getTodos(u.id);
                            if (Array.isArray(updated)) {
                                tasks = updated;
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
                    showToast('Type a task first! ✍️', 'info');
                    return;
                }

                var priority = (document.getElementById('quick-priority-select') || {}).value || 'medium';
                var category = (document.getElementById('quick-category-select') || {}).value || 'personal';
                var dueDate = (document.getElementById('quick-due-date') || {}).value || self.getTodayStr();

                self.addTask({
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
                quickAddInput.focus();
                SoundFX.play('pop');
                showToast('Task added! 🎯', 'success');

                // Auto-switch view so the new task is visible
                if (currentFilter === 'completed') {
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
                    task.dueDate = document.getElementById('edit-task-duedate').value;

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
                    supabaseStatusPill.textContent = '🟢 Connected';
                    supabaseStatusPill.style.background = 'rgba(16, 185, 129, 0.15)';
                    supabaseStatusPill.style.color = 'var(--color-success)';
                } else {
                    supabaseStatusPill.textContent = '⚪ Local Mode';
                    supabaseStatusPill.style.background = 'rgba(148, 163, 184, 0.15)';
                    supabaseStatusPill.style.color = 'var(--text-muted)';
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
                        showToast('⚡ Supabase Connected & Synced!', 'success');
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
                    showToast('Backup downloaded! 📦', 'success');
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
                                showToast('Tasks imported successfully! ✨', 'success');
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
            var currentTheme = localStorage.getItem('taskflow_theme') || 'dark';

            function applyTheme(theme) {
                if (theme === 'light') {
                    document.documentElement.setAttribute('data-theme', 'light');
                    toggleBtns.forEach(b => b.innerHTML = '🌙');
                } else {
                    document.documentElement.removeAttribute('data-theme');
                    toggleBtns.forEach(b => b.innerHTML = '☀️');
                }
                localStorage.setItem('taskflow_theme', theme);
            }

            applyTheme(currentTheme);

            toggleBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var nowTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
                    applyTheme(nowTheme);
                    SoundFX.play('pop');
                });
            });
        },

        setupSoundToggle: function() {
            var soundBtns = document.querySelectorAll('.btn-sound-toggle');
            function updateIcons(enabled) {
                soundBtns.forEach(b => b.innerHTML = enabled ? '🔔' : '🔕');
            }
            updateIcons(SoundFX.isEnabled());

            soundBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var enabled = SoundFX.toggle();
                    updateIcons(enabled);
                    showToast(enabled ? 'Sound FX Enabled' : 'Sound FX Muted', 'info');
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
                            showToast('Mobile link copied! 📋', 'success');
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
                if (titleEl) titleEl.textContent = (catMeta ? catMeta.icon + ' ' + catMeta.name : 'Category');
            } else {
                var titles = {
                    today: 'Today’s Focus',
                    all: 'All Tasks',
                    upcoming: 'Upcoming Tasks',
                    starred: 'Starred / Important',
                    completed: 'Completed Tasks'
                };
                if (titleEl) titleEl.textContent = titles[currentFilter] || 'Tasks';
            }

            if (subtitleEl) {
                var today = new Date();
                var options = { weekday: 'long', month: 'short', day: 'numeric' };
                subtitleEl.textContent = today.toLocaleDateString(undefined, options);
            }
        },

        getTodayStr: function() {
            return new Date().toISOString().split('T')[0];
        },

        addTask: function(data) {
            var newTask = {
                id: 'task_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                title: data.title,
                notes: data.notes || '',
                priority: data.priority || 'medium',
                category: data.category || 'personal',
                dueDate: data.dueDate || this.getTodayStr(),
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
                var todayTasks = tasks.filter(t => t.dueDate === this.getTodayStr());
                var allDone = todayTasks.length > 0 && todayTasks.every(t => t.completed);

                if (allDone) {
                    SoundFX.play('fanfare');
                    Confetti.burst(window.innerWidth / 2, window.innerHeight * 0.4, 65);
                    showToast('All tasks for today completed! Amazing! 🌟', 'success');
                } else {
                    Confetti.burst(window.innerWidth * 0.7, window.innerHeight * 0.6, 25);
                    showToast('Task completed! 🎉', 'success');
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
                container.innerHTML = '<div class="subtask-empty-hint">No checklist items yet. Add subtasks below!</div>';
                return;
            }

            subtasks.forEach(function(st, index) {
                var row = document.createElement('div');
                row.className = 'subtask-item-row' + (st.completed ? ' completed' : '');
                row.innerHTML = `
                    <button type="button" class="subtask-check-btn" data-st-index="${index}">
                        ${st.completed ? '✓' : ''}
                    </button>
                    <span class="subtask-title-text">${App.escapeHtml(st.title)}</span>
                    <button type="button" class="subtask-delete-btn" data-st-delete-index="${index}" title="Remove subtask">✕</button>
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

                // View Filter
                if (currentCategory === 'all') {
                    if (currentFilter === 'today') {
                        return t.dueDate === todayStr || (!t.completed && t.dueDate < todayStr);
                    } else if (currentFilter === 'upcoming') {
                        return t.dueDate > todayStr;
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
                today: tasks.filter(t => !t.completed && (t.dueDate === todayStr || t.dueDate < todayStr)).length,
                upcoming: tasks.filter(t => !t.completed && t.dueDate > todayStr).length,
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
            var todayTasks = tasks.filter(t => t.dueDate === todayStr);
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
                var emptyMsg = searchQuery ? 'No tasks found matching "' + this.escapeHtml(searchQuery) + '"' : 'No tasks in this view. Enjoy your day! 🌿';
                container.innerHTML = `
                    <div class="empty-state-card">
                        <div class="empty-icon">✨</div>
                        <h3>All Clear!</h3>
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
                var subtaskBadge = subtasks.length > 0 
                    ? `<span class="badge-subtasks">✓ ${completedSubtasks}/${subtasks.length}</span>` 
                    : '';

                var dateBadge = App.formatDateBadge(task.dueDate, task.completed);

                item.innerHTML = `
                    <button type="button" class="task-checkbox" aria-label="Toggle completed">
                        <span class="check-icon">${task.completed ? '✓' : ''}</span>
                    </button>
                    <div class="task-content">
                        <div class="task-title-row">
                            <span class="task-title">${App.escapeHtml(task.title)}</span>
                        </div>
                        ${task.notes ? `<p class="task-notes-snippet">${App.escapeHtml(task.notes)}</p>` : ''}
                        <div class="task-meta-row">
                            <span class="badge-category" style="--cat-color: ${cat.color}">
                                ${cat.icon} ${cat.name}
                            </span>
                            <span class="badge-priority priority-${task.priority}">
                                ${App.getPriorityLabel(task.priority)}
                            </span>
                            ${dateBadge}
                            ${subtaskBadge}
                        </div>
                    </div>
                    <div class="task-actions">
                        <button type="button" class="btn-action btn-star ${task.starred ? 'active' : ''}" title="Star task">
                            ${task.starred ? '★' : '☆'}
                        </button>
                        <button type="button" class="btn-action btn-edit" title="Edit task details">
                            ✏️
                        </button>
                        <button type="button" class="btn-action btn-delete" title="Delete task">
                            🗑️
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

        formatDateBadge: function(dueDate, isCompleted) {
            if (!dueDate) return '';
            var today = this.getTodayStr();
            var tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            var tomorrowStr = tomorrow.toISOString().split('T')[0];

            if (dueDate === today) {
                return '<span class="badge-date today">📅 Today</span>';
            } else if (dueDate === tomorrowStr) {
                return '<span class="badge-date tomorrow">📅 Tomorrow</span>';
            } else if (dueDate < today && !isCompleted) {
                return '<span class="badge-date overdue">⚠️ Overdue</span>';
            } else {
                return '<span class="badge-date">📅 ' + dueDate + '</span>';
            }
        },

        getPriorityLabel: function(priority) {
            var labels = {
                urgent: '🔥 Urgent',
                high: '⚡ High',
                medium: '🔷 Medium',
                low: '☕ Low'
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
