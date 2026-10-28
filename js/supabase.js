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
            return !!(this.getUrl() && this.getKey() && window.supabase);
        },

        getClient: function() {
            if (client) return client;
            var url = this.getUrl();
            var key = this.getKey();
            if (url && key && window.supabase) {
                try {
                    client = window.supabase.createClient(url, key, {
                        auth: { persistSession: true }
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
