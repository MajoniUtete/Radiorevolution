// Radio Revolution Service Worker
// Handles: caching, push notifications, stream status polling

const CACHE_NAME = 'radio-revolution-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html'
];

// Stream status polling interval (ms)
const POLL_INTERVAL = 30000; // 30 seconds
let pollInterval = null;
let wasLive = false;

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {
        // Silently fail on individual cache misses during install
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
  startStreamPolling();
});

// ─── Fetch (cache-first with network fallback) ────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Skip non-GET and audio stream requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/stream') || event.request.url.includes('/live')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('/offline.html');
        }
      });
    })
  );
});

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {
    title: 'Radio Revolution',
    body: '🎙️ We\'re LIVE! The unfiltered voice of Zimbabwe is on air!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    tag: 'radio-live',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    actions: [
      { action: 'listen', title: '🎵 Listen Now' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    data: { url: '/?action=play' }
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      data.body = event.data.text() || data.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      renotify: data.renotify,
      vibrate: data.vibrate,
      actions: data.actions,
      data: data.data
    })
  );
});

// ─── Notification Click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || '/?action=play';

  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'AUTO_PLAY' });
          return;
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// ─── Message Handling (from main app) ─────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'START_POLL') {
    startStreamPolling();
  }
  if (event.data && event.data.type === 'STOP_POLL') {
    stopStreamPolling();
  }
});

// ─── Stream Status Polling ────────────────────────────────────────────────────
function startStreamPolling() {
  if (pollInterval) return;
  checkStreamStatus();
  pollInterval = setInterval(checkStreamStatus, POLL_INTERVAL);
}

function stopStreamPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function checkStreamStatus() {
  try {
    // Fetch stream status from your ICEcast/SHOUTcast server
    // Replace STREAM_STATUS_URL with your actual status endpoint
    const STREAM_STATUS_URL = self.__STREAM_STATUS_URL__ || null;
    if (!STREAM_STATUS_URL) return;

    const response = await fetch(STREAM_STATUS_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      wasLive = false;
      broadcastStatus(false);
      return;
    }

    const text = await response.text();
    let isLive = false;

    // Try JSON (ICEcast)
    try {
      const json = JSON.parse(text);
      // ICEcast2 status JSON format
      if (json.icestats && json.icestats.source) {
        const sources = Array.isArray(json.icestats.source)
          ? json.icestats.source
          : [json.icestats.source];
        isLive = sources.some((s) => s.listeners !== undefined);
      }
    } catch {
      // SHOUTcast or plain text — check for listeners/bitrate indicators
      isLive = text.includes('Current Listeners') || text.includes('Stream is Up');
    }

    if (isLive && !wasLive) {
      // Stream just went live — notify!
      wasLive = true;
      broadcastStatus(true);
      sendLiveNotification();
    } else if (!isLive && wasLive) {
      wasLive = false;
      broadcastStatus(false);
    }
  } catch {
    // Network error — don't change live status
  }
}

function broadcastStatus(isLive) {
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) =>
      client.postMessage({ type: 'STREAM_STATUS', isLive })
    );
  });
}

async function sendLiveNotification() {
  const permission = await self.registration.pushManager.permissionState(
    { userVisibleOnly: true },
    'push'
  ).catch(() => 'unknown');

  // Show notification even without server push (local notification)
  self.registration.showNotification('Radio Revolution is LIVE! 🔴', {
    body: '🎙️ The unfiltered voice of Zimbabwe is now on air. Tap to listen!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    tag: 'radio-live',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    actions: [
      { action: 'listen', title: '🎵 Listen Now' },
      { action: 'dismiss', title: 'Maybe Later' }
    ],
    data: { url: '/?action=play' }
  }).catch(() => {});
}
