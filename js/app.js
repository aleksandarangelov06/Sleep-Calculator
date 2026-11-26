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
  weather: 'sleepcalc-weather',  // last forecast, so the card shows instantly and offline
  weatherOpen: 'sleepcalc-weather-open', // '1' when the forecast card is expanded
  weatherOn: 'sleepcalc-weather-on',     // '0' when the forecast is turned off
  weatherUnit: 'sleepcalc-weather-unit', // 'F' | 'C'; absent = automatic
  weatherCity: 'sleepcalc-weather-city', // chosen city as JSON; absent = automatic
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
  renderWeather();
}

/* ---------- Weather for the wake-up day (Sleep now tab) ---------- */
// Forecast from Open-Meteo. Location is either a city picked in Settings or,
// by default, found the way Alek Weather does it: precise location only if the
// browser has already granted it (this never prompts), otherwise BigDataCloud's
// IP lookup, which is city-level. Cached for an hour, so tab switches and the
// 30s refresh never refetch. Temperatures are fetched in °C and converted on
// display, so changing units never needs a refetch.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const LOCATE_URL = 'https://api-bdc.io/data/reverse-geocode-client?localityLanguage=en';
const WEATHER_FRESH_MS = 60 * 60 * 1000;           // refetch after an hour
const WEATHER_MAX_AGE_MS = 24 * 60 * 60 * 1000;    // older than this is never shown
const FAHRENHEIT_COUNTRIES = ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW'];

// WMO weather codes (what Open-Meteo returns) -> label and icon.
const WEATHER_CODES = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloud'], 45: ['Foggy', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'], 80: ['Light showers', 'rain'], 81: ['Showers', 'rain'],
  82: ['Heavy showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorms', 'storm'], 96: ['Strong thunderstorms', 'storm'], 99: ['Severe thunderstorms', 'storm'],
};

// Inner SVG for each icon (24x24, stroked).
const CLOUD_BASE = '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.24"/>';
const WEATHER_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  partly: '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41"/><path d="M15.95 12.65a4 4 0 0 0-5.93-4.13"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  fog: CLOUD_BASE + '<path d="M16 17H7M17 21H9"/>',
  rain: CLOUD_BASE + '<path d="M16 14v6M8 14v6M12 16v6"/>',
  snow: CLOUD_BASE + '<path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
  storm: '<path d="M6 16.33A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.97"/><path d="m13 12-3 5h4l-3 5"/>',
};

/* Weather settings (persisted) */
let weatherOn = localStorage.getItem(STORE.weatherOn) !== '0';   // on unless turned off
let weatherUnit = ['F', 'C'].includes(localStorage.getItem(STORE.weatherUnit))
  ? localStorage.getItem(STORE.weatherUnit)
  : 'auto';                                                      // 'auto' | 'F' | 'C'
let weatherCity = readSavedCity(); // { name, region, lat, lon, country }, or null for automatic

let weather = readCachedWeather(); // { at, key, place, country, daily (°C) } or null
let weatherLoading = false;

function readSavedCity() {
  try {
    const c = JSON.parse(localStorage.getItem(STORE.weatherCity));
    return c && typeof c.lat === 'number' && typeof c.lon === 'number' ? c : null;
  } catch {
    return null;
  }
}

// Identifies where a forecast is for, so a cached one is never shown for the wrong place.
function locationKey() {
  return weatherCity ? `${weatherCity.lat.toFixed(2)},${weatherCity.lon.toFixed(2)}` : 'auto';
}

function readCachedWeather() {
  try {
    const w = JSON.parse(localStorage.getItem(STORE.weather));
    return w && w.daily && w.key && Date.now() - w.at < WEATHER_MAX_AGE_MS ? w : null;
  } catch {
    return null;
  }
}

// The unit to display: the chosen one, or by country when set to automatic.
function tempUnit() {
  if (weatherUnit !== 'auto') return weatherUnit;
  const country = weatherCity ? weatherCity.country : weather && weather.country;
  return FAHRENHEIT_COUNTRIES.includes(country) ? 'F' : 'C';
}
const showTemp = (c) => `${Math.round(tempUnit() === 'F' ? c * 9 / 5 + 32 : c)}°`;

// fetch() that gives up after `ms` and treats a non-2xx reply as a failure.
function fetchJSON(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .finally(() => clearTimeout(timer));
}

// Where the device is, without ever showing a location prompt.
async function locate() {
  let query = '';
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    if (status?.state === 'granted') {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 30 * 60000, timeout: 8000 })
      );
      // City-level is plenty for a daily forecast, and sends less to third parties.
      query = `&latitude=${pos.coords.latitude.toFixed(2)}&longitude=${pos.coords.longitude.toFixed(2)}`;
    }
  } catch { /* no Permissions API (Android WebView) or no fix: fall back to IP */ }
  const d = await fetchJSON(LOCATE_URL + query);
  if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') throw new Error('No location');
  return {
    lat: d.latitude,
    lon: d.longitude,
    place: d.city || d.locality || d.principalSubdivision || '',
    country: d.countryCode || '',
  };
}

// Fetch a forecast unless the cached one is for this place and under an hour
// old. `force` refetches anyway (after the location changes).
async function loadWeather(force = false) {
  if (!weatherOn || weatherLoading) return;
  const key = locationKey();
  if (!force && weather && weather.key === key && Date.now() - weather.at < WEATHER_FRESH_MS) return;
  weatherLoading = true;
  try {
    const loc = weatherCity
      ? { lat: weatherCity.lat, lon: weatherCity.lon, place: weatherCity.name, country: weatherCity.country }
      : await locate();
    const params = new URLSearchParams({
      latitude: loc.lat.toFixed(2),
      longitude: loc.lon.toFixed(2),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise',
      timezone: 'auto',
      forecast_days: '3',
    });
    const f = await fetchJSON(`${FORECAST_URL}?${params}`);
    if (!f.daily || !Array.isArray(f.daily.time)) throw new Error('No forecast');
    // Ignore a reply for a place that was changed while it was on its way.
    if (key === locationKey()) {
      weather = { at: Date.now(), key, place: loc.place, country: loc.country, daily: f.daily };
      localStorage.setItem(STORE.weather, JSON.stringify(weather));
    }
  } catch {
    // Offline or blocked: keep showing the cached forecast, if there is one.
  } finally {
    weatherLoading = false;
  }
  // The place changed mid-fetch: fetch again for the new one.
  if (key !== locationKey()) {
    loadWeather(true);
    return;
  }
  if (isWakePanelActive()) renderWeather();
  renderWeatherSettings();
}

// Collapse the forecast to its one-line summary, or open the full card.
function setWeatherOpen(open) {
  document.getElementById('weather').classList.toggle('open', open);
  document.getElementById('weather-details').hidden = !open;
  document.getElementById('weather-toggle').setAttribute('aria-expanded', String(open));
}

// "YYYY-MM-DD" in local time, the format Open-Meteo's daily.time uses.
function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Fill the card with the forecast for the day of the recommended wake-up.
function renderWeather() {
  const card = document.getElementById('weather');
  const d = weatherOn && weather && weather.key === locationKey() && weather.daily;
  const wake = new Date(Date.now() + (fallMinutes + 5 * CYCLE_MIN) * 60000);
  const i = d ? d.time.indexOf(isoDate(wake)) : -1;
  if (i < 0 || d.temperature_2m_max[i] == null) {
    card.hidden = true;
    return;
  }

  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const day = isoDate(wake) === isoDate(today) ? 'Today'
    : isoDate(wake) === isoDate(tomorrow) ? 'Tomorrow'
      : wake.toLocaleDateString(undefined, { weekday: 'long' });
  document.getElementById('weather-day').textContent = day;
  document.getElementById('weather-place').textContent = weather.place;

  const [label, icon] = WEATHER_CODES[d.weather_code[i]] || ['Mixed conditions', 'cloud'];
  const hi = showTemp(d.temperature_2m_max[i]);
  const lo = showTemp(d.temperature_2m_min[i]);
  document.getElementById('weather-icon').innerHTML = WEATHER_ICONS[icon];
  document.getElementById('weather-line-icon').innerHTML = WEATHER_ICONS[icon];
  document.getElementById('weather-line').textContent = `${day}: ${label}, ${hi} / ${lo}`;
  document.getElementById('weather-desc').textContent = label;
  document.getElementById('weather-hi').textContent = `${hi}${tempUnit()}`;
  document.getElementById('weather-lo').textContent = lo;

  const rain = d.precipitation_probability_max && d.precipitation_probability_max[i];
  const rainEl = document.getElementById('weather-rain');
  rainEl.hidden = rain == null;
  rainEl.lastElementChild.textContent = `${rain}% chance of rain`;

  // Sunrise arrives as local "YYYY-MM-DDTHH:MM"; show it in the chosen 12/24-hour format.
  const sunEl = document.getElementById('weather-sunrise');
  const m = /T(\d{2}):(\d{2})/.exec((d.sunrise && d.sunrise[i]) || '');
  sunEl.hidden = !m;
  if (m) {
    const t = new Date();
    t.setHours(Number(m[1]), Number(m[2]), 0, 0);
    const { clock, period } = timeParts(t);
    sunEl.lastElementChild.textContent = `Sunrise ${clock}${period ? ` ${period}` : ''}`;
  }

  card.hidden = false;
}

/* ---------- Weather settings page ---------- */
// "Weather" row in Settings: its switch turns the forecast on or off, and the
// row itself opens a page for the location and temperature units.
let locationUi = weatherCity ? 'city' : 'auto'; // which location option is showing
let citySearchTimer = 0;
let citySearchSeq = 0; // drops replies to searches that have since been retyped

// Sync every weather control in Settings to the current state.
function renderWeatherSettings() {
  document.getElementById('weather-switch').checked = weatherOn;
  document.getElementById('weather-switch-page').checked = weatherOn;

  const where = weatherCity ? weatherCity.name : 'Automatic location';
  document.getElementById('weather-row-sub').textContent =
    weatherOn ? `${where} · °${tempUnit()}` : 'Off';

  // Everything below the switch is unavailable while the forecast is off.
  const options = document.getElementById('weather-options');
  options.inert = !weatherOn;
  options.classList.toggle('off', !weatherOn);

  document.querySelectorAll('#weather-loc-seg .seg-opt').forEach((b) =>
    b.classList.toggle('active', b.dataset.loc === locationUi)
  );
  document.getElementById('city-search').hidden = locationUi !== 'city';

  let status;
  if (locationUi === 'auto') {
    const place = weather && weather.key === 'auto' && weather.place;
    status = place
      ? `Using your approximate location: ${place}.`
      : 'Uses your approximate location, found from your internet connection.';
  } else {
    status = weatherCity
      ? `Showing the forecast for ${[weatherCity.name, weatherCity.region].filter(Boolean).join(', ')}.`
      : 'Search for the city to show the forecast for.';
  }
  // Only on a real change, so screen readers don't re-announce it on every sync.
  const statusEl = document.getElementById('weather-loc-status');
  if (statusEl.textContent !== status) statusEl.textContent = status;

  document.querySelectorAll('#weather-unit-seg .seg-opt').forEach((b) =>
    b.classList.toggle('active', b.dataset.unit === weatherUnit)
  );
}

function setWeatherOn(on) {
  weatherOn = on;
  localStorage.setItem(STORE.weatherOn, on ? '1' : '0');
  renderWeatherSettings();
  renderWeather();
  loadWeather(); // no-op when off, or when the cached forecast is still fresh
}

// Use a city picked from the search results, or null to go back to automatic.
function setWeatherCity(city) {
  weatherCity = city;
  if (city) localStorage.setItem(STORE.weatherCity, JSON.stringify(city));
  else localStorage.removeItem(STORE.weatherCity);
  locationUi = city ? 'city' : 'auto';
  renderWeatherSettings();
  renderWeather(); // hides the old place's forecast until the new one arrives
  loadWeather(true);
}

function cityMessage(text) {
  const p = document.createElement('p');
  p.className = 'city-msg';
  p.textContent = text;
  document.getElementById('city-results').replaceChildren(p);
}

// Look a city up with Open-Meteo's geocoder and list the matches.
async function searchCities(query) {
  const seq = ++citySearchSeq;
  cityMessage('Searching…');
  try {
    const params = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' });
    const d = await fetchJSON(`${GEOCODE_URL}?${params}`);
    if (seq !== citySearchSeq) return;
    const results = (d.results || []).filter((r) => typeof r.latitude === 'number');
    if (!results.length) {
      cityMessage('No cities found. Try another spelling.');
      return;
    }
    document.getElementById('city-results').replaceChildren(...results.map((r) => {
      const city = {
        name: r.name,
        region: [r.admin1, r.country].filter(Boolean).join(', '),
        lat: r.latitude,
        lon: r.longitude,
        country: r.country_code || '',
      };
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'city-opt';
      b.innerHTML = '<span class="city-name"></span><span class="city-region"></span>';
      b.firstChild.textContent = city.name;
      b.lastChild.textContent = city.region;
      b.addEventListener('click', () => {
        document.getElementById('city-input').value = '';
        document.getElementById('city-results').replaceChildren();
        setWeatherCity(city);
      });
      return b;
    }));
  } catch {
    if (seq === citySearchSeq) cityMessage('Couldn’t search right now. Check your connection.');
  }
}

function setupWeatherSettings() {
  renderWeatherSettings();

  document.getElementById('weather-page-btn').addEventListener('click', () => showSettingsPage('weather'));
  document.getElementById('weather-back').addEventListener('click', () => showSettingsPage('main'));
  ['weather-switch', 'weather-switch-page'].forEach((id) =>
    document.getElementById(id).addEventListener('change', (e) => setWeatherOn(e.target.checked))
  );

  // Location: Automatic / Choose a city
  document.getElementById('weather-loc-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-opt');
    if (!btn) return;
    if (btn.dataset.loc === 'auto') {
      if (weatherCity) {
        setWeatherCity(null);
      } else {
        locationUi = 'auto';
        renderWeatherSettings();
      }
    } else {
      locationUi = 'city';
      renderWeatherSettings();
      document.getElementById('city-input').focus();
    }
  });

  // City search, as you type (debounced so each keystroke isn't a request).
  const input = document.getElementById('city-input');
  input.addEventListener('input', () => {
    clearTimeout(citySearchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      citySearchSeq++; // drop any search still on its way
      document.getElementById('city-results').replaceChildren();
      return;
    }
    citySearchTimer = setTimeout(() => searchCities(q), 300);
  });
  // Enter picks the top match.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = document.querySelector('#city-results .city-opt');
    if (first) first.click();
  });

  // Temperature units: Automatic / °F / °C
  document.getElementById('weather-unit-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-opt');
    if (!btn) return;
    weatherUnit = btn.dataset.unit;
    if (weatherUnit === 'auto') localStorage.removeItem(STORE.weatherUnit);
    else localStorage.setItem(STORE.weatherUnit, weatherUnit);
    renderWeatherSettings();
    renderWeather();
  });
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
  const drawer = document.getElementById('drawer');
  drawer.classList.remove('open');
  document.getElementById('overlay').classList.add('hidden');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
  // Next time Settings opens on its main page, once the slide-out has finished.
  setTimeout(() => {
    if (!drawer.classList.contains('open')) showSettingsPage('main', false);
  }, 400);
}

// Settings has a main page and a Weather page; show one. `focus` moves the
// keyboard focus to the new page so keyboard and screen reader users follow.
function showSettingsPage(page, focus = true) {
  const main = document.getElementById('settings-main');
  const wx = document.getElementById('settings-weather');
  const toWeather = page === 'weather';
  if (wx.hidden === !toWeather) return; // already showing
  // Slides in from the right going deeper, from the left coming back.
  (toWeather ? wx : main).classList.toggle('back', !toWeather);
  main.hidden = toWeather;
  wx.hidden = !toWeather;
  document.getElementById('drawer').scrollTop = 0;
  if (focus) document.getElementById(toWeather ? 'weather-back' : 'weather-page-btn').focus();
}

// Back (Android button, or Escape): leave the Weather page first, then close
// Settings. Returns true when it handled the press; otherwise the app goes back as usual.
window.handleBack = () => {
  if (!document.getElementById('drawer').classList.contains('open')) return false;
  if (!document.getElementById('settings-weather').hidden) showSettingsPage('main');
  else closeDrawer();
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
  weather = null;      // the cached forecast was wiped with the rest
  weatherOn = true;
  weatherUnit = 'auto';
  weatherCity = null;
  locationUi = 'auto';
  setWeatherOpen(false);
  renderWeatherSettings();
  setPlanFrom('wake'); // also re-renders
  loadWeather();
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
  document.querySelectorAll('[data-close-settings]').forEach((b) =>
    b.addEventListener('click', closeDrawer)
  );
  document.getElementById('overlay').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.handleBack(); });
  setupWeatherSettings();

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

  // Tomorrow's weather: one line that opens into the full card, remembered
  // between visits. Fetch now, and again when the app comes back to the front
  // with a forecast more than an hour old.
  setWeatherOpen(localStorage.getItem(STORE.weatherOpen) === '1');
  document.getElementById('weather-toggle').addEventListener('click', () => {
    const open = !document.getElementById('weather').classList.contains('open');
    setWeatherOpen(open);
    localStorage.setItem(STORE.weatherOpen, open ? '1' : '0');
  });
  loadWeather();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadWeather();
  });
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

/* ---------- Android app: check for updates ---------- */
// APK-only self-updater, the same design as Alek Weather. All networking and
// the install happen natively (window.AndroidUpdate in MainActivity.kt); this
// is only the Settings row. Nothing runs until "Check for updates" is tapped.
// Native reports back with `sleepupdate` / `sleepupdateprogress` events.
function setupUpdater() {
  const bridge = window.AndroidUpdate;
  if (!isAndroidApp() || !bridge) return;

  const row = document.getElementById('update-row');
  const label = document.getElementById('update-label');
  const sub = document.getElementById('update-sub');
  const btn = document.getElementById('update-btn');
  const current = bridge.currentVersion();
  let offeredUrl = '';    // set once a check finds a newer release
  let offeredVersion = '';

  row.classList.remove('hidden');
  sub.textContent = current
    ? `You have version ${current}. Check GitHub for a newer one.`
    : 'Check GitHub for a newer version of the app.';

  // Show one step of the flow: checking, current, available, downloading, ...
  function show(phase, detail = {}) {
    label.textContent = offeredUrl ? `Version ${offeredVersion} available` : 'App updates';
    btn.textContent = offeredUrl ? 'Update' : 'Check for updates';
    btn.disabled = phase === 'checking' || phase === 'downloading';
    sub.textContent = {
      checking: 'Checking for updates…',
      current: `You’re on the latest version (${detail.current || current}).`,
      available: `You have version ${current}. Tap Update to download and install it.`,
      downloading: `Downloading… ${detail.pct || 0}%`,
      installing: 'Follow the prompt to finish installing.',
      permission: 'Allow installs from Sleep Calculator, then tap Update again.',
      error: offeredUrl
        ? 'The download didn’t finish. Tap Update to try again.'
        : 'Couldn’t check for updates. Try again later.',
    }[phase] || '';
  }

  btn.addEventListener('click', () => {
    if (offeredUrl) {
      show('downloading', { pct: 0 });
      bridge.install(offeredUrl);
    } else {
      show('checking');
      bridge.check();
    }
  });

  window.addEventListener('sleepupdate', (e) => {
    const d = e.detail || {};
    if (d.status === 'available') {
      offeredUrl = d.url;
      offeredVersion = d.latest;
    } else if (d.status === 'current') {
      offeredUrl = '';
    }
    // A failed download keeps offering the update rather than a fresh check.
    show(d.status, d);
  });
  window.addEventListener('sleepupdateprogress', (e) => {
    show('downloading', { pct: Number(e.detail) || 0 });
  });
}

// Boot the app once the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupPWA();
  setupApk();
  setupUpdater();
});
