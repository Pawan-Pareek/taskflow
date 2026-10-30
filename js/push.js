// TaskFlow reminders: Web Push subscription helper
(function(window) {
    var PUSH_FLAG = 'taskflow_push_on';

    function urlBase64ToUint8Array(base64) {
        var padding = '='.repeat((4 - (base64.length % 4)) % 4);
        var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    function isIOS() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function isStandalone() {
        return window.navigator.standalone === true ||
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    }

    var TaskPush = {
        supported: function() {
            return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        },

        permission: function() {
            return ('Notification' in window) ? Notification.permission : 'unsupported';
        },

        // True when this device has accepted notifications and the cloud holds its subscription
        isOn: function() {
            try { return localStorage.getItem(PUSH_FLAG) === '1' && this.permission() === 'granted'; }
            catch (e) { return false; }
        },

        // Human readable reason notifications cannot be enabled here, or '' if they can
        blocker: function() {
            if (isIOS() && !isStandalone()) {
                return 'On iPhone, tap Share → "Add to Home Screen", then open TaskFlow from the home screen icon and enable reminders there.';
            }
            if (!this.supported()) return 'This browser does not support push notifications.';
            if (this.permission() === 'denied') return 'Notifications are blocked. Allow them in your browser or phone settings for this site.';
            if (!(window.TaskSupabase && window.TaskSupabase.isEnabled())) return 'Connect Supabase cloud sync first. Reminders need the cloud to reach your phone.';
            if (!(window.TaskAPI && window.TaskAPI.getCurrentUser())) return 'Sign in first.';
            var key = window.TASKFLOW_CONFIG && window.TASKFLOW_CONFIG.vapidPublicKey;
            if (!key) return 'Push key is missing from config.js.';
            return '';
        },

        enable: async function() {
            var why = this.blocker();
            if (why) throw new Error(why);

            var perm = await Notification.requestPermission();
            if (perm !== 'granted') throw new Error('Notification permission was not granted.');

            var reg = await navigator.serviceWorker.ready;
            var sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(window.TASKFLOW_CONFIG.vapidPublicKey)
                });
            }
            await window.TaskSupabase.savePushSubscription(window.TaskAPI.getCurrentUser().id, sub);
            try { localStorage.setItem(PUSH_FLAG, '1'); } catch (e) {}
            return true;
        },

        disable: async function() {
            try {
                var reg = await navigator.serviceWorker.ready;
                var sub = await reg.pushManager.getSubscription();
                if (sub) {
                    if (window.TaskSupabase) await window.TaskSupabase.deletePushSubscription(sub.endpoint);
                    await sub.unsubscribe();
                }
            } catch (e) { console.warn('Push disable warning:', e); }
            try { localStorage.removeItem(PUSH_FLAG); } catch (e) {}
        },

        // Show a notification from the page itself (used while the app is open)
        showLocal: async function(title, body, tag) {
            if (this.permission() !== 'granted') return false;
            try {
                var reg = await navigator.serviceWorker.ready;
                await reg.showNotification(title, { body: body, icon: './icons/icon.png', tag: tag });
                return true;
            } catch (e) { return false; }
        }
    };

    window.TaskPush = TaskPush;
})(window);
