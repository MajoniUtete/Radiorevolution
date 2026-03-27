/**
 * Radio Revolution — Push Notification Server
 * ─────────────────────────────────────────────
 * Handles:
 *  • Subscription management (subscribe / unsubscribe)
 *  • Push notifications to all subscribers
 *  • BUTT webhook endpoint (POST /broadcast/live)
 *  • Stream status polling + auto-notify on go-live
 *
 * Deploy to: Railway, Render, Fly.io, VPS, etc.
 * Local dev:  npm install && cp .env.example .env && npm start
 */

'use strict';

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const webpush  = require('web-push');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── VAPID Setup ─────────────────────────────────────────────────────────────
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.error('\n❌  VAPID keys missing! Run:  npm run generate-vapid\n');
  process.exit(1);
}

webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:hello@radiorevolution.co.zw',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ─── In-memory subscription store ────────────────────────────────────────────
// For production, replace with a database (SQLite, PostgreSQL, Redis, etc.)
const subscriptions = new Map(); // endpoint -> PushSubscription object
let broadcastIsLive = false;

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS policy: ' + origin + ' not allowed'));
    }
  }
}));
app.use(express.json());

// ─── Auth Middleware (for sensitive endpoints) ────────────────────────────────
function requireHostKey(req, res, next) {
  const key = req.headers['x-host-key'] || req.body?.hostKey;
  if (key === process.env.HOST_SECRET_KEY) return next();
  res.status(401).json({ error: 'Unauthorized. Invalid host key.' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function pushToAll(payload) {
  const notification = JSON.stringify(payload);
  const results = { sent: 0, failed: 0, removed: 0 };

  const promises = Array.from(subscriptions.values()).map(async (sub) => {
    try {
      await webpush.sendNotification(sub, notification);
      results.sent++;
    } catch (err) {
      results.failed++;
      // 410 Gone = subscription expired/invalid — remove it
      if (err.statusCode === 410 || err.statusCode === 404) {
        subscriptions.delete(sub.endpoint);
        results.removed++;
      }
    }
  });

  await Promise.allSettled(promises);
  return results;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'Radio Revolution Push Server',
    status: 'online',
    subscribers: subscriptions.size,
    broadcastLive: broadcastIsLive,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  });
});

// Expose VAPID public key for frontend
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── Subscribe ─────────────────────────────────────────────────────────────────
app.post('/subscribe', (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  subscriptions.set(subscription.endpoint, subscription);
  console.log(`[+] Subscriber added. Total: ${subscriptions.size}`);
  res.status(201).json({ message: 'Subscribed successfully', total: subscriptions.size });
});

// ── Unsubscribe ───────────────────────────────────────────────────────────────
app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const deleted = subscriptions.delete(endpoint);
  console.log(`[-] Unsubscribed. Total: ${subscriptions.size}`);
  res.json({ message: deleted ? 'Unsubscribed' : 'Not found', total: subscriptions.size });
});

// ── Send Notification (host panel) ────────────────────────────────────────────
app.post('/notify', requireHostKey, async (req, res) => {
  const {
    title = 'Radio Revolution',
    body  = '🎙️ Tune in now — we\'re LIVE!',
    icon  = '/icons/icon-192.png',
    badge = '/icons/icon-96.png',
    url   = '/?action=play',
  } = req.body;

  const payload = { title, body, icon, badge, tag: 'radio-live', renotify: true, data: { url } };
  const results = await pushToAll(payload);

  console.log(`[📣] Notification sent: ${results.sent} ok, ${results.failed} failed, ${results.removed} removed`);
  res.json({ ...results, message: 'Notification dispatched' });
});

// ── BUTT Webhook — On Connect (host starts streaming) ─────────────────────────
app.post('/broadcast/live', requireHostKey, async (req, res) => {
  const { host = 'Your host' } = req.body;
  broadcastIsLive = true;
  console.log(`[🔴] BUTT connected — broadcast is LIVE (host: ${host})`);

  const results = await pushToAll({
    title: 'Radio Revolution is LIVE! 🔴',
    body: `🎙️ ${host} is on air — The unfiltered voice of Zimbabwe is live now!`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    tag: 'radio-live',
    renotify: true,
    data: { url: '/?action=play' },
    actions: [
      { action: 'listen', title: '🎵 Listen Now' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  });

  res.json({ message: 'Broadcast live — listeners notified', ...results });
});

// ── BUTT Webhook — On Disconnect (host stops streaming) ───────────────────────
app.post('/broadcast/offline', requireHostKey, (req, res) => {
  broadcastIsLive = false;
  console.log('[⏹️] Broadcast ended — stream is offline');
  res.json({ message: 'Broadcast marked as offline' });
});

// ── Stream status (for frontend polling) ─────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({
    live: broadcastIsLive,
    subscribers: subscriptions.size,
    timestamp: new Date().toISOString(),
  });
});

// ─── Optional: Auto-detect stream live via ICEcast polling ───────────────────
if (process.env.STREAM_STATUS_URL) {
  const POLL_MS = 30_000;

  async function checkStreamStatus() {
    try {
      const response = await fetch(process.env.STREAM_STATUS_URL, {
        signal: AbortSignal.timeout(5000),
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) { broadcastIsLive = false; return; }

      const json = await response.json();
      let nowLive = false;

      // ICEcast2 JSON format
      if (json.icestats?.source) {
        const sources = Array.isArray(json.icestats.source)
          ? json.icestats.source : [json.icestats.source];
        nowLive = sources.some(s => s.listeners !== undefined);
      }

      if (nowLive && !broadcastIsLive) {
        broadcastIsLive = true;
        console.log('[🔴] Stream went LIVE — auto-notifying subscribers');
        pushToAll({
          title: 'Radio Revolution is LIVE! 🔴',
          body: '🎙️ The unfiltered voice of Zimbabwe is on air now. Tap to listen!',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-96.png',
          tag: 'radio-live',
          renotify: true,
          data: { url: '/?action=play' },
        });
      } else if (!nowLive) {
        broadcastIsLive = false;
      }
    } catch {
      // Network error — skip
    }
  }

  setInterval(checkStreamStatus, POLL_MS);
  checkStreamStatus(); // Run on startup
  console.log(`[📡] Stream polling active: ${process.env.STREAM_STATUS_URL}`);
}

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   📻 Radio Revolution Push Server         ║
║   The Unfiltered Voice of Zimbabwe        ║
╠═══════════════════════════════════════════╣
║   Status:  http://localhost:${PORT}          ║
║   Subs:    /subscribe                     ║
║   Notify:  POST /notify                   ║
║   BUTT:    POST /broadcast/live           ║
╚═══════════════════════════════════════════╝

  Subscribers: ${subscriptions.size}
  VAPID ready: ✅
  `);
});
