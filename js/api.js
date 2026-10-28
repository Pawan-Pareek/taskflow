// TaskFlow API & Synchronization Client
// Seamlessly operates in Backend Server Mode (LAN/Cloud) OR Standalone Offline Mode
(function(window) {
    var BASE_URL = window.location.origin;
    var TOKEN_KEY = 'taskflow_auth_token';
    var USER_KEY = 'taskflow_current_user';
    var OFFLINE_DB_KEY = 'taskflow_offline_database';

    // Initialize offline fallback database
    function getOfflineDB() {
        var raw = localStorage.getItem(OFFLINE_DB_KEY);
        if (!raw) {
            var initialDB = {
                users: [
                    {
                        id: 'demo-user-1',
                        username: 'alex',
                        name: 'Alex Rivera',
                        email: 'alex@example.com',
                        passwordHash: hashSimple('demo1234'),
                        avatar: 'avatar-1',
                        createdAt: new Date().toISOString()
                    }
                ],
                todos: {
                    'demo-user-1': [
                        {
                            id: 'task-1',
                            title: 'Welcome to TaskFlow Pro! 🚀',
                            notes: 'Access this app on both your laptop and your mobile phone seamlessly. Try adding subtasks or changing priorities!',
                            priority: 'urgent',
                            category: 'personal',
                            dueDate: getTodayStr(),
                            completed: false,
                            starred: true,
                            subtasks: [
                                { id: 'st-1', title: 'Open on mobile using Connect Mobile QR Code', completed: false },
                                { id: 'st-2', title: 'Test dark and light mode', completed: true },
                                { id: 'st-3', title: 'Complete this first task!', completed: false }
                            ],
                            createdAt: new Date(Date.now() - 3600000).toISOString()
                        },
                        {
                            id: 'task-2',
                            title: 'Connect phone via QR Code 📱',
                            notes: 'Click the "Connect Mobile" button in the sidebar or top bar to see your local Wi-Fi QR code and scan it with your phone camera!',
                            priority: 'high',
                            category: 'work',
                            dueDate: getTodayStr(),
                            completed: false,
                            starred: true,
                            subtasks: [],
                            createdAt: new Date(Date.now() - 1800000).toISOString()
                        },
                        {
                            id: 'task-3',
                            title: 'Review weekly roadmap',
                            notes: 'Prepare notes for Monday morning sync with design team.',
                            priority: 'medium',
                            category: 'work',
                            dueDate: getTomorrowStr(),
                            completed: false,
                            starred: false,
                            subtasks: [],
                            createdAt: new Date().toISOString()
                        },
                        {
                            id: 'task-4',
                            title: 'Pick up groceries 🥑',
                            notes: 'Avocados, almond milk, coffee beans, dark chocolate',
                            priority: 'low',
                            category: 'shopping',
                            dueDate: getTodayStr(),
                            completed: true,
                            starred: false,
                            subtasks: [],
                            createdAt: new Date(Date.now() - 7200000).toISOString()
                        }
                    ]
                }
            };
            localStorage.setItem(OFFLINE_DB_KEY, JSON.stringify(initialDB));
            return initialDB;
        }
        try {
            return JSON.parse(raw);
        } catch(e) {
            return { users: [], todos: {} };
        }
    }

    function saveOfflineDB(db) {
        localStorage.setItem(OFFLINE_DB_KEY, JSON.stringify(db));
    }

    function hashSimple(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return 'h_' + Math.abs(hash).toString(16);
    }

    function getTodayStr() {
        var d = new Date();
        return d.toISOString().split('T')[0];
    }

    function getTomorrowStr() {
        var d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    }

    var serverAvailable = null;
    var cachedServerInfo = null;

    var API = {
        // Check if backend API server is online
        checkServer: async function() {
            // If running on file:// protocol, skip server check immediately
            if (window.location.protocol === 'file:') {
                serverAvailable = false;
                return false;
            }
            try {
                var controller = new AbortController();
                var timeoutId = setTimeout(function() { controller.abort(); }, 1500);
                var res = await fetch(BASE_URL + '/api/info', { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    serverAvailable = true;
                    cachedServerInfo = await res.json();
                    return true;
                }
            } catch(e) {
                // Server not reachable
            }
            serverAvailable = false;
            return false;
        },

        isServerConnected: function() {
            return serverAvailable === true;
        },

        getServerInfo: async function() {
            if (cachedServerInfo) return cachedServerInfo;
            if (serverAvailable) {
                try {
                    var res = await fetch(BASE_URL + '/api/info');
                    if (res.ok) {
                        cachedServerInfo = await res.json();
                        return cachedServerInfo;
                    }
                } catch(e) {}
            }
            // Fallback info when running locally or on local server
            return {
                mode: 'offline-local',
                hostUrl: window.location.origin || 'http://localhost:8080',
                lanUrl: window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' 
                    ? window.location.origin 
                    : 'http://' + (window.location.hostname || 'localhost') + ':8080'
            };
        },

        getToken: function() {
            return localStorage.getItem(TOKEN_KEY);
        },

        setToken: function(token) {
            if (token) {
                localStorage.setItem(TOKEN_KEY, token);
            } else {
                localStorage.removeItem(TOKEN_KEY);
            }
        },

        getCurrentUser: function() {
            var raw = localStorage.getItem(USER_KEY);
            if (raw) {
                try { return JSON.parse(raw); } catch(e) { return null; }
            }
            return null;
        },

        setCurrentUser: function(user) {
            if (user) {
                localStorage.setItem(USER_KEY, JSON.stringify(user));
            } else {
                localStorage.removeItem(USER_KEY);
            }
        },

        // REGISTER
        register: async function(userData) {
            if (await this.checkServer()) {
                try {
                    var res = await fetch(BASE_URL + '/api/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(userData)
                    });
                    var data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Registration failed');
                    this.setToken(data.token);
                    this.setCurrentUser(data.user);
                    return data;
                } catch(err) {
                    if (serverAvailable) throw err;
                }
            }

            // Offline / Local Mode Register
            var db = getOfflineDB();
            var usernameLower = userData.username.trim().toLowerCase();
            var emailLower = userData.email.trim().toLowerCase();

            var exists = db.users.find(function(u) {
                return u.username.toLowerCase() === usernameLower || u.email.toLowerCase() === emailLower;
            });
            if (exists) {
                throw new Error('Username or email is already registered.');
            }

            var newUser = {
                id: 'usr_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                username: userData.username.trim(),
                name: userData.name ? userData.name.trim() : userData.username.trim(),
                email: userData.email.trim(),
                passwordHash: hashSimple(userData.password),
                avatar: userData.avatar || 'avatar-1',
                createdAt: new Date().toISOString()
            };

            db.users.push(newUser);
            // Pre-seed some helpful initial todos for the new user
            db.todos[newUser.id] = [
                {
                    id: 'task_' + Date.now(),
                    title: 'Welcome to TaskFlow, ' + newUser.name + '! 👋',
                    notes: 'This todo list syncs across your laptop and mobile phone. Bookmark it on both devices!',
                    priority: 'high',
                    category: 'personal',
                    dueDate: getTodayStr(),
                    completed: false,
                    starred: true,
                    subtasks: [
                        { id: 'st_1', title: 'Tap this checkmark to complete', completed: false },
                        { id: 'st_2', title: 'Connect your phone via QR Code', completed: false }
                    ],
                    createdAt: new Date().toISOString()
                }
            ];

            saveOfflineDB(db);
            var token = 'tok_mock_' + newUser.id + '_' + Date.now();
            var publicUser = {
                id: newUser.id,
                username: newUser.username,
                name: newUser.name,
                email: newUser.email,
                avatar: newUser.avatar
            };
            this.setToken(token);
            this.setCurrentUser(publicUser);
            return { user: publicUser, token: token };
        },

        // LOGIN
        login: async function(credentials) {
            if (await this.checkServer()) {
                try {
                    var res = await fetch(BASE_URL + '/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(credentials)
                    });
                    var data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Invalid credentials');
                    this.setToken(data.token);
                    this.setCurrentUser(data.user);
                    return data;
                } catch(err) {
                    if (serverAvailable) throw err;
                }
            }

            // Offline / Local Mode Login
            var db = getOfflineDB();
            var identifier = credentials.identifier.trim().toLowerCase();
            var passwordHash = hashSimple(credentials.password);

            var user = db.users.find(function(u) {
                return (u.username.toLowerCase() === identifier || u.email.toLowerCase() === identifier) &&
                       u.passwordHash === passwordHash;
            });

            if (!user) {
                throw new Error('Invalid username/email or password.');
            }

            var token = 'tok_mock_' + user.id + '_' + Date.now();
            var publicUser = {
                id: user.id,
                username: user.username,
                name: user.name,
                email: user.email,
                avatar: user.avatar
            };
            this.setToken(token);
            this.setCurrentUser(publicUser);
            return { user: publicUser, token: token };
        },

        // LOGOUT
        logout: function() {
            this.setToken(null);
            this.setCurrentUser(null);
        },

        // GET TODOS
        getTodos: async function() {
            var currentUser = this.getCurrentUser();
            var userId = currentUser ? currentUser.id : 'guest';

            // 1. Supabase Cloud DB (if configured)
            if (window.TaskSupabase && window.TaskSupabase.isEnabled()) {
                try {
                    var cloudList = await window.TaskSupabase.getTodos(userId);
                    if (cloudList !== null && Array.isArray(cloudList)) {
                        var db = getOfflineDB();
                        db.todos[userId] = cloudList;
                        saveOfflineDB(db);
                        return cloudList;
                    }
                } catch(e) {
                    console.warn('Supabase fetch failed, falling back to local:', e);
                }
            }

            // 2. Local Wi-Fi Server
            if (await this.checkServer()) {
                try {
                    var token = this.getToken();
                    var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
                    var res = await fetch(BASE_URL + '/api/todos', { headers: headers });
                    if (res.ok) {
                        var list = await res.json();
                        if (!Array.isArray(list)) {
                            list = (list && typeof list === 'object' && !list.error) ? [list] : [];
                        }
                        // Cache locally for offline resilience
                        var db = getOfflineDB();
                        db.todos[userId] = list;
                        saveOfflineDB(db);
                        return list;
                    }
                } catch(e) {}
            }

            // 3. Offline localStorage fallback
            var db = getOfflineDB();
            var cached = db.todos[userId] || db.todos['demo-user-1'] || [];
            return Array.isArray(cached) ? cached : [cached];
        },

        // SAVE / UPDATE TODOS
        saveTodos: async function(todos) {
            var currentUser = this.getCurrentUser();
            var userId = currentUser ? currentUser.id : 'guest';

            // Always save to local cache first
            var db = getOfflineDB();
            if (!db.todos) db.todos = {};
            db.todos[userId] = todos;
            saveOfflineDB(db);

            // 1. Supabase Cloud Sync
            if (window.TaskSupabase && window.TaskSupabase.isEnabled()) {
                try {
                    await window.TaskSupabase.saveTodos(todos, userId);
                } catch(e) {
                    console.warn('Supabase sync warning:', e);
                }
            }

            // 2. Local Server Sync
            if (this.isServerConnected()) {
                try {
                    var token = this.getToken();
                    var headers = { 'Content-Type': 'application/json' };
                    if (token) headers['Authorization'] = 'Bearer ' + token;

                    await fetch(BASE_URL + '/api/todos/batch', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ todos: todos })
                    });
                } catch(e) {
                    console.warn('Background sync queued');
                }
            }
        },

        // DELETE SINGLE TODO (for cloud DB sync)
        deleteTodo: async function(todoId) {
            if (window.TaskSupabase && window.TaskSupabase.isEnabled()) {
                try {
                    await window.TaskSupabase.deleteTodo(todoId);
                } catch(e) {}
            }
        }
    };

    window.TaskAPI = API;
})(window);
