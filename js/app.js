/* ===== Sleep Calculator ===== */

const CYCLE_MIN = 90;            // length of one sleep cycle
const CYCLES = [6, 5, 4, 3];     // cycles to offer (most → least sleep)
const STORE = {
  theme: 'sleepcalc-theme',      // 'dark' | 'light' | 'system'
  fall: 'sleepcalc-fall-minutes',
  format: 'sleepcalc-time-format', // '12' | '24'
};

const THEMES = ['light', 'dark', 'system']; // valid theme choices
const darkMql = window.matchMedia('(prefers-color-scheme: dark)'); // live OS dark-mode query

/* ---------- State (persisted) ---------- */
let fallMinutes = clampInt(localStorage.getItem(STORE.fall), 0, 45, 15);
let timeFormat = localStorage.getItem(STORE.format) === '24' ? '24' : '12';
// User's chosen preference; the effective theme is resolved in applyTheme().
let themePref = THEMES.includes(localStorage.getItem(STORE.theme))
  ? localStorage.getItem(STORE.theme)
  : 'system'; // follow the OS by default

/* ---------- Helpers ---------- */
// Parse an int and force it into [min, max]; use fallback if not a number.
function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Format a Date's time, honoring the 12/24-hour setting.
function formatTime(date) {
  let h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  if (timeFormat === '24') {
    return `${h.toString().padStart(2, '0')}:${m}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12; // 0 and 12 both display as 12
  return `${h}:${m} ${period}`;
}

// "Late" = a bedtime that lands in the small hours (midnight up to 5 AM).
function isLateBedtime(date) {
  const h = date.getHours();
  return h >= 0 && h < 5;
}

// Turn a minute count into a readable "H hr M min".
function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/* ---------- Apply theme ---------- */
// Resolve 'system' to the OS preference; otherwise use the chosen theme.
function effectiveTheme() {
  if (themePref === 'system') return darkMql.matches ? 'dark' : 'light';
  return themePref;
}

// Push the active theme to the page, browser UI color, and settings buttons.
function applyTheme() {
  const theme = effectiveTheme();
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#000000' : '#f0f2f5'; // match browser chrome
  document.querySelectorAll('#theme-seg .seg-opt').forEach((b) =>
    b.classList.toggle('active', b.dataset.theme === themePref)
  );
}

/* ---------- Build a result row ---------- */
// Make one time option card; `recommended` flags the highlighted 5-cycle pick.
function resultRow(time, cycles, recommended) {
  const totalSleep = cycles * CYCLE_MIN;
  const row = document.createElement('div');
  row.className = 'result' + (recommended ? ' recommended' : '');
  row.innerHTML = `
    <div class="result-main">
      <span class="result-time">${formatTime(time)}</span>
      <span class="result-meta">${cycles} cycles &middot; ${formatDuration(totalSleep)} of sleep</span>
    </div>
    ${recommended ? '<span class="result-tag">Recommended</span>' : ''}
  `;
  return row;
}

/* ---------- Wake-up mode: sleep now ---------- */
function renderWake() {
  const now = new Date();
  const asleepAt = new Date(now.getTime() + fallMinutes * 60000);
  const container = document.getElementById('wake-results');
  container.innerHTML = '';

  // One row per cycle option; 5 cycles (~7.5h) is the recommended pick.
  CYCLES.forEach((cycles) => {
    const wake = new Date(asleepAt.getTime() + cycles * CYCLE_MIN * 60000);
    container.appendChild(resultRow(wake, cycles, cycles === 5));
  });

  // Heading to bed "right now" — warn if right now is the small hours.
  document.getElementById('wake-warning').classList.toggle('hidden', !isLateBedtime(now));

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
    document.getElementById('bed-warning').classList.add('hidden');
    return;
  }

  const [hh, mm] = input.value.split(':').map(Number);
  const wake = new Date();
  wake.setHours(hh, mm, 0, 0);
  // Wake time is always interpreted as the next occurrence.
  if (wake <= new Date()) wake.setDate(wake.getDate() + 1);

  // For each cycle count, bedtime = wake - sleep - time to fall asleep.
  let recommendedBed = null;
  CYCLES.forEach((cycles) => {
    const bed = new Date(wake.getTime() - (cycles * CYCLE_MIN + fallMinutes) * 60000);
    if (cycles === 5) recommendedBed = bed;
    container.appendChild(resultRow(bed, cycles, cycles === 5));
  });

  // Warn when the recommended bedtime falls in the small hours.
  document.getElementById('bed-warning')
    .classList.toggle('hidden', !(recommendedBed && isLateBedtime(recommendedBed)));
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
// Slide the settings panel in/out and toggle the dimming overlay.
// Also locks page scroll so the body scrollbar disappears while open.
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById('drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('drawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
}

/* ---------- Delete data / reset ---------- */
// Clear saved settings and return the app to its first-run defaults.
function deleteData() {
  if (!confirm('Delete all saved data and reset the app to defaults?')) return;

  // Wipe this app's stored preferences.
  Object.values(STORE).forEach((key) => localStorage.removeItem(key));

  // Restore in-memory state to the same defaults used on first load.
  fallMinutes = 15;
  timeFormat = '12';
  themePref = 'system';

  // Reflect the reset across the settings UI and results.
  applyTheme(); // also re-highlights the theme buttons
  document.getElementById('fall-slider').value = fallMinutes;
  document.getElementById('fall-value').textContent = fallMinutes;
  document.querySelectorAll('#format-seg .seg-opt').forEach((b) =>
    b.classList.toggle('active', b.dataset.fmt === timeFormat)
  );
  document.getElementById('wake-input').value = '07:00'; // default wake time
  if (desktopMql.matches) { tpBuildColumns(); tpRender(); }
  renderActive();
}

/* ---------- Wire up ---------- */
function init() {
  applyTheme();

  // Init settings UI
  document.getElementById('fall-slider').value = fallMinutes;
  document.getElementById('fall-value').textContent = fallMinutes;
  document.querySelectorAll('#format-seg .seg-opt').forEach((b) =>
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

  // Theme: light / dark / system
  document.getElementById('theme-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-opt');
    if (!btn) return;
    themePref = btn.dataset.theme;
    localStorage.setItem(STORE.theme, themePref);
    applyTheme();
  });

  // Follow the OS theme live while "System" is selected.
  darkMql.addEventListener('change', () => {
    if (themePref === 'system') applyTheme();
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
    document.querySelectorAll('#format-seg .seg-opt').forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
    // Rebuild the desktop picker so its hour column / AM-PM match the new format.
    if (desktopMql.matches) { tpBuildColumns(); tpRender(); }
    renderActive();
  });

  // Delete data / reset to defaults
  document.getElementById('delete-data-btn').addEventListener('click', deleteData);

  // Bedtime input
  document.getElementById('wake-input').addEventListener('input', renderBed);

  // Default wake-up time: 7:00 AM
  document.getElementById('wake-input').value = '07:00';

  // Swap to the custom picker on desktop (reads the value set just above)
  setupTimePicker();

  // First render + keep "sleep now" fresh every 30s
  renderActive();
  setInterval(() => {
    if (!document.getElementById('panel-wake').classList.contains('hidden')) renderWake();
  }, 30000);
}

/* ---------- Custom desktop time picker ---------- */
// On desktop (precise pointer) the native <input type="time"> popup is an
// unstylable OS dropdown. We swap in a custom picker there and keep the native
// input on touch, where its OS wheel is genuinely better. The native input
// stays the single source of truth: the picker reads/writes its value and
// fires an 'input' event so renderBed() runs unchanged.
const desktopMql = window.matchMedia('(hover: hover) and (pointer: fine)');
const MIN_STEP = 5; // minute granularity in the custom columns
let tpWired = false;

// Collect the picker's DOM elements in one object.
function tpEls() {
  return {
    input: document.getElementById('wake-input'),
    picker: document.getElementById('time-picker'),
    display: document.getElementById('time-display'),
    text: document.getElementById('time-display-text'),
    pop: document.getElementById('time-pop'),
    colHour: document.getElementById('col-hour'),
    colMin: document.getElementById('col-min'),
    colAmpm: document.getElementById('col-ampm'),
  };
}

// Read the native input's value as { h, m } in 24-hour terms.
function tpGetValue() {
  const [h, m] = (tpEls().input.value || '07:00').split(':').map(Number);
  return { h, m };
}

// Write back to the native input and notify the rest of the app.
function tpSetValue(h, m) {
  const input = tpEls().input;
  input.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  tpRender();
}

// Build one clickable option button for a column.
function tpOption(label, type, value) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'time-opt';
  b.textContent = label;
  b.dataset.type = type;
  b.dataset.value = value;
  b.setAttribute('role', 'option');
  b.addEventListener('click', () => tpPick(type, value));
  return b;
}

// (Re)build the option columns for the current 12/24-hour format.
function tpBuildColumns() {
  const { colHour, colMin, colAmpm } = tpEls();
  const is12 = timeFormat === '12';
  colHour.innerHTML = '';
  colMin.innerHTML = '';
  colAmpm.innerHTML = '';

  const hours = is12
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : Array.from({ length: 24 }, (_, i) => i);
  hours.forEach((h) =>
    colHour.appendChild(tpOption(is12 ? String(h) : String(h).padStart(2, '0'), 'hour', h))
  );

  for (let m = 0; m < 60; m += MIN_STEP) {
    colMin.appendChild(tpOption(String(m).padStart(2, '0'), 'min', m));
  }

  colAmpm.hidden = !is12;
  if (is12) ['AM', 'PM'].forEach((p) => colAmpm.appendChild(tpOption(p, 'ampm', p)));
}

// Apply a clicked option, converting 12-hour selections back to 24-hour.
function tpPick(type, value) {
  let { h, m } = tpGetValue();
  if (type === 'min') {
    m = Number(value);
  } else if (type === 'hour') {
    const hr = Number(value);
    if (timeFormat === '12') {
      h = (hr % 12) + (h >= 12 ? 12 : 0); // keep current AM/PM
    } else {
      h = hr;
    }
  } else if (type === 'ampm') {
    const wantPm = value === 'PM';
    if (wantPm && h < 12) h += 12;
    else if (!wantPm && h >= 12) h -= 12;
  }
  tpSetValue(h, m);
}

// Mark the option matching `value` as selected within one column.
function tpHighlight(col, value) {
  col.querySelectorAll('.time-opt').forEach((b) =>
    b.classList.toggle('selected', b.dataset.value === value)
  );
}

// Sync the display label + highlighted options to the current value.
function tpRender() {
  const { text, colHour, colMin, colAmpm } = tpEls();
  const { h, m } = tpGetValue();

  const d = new Date();
  d.setHours(h, m, 0, 0);
  text.textContent = formatTime(d); // respects the 12/24-hour setting

  const hourVal = timeFormat === '12' ? (h % 12 || 12) : h;
  tpHighlight(colHour, String(hourVal));
  tpHighlight(colMin, String(m));
  tpHighlight(colAmpm, h >= 12 ? 'PM' : 'AM');
}

// Center the selected hour/minute without scrolling the page.
function tpScrollSelected() {
  const { colHour, colMin } = tpEls();
  [colHour, colMin].forEach((col) => {
    const sel = col.querySelector('.time-opt.selected');
    if (sel) col.scrollTop = sel.offsetTop - (col.clientHeight - sel.clientHeight) / 2;
  });
}

// Open the popup, center the selection, and watch for outside clicks.
function tpOpen() {
  const { pop, display } = tpEls();
  pop.hidden = false;
  display.classList.add('open');
  display.setAttribute('aria-expanded', 'true');
  tpScrollSelected();
  document.addEventListener('click', tpOutside, true);
}
// Close the popup and detach the outside-click listener.
function tpClose() {
  const { pop, display } = tpEls();
  if (pop.hidden) return;
  pop.hidden = true;
  display.classList.remove('open');
  display.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', tpOutside, true);
}
// Close when a click lands anywhere outside the picker.
function tpOutside(e) {
  if (!tpEls().picker.contains(e.target)) tpClose();
}

// One-time wiring: toggle button + Escape to close.
function tpWire() {
  const { display } = tpEls();
  display.addEventListener('click', () => (tpEls().pop.hidden ? tpOpen() : tpClose()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') tpClose();
  });
}

// Show the custom picker (desktop) or the native input (touch).
function tpActivate(on) {
  const { input, picker } = tpEls();
  if (on) {
    if (!tpWired) { tpWire(); tpWired = true; }
    tpBuildColumns();
    input.hidden = true;
    picker.hidden = false;
    tpRender();
  } else {
    input.hidden = false;
    picker.hidden = true;
    tpClose();
  }
}

function setupTimePicker() {
  tpActivate(desktopMql.matches);
  // Adapt live if a hybrid device switches between mouse and touch.
  desktopMql.addEventListener('change', (e) => tpActivate(e.matches));
}

/* ---------- PWA: service worker + install ---------- */
// True when launched as an installed app (not a browser tab).
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
// True on iPhone/iPad/iPod (they need manual install steps).
function isIOS() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}
// True during local dev, where we skip caching.
function isLocalhost() {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
}

// Register the service worker and drive the "install app" settings row.
function setupPWA() {
  if ('serviceWorker' in navigator) {
    if (isLocalhost()) {
      // Local dev (e.g. Live Server): never cache. Remove any worker left from a
      // previous session and clear its caches so edits always show on reload —
      // no more manually clearing site data.
      navigator.serviceWorker.getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()));
      if (window.caches) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
    } else {
      // Deployed: register the worker for offline support + installability.
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
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

// Boot the app once the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupPWA();
});
