// TaskFlow Supabase Cloud Integration
// Enables cross-device sync from anywhere in the world without running a local server!
(function(window) {
    var STORAGE_URL_KEY = 'taskflow_supabase_url';
    var STORAGE_ANON_KEY = 'taskflow_supabase_anon_key';
    
    var client = null;
    var realtimeChannel = null;
    var settingsChannel = null;
    // What the cloud is known to hold for each task id (as the JSON of its row). Saves send only tasks that differ,
    // instead of re-writing every task on every change (which also made every device re-render the whole list).
    var syncedRows = {};

    // App task -> database row
    function toRow(t, userId) {
        var row = {
            id: t.id,
            user_id: userId,
            title: t.title,
            notes: t.notes || '',
            priority: t.priority || 'medium',
            category: t.category || 'personal',
            // lists other than the first are stored as custom:<id>, so no new column is needed
            goal_type: t.type === 'custom' && t.list && t.list !== 'custom' ? 'custom:' + t.list : (t.type || 'daily'),
            repeat_rule: t.repeat || null,
            repeat_day: t.repeat ? (t.repeatDay || null) : null,
            remind_at: t.remindAt || null,
            due_date: t.dueDate || null,
            completed: !!t.completed,
            // when it was finished: the weekly / monthly summary counts tasks on the day they were done
            completed_at: t.completed ? (t.completedAt || null) : null,
            starred: !!t.starred,
            subtasks: t.subtasks || []
        };
        // The server flips `reminded` to true after sending. Only write it from the
        // client when the reminder time was just set/changed, so a stale copy can
        // never re-arm a reminder that was already delivered.
        if (t.remindDirty) row.reminded = false;
        return row;
    }

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
                        auth: { persistSession: true, autoRefreshToken: true }
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
                console.log('Supabase cloud client initialized');
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

        // ---- Accounts: Supabase Auth (passwords are hashed server-side; every request carries the user's own token) ----

        isUuid: function(id) {
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
        },

        // Auth user -> the small profile object the app keeps
        profileFrom: function(u) {
            var m = (u && u.user_metadata) || {};
            var fallback = ((u && u.email) || 'user').split('@')[0];
            return {
                id: u.id,
                username: m.username || fallback,
                name: m.name || m.username || fallback,
                email: u.email,
                avatar: m.avatar || 'avatar-1'
            };
        },

        userError: function(message) {
            var e = new Error(message);
            e.userFacing = true; // shown to the user as is, never swallowed by the offline fallbacks
            return e;
        },

        // The signed-in user from the stored session (null when signed out or the session is gone)
        getSessionUser: async function() {
            var c = this.getClient();
            if (!c) return null;
            var res = await c.auth.getSession();
            return res.data && res.data.session ? this.profileFrom(res.data.session.user) : null;
        },

        // Old accounts (made before Supabase Auth) are matched by their verified email and moved over once
        claimLegacyData: async function() {
            var c = this.getClient();
            if (!c) return 0;
            var res = await c.rpc('claim_legacy_data');
            if (res.error) {
                console.warn('Supabase claim_legacy_data warning (run supabase/secure-rls.sql):', res.error.message);
                return 0;
            }
            return res.data || 0;
        },

        registerUser: async function(userData) {
            var c = this.getClient();
            if (!c) throw new Error('Supabase cloud database not connected.');
            var res = await c.auth.signUp({
                email: userData.email.trim(),
                password: userData.password,
                options: { data: {
                    username: userData.username.trim(),
                    name: (userData.name || userData.username).trim(),
                    avatar: userData.avatar || 'avatar-1'
                } }
            });
            if (res.error) {
                var msg = res.error.message || 'Registration failed.';
                if (/already registered|already been registered/i.test(msg)) throw this.userError('Username or email is already registered.');
                throw this.userError(msg);
            }
            // With "Confirm email" on (required for production) there is no session until the link is opened
            if (!res.data.session) {
                return { pending: true, message: 'Account created. Open the confirmation link we emailed you, then sign in.' };
            }
            await this.claimLegacyData();
            return this.profileFrom(res.data.session.user);
        },

        loginUser: async function(identifier, password) {
            var c = this.getClient();
            if (!c) throw new Error('Supabase cloud database not connected.');
            var email = identifier.trim();
            if (email.indexOf('@') < 0) throw this.userError('Sign in with your email address.');
            var res = await c.auth.signInWithPassword({ email: email, password: password });
            if (res.error) {
                if (/not confirmed/i.test(res.error.message || '')) throw this.userError('Confirm your email first: open the link we sent you, then sign in.');
                if (/invalid login/i.test(res.error.message || '')) throw this.userError('Invalid email or password.');
                throw this.userError(res.error.message || 'Sign in failed.');
            }
            await this.claimLegacyData();
            return this.profileFrom(res.data.user);
        },

        signOut: async function() {
            var c = this.getClient();
            if (c) { try { await c.auth.signOut({ scope: 'local' }); } catch (e) {} } // this device only
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
            var mapped = (res.data || []).map(function(row) {
                return {
                    id: row.id,
                    title: row.title,
                    notes: row.notes || '',
                    priority: row.priority || 'medium',
                    category: row.category || 'personal',
                    type: /^custom/.test(row.goal_type || '') ? 'custom' : (row.goal_type || undefined),
                    list: /^custom:/.test(row.goal_type || '') ? row.goal_type.slice(7) : undefined,
                    repeat: row.repeat_rule || '',
                    repeatDay: row.repeat_day || undefined,
                    remindAt: row.remind_at || '',
                    reminded: !!row.reminded,
                    dueDate: row.due_date || '',
                    completed: !!row.completed,
                    completedAt: row.completed_at || undefined,
                    starred: !!row.starred,
                    subtasks: Array.isArray(row.subtasks) ? row.subtasks : (typeof row.subtasks === 'string' ? JSON.parse(row.subtasks || '[]') : []),
                    createdAt: row.created_at
                };
            });
            syncedRows = {};
            mapped.forEach(function(t) { syncedRows[t.id] = JSON.stringify(toRow(t, userId)); });
            return mapped;
        },

        // Save / upsert only the tasks that changed since the cloud copy we know of
        saveTodos: async function(todos, userId) {
            var c = this.getClient();
            if (!c || !userId) return;

            if (!todos || todos.length === 0) return;

            var rows = todos.map(function(t) { return toRow(t, userId); });
            var changed = rows.filter(function(r) { return syncedRows[r.id] !== JSON.stringify(r); });
            if (changed.length === 0) return;
            var sentSigs = changed.map(function(r) { return JSON.stringify(r); });
            rows = changed;

            var res = await c.from('todos').upsert(rows, { onConflict: 'id' });
            if (res.error && /goal_type|remind_at|reminded|repeat_rule|repeat_day|completed_at/.test(res.error.message || '')) {
                // Optional columns not created yet: save without them so sync keeps working
                console.warn('Supabase: run supabase/setup-reminders.sql to add goal_type / remind_at / reminded.');
                if (!window._goalTypeWarned && window.showToast) {
                    window._goalTypeWarned = true;
                    window.showToast('Goals and reminders are saved on this device only. Run the SQL setup in Supabase to sync them (see Settings).', 'info');
                }
                res = await c.from('todos').upsert(rows.map(function(r) {
                    delete r.goal_type; delete r.remind_at; delete r.reminded; delete r.repeat_rule; delete r.repeat_day; delete r.completed_at; return r;
                }), { onConflict: 'id' });
            }
            if (!res.error) {
                rows.forEach(function(r, i) { syncedRows[r.id] = sentSigs[i]; });
                todos.forEach(function(t) { delete t.remindDirty; });
            }
            if (res.error) {
                console.warn('Supabase batch upsert warning:', res.error);
            }
        },

        // Custom list name (one row per user; the latest rename overwrites the old one)
        getCustomListName: async function(userId) {
            var c = this.getClient();
            if (!c || !userId) return null;
            var res = await c.from('user_settings').select('custom_list_name').eq('user_id', userId).maybeSingle();
            if (res.error) {
                console.warn('Supabase getCustomListName warning (run supabase/setup-reminders.sql):', res.error);
                return null;
            }
            return res.data ? (res.data.custom_list_name || '') : null;
        },

        // The user's custom lists: { lists: [...], legacyName } or null when unavailable
        getCustomLists: async function(userId) {
            var c = this.getClient();
            if (!c || !userId) return null;
            var res = await c.from('user_settings').select('custom_lists, custom_list_name').eq('user_id', userId).maybeSingle();
            if (res.error) {
                // custom_lists column not added yet: fall back to the single saved name
                var name = await this.getCustomListName(userId);
                return name === null ? null : { lists: [], legacyName: name };
            }
            var d = res.data || {};
            return { lists: Array.isArray(d.custom_lists) ? d.custom_lists : [], legacyName: d.custom_list_name || '' };
        },

        saveCustomLists: async function(userId, lists) {
            var c = this.getClient();
            if (!c || !userId || !lists || !lists.length) return false;
            var res = await c.from('user_settings').upsert({
                user_id: userId,
                custom_lists: lists,
                custom_list_name: lists[0].name, // older app versions only know the first list
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (res.error) {
                console.warn('Supabase saveCustomLists warning (run supabase/setup-reminders.sql):', res.error);
                return this.saveCustomListName(userId, lists[0].name);
            }
            return true;
        },

        saveCustomListName: async function(userId, name) {
            var c = this.getClient();
            if (!c || !userId) return false;
            var res = await c.from('user_settings').upsert({
                user_id: userId,
                custom_list_name: name,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (res.error) {
                console.warn('Supabase saveCustomListName warning (run supabase/setup-reminders.sql):', res.error);
                return false;
            }
            return true;
        },

        // Category list (jsonb on the same user_settings row). null = unavailable, [] = none saved yet
        getCategories: async function(userId) {
            var c = this.getClient();
            if (!c || !userId) return null;
            var res = await c.from('user_settings').select('categories').eq('user_id', userId).maybeSingle();
            if (res.error) {
                console.warn('Supabase getCategories warning (run supabase/setup-reminders.sql):', res.error);
                return null;
            }
            return res.data && Array.isArray(res.data.categories) ? res.data.categories : [];
        },

        saveCategories: async function(userId, categories) {
            var c = this.getClient();
            if (!c || !userId) return false;
            var res = await c.from('user_settings').upsert({
                user_id: userId,
                categories: categories,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (res.error) {
                console.warn('Supabase saveCategories warning (run supabase/setup-reminders.sql):', res.error);
                return false;
            }
            return true;
        },

        // Weekly / monthly summary notifications: { enabled, tz } on the user_settings row.
        // null = unavailable (column not added yet), {} = nothing saved yet
        getSummaryPrefs: async function(userId) {
            var c = this.getClient();
            if (!c || !userId) return null;
            var res = await c.from('user_settings').select('summary_prefs').eq('user_id', userId).maybeSingle();
            if (res.error) {
                console.warn('Supabase getSummaryPrefs warning (run supabase/setup-summaries.sql):', res.error);
                return null;
            }
            return (res.data && res.data.summary_prefs) || {};
        },

        saveSummaryPrefs: async function(userId, prefs) {
            var c = this.getClient();
            if (!c || !userId) return false;
            var res = await c.from('user_settings').upsert({
                user_id: userId,
                summary_prefs: prefs,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (res.error) {
                console.warn('Supabase saveSummaryPrefs warning (run supabase/setup-summaries.sql):', res.error);
                return false;
            }
            return true;
        },

        // Habits: one row per habit; the days checked in are a list on the row.
        // null = unavailable (table not created yet)
        listHabits: async function(userId) {
            var c = this.getClient();
            if (!c || !userId) return null;
            var res = await c.from('habits').select('*').eq('user_id', userId).order('created_at', { ascending: true });
            if (res.error) {
                console.warn('Supabase listHabits warning (run supabase/setup-habits.sql):', res.error);
                return null;
            }
            return res.data || [];
        },

        saveHabit: async function(userId, h) {
            var c = this.getClient();
            if (!c || !userId) return false;
            var row = {
                id: h.id,
                user_id: userId,
                name: h.name,
                schedule: h.schedule || 'daily',
                remind_time: h.remind_time || null,
                tz: h.tz || null,
                start_date: h.start_date,
                target_days: h.target_days || 21,
                checkins: h.checkins || [],
                status: h.status || 'active',
                updated_at: new Date().toISOString()
            };
            var res = await c.from('habits').upsert(row, { onConflict: 'id' });
            if (res.error) {
                console.warn('Supabase saveHabit warning (run supabase/setup-habits.sql):', res.error);
                return false;
            }
            return true;
        },

        deleteHabit: async function(id) {
            var c = this.getClient();
            if (!c) return false;
            var res = await c.from('habits').delete().eq('id', id);
            return !res.error;
        },

        // Notification alerts the user manages in Settings (sent by the send-notification-alerts Edge Function)
        listNotifAlerts: async function(userId) {
            var c = this.getClient();
            if (!c || !userId) return null;
            var res = await c.from('notification_alerts').select('*').eq('user_id', userId).order('send_time', { ascending: true });
            if (res.error) {
                console.warn('Supabase listNotifAlerts warning (run supabase/setup-reminders.sql):', res.error);
                return null;
            }
            return res.data || [];
        },

        saveNotifAlert: async function(userId, alert) {
            var c = this.getClient();
            if (!c || !userId) throw new Error('Cloud sync is not connected');
            var row = Object.assign({}, alert, { user_id: userId });
            if (!row.id) delete row.id;
            // A changed schedule should be allowed to fire again today
            row.last_sent_on = null;
            var res = await c.from('notification_alerts').upsert(row).select().single();
            if (res.error) throw new Error(res.error.message);
            return res.data;
        },

        setNotifAlertEnabled: async function(id, enabled) {
            var c = this.getClient();
            if (!c) return false;
            var res = await c.from('notification_alerts').update({ enabled: enabled }).eq('id', id);
            return !res.error;
        },

        deleteNotifAlert: async function(id) {
            var c = this.getClient();
            if (!c) return false;
            var res = await c.from('notification_alerts').delete().eq('id', id);
            return !res.error;
        },

        sendTestNotifAlert: async function(id) {
            var c = this.getClient();
            if (!c) throw new Error('Cloud sync is not connected');
            var res = await c.functions.invoke('send-notification-alerts', { body: { test: id } });
            if (res.error) {
                var msg = res.error.message;
                try { var j = await res.error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
                throw new Error(msg);
            }
            return true;
        },

        subscribeToSettings: function(userId, onUpdate) {
            var c = this.getClient();
            if (!c || !userId) return;
            if (settingsChannel) c.removeChannel(settingsChannel);
            settingsChannel = c.channel('public:user_settings:' + userId)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'user_settings',
                    filter: 'user_id=eq.' + userId
                }, function(payload) {
                    if (typeof onUpdate === 'function') onUpdate(payload);
                })
                .subscribe();
        },

        // Web Push subscriptions (one row per phone/browser)
        savePushSubscription: async function(userId, sub) {
            var c = this.getClient();
            if (!c || !userId) throw new Error('Cloud sync is not connected');
            var json = sub.toJSON();
            var res = await c.from('push_subscriptions').upsert({
                endpoint: json.endpoint,
                user_id: userId,
                p256dh: json.keys.p256dh,
                auth: json.keys.auth,
                user_agent: (navigator.userAgent || '').slice(0, 200)
            }, { onConflict: 'endpoint' });
            if (res.error) throw new Error(res.error.message);
        },

        deletePushSubscription: async function(endpoint) {
            var c = this.getClient();
            if (!c) return;
            await c.from('push_subscriptions').delete().eq('endpoint', endpoint);
        },

        // Delete a todo from Supabase
        deleteTodo: async function(todoId) {
            delete syncedRows[todoId]; // forget it, so undoing a delete saves the row again
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
                    console.log('Supabase realtime change received:', payload);
                    if (typeof onUpdate === 'function') {
                        onUpdate(payload);
                    }
                })
                .subscribe();
        }
    };

    window.TaskSupabase = TaskSupabase;
})(window);
