// Hourly cron (XX:15 ET): wakes the Render backend, stores the new prediction in D1
// and fills in what actually happened in the previous hour's prediction window.

const FIRST_HOUR = 3;  // ET, first observation window stored
const LAST_HOUR = 15;  // ET, last observation window stored - its actuals arrive with the 16:15 run

// Cron runs in UTC, so the ET hour is checked here - keeps the schedule right across DST changes.
function etHour() {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
    .format(new Date());
  return Number(hour);
}

// One entry per forecast instrument; adding one = new entry here + its endpoint in the backend
const INSTRUMENTS = [
  { symbol: 'XAUUSD', path: '/predict/live' },
];

async function runInstrument(env, { symbol, path }, hour) {
  // Render free tier may be asleep - the first request waits ~1 min for it to boot
  const res = await fetch(`${env.BACKEND_URL}${path}`);
  if (!res.ok) {
    console.error(`${symbol}: backend error ${res.status}: ${await res.text()}`);
    return;
  }
  const p = await res.json();
  const prev = p.previous_window;

  const statements = [
    env.DB.prepare(
      `UPDATE predictions SET actual_high = ?, actual_low = ?, actual_range = ?, actual_power = ?
       WHERE symbol = ? AND window_start = ?`
    ).bind(prev.actual_high, prev.actual_low, prev.actual_range, prev.actual_power, symbol, prev.previous_window_start),
  ];

  if (hour <= LAST_HOUR) {
    statements.push(env.DB.prepare(
      `INSERT OR REPLACE INTO predictions
       (symbol, window_start, created_at, last_close, predicted_multiplier, predicted_power,
        typical_low, typical_high, wide_low, wide_high, features)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      symbol, p.window_start, new Date().toISOString(), p.last_close, p.predicted_volatility_multiplier, p.predicted_power,
      p.typical_low, p.typical_high, p.wide_low, p.wide_high, JSON.stringify(p.features)
    ));
  }

  await env.DB.batch(statements);
  console.log(`${symbol}: stored window ${p.window_start}, updated actuals for ${prev.previous_window_start}`);
}

async function run(env) {
  const hour = etHour();
  if (hour < FIRST_HOUR || hour > LAST_HOUR + 1) return;

  for (const instrument of INSTRUMENTS) {
    try {
      await runInstrument(env, instrument, hour);
    } catch (e) {
      console.error(`${instrument.symbol}: ${e}`); // one instrument failing must not stop the others
    }
  }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env));
  },

  // Read-only API for the frontend (static files in ../frontend are served before this handler)
  async fetch(request, env) {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol') || 'XAUUSD';
    const headers = { 'Access-Control-Allow-Origin': '*' };

    if (url.pathname === '/api/predictions') {
      const requested = parseInt(url.searchParams.get('limit'), 10);
      const limit = Number.isNaN(requested) ? 200 : Math.min(Math.max(requested, 1), 500);
      const { results } = await env.DB.prepare(
        'SELECT * FROM predictions WHERE symbol = ? ORDER BY window_start DESC LIMIT ?'
      ).bind(symbol, limit).all();
      return Response.json(results, { headers });
    }

    if (url.pathname === '/api/summary') {
      // Same hit definitions as frontend/lib.js hitFlags()
      const summary = await env.DB.prepare(
        `SELECT COUNT(*) AS n,
           AVG(CASE WHEN actual_range <= typical_high - typical_low THEN 1.0 ELSE 0.0 END) AS range_fit_typical,
           AVG(CASE WHEN actual_range <= wide_high - wide_low THEN 1.0 ELSE 0.0 END) AS range_fit_wide,
           AVG(CASE WHEN actual_high <= typical_high AND actual_low >= typical_low THEN 1.0 ELSE 0.0 END) AS inside_typical,
           AVG(CASE WHEN actual_high <= wide_high AND actual_low >= wide_low THEN 1.0 ELSE 0.0 END) AS inside_wide
         FROM predictions WHERE symbol = ? AND actual_range IS NOT NULL`
      ).bind(symbol).first();
      return Response.json(summary, { headers });
    }

    return Response.json({ error: 'not found' }, { status: 404, headers });
  },
};
