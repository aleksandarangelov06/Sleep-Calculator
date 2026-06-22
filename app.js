/* ===== Sleep Calculator ===== */

const CYCLE_MIN = 90;            // length of one sleep cycle
const CYCLES = [6, 5, 4, 3];     // cycles to offer (most → least sleep)
const STORE = {
  theme: 'sleepcalc-theme',      // 'dark' | 'light'
  fall: 'sleepcalc-fall-minutes',
  format: 'sleepcalc-time-format', // '12' | '24'
};

/* ---------- State (persisted) ---------- */
let fallMinutes = clampInt(localStorage.getItem(STORE.fall), 0, 45, 15);
let timeFormat = localStorage.getItem(STORE.format) === '24' ? '24' : '12';
let theme = localStorage.getItem(STORE.theme) === 'light' ? 'light' : 'dark'; // dark by default

/* ---------- Helpers ---------- */
function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function formatTime(date) {
  let h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  if (timeFormat === '24') {
    return `${h.toString().padStart(2, '0')}:${m}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/* Quality hint per number of cycles */
function cycleNote(cycles) {
  if (cycles >= 6) return 'Plenty of rest';
  if (cycles === 5) return 'Recommended';
  if (cycles === 4) return 'Good in a pinch';
  return 'Bare minimum';
}

/* ---------- Apply theme ---------- */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#000000' : '#f0f2f5';
  document.getElementById('theme-toggle').checked = theme === 'light';
}

/* ---------- Build a result row ---------- */
function resultRow(time, cycles, recommended) {
  const totalSleep = cycles * CYCLE_MIN;
  const row = document.createElement('div');
  row.className = 'result' + (recommended ? ' recommended' : '');
  row.innerHTML = `
    <div class="result-main">
      <span class="result-time">${formatTime(time)}</span>
      <span class="result-meta">${cycles} cycles &middot; ${formatDuration(totalSleep)} of sleep</span>
    </div>
    <span class="result-tag">${recommended ? 'Recommended' : cycleNote(cycles)}</span>
  `;
  return row;
}

/* ---------- Wake-up mode: sleep now ---------- */
function renderWake() {
  const now = new Date();
  document.getElementById('now-line').textContent =
    `It's ${formatTime(now)} now — asleep by about ${formatTime(new Date(now.getTime() + fallMinutes * 60000))}.`;

  const asleepAt = new Date(now.getTime() + fallMinutes * 60000);
  const container = document.getElementById('wake-results');
  container.innerHTML = '';

  CYCLES.forEach((cycles) => {
    const wake = new Date(asleepAt.getTime() + cycles * CYCLE_MIN * 60000);
    container.appendChild(resultRow(wake, cycles, cycles === 5));
  });

  document.getElementById('fall-note').textContent = fallMinutes;
}

/* ---------- Bedtime mode: work backward from wake time ---------- */
function renderBed() {
  const input = document.getElementById('wake-input');
  const container = document.getElementById('bed-results');
  document.getElementById('fall-note-2').textContent = fallMinutes;
  container.innerHTML = '';

  if (!input.value) {
    container.innerHTML = '<p class="footnote">Choose a wake-up time above to see when to head to bed.</p>';
    return;
  }

  const [hh, mm] = input.value.split(':').map(Number);
  const wake = new Date();
  wake.setHours(hh, mm, 0, 0);
  // Wake time is always interpreted as the next occurrence.
  if (wake <= new Date()) wake.setDate(wake.getDate() + 1);

  // For each cycle count, bedtime = wake - sleep - time to fall asleep.
  CYCLES.forEach((cycles) => {
    const bed = new Date(wake.getTime() - (cycles * CYCLE_MIN + fallMinutes) * 60000);
    container.appendChild(resultRow(bed, cycles, cycles === 5));
  });
}

/* ---------- Re-render whichever panel is active ---------- */
function renderActive() {
  if (!document.getElementById('panel-wake').classList.contains('hidden')) {
    renderWake();
  } else {
    renderBed();
  }
}

/* ---------- Tab switching ---------- */
function switchTab(target) {
  const wake = target === 'wake';
  document.getElementById('tab-wake').classList.toggle('active', wake);
  document.getElementById('tab-bed').classList.toggle('active', !wake);
  document.getElementById('panel-wake').classList.toggle('hidden', !wake);
  document.getElementById('panel-bed').classList.toggle('hidden', wake);
  renderActive();
}

/* ---------- Settings drawer ---------- */
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById('drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('drawer').setAttribute('aria-hidden', 'true');
}

/* ---------- Wire up ---------- */
function init() {
  applyTheme();

  // Init settings UI
  document.getElementById('fall-slider').value = fallMinutes;
  document.getElementById('fall-value').textContent = fallMinutes;
  document.querySelectorAll('.seg-opt').forEach((b) =>
    b.classList.toggle('active', b.dataset.fmt === timeFormat)
  );

  // Tabs
  document.getElementById('tab-wake').addEventListener('click', () => switchTab('wake'));
  document.getElementById('tab-bed').addEventListener('click', () => switchTab('bed'));

  // Settings open/close
  document.getElementById('settings-btn').addEventListener('click', openDrawer);
  document.getElementById('close-settings').addEventListener('click', closeDrawer);
  document.getElementById('overlay').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('change', (e) => {
    theme = e.target.checked ? 'light' : 'dark';
    localStorage.setItem(STORE.theme, theme);
    applyTheme();
  });

  // Fall-asleep slider
  document.getElementById('fall-slider').addEventListener('input', (e) => {
    fallMinutes = parseInt(e.target.value, 10);
    document.getElementById('fall-value').textContent = fallMinutes;
    localStorage.setItem(STORE.fall, fallMinutes);
    renderActive();
  });

  // Time format
  document.getElementById('format-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-opt');
    if (!btn) return;
    timeFormat = btn.dataset.fmt;
    localStorage.setItem(STORE.format, timeFormat);
    document.querySelectorAll('.seg-opt').forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
    renderActive();
  });

  // Bedtime input
  document.getElementById('wake-input').addEventListener('input', renderBed);

  // Default wake-up time: 7:00 AM
  document.getElementById('wake-input').value = '07:00';

  // First render + keep "sleep now" fresh every 30s
  renderActive();
  setInterval(() => {
    if (!document.getElementById('panel-wake').classList.contains('hidden')) renderWake();
  }, 30000);
}

/* ---------- PWA: service worker + install ---------- */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

function setupPWA() {
  // Register the service worker (enables offline + installability).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  const row = document.getElementById('install-row');
  const btn = document.getElementById('install-btn');
  const sub = document.getElementById('install-sub');

  if (isStandalone()) return; // already installed — leave the row hidden

  let deferredPrompt = null;

  // Android / desktop Chrome: capture the install prompt and offer a button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    row.classList.remove('hidden');
    btn.classList.remove('hidden');
  });

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    row.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    row.classList.add('hidden');
  });

  // iOS Safari has no install prompt — show manual instructions instead.
  if (isIOS()) {
    row.classList.remove('hidden');
    btn.classList.add('hidden');
    sub.innerHTML = 'Tap the Share button, then <strong>Add to Home Screen</strong>.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  setupPWA();
});
