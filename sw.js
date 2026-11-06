const CACHE_NAME = 'taskflow-pro-v8'; // v2: drops v1 entries, which also held cached cloud (Supabase) responses
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/styles.css',
    './js/qrcode.js',
    './js/audio.js',
    './js/confetti.js',
    './js/api.js',
    './js/auth.js',
    './js/quickparse.js',
    './js/streak.js',
    './js/summary.js',
    './js/app.js',
    './favicon.png',
    './icons/icon.png',
    './icons/icon.svg',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only cache GET requests and non-API requests
    if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
        return;
    }
    // Only this site's own files are cached. Cloud (Supabase) responses hold a user's tasks and
    // must never be stored where the next person on a shared device could read them offline.
    if (new URL(event.request.url).origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Cache fresh copy
                if (networkResponse && networkResponse.status === 200) {
                    const cloned = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
                }
                return networkResponse;
            })
            .catch(() => {
                // If offline, serve from cache
                return caches.match(event.request);
            })
    );
});

// ---- Task reminders (Web Push) ----
self.addEventListener('push', (event) => {
    let data = { title: 'Reminder', body: 'You have a task due.', url: '/' };
    try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) {}
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: './icons/icon.png',
            badge: './icons/badge.png',
            tag: data.taskId || 'taskflow-reminder',
            data: { url: data.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
            for (const w of wins) {
                if ('focus' in w) {
                    // A link to a task or summary is followed; a plain alert just brings the app forward
                    return w.focus().then((fw) => (target !== '/' && fw && 'navigate' in fw) ? fw.navigate(target) : fw);
                }
            }
            return self.clients.openWindow(target);
        })
    );
});
