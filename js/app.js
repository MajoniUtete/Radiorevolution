/* ═══════════════════════════════════════════════════════════════════════════
   Radio Revolution — App Logic
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  // 🎙️ Replace with your actual stream URL (SHOUTcast/ICEcast)
  streamUrl: 'https://your-stream-url.com/live',

  // 📊 ICEcast status endpoint (optional - for live listener count)
  // e.g. 'https://your-stream-url.com/status-json.xsl'
  statusUrl: null,

  // 🔔 Push notification server URL (your deployed backend)
  // e.g. 'https://your-api.com'
  pushServerUrl: null,

  // 🔑 VAPID public key from your push server
  vapidPublicKey: null,

  stationName: 'Radio Revolution',
  tagline: 'The Unfiltered Voice of Zimbabwe',
};

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  isPlaying: false,
  isLive: false,
  volume: 0.8,
  notificationsEnabled: false,
  installPromptEvent: null,
  currentNav: 'home',
};

// ─── DOM References ───────────────────────────────────────────────────────────
const audio        = document.getElementById('radioAudio');
const playBtn      = document.getElementById('playBtn');
const playIcon     = document.getElementById('playIcon');
const playLabel    = document.getElementById('playLabel');
const liveStatus   = document.getElementById('liveStatus');
const liveText     = document.getElementById('liveText');
const listenersBadge = document.getElementById('listenersBadge');
const waveContainer = document.getElementById('waveContainer');
const showArtwork  = document.getElementById('showArtwork');
const volumeSlider = document.getElementById('volumeSlider');
const volPct       = document.getElementById('volPct');
const notifyBtn    = document.getElementById('notifyBtn');
const toast        = document.getElementById('toast');
const installBtn   = document.getElementById('installPromptBtn');

// ─── Service Worker Registration ──────────────────────────────────────────────
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[SW] Registered:', reg.scope);

    // Listen for messages from SW
    navigator.serviceWorker.addEventListener('message', handleSwMessage);

    // Check for updates
    reg.addEventListener('updatefound', () => {
      showToast('Update available — refresh to get the latest!', 'info');
    });
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
  }
}

function handleSwMessage(event) {
  const { type, isLive } = event.data || {};
  if (type === 'STREAM_STATUS') {
    updateLiveStatus(isLive);
  }
  if (type === 'AUTO_PLAY') {
    if (!state.isPlaying) togglePlay();
  }
}

// ─── Audio Player ─────────────────────────────────────────────────────────────
function setupAudio() {
  audio.src = CONFIG.streamUrl;
  audio.volume = state.volume;
  audio.preload = 'none';

  audio.addEventListener('playing', () => {
    state.isPlaying = true;
    updatePlayUI(true);
  });

  audio.addEventListener('pause', () => {
    state.isPlaying = false;
    updatePlayUI(false);
  });

  audio.addEventListener('waiting', () => {
    playIcon.textContent = '⏳';
    playLabel.textContent = 'Connecting...';
  });

  audio.addEventListener('error', () => {
    state.isPlaying = false;
    updatePlayUI(false);
    showToast('Stream unavailable. Please try again shortly.', 'error');
  });

  audio.addEventListener('stalled', () => {
    showToast('Stream buffering...', 'info');
  });
}

function togglePlay() {
  if (state.isPlaying) {
    audio.pause();
    audio.src = ''; // Release stream
  } else {
    audio.src = CONFIG.streamUrl;
    audio.load();
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(() => {
        showToast('Tap play to start the stream', 'info');
      });
    }
  }
}

function updatePlayUI(playing) {
  playIcon.textContent = playing ? '⏸' : '▶';
  playLabel.textContent = playing ? 'Now Streaming' : 'Tap to Listen';
  playBtn.classList.toggle('playing', playing);
  waveContainer.classList.toggle('playing', playing);
  showArtwork.classList.toggle('playing', playing);

  // Update wave bars when not playing
  if (!playing) {
    document.querySelectorAll('.wave-bar').forEach(bar => {
      bar.style.height = '6px';
      bar.style.opacity = '0.3';
    });
  } else {
    document.querySelectorAll('.wave-bar').forEach((bar, i) => {
      bar.style.height = '';
      bar.style.opacity = '';
    });
  }

  // Media Session API (lock screen controls)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Radio Revolution Live',
      artist: CONFIG.tagline,
      album: CONFIG.stationName,
      artwork: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play',  () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('stop',  () => { audio.pause(); audio.src = ''; });
  }
}

// ─── Volume ───────────────────────────────────────────────────────────────────
function setupVolume() {
  volumeSlider.value = state.volume * 100;
  volPct.textContent = `${Math.round(state.volume * 100)}%`;

  volumeSlider.addEventListener('input', (e) => {
    state.volume = e.target.value / 100;
    audio.volume = state.volume;
    volPct.textContent = `${e.target.value}%`;

    // Update slider gradient
    const pct = e.target.value;
    e.target.style.background = `linear-gradient(to right, #cc0000 ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
  });

  // Init gradient
  volumeSlider.style.background = `linear-gradient(to right, #cc0000 80%, rgba(255,255,255,0.08) 80%)`;
}

// ─── Live Status ──────────────────────────────────────────────────────────────
function updateLiveStatus(isLive, listeners) {
  state.isLive = isLive;
  liveStatus.classList.toggle('live', isLive);
  liveText.textContent = isLive ? '● ON AIR' : '○ OFF AIR';
  if (listeners !== undefined && isLive) {
    listenersBadge.textContent = `${listeners} listening`;
  }
}

async function pollStreamStatus() {
  if (!CONFIG.statusUrl) return;
  try {
    const res = await fetch(CONFIG.statusUrl + '?t=' + Date.now(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) { updateLiveStatus(false); return; }
    const json = await res.json();
    // ICEcast format
    if (json.icestats && json.icestats.source) {
      const sources = Array.isArray(json.icestats.source)
        ? json.icestats.source : [json.icestats.source];
      const totalListeners = sources.reduce((s, src) => s + (src.listeners || 0), 0);
      updateLiveStatus(true, totalListeners);
    } else {
      updateLiveStatus(false);
    }
  } catch {
    // Stream offline or network error
  }
}

// ─── Push Notifications ───────────────────────────────────────────────────────
async function setupNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    notifyBtn.textContent = '🔕 Notifications unavailable';
    notifyBtn.disabled = true;
    return;
  }

  // Check existing permission
  if (Notification.permission === 'granted') {
    const subscription = await getExistingSubscription();
    if (subscription) {
      state.notificationsEnabled = true;
      updateNotifyBtn(true);
    }
  } else if (Notification.permission === 'denied') {
    notifyBtn.textContent = '🔕 Notifications blocked in browser settings';
    notifyBtn.disabled = true;
  }
}

async function requestNotifications() {
  if (state.notificationsEnabled) {
    await unsubscribeFromNotifications();
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Enable notifications in your browser settings', 'error');
      return;
    }

    if (CONFIG.vapidPublicKey && CONFIG.pushServerUrl) {
      // Full Web Push subscription
      await subscribeToPush();
    } else {
      // Fallback: local notifications only (no server push)
      state.notificationsEnabled = true;
      updateNotifyBtn(true);
      showToast('Notifications enabled! We\'ll alert you when we go live.', 'success');

      // Start polling if no status URL is configured — use stream check
      if (!CONFIG.statusUrl) {
        navigator.serviceWorker.ready.then(reg => {
          reg.active && reg.active.postMessage({ type: 'START_POLL' });
        });
      }
    }
  } catch (err) {
    showToast('Could not enable notifications. Please try again.', 'error');
    console.error('[Push]', err);
  }
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(CONFIG.vapidPublicKey),
  });

  // Send subscription to your server
  const res = await fetch(`${CONFIG.pushServerUrl}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription }),
  });

  if (!res.ok) throw new Error('Server subscription failed');

  state.notificationsEnabled = true;
  updateNotifyBtn(true);
  showToast('You\'re subscribed! We\'ll notify you when we go live 🔴', 'success');
}

async function unsubscribeFromNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      if (CONFIG.pushServerUrl) {
        await fetch(`${CONFIG.pushServerUrl}/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
      }
    }
    state.notificationsEnabled = false;
    updateNotifyBtn(false);
    showToast('Notifications disabled', 'info');
  } catch (err) {
    console.error('[Push] Unsubscribe failed:', err);
  }
}

async function getExistingSubscription() {
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function updateNotifyBtn(enabled) {
  notifyBtn.textContent = enabled
    ? '🔔 Notifications ON — Tap to disable'
    : '🔔 Notify me when we\'re LIVE!';
  notifyBtn.classList.toggle('subscribed', enabled);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ─── PWA Install Prompt ───────────────────────────────────────────────────────
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPromptEvent = e;
    installBtn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    state.installPromptEvent = null;
    installBtn.classList.add('hidden');
    showToast('Radio Revolution added to your home screen! 🎉', 'success');
  });

  installBtn.addEventListener('click', async () => {
    if (!state.installPromptEvent) return;
    state.installPromptEvent.prompt();
    const { outcome } = await state.installPromptEvent.userChoice;
    if (outcome === 'accepted') {
      state.installPromptEvent = null;
      installBtn.classList.add('hidden');
    }
  });
}

// ─── Install Tabs ─────────────────────────────────────────────────────────────
function setupInstallTabs() {
  const tabs  = document.querySelectorAll('.install-tab');
  const steps = document.querySelectorAll('.install-step');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t  => t.classList.toggle('active',  t.dataset.tab === target));
      steps.forEach(s => s.classList.toggle('active', s.dataset.step === target));
    });
  });
}

// ─── Bottom Navigation ────────────────────────────────────────────────────────
function setupNav() {
  const navItems   = document.querySelectorAll('.nav-item');
  const sections   = document.querySelectorAll('.section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.nav;
      state.currentNav = target;
      navItems.forEach(n  => n.classList.toggle('active',  n.dataset.nav === target));
      sections.forEach(s => s.classList.toggle('active', s.dataset.section === target));
    });
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// ─── Ticker ───────────────────────────────────────────────────────────────────
const tickerMessages = [
  '🎙️ Radio Revolution — The Unfiltered Voice of Zimbabwe',
  '🌍 Broadcasting from the heart of Zimbabwe',
  '🔥 Real talk · Real music · Real Zimbabwe',
  '📻 Stream live anytime, anywhere',
  '💚 Follow us on social media @RadioRevolutionZW',
];
let tickerIndex = 0;
function rotateTicker() {
  const el = document.querySelector('.ticker-text');
  if (!el) return;
  el.textContent = tickerMessages[tickerIndex % tickerMessages.length];
  tickerIndex++;
}

// ─── Auto-play from URL ───────────────────────────────────────────────────────
function checkAutoPlay() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'play') {
    setTimeout(() => togglePlay(), 500);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await registerServiceWorker();
  setupAudio();
  setupVolume();
  setupInstallPrompt();
  setupInstallTabs();
  setupNav();
  await setupNotifications();

  // Event listeners
  playBtn.addEventListener('click', togglePlay);
  notifyBtn.addEventListener('click', requestNotifications);

  // Stream polling
  if (CONFIG.statusUrl) {
    pollStreamStatus();
    setInterval(pollStreamStatus, 30_000);
  }

  // Ticker rotation
  rotateTicker();
  setInterval(rotateTicker, 8000);

  checkAutoPlay();
}

document.addEventListener('DOMContentLoaded', init);
