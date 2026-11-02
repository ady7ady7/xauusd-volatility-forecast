// Pure helpers for the page - no DOM, no fetch (tested in tests/frontend/lib.test.mjs).
// Window timestamps from the API are naive ET strings ('2026-11-02T08:00:00'). All window math is done
// on those strings (parsed as if UTC), never through the browser's timezone, so a viewer in Warsaw
// or Tokyo sees the same ET labels.

const LAST_HOUR = 15; // ET, last observation window of the day - mirrors worker/src/index.js
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parseNaive = (iso) => new Date(iso + 'Z');
const toNaive = (date) => date.toISOString().slice(0, 19);
const addMinutes = (iso, minutes) => toNaive(new Date(parseNaive(iso).getTime() + minutes * 60_000));

export function etNowIso(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function windowLabel(windowStart) {
  const d = parseNaive(windowStart);
  const h = d.getUTCHours();
  return {
    day: `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
    span: `${h}:15–${h + 1}:00 ET`,
  };
}

// The forecast is "live" only during its own prediction window (XX:15 - XX+1:00 ET)
export function isLive(windowStart, nowEt) {
  return addMinutes(windowStart, 15) <= nowEt && nowEt < addMinutes(windowStart, 60);
}

export function nextUpdateLabel(windowStart) {
  const h = parseNaive(windowStart).getUTCHours();
  return h >= LAST_HOUR ? 'next trading day, 3:15 ET' : `${h + 1}:15 ET`;
}

const FIRST_HOUR = 3; // ET, first observation window of the day - mirrors worker/src/index.js

// The status line above the forecast. Between trading-hour runs (XX:00 - XX:15) it names the next forecast
// instead of calling the market closed; after 15:15, overnight and at weekends it says the window is over.
export function statusLine(windowStart, nowEt) {
  const made = `${parseNaive(windowStart).getUTCHours()}:15 ET`;
  if (isLive(windowStart, nowEt)) return `Updated ${made} · next update ${nextUpdateLabel(windowStart)}`;
  const now = parseNaive(nowEt);
  const weekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
  const nextHour = now.getUTCMinutes() < 15 ? now.getUTCHours() : now.getUTCHours() + 1;
  const { day } = windowLabel(windowStart);
  if (weekday && now.getUTCHours() >= FIRST_HOUR && nextHour <= LAST_HOUR) {
    return `Next forecast at ${nextHour}:15 ET · last forecast from ${day}, ${made}`;
  }
  return `Outside the forecast window — last forecast from ${day}, ${made}`;
}

export function historyButtonLabel(count, apiLimit) {
  return count < apiLimit ? `Show all ${count} windows` : `Show the latest ${apiLimit} windows`;
}

export function rowStatus(row, isNewest) {
  if (row.actual_range !== null) return 'scored';
  return isNewest ? 'awaiting' : 'no-data';
}

// Same definitions as /api/summary in worker/src/index.js
export function hitFlags(row) {
  if (row.actual_range === null) {
    return { fitTypical: null, fitWide: null, insideTypical: null, insideWide: null };
  }
  return {
    fitTypical: row.actual_range <= row.typical_high - row.typical_low,
    fitWide: row.actual_range <= row.wide_high - row.wide_low,
    insideTypical: row.actual_high <= row.typical_high && row.actual_low >= row.typical_low,
    insideWide: row.actual_high <= row.wide_high && row.actual_low >= row.wide_low,
  };
}

// x positions (0..width) for the band strip: wide band, typical band, last close, actual low-high.
// The scale covers the wide band and any actual range that broke out of it, with 8% air each side.
export function bandGeometry(row, width) {
  const hasActual = row.actual_range !== null;
  const lo = Math.min(row.wide_low, hasActual ? row.actual_low : Infinity);
  const hi = Math.max(row.wide_high, hasActual ? row.actual_high : -Infinity);
  const pad = (hi - lo) * 0.08;
  const x = (price) => ((price - (lo - pad)) / (hi - lo + 2 * pad)) * width;
  return {
    wide: [x(row.wide_low), x(row.wide_high)],
    typical: [x(row.typical_low), x(row.typical_high)],
    close: x((row.typical_low + row.typical_high) / 2), // bands are symmetric around the last close
    actual: hasActual ? [x(row.actual_low), x(row.actual_high)] : null,
    x,
  };
}

// Round price ticks inside [lo, hi]: the smallest step from the list that gives 5 ticks or fewer
export function priceTicks(lo, hi) {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) {
    const ticks = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
    if (ticks.length <= 5) return ticks;
  }
  return [];
}

export function fmtPrice(x) {
  if (x === null || x === undefined) return '–';
  return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(frac) {
  if (frac === null || frac === undefined) return '–';
  return `${Math.round(frac * 100)}%`;
}
