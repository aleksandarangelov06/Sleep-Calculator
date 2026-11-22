/* ===== Sleep Calculator ===== */

const CYCLE_MIN = 90;            // length of one sleep cycle
const CYCLES = [6, 5, 4, 3];     // cycles to offer (most → least sleep)
const MAX_CYCLES = Math.max(...CYCLES); // pips drawn per result row
const DEFAULT_WAKE = '07:00';    // starting value for "I want to wake up at"
const DEFAULT_BED = '22:30';     // starting value for "I want to go to bed at"
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

/* ---------- State (session only) ---------- */
// Plan bedtime tab: plan from a wake-up time (gives bedtimes) or from a bedtime
// (gives wake-up times). Not saved, so the tab always opens on "wake".
let planFrom = 'wake'; // 'wake' | 'bed'

/* ---------- Helpers ---------- */
// Parse an int and force it into [min, max]; use fallback if not a number.
function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Split a Date's time into the clock part and AM/PM, honoring the 12/24-hour
// setting. `period` is empty in 24-hour mode.
function timeParts(date) {
  let h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  if (timeFormat === '24') {
    return { clock: `${h.toString().padStart(2, '0')}:${m}`, period: '' };
  }
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12; // 0 and 12 both display as 12
  return { clock: `${h}:${m}`, period };
}

// Time as HTML, with AM/PM wrapped so it can be styled smaller than the digits.
function timeHTML(date) {
  const { clock, period } = timeParts(date);
  return period ? `${clock}<span class="period"> ${period}</span>` : clock;
}

// Turn an "HH:MM" time-input value into a Date for today at that time.
function dateFromInput(value) {
  const [hh, mm] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
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

// Colors at the top and bottom of the sky, for the browser bar and Android's system bars.
const SKY_EDGES = { dark: ['#0a1020', '#04060d'], light: ['#e6ecfa', '#f6f2ec'] };

// Push the active theme to the page, browser UI color, and settings buttons.
function applyTheme() {
  const theme = effectiveTheme();
  const [top, bottom] = SKY_EDGES[theme];
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = top; // match browser chrome to the top of the sky
  // Inside the Android app, tint the status and navigation bars the same way.
  if (window.AndroidBars) window.AndroidBars.setBars(top, bottom, theme === 'dark');
  document.querySelectorAll('#theme-seg .seg-opt').forEach((b) =>
    b.classList.toggle('active', b.dataset.theme === themePref)
  );
}

/* ---------- Build a result row ---------- */
// Make one time option card; `recommended` flags the highlighted 5-cycle pick.
function resultRow(time, cycles, recommended) {
  const totalSleep = cycles * CYCLE_MIN;
  // One bar per possible cycle, filled up to this option's count.
  const pips = Array.from({ length: MAX_CYCLES }, (_, i) =>
    `<span class="pip${i < cycles ? ' on' : ''}"></span>`
  ).join('');
  const row = document.createElement('div');
  row.className = 'result' + (recommended ? ' recommended' : '');
  row.innerHTML = `
    <div class="result-main">
      <span class="result-time">${timeHTML(time)}</span>
      <span class="result-meta">${cycles} cycles &middot; ${formatDuration(totalSleep)} of sleep</span>
    </div>
    <div class="result-side">
      ${recommended ? '<span class="result-tag">Recommended</span>' : ''}
      <span class="pips" aria-hidden="true">${pips}</span>
    </div>
  `;
  return row;
}

/* ---------- Shared calculations ---------- */
// Add wake-up options for someone going to bed at `bedtime`.
// wake = bedtime + time to fall asleep + whole cycles. 5 cycles is recommended.
function appendWakeTimes(container, bedtime) {
  const asleepAt = new Date(bedtime.getTime() + fallMinutes * 60000);
  CYCLES.forEach((cycles) => {
    const wake = new Date(asleepAt.getTime() + cycles * CYCLE_MIN * 60000);
    container.appendChild(resultRow(wake, cycles, cycles === 5));
  });
}

// Add bedtime options for someone who must wake at `wake`, and return the
// recommended (5-cycle) bedtime. bedtime = wake - whole cycles - time to fall asleep.
function appendBedtimes(container, wake) {
  let recommended = null;
  CYCLES.forEach((cycles) => {
    const bed = new Date(wake.getTime() - (cycles * CYCLE_MIN + fallMinutes) * 60000);
    if (cycles === 5) recommended = bed;
    container.appendChild(resultRow(bed, cycles, cycles === 5));
  });
  return recommended;
}

/* ---------- Wake-up mode: sleep now ---------- */
function renderWake() {
  const now = new Date();
  const container = document.getElementById('wake-results');
  container.innerHTML = '';
  document.getElementById('now-time').innerHTML = timeHTML(now);
  document.getElementById('fall-note').textContent = fallMinutes;

  appendWakeTimes(container, now);

  // Heading to bed "right now": warn if right now is the small hours.
  document.getElementById('wake-warning').classList.toggle('hidden', !isLateBedtime(now));
}

/* ---------- Plan bedtime mode: from a wake-up time or a bedtime ---------- */
// Copy that changes with the "Wake up at" / "Go to bed at" switch.
const PLAN_COPY = {
  wake: {
    sub: 'We’ll work backward so you wake up at the end of a full sleep cycle.',
    label: 'Best times to go to bed',
    empty: 'Choose a wake-up time above to see when to head to bed.',
    warning: 'Your recommended bedtime is past midnight. Going to bed this late can disrupt your body clock and lower sleep quality. Aim for an earlier wake-up time when you can.',
  },
  bed: {
    sub: 'We’ll count forward so your alarm goes off at the end of a full sleep cycle.',
    label: 'Best times to wake up',
    empty: 'Choose a bedtime above to see when to set your alarm.',
    warning: 'That bedtime is past midnight. Going to bed this late can disrupt your body clock and lower sleep quality.',
  },
};

function renderBed() {
  const fromBed = planFrom === 'bed';
  const input = document.getElementById(fromBed ? 'bed-input' : 'wake-input');
  const container = document.getElementById('bed-results');
  const warning = document.getElementById('bed-warning');
  document.getElementById('fall-note-2').textContent = fallMinutes;
  container.innerHTML = '';

  if (!input.value) {
    container.innerHTML = `<p class="footnote">${PLAN_COPY[planFrom].empty}</p>`;
    warning.classList.add('hidden');
    return;
  }

  let lateBedtime;
  if (fromBed) {
    // Count forward from the chosen bedtime; warn if that bedtime is in the small hours.
    const bedtime = dateFromInput(input.value);
    appendWakeTimes(container, bedtime);
    lateBedtime = isLateBedtime(bedtime);
  } else {
    // Work backward from the next occurrence of the wake time;
    // warn when the recommended bedtime falls in the small hours.
    const wake = dateFromInput(input.value);
    if (wake <= new Date()) wake.setDate(wake.getDate() + 1);
    lateBedtime = isLateBedtime(appendBedtimes(container, wake));
  }
  warning.classList.toggle('hidden', !lateBedtime);
}

// Flip the plan tab between planning from a wake-up time and from a bedtime.
function setPlanFrom(from) {
  planFrom = from;
  const fromBed = from === 'bed';
  document.querySelectorAll('#plan-seg .seg-opt').forEach((b) => {
    const on = b.dataset.from === from;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('from-wake').hidden = fromBed;
  document.getElementById('from-bed').hidden = !fromBed;

  const copy = PLAN_COPY[from];
  document.getElementById('plan-sub').textContent = copy.sub;
  document.getElementById('plan-label').textContent = copy.label;
  document.getElementById('bed-warning-text').textContent = copy.warning;
  renderActive();
}

/* ---------- Re-render whichever panel is active ---------- */
function isWakePanelActive() {
  return !document.getElementById('panel-wake').classList.contains('hidden');
}
function renderActive() {
  if (isWakePanelActive()) renderWake();
  else renderBed();
}

/* ---------- Tab switching ---------- */
function switchTab(target) {
  const wake = target === 'wake';
  const tabWake = document.getElementById('tab-wake');
  const tabBed = document.getElementById('tab-bed');
  document.querySelector('.tabs').dataset.active = wake ? 'wake' : 'bed'; // slides the pill
  tabWake.classList.toggle('active', wake);
  tabBed.classList.toggle('active', !wake);
  tabWake.setAttribute('aria-selected', String(wake));
  tabBed.setAttribute('aria-selected', String(!wake));
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

// Android back button: the APK asks the page first. Close Settings if it's
// open and report the press as handled; otherwise the app goes back as usual.
window.handleBack = () => {
  if (!document.getElementById('drawer').classList.contains('open')) return false;
  closeDrawer();
  return true;
};

/* ---------- Fall-asleep slider ---------- */
// Reflect fallMinutes in the slider, its readout, and the filled part of the track.
function syncFallUI() {
  const slider = document.getElementById('fall-slider');
  slider.value = fallMinutes;
  slider.style.setProperty('--fill', `${(fallMinutes / Number(slider.max)) * 100}%`);
  document.getElementById('fall-value').textContent = fallMinutes;
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
  syncFallUI();
  document.querySelectorAll('#format-seg .seg-opt').forEach((b) =>
    b.classList.toggle('active', b.dataset.fmt === timeFormat)
  );
  document.getElementById('wake-input').value = DEFAULT_WAKE;
  document.getElementById('bed-input').value = DEFAULT_BED;
  refreshPickers();
  setPlanFrom('wake'); // also re-renders
}

/* ---------- Wire up ---------- */
function init() {
  applyTheme();

  // Init settings UI
  syncFallUI();
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
    syncFallUI();
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
    // Rebuild the desktop pickers so their hour column / AM-PM match the new format.
    refreshPickers();
    renderActive();
  });

  // Delete data / reset to defaults
  document.getElementById('delete-data-btn').addEventListener('click', deleteData);

  // Plan bedtime tab: "Wake up at" / "Go to bed at" switch
  document.getElementById('plan-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-opt');
    if (btn) setPlanFrom(btn.dataset.from);
  });

  // Both time inputs live in the plan bedtime tab
  const wakeInput = document.getElementById('wake-input');
  const bedInput = document.getElementById('bed-input');
  wakeInput.value = DEFAULT_WAKE;
  bedInput.value = DEFAULT_BED;
  wakeInput.addEventListener('input', renderBed);
  bedInput.addEventListener('input', renderBed);

  // Swap to the custom pickers on desktop (reads the values set just above)
  setupTimePickers();

  // First render + keep "sleep now" fresh every 30s
  renderActive();
  setInterval(() => {
    if (isWakePanelActive()) renderWake();
  }, 30000);
}

/* ---------- Custom desktop time picker ---------- */
// On desktop (precise pointer) the native <input type="time"> popup is an
// unstylable OS dropdown. We swap in a custom picker there and keep the native
// input on touch, where its OS wheel is genuinely better. The native input
// stays the single source of truth: the picker reads/writes its value and
// fires an 'input' event so the render functions run unchanged.
// Each time input on the page gets its own TimePicker instance.
const desktopMql = window.matchMedia('(hover: hover) and (pointer: fine)');
const MIN_STEP = 5; // minute granularity in the custom columns
const pickers = []; // every TimePicker on the page

const pad2 = (n) => String(n).padStart(2, '0');

class TimePicker {
  // `input` is the native time input this picker drives; `label` names the popup
  // for screen readers; `fallback` is used if the input is ever empty.
  constructor(input, label, fallback) {
    this.input = input;
    this.fallback = fallback;

    this.root = document.createElement('div');
    this.root.className = 'time-picker';
    this.root.hidden = true;
    this.root.innerHTML = `
      <button type="button" class="time-display" aria-haspopup="dialog" aria-expanded="false">
        <span class="time-display-text"></span>
        <svg class="time-display-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div class="time-pop" hidden role="dialog" aria-label="${label}">
        <div class="time-cols">
          <div class="time-col-wrap">
            <span class="time-col-label">Hour</span>
            <div class="time-col" data-col="hour" role="listbox" aria-label="Hour"></div>
          </div>
          <div class="time-col-wrap">
            <span class="time-col-label">Min</span>
            <div class="time-col" data-col="min" role="listbox" aria-label="Minute"></div>
          </div>
        </div>
        <div class="time-ampm" data-col="ampm" role="listbox" aria-label="AM or PM"></div>
      </div>
    `;
    input.after(this.root);

    const find = (sel) => this.root.querySelector(sel);
    this.display = find('.time-display');
    this.text = find('.time-display-text');
    this.pop = find('.time-pop');
    this.colHour = find('[data-col="hour"]');
    this.colMin = find('[data-col="min"]');
    this.colAmpm = find('[data-col="ampm"]');

    // Close when a click lands anywhere outside this picker.
    this.onOutside = (e) => { if (!this.root.contains(e.target)) this.close(); };
    this.display.addEventListener('click', () => (this.pop.hidden ? this.open() : this.close()));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  // Read the native input's value as { h, m } in 24-hour terms.
  getValue() {
    const [h, m] = (this.input.value || this.fallback).split(':').map(Number);
    return { h, m };
  }

  // Write back to the native input and notify the rest of the app.
  setValue(h, m) {
    this.input.value = `${pad2(h)}:${pad2(m)}`;
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.render();
  }

  // Build one clickable option button for a column.
  option(label, type, value) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'time-opt';
    b.textContent = label;
    b.dataset.value = value;
    b.setAttribute('role', 'option');
    b.addEventListener('click', () => this.pick(type, value));
    return b;
  }

  // (Re)build the option columns for the current 12/24-hour format.
  build() {
    const is12 = timeFormat === '12';
    this.colHour.innerHTML = '';
    this.colMin.innerHTML = '';
    this.colAmpm.innerHTML = '';

    const hours = is12
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : Array.from({ length: 24 }, (_, i) => i);
    hours.forEach((h) =>
      this.colHour.appendChild(this.option(is12 ? String(h) : pad2(h), 'hour', h))
    );

    for (let m = 0; m < 60; m += MIN_STEP) {
      this.colMin.appendChild(this.option(pad2(m), 'min', m));
    }

    this.colAmpm.hidden = !is12;
    if (is12) ['AM', 'PM'].forEach((p) => this.colAmpm.appendChild(this.option(p, 'ampm', p)));
  }

  // Apply a clicked option, converting 12-hour selections back to 24-hour.
  pick(type, value) {
    let { h, m } = this.getValue();
    if (type === 'min') {
      m = Number(value);
    } else if (type === 'hour') {
      const hr = Number(value);
      h = timeFormat === '12' ? (hr % 12) + (h >= 12 ? 12 : 0) : hr; // keep current AM/PM
    } else if (type === 'ampm') {
      const wantPm = value === 'PM';
      if (wantPm && h < 12) h += 12;
      else if (!wantPm && h >= 12) h -= 12;
    }
    this.setValue(h, m);
  }

  // Sync the display label + highlighted options to the current value.
  render() {
    const { h, m } = this.getValue();
    const d = new Date();
    d.setHours(h, m, 0, 0);
    this.text.innerHTML = timeHTML(d); // respects the 12/24-hour setting

    const highlight = (col, value) =>
      col.querySelectorAll('.time-opt').forEach((b) =>
        b.classList.toggle('selected', b.dataset.value === value)
      );
    highlight(this.colHour, String(timeFormat === '12' ? (h % 12 || 12) : h));
    highlight(this.colMin, String(m));
    highlight(this.colAmpm, h >= 12 ? 'PM' : 'AM');
  }

  // Center the selected hour/minute without scrolling the page.
  scrollSelected() {
    [this.colHour, this.colMin].forEach((col) => {
      const sel = col.querySelector('.time-opt.selected');
      if (sel) col.scrollTop = sel.offsetTop - (col.clientHeight - sel.clientHeight) / 2;
    });
  }

  // Open the popup, center the selection, and watch for outside clicks.
  open() {
    this.pop.hidden = false;
    this.display.classList.add('open');
    this.display.setAttribute('aria-expanded', 'true');
    this.scrollSelected();
    document.addEventListener('click', this.onOutside, true);
  }

  // Close the popup and detach the outside-click listener.
  close() {
    if (this.pop.hidden) return;
    this.pop.hidden = true;
    this.display.classList.remove('open');
    this.display.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', this.onOutside, true);
  }

  // Show the custom picker (desktop) or the native input (touch).
  activate(on) {
    if (on) {
      this.build();
      this.input.hidden = true;
      this.root.hidden = false;
      this.render();
    } else {
      this.input.hidden = false;
      this.root.hidden = true;
      this.close();
    }
  }
}

// Rebuild every picker (after the time format or the values change).
function refreshPickers() {
  if (!desktopMql.matches) return;
  pickers.forEach((p) => { p.build(); p.render(); });
}

function setupTimePickers() {
  pickers.push(
    new TimePicker(document.getElementById('wake-input'), 'Choose wake-up time', DEFAULT_WAKE),
    new TimePicker(document.getElementById('bed-input'), 'Choose bedtime', DEFAULT_BED)
  );
  const activateAll = (on) => pickers.forEach((p) => p.activate(on));
  activateAll(desktopMql.matches);
  // Adapt live if a hybrid device switches between mouse and touch.
  desktopMql.addEventListener('change', (e) => activateAll(e.matches));
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
    if (isLocalhost() || isAndroidApp()) {
      // Local dev (e.g. Live Server): never cache. Remove any worker left from a
      // previous session and clear its caches so edits always show on reload —
      // no more manually clearing site data.
      // The Android app serves every file from its own bundled copy, so a cache
      // there would only keep serving old files after an app update.
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

  // Already installed (as a PWA or the Android app): leave the row hidden.
  if (isStandalone() || isAndroidApp()) return;

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

/* ---------- Android APK download ---------- */
// Inside an APK the page is served from the WebView's asset host
// (same setup as Alek Weather), so the offer hides there.
function isAndroidApp() {
  return location.hostname === 'appassets.androidplatform.net';
}
// An Android phone or tablet in a browser. The APK is Android-only, so
// iPhones and desktops never see the offer.
function isAndroidWeb() {
  return !isAndroidApp() && /Android/i.test(navigator.userAgent);
}

function setupApk() {
  if (isAndroidWeb()) document.getElementById('apk-row').classList.remove('hidden');
}

// Boot the app once the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupPWA();
  setupApk();
});
