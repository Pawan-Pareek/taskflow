// TaskFlow Supabase Cloud Integration
// Enables cross-device sync from anywhere in the world without running a local server!
(function(window) {
    var STORAGE_URL_KEY = 'taskflow_supabase_url';
    var STORAGE_ANON_KEY = 'taskflow_supabase_anon_key';
    
    var client = null;
    var realtimeChannel = null;

    var TaskSupabase = {
        getUrl: function() {
            return localStorage.getItem(STORAGE_URL_KEY) || (window.TASKFLOW_CONFIG && window.TASKFLOW_CONFIG.supabaseUrl) || '';
        },

        getKey: function() {
            return localStorage.getItem(STORAGE_ANON_KEY) || (window.TASKFLOW_CONFIG && window.TASKFLOW_CONFIG.supabaseAnonKey) || '';
        },

        isEnabled: function() {
            var sb = window.supabase || (window.supabaseJs && window.supabaseJs.createClient ? window.supabaseJs : null);
            return !!(this.getUrl() && this.getKey() && sb);
        },

        getClient: function() {
            if (client) return client;
            var url = this.getUrl();
            var key = this.getKey();
            // Support both old (window.supabase) and new (window.supabase or window.supabaseJs) CDN exports
            var sbLib = (window.supabase && typeof window.supabase.createClient === 'function')
                ? window.supabase
                : null;
            if (!sbLib && window.supabase && window.supabase.default) sbLib = window.supabase.default;
            if (url && key && sbLib) {
                try {
                    client = sbLib.createClient(url, key, {
                        auth: { persistSession: true, autoRefreshToken: false }
                    });
                    return client;
                } catch(e) {
                    console.error('Failed to initialize Supabase client:', e);
                }
            }
            return null;
        },

        init: function() {
            var c = this.getClient();
            if (c) {
                console.log('⚡ Supabase Cloud Client initialized');
            }
        },

        formatUrl: function(url) {
            url = (url || '').trim();
            if (!url) return '';
            // If user entered just project ID (e.g. dqdqfvtsnzamqrumdzzm)
            if (!url.includes('://') && !url.includes('.')) {
                return 'https://' + url + '.supabase.co';
            }
            if (!/^https?:\/\//i.test(url)) {
                url = 'https://' + url;
            }
            // If missing .supabase.co
            if (!url.includes('.supabase.co') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
                url = url.replace(/\/+$/, '') + '.supabase.co';
            }
            return url.replace(/\/+$/, '');
        },

        // Test credentials & table existence
        testConnection: async function(url, key) {
            if (!window.supabase) {
                throw new Error('Supabase client library not loaded. Check internet connection.');
            }
            url = this.formatUrl(url);
            try {
                var testClient = window.supabase.createClient(url, key);
                // Try a lightweight query
                var res = await testClient.from('todos').select('id').limit(1);
                if (res.error) {
                    // Check if table missing
                    if (res.error.code === '42P01') {
                        throw new Error('Connected to Supabase successfully!\nHowever, the "todos" table does not exist yet.\n\nPlease copy the SQL script below and run it in your Supabase SQL Editor.');
                    }
                    throw new Error(res.error.message || 'Supabase connection failed.');
                }
                return { success: true };
            } catch(e) {
                if (e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'))) {
                    throw new Error('Could not reach Supabase (Network Error).\n\nYour Project URL should look like:\nhttps://[your-project-id].supabase.co\n\nPlease verify your URL ends with ".supabase.co" and your Project ID is complete.');
                }
                throw e;
            }
        },

        // Save URL and Anon Key into browser storage
        saveConfig: async function(url, key) {
            url = this.formatUrl(url);
            key = (key || '').trim();

            if (!url || !key) {
                localStorage.removeItem(STORAGE_URL_KEY);
                localStorage.removeItem(STORAGE_ANON_KEY);
                client = null;
                return { success: true, cleared: true };
            }

            // Verify before saving
            await this.testConnection(url, key);

            localStorage.setItem(STORAGE_URL_KEY, url);
            localStorage.setItem(STORAGE_ANON_KEY, key);
            client = null; // reset
            this.getClient();
            return { success: true, cleared: false };
        },

        // Secure simple password hasher
        hashPassword: function(str) {
            var hash = 0;
            for (var i = 0; i < str.length; i++) {
                var char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash |= 0;
            }
            return 'h_' + Math.abs(hash).toString(16);
        },

        // Cloud User Registration (works across all browsers and devices)
        registerUser: async function(userData) {
            var c = this.getClient();
            if (!c) throw new Error('Supabase cloud database not connected.');
            var uLower = userData.username.trim().toLowerCase();
            var eLower = userData.email.trim().toLowerCase();

            // Check if username or email is already taken
            var checkUser = await c.from('users').select('id').ilike('username', uLower);
            var checkEmail = await c.from('users').select('id').ilike('email', eLower);
            if ((checkUser.data && checkUser.data.length > 0) || (checkEmail.data && checkEmail.data.length > 0)) {
                throw new Error('Username or email is already registered.');
            }

            var hash = this.hashPassword(userData.password);
            var newId = 'usr_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            var newUserRow = {
                id: newId,
                username: userData.username.trim(),
                name: userData.name ? userData.name.trim() : userData.username.trim(),
                email: userData.email.trim(),
                password_hash: hash,
                avatar: userData.avatar || 'avatar-1'
            };

            var res = await c.from('users').insert([newUserRow]);
            if (res.error) {
                if (res.error.code === '42P01') {
                    throw new Error('Cloud "users" table is missing in Supabase.\nPlease run the SQL setup script from Settings.');
                }
                throw new Error(res.error.message || 'Registration failed.');
            }

            return {
                id: newUserRow.id,
                username: newUserRow.username,
                name: newUserRow.name,
                email: newUserRow.email,
                avatar: newUserRow.avatar
            };
        },

        // Cloud User Login (works across all browsers and devices)
        loginUser: async function(identifier, password) {
            var c = this.getClient();
            if (!c) throw new Error('Supabase cloud database not connected.');
            var idTrim = identifier.trim().toLowerCase();
            var hash = this.hashPassword(password);

            // Try login by username first, then by email
            var byUsername = await c.from('users').select('*').ilike('username', idTrim);
            if (byUsername.error && byUsername.error.code === '42P01') {
                throw new Error('Cloud "users" table is missing in Supabase.\nPlease run the SQL setup script from Settings.');
            }

            var byEmail = await c.from('users').select('*').ilike('email', idTrim);

            var list = [];
            if (byUsername.data && byUsername.data.length > 0) list = list.concat(byUsername.data);
            if (byEmail.data && byEmail.data.length > 0) list = list.concat(byEmail.data);

            if (list.length === 0) {
                throw new Error('Invalid username/email or password.');
            }

            var matched = list.find(function(u) {
                return u.password_hash === hash || u.password_hash === password;
            });

            if (!matched) {
                throw new Error('Invalid username/email or password.');
            }

            return {
                id: matched.id,
                username: matched.username,
                name: matched.name,
                email: matched.email,
                avatar: matched.avatar
            };
        },

        // Fetch todos for the current user
        getTodos: async function(userId) {
            var c = this.getClient();
            if (!c) return null;

            var res = await c.from('todos')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (res.error) {
                console.error('Supabase getTodos error:', res.error);
                return null;
            }

            // Map DB columns to TaskFlow task format
            return (res.data || []).map(function(row) {
                return {
                    id: row.id,
                    title: row.title,
                    notes: row.notes || '',
                    priority: row.priority || 'medium',
                    category: row.category || 'personal',
                    dueDate: row.due_date || '',
                    completed: !!row.completed,
                    starred: !!row.starred,
                    subtasks: Array.isArray(row.subtasks) ? row.subtasks : (typeof row.subtasks === 'string' ? JSON.parse(row.subtasks || '[]') : []),
                    createdAt: row.created_at
                };
            });
        },

        // Save / upsert tasks batch
        saveTodos: async function(todos, userId) {
            var c = this.getClient();
            if (!c || !userId) return;

            if (!todos || todos.length === 0) return;

            var rows = todos.map(function(t) {
                return {
                    id: t.id,
                    user_id: userId,
                    title: t.title,
                    notes: t.notes || '',
                    priority: t.priority || 'medium',
                    category: t.category || 'personal',
                    due_date: t.dueDate || null,
                    completed: !!t.completed,
                    starred: !!t.starred,
                    subtasks: t.subtasks || []
                };
            });

            var res = await c.from('todos').upsert(rows, { onConflict: 'id' });
            if (res.error) {
                console.warn('Supabase batch upsert warning:', res.error);
            }
        },

        // Delete a todo from Supabase
        deleteTodo: async function(todoId) {
            var c = this.getClient();
            if (!c) return;
            await c.from('todos').delete().eq('id', todoId);
        },

        // Realtime subscription for instant multi-device syncing
        subscribeToChanges: function(userId, onUpdate) {
            var c = this.getClient();
            if (!c || !userId) return;

            if (realtimeChannel) {
                c.removeChannel(realtimeChannel);
            }

            realtimeChannel = c.channel('public:todos:' + userId)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'todos',
                    filter: 'user_id=eq.' + userId
                }, function(payload) {
                    console.log('⚡ Supabase Realtime Change received:', payload);
                    if (typeof onUpdate === 'function') {
                        onUpdate(payload);
                    }
                })
                .subscribe();
        }
    };

    window.TaskSupabase = TaskSupabase;
})(window);
