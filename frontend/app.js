import {
  etNowIso, windowLabel, statusLine, historyButtonLabel, rowStatus, hitFlags, bandGeometry, priceTicks, fmtPrice, fmtPct,
} from './lib.js';

// One entry per instrument; the page shows the first. A switcher appears once there are two.
const INSTRUMENTS = [{ symbol: 'XAUUSD', label: 'XAU/USD' }];
const ROWS_SHOWN = 24;
const API_LIMIT = 500;       // rows fetched for the track record (the API's maximum)
const REFRESH_MS = 60_000;   // re-check data and the status line while the tab stays open

const FEATURE_LABELS = {
  realized_power_observation: 'Realized movement, first 15 min',
  atr14_mean_observation: 'ATR(14), mean',
  otf_streak_observation: 'Directional streak',
  sjv_10_observation: 'Signed jump variation (10)',
  efficiency_ratio_10_observation: 'Efficiency ratio (10)',
  wtc_10_observation: 'Range-to-movement ratio (10)',
  center_of_mass_mean_observation: 'Movement centre of mass',
  atr_trend_observation: 'ATR rising, last 5 bars',
  day_of_week: 'Day of week (0 = Mon)',
};

const SVG = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const band = (low, high) => `${fmtPrice(low)} – ${fmtPrice(high)}`;
const num = (x, digits) => (x === null || x === undefined ? '–' : Number(x).toFixed(digits));

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// The signature element: the forecast's bands on a price axis around the last close
// Drawn at the container's real width so the 12px tick labels stay 12px on a phone
function forecastStrip(row) {
  const W = Math.round($('forecast-chart').clientWidth) || 600, H = 92;
  const g = bandGeometry(row, W);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Typical band ${band(row.typical_low, row.typical_high)}, wide band ${band(row.wide_low, row.wide_high)}, last close ${fmtPrice(row.last_close)}` });
  svg.append(
    svgEl('rect', { x: g.wide[0], y: 16, width: g.wide[1] - g.wide[0], height: 36, fill: 'var(--gold-pale)' }),
    svgEl('rect', { x: g.typical[0], y: 16, width: g.typical[1] - g.typical[0], height: 36, fill: 'var(--gold)' }),
    svgEl('rect', { x: g.close - 1, y: 8, width: 2, height: 52, fill: 'var(--text)' }),
  );
  svg.append(svgEl('rect', { x: 0, y: 66, width: W, height: 1, fill: 'var(--border)' }));
  for (const t of priceTicks(row.wide_low, row.wide_high)) {
    const x = g.x(t);
    svg.append(svgEl('rect', { x: x - 0.5, y: 66, width: 1, height: 5, fill: 'var(--control)' }));
    const label = svgEl('text', { x, y: 88, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--muted)' });
    label.textContent = fmtPrice(t).replace('.00', '');
    svg.append(label);
  }
  return svg;
}

// The same strip per table row, with the actual low-high drawn over it
function rowStrip(row) {
  const W = 168, H = 16;
  const g = bandGeometry(row, W);
  const svg = svgEl('svg', { class: 'row-strip', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  svg.append(
    svgEl('rect', { x: g.wide[0], y: 4, width: g.wide[1] - g.wide[0], height: 8, fill: 'var(--gold-pale)' }),
    svgEl('rect', { x: g.typical[0], y: 4, width: g.typical[1] - g.typical[0], height: 8, fill: 'var(--gold)' }),
  );
  if (g.actual) {
    const [a, b] = g.actual;
    svg.append(
      svgEl('rect', { x: a, y: 7, width: b - a, height: 2, fill: 'var(--text)' }),
      svgEl('rect', { x: a, y: 2, width: 2, height: 12, fill: 'var(--text)' }),
      svgEl('rect', { x: b - 2, y: 2, width: 2, height: 12, fill: 'var(--text)' }),
    );
  }
  return svg;
}

function renderForecast(row) {
  const { day, span } = windowLabel(row.window_start);
  $('forecast-window').textContent = `${day}, ${span}`;
  $('forecast-close').textContent = `Last close ${fmtPrice(row.last_close)}`;
  $('typical').textContent = band(row.typical_low, row.typical_high);
  $('wide').textContent = band(row.wide_low, row.wide_high);
  $('forecast-chart').replaceChildren(forecastStrip(row));
  $('forecast-status').textContent = statusLine(row.window_start, etNowIso(new Date()));
}

function renderSummary(s) {
  const cells = { 's-fit-typical': s.range_fit_typical, 's-fit-wide': s.range_fit_wide,
    's-inside-typical': s.inside_typical, 's-inside-wide': s.inside_wide };
  for (const [id, value] of Object.entries(cells)) {
    $(id).replaceChildren(fmtPct(value));
    if (s.n > 0) {
      const small = document.createElement('small');
      small.textContent = `of ${s.n}`;
      $(id).append(small);
    }
  }
  $('finding').textContent = s.n === 0
    ? 'No window has been scored yet: each forecast is checked against the market an hour after it is made.'
    : `The typical band held the hour's full range in ${fmtPct(s.range_fit_typical)} of ${s.n} scored windows, the wide band in ${fmtPct(s.range_fit_wide)}.`;
}

function detailsRow(row) {
  const features = JSON.parse(row.features);
  const items = [
    ['Last close', fmtPrice(row.last_close)],
    ['Predicted multiplier', num(row.predicted_multiplier, 2)],
    ['Predicted movement', num(row.predicted_power, 5)],
    ['Actual movement', num(row.actual_power, 5)],
    ...Object.entries(FEATURE_LABELS).filter(([key]) => key in features).map(([key, label]) => [label, num(features[key], 4)]),
  ];
  const tr = document.createElement('tr');
  tr.className = 'details';
  tr.hidden = true;
  const td = document.createElement('td');
  td.colSpan = 8;
  const dl = document.createElement('dl');
  for (const [label, value] of items) {
    const div = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    div.append(dt, dd);
    dl.append(div);
  }
  td.append(dl);
  tr.append(td);
  return tr;
}

function flagCell(a, b) {
  const td = document.createElement('td');
  td.className = 'flag';
  for (const [i, flag] of [a, b].entries()) {
    if (i) td.append(' / ');
    const span = document.createElement('span');
    span.textContent = flag ? 'yes' : 'no';
    if (!flag) span.className = 'miss';
    td.append(span);
  }
  return td;
}

function textCell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderTable(rows, limit) {
  const tbody = $('history');
  tbody.replaceChildren();
  rows.slice(0, limit).forEach((row, i) => {
    const status = rowStatus(row, i === 0);
    const f = hitFlags(row);
    const { day, span } = windowLabel(row.window_start);
    const tr = document.createElement('tr');
    tr.className = `row ${status}`;
    tr.tabIndex = 0;
    tr.setAttribute('aria-expanded', 'false');
    tr.append(
      textCell(`${day}, ${span}`),
      textCell(band(row.typical_low, row.typical_high), 'num'),
      textCell(band(row.wide_low, row.wide_high), 'num'),
    );
    if (status === 'scored') {
      tr.append(textCell(band(row.actual_low, row.actual_high), 'num'), textCell(fmtPrice(row.actual_range), 'num'),
        flagCell(f.fitTypical, f.fitWide), flagCell(f.insideTypical, f.insideWide));
    } else {
      tr.append(textCell(status === 'awaiting' ? 'awaiting outcome' : 'no data', 'num pending'),
        textCell('–', 'num pending'), textCell('–', 'flag pending'), textCell('–', 'flag pending'));
    }
    const stripTd = document.createElement('td');
    stripTd.className = 'strip-col';
    stripTd.append(rowStrip(row));
    tr.append(stripTd);

    const details = detailsRow(row);
    const toggle = () => {
      details.hidden = !details.hidden;
      tr.setAttribute('aria-expanded', String(!details.hidden));
    };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    tbody.append(tr, details);
  });

  const button = $('show-all');
  button.hidden = rows.length <= limit;
  button.textContent = historyButtonLabel(rows.length, API_LIMIT);
  button.onclick = () => { expanded = true; renderTable(rows, rows.length); };
}

function renderMessage(text) {
  $('forecast-window').textContent = text;
  for (const id of ['forecast-close', 'typical', 'wide', 'forecast-status']) $(id).textContent = '';
  $('history').replaceChildren();
  document.body.classList.add('no-data');
}

let latestRow = null;
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
  renderForecast(latestRow);
  renderSummary(summary);
  renderTable(rows, expanded ? rows.length : ROWS_SHOWN);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (latestRow) $('forecast-chart').replaceChildren(forecastStrip(latestRow)); }, 150);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
setInterval(refresh, REFRESH_MS);
refresh();
