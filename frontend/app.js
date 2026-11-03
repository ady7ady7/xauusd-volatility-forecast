import {
  etNowIso, windowLabel, statusLine, historyButtonLabel, rowStatus, hitLevels, rulerView, rulerTicks, fmtPrice, fmtPct,
} from './lib.js';

// One entry per instrument; the page shows the first. A switcher appears once there are two.
const INSTRUMENTS = [{ symbol: 'XAUUSD', label: 'XAU/USD' }];
const ROWS_SHOWN = 24;
const API_LIMIT = 500;       // rows fetched for the track record (the API's maximum)
const REFRESH_MS = 60_000;   // re-check data and the status line while the tab stays open

const LEVEL_TEXT = { inner: 'inner', outer: 'outer', neither: 'neither' };

const SVG = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const band = (low, high) => `${fmtPrice(low)} – ${fmtPrice(high)}`;
const num = (x, digits) => (x === null || x === undefined ? '–' : Number(x).toFixed(digits));
const windowText = (row) => { const { day, span } = windowLabel(row.window_start); return `${day} ${span}`; };

function svgEl(tag, attrs, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// The motif: a price ruler with the two bands across it and the last close as a needle. Drawn at the
// container's real size; vertical (price rises upwards) or flat (price rises to the right).
function drawRuler(container, row, { zoom, actual = false, edgeLabels = false }) {
  const W = Math.round(container.clientWidth), H = Math.round(container.clientHeight);
  if (!W || !H) return;
  const flat = W > H;
  const len = flat ? W : H;
  const view = rulerView(actual ? row : { ...row, actual_range: null }, zoom);
  const pos = (price) => (flat ? ((price - view.lo) / (view.hi - view.lo)) * len : len - ((price - view.lo) / (view.hi - view.lo)) * len);
  // a band across the ruler between two prices
  const span = (lo, hi, cls) => {
    const [a, b] = [pos(lo), pos(hi)].sort((p, q) => p - q);
    return flat ? svgEl('rect', { class: cls, x: a, y: 0, width: b - a, height: H }) : svgEl('rect', { class: cls, x: 0, y: a, width: W, height: b - a });
  };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Inner band ${band(row.typical_low, row.typical_high)}, outer band ${band(row.wide_low, row.wide_high)}, last close ${fmtPrice(row.last_close)}` });
  svg.append(svgEl('rect', { class: 'r-body', x: 0, y: 0, width: W, height: H }),
    span(row.wide_low, row.wide_high, 'r-outer'), span(row.typical_low, row.typical_high, 'r-inner'));

  const major = Math.min(32, (flat ? H : W) * 0.24), minor = major / 2;
  const c = pos((row.typical_low + row.typical_high) / 2); // bands are symmetric around the last close
  for (const t of rulerTicks(view.lo, view.hi)) {
    const p = pos(t.price), l = t.major ? major : minor;
    svg.append(flat ? svgEl('rect', { class: 'r-tick', x: p - 1, y: 0, width: 2, height: l }) : svgEl('rect', { class: 'r-tick', x: 0, y: p - 1, width: l, height: 2 }));
    if (t.major && Math.abs(p - c) > 12) {
      const text = fmtPrice(t.price).replace('.00', '');
      svg.append(flat ? svgEl('text', { class: 'r-label', x: p, y: major + 18, 'text-anchor': 'middle' }, text)
        : svgEl('text', { class: 'r-label', x: major + 10, y: p + 4.5 }, text));
    }
  }

  svg.append(flat ? svgEl('rect', { class: 'r-needle', x: c - 1.5, y: 0, width: 3, height: H }) : svgEl('rect', { class: 'r-needle', x: 0, y: c - 1.5, width: W, height: 3 }));

  if (edgeLabels) {
    const at = flat ? null : major + 96;
    const label = (price, dy, text) => svg.append(flat
      ? svgEl('text', { class: 'r-label r-label-big', x: pos(price) + (dy > 0 ? -6 : 6), y: H - 16, 'text-anchor': dy > 0 ? 'end' : 'start' }, text)
      : svgEl('text', { class: 'r-label r-label-big', x: at, y: pos(price) + dy }, text));
    if (!flat) { // lying flat on a phone there is room for the close only; the figures sit just above
      label(row.typical_high, 22, `${fmtPrice(row.typical_high)} inner`);
      label(row.typical_low, -10, `${fmtPrice(row.typical_low)} inner`);
      label(row.wide_high, 22, `${fmtPrice(row.wide_high)} outer`);
      label(row.wide_low, -10, `${fmtPrice(row.wide_low)} outer`);
    }
    svg.append(flat ? svgEl('text', { class: 'r-label r-label-big', x: c + 8, y: major + 40 }, `${fmtPrice(row.last_close)} last close`)
      : svgEl('text', { class: 'r-label r-label-big', x: at, y: c - 10 }, `${fmtPrice(row.last_close)} last close`));
  }

  if (actual && row.actual_range !== null) {
    const [a, b] = [pos(row.actual_low), pos(row.actual_high)].sort((p, q) => p - q);
    const x = W - 30;
    svg.append(svgEl('rect', { class: 'r-actual', x: x + 3, y: a, width: 4, height: b - a }),
      svgEl('rect', { class: 'r-actual', x: x - 6, y: a - 1.5, width: 22, height: 3 }),
      svgEl('rect', { class: 'r-actual', x: x - 6, y: b - 1.5, width: 22, height: 3 }));
  }
  container.replaceChildren(svg);
}

function renderForecast(row) {
  const { day, span } = windowLabel(row.window_start);
  $('forecast-window').textContent = `${day}, ${span} ET`;
  $('inner').textContent = band(row.typical_low, row.typical_high);
  $('outer').textContent = band(row.wide_low, row.wide_high);
  $('forecast-close').textContent = `Last close ${fmtPrice(row.last_close)}`;
  $('forecast-status').textContent = statusLine(row.window_start, etNowIso(new Date()));
  drawRuler($('hero-ruler'), row, { zoom: 1.5, edgeLabels: true });
}

function renderSummary(s) {
  const cells = { 's-fit-inner': s.range_fit_typical, 's-fit-outer': s.range_fit_wide,
    's-inside-inner': s.inside_typical, 's-inside-outer': s.inside_wide };
  for (const [id, value] of Object.entries(cells)) {
    $(id).textContent = fmtPct(value);
  }
  $('finding').textContent = s.n === 0
    ? 'No hour has been scored yet: each forecast is checked against the market an hour after it is made.'
    : `The inner band held the hour's full range in ${fmtPct(s.range_fit_typical)} of ${s.n} scored hours, the outer band in ${fmtPct(s.range_fit_wide)}.`;
}

function dlOf(items) {
  const dl = document.createDocumentFragment();
  for (const [label, value] of items) {
    const div = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    div.append(dt, dd);
    dl.append(div);
  }
  return dl;
}

// The left-hand panel: the hour a visitor points at, on its own ruler with what gold really did
function showInPanel(row) {
  const levels = hitLevels(row);
  $('panel-window').textContent = `${windowText(row)} ET`;
  $('panel-figures').replaceChildren(dlOf([
    ['Inner band', band(row.typical_low, row.typical_high)],
    ['Outer band', band(row.wide_low, row.wide_high)],
    ['Actual low – high', row.actual_range === null ? 'awaiting outcome' : band(row.actual_low, row.actual_high)],
    ['Actual range', row.actual_range === null ? '–' : fmtPrice(row.actual_range)],
    ['Range fit', levels.fit ? LEVEL_TEXT[levels.fit] : '–'],
    ['Price inside', levels.inside ? LEVEL_TEXT[levels.inside] : '–'],
  ]));
  drawRuler($('panel-ruler'), row, { zoom: 1.3, actual: true });
  const panel = $('panel');
  panel.classList.remove('swap');
  void panel.offsetWidth; // restart the crossfade
  panel.classList.add('swap');
}

function detailsRow(row) {
  const tr = document.createElement('tr');
  tr.className = 'details';
  tr.hidden = true;
  const td = document.createElement('td');
  td.colSpan = 4;
  const dl = document.createElement('dl');
  dl.append(dlOf([
    ['Last close', fmtPrice(row.last_close)],
    ['Predicted multiplier', num(row.predicted_multiplier, 2)],
    ['Predicted movement', num(row.predicted_power, 5)],
    ['Actual movement', num(row.actual_power, 5)],
  ]));
  td.append(dl);
  tr.append(td);
  return tr;
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

let activeStart = null;

function setActive(tr, row) {
  if (activeStart === row.window_start) return;
  activeStart = row.window_start;
  for (const other of $('history').querySelectorAll('tr.row.active')) other.classList.remove('active');
  tr.classList.add('active');
  showInPanel(row);
}

function renderTable(rows, limit) {
  const tbody = $('history');
  tbody.replaceChildren();
  const shown = rows.slice(0, limit);
  if (!shown.some((r) => r.window_start === activeStart)) activeStart = null;
  const firstPick = (shown.find((r) => r.actual_range !== null) ?? shown[0]).window_start;
  shown.forEach((row, i) => {
    const status = rowStatus(row, i === 0);
    const levels = hitLevels(row);
    const tr = document.createElement('tr');
    tr.className = `row ${status}`;
    tr.tabIndex = 0;
    tr.setAttribute('aria-expanded', 'false');
    tr.append(cell(windowText(row)));
    if (status === 'scored') {
      tr.append(cell(fmtPrice(row.actual_range), 'num range-cell'),
        cell(LEVEL_TEXT[levels.fit], `lvl-${levels.fit}`), cell(LEVEL_TEXT[levels.inside], `lvl-${levels.inside}`));
    } else {
      tr.append(cell('–', 'num range-cell'), cell(status === 'awaiting' ? 'awaiting' : 'no data'), cell('–'));
    }
    const details = detailsRow(row);
    const toggle = () => {
      details.hidden = !details.hidden;
      tr.setAttribute('aria-expanded', String(!details.hidden));
    };
    tr.addEventListener('pointerenter', () => setActive(tr, row));
    tr.addEventListener('focus', () => setActive(tr, row));
    tr.addEventListener('click', () => { setActive(tr, row); toggle(); });
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    tbody.append(tr, details);
    if (row.window_start === activeStart || (activeStart === null && row.window_start === firstPick)) {
      activeStart = null;
      setActive(tr, row);
    }
  });

  const button = $('show-all');
  button.hidden = rows.length <= limit;
  button.textContent = historyButtonLabel(rows.length, API_LIMIT);
  button.onclick = () => { expanded = true; renderTable(rows, rows.length); };
}

function renderMessage(text) {
  $('forecast-window').textContent = text;
  for (const id of ['inner', 'outer', 'forecast-close', 'forecast-status', 'panel-window']) $(id).textContent = '';
  $('history').replaceChildren();
  document.body.classList.add('no-data');
}

function buildFooterRuler() {
  const el = $('footer-ruler');
  const count = el.clientWidth < 600 ? 31 : 51;
  el.replaceChildren(...Array.from({ length: count }, (_, i) => {
    const span = document.createElement('span');
    const kind = i % 10 === 0 ? 'major' : i % 5 === 0 ? 'mid' : 'minor';
    span.className = kind;
    span.style.height = kind === 'major' ? '100%' : kind === 'mid' ? '78%' : '58%';
    span.style.animationDelay = `${i * 14}ms`;
    return span;
  }));
}

// Each part of a section rises in once, 80ms after the one before it
function watchReveals() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { threshold: 0.15 });
  for (const section of document.querySelectorAll('section, .ingots, .footer')) {
    section.querySelectorAll('[data-reveal]').forEach((el, i) => { el.style.transitionDelay = `${i * 80}ms`; io.observe(el); });
  }
  io.observe(document.querySelector('.ingots'));
  io.observe($('footer-ruler'));
}

let latestRow = null;
let latestRows = [];
let expanded = false; // keep "Show all" open across refreshes

async function refresh() {
  const { symbol } = INSTRUMENTS[0];
  let rows, summary;
  try {
    [rows, summary] = await Promise.all([
      getJson(`/api/predictions?symbol=${symbol}&limit=${API_LIMIT}`),
      getJson(`/api/summary?symbol=${symbol}`),
    ]);
  } catch (e) {
    console.error(e);
    if (!latestRow) renderMessage('Data temporarily unavailable.'); // a failed refresh keeps the data already shown
    return;
  }
  if (rows.length === 0) {
    renderMessage('First forecast arrives at 3:15 ET on the next trading day.');
    return;
  }
  document.body.classList.remove('no-data');
  latestRow = rows[0];
  latestRows = rows;
  renderForecast(latestRow);
  renderSummary(summary);
  renderTable(rows, expanded ? rows.length : ROWS_SHOWN);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!latestRow) return;
    drawRuler($('hero-ruler'), latestRow, { zoom: 1.5, edgeLabels: true });
    const active = latestRows.find((r) => r.window_start === activeStart);
    if (active) drawRuler($('panel-ruler'), active, { zoom: 1.3, actual: true });
  }, 150);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
buildFooterRuler();
watchReveals();
setInterval(refresh, REFRESH_MS);
refresh();
