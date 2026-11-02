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

async function run(env) {
  const hour = etHour();
  if (hour < FIRST_HOUR || hour > LAST_HOUR + 1) return;

  // Render free tier may be asleep - the first request waits ~1 min for it to boot
  const res = await fetch(`${env.BACKEND_URL}/predict/live`);
  if (!res.ok) {
    console.error(`Backend error ${res.status}: ${await res.text()}`);
    return;
  }
  const p = await res.json();
  const prev = p.previous_window;

  const statements = [
    env.DB.prepare(
      `UPDATE predictions SET actual_high = ?, actual_low = ?, actual_range = ?, actual_power = ?
       WHERE window_start = ?`
    ).bind(prev.actual_high, prev.actual_low, prev.actual_range, prev.actual_power, prev.previous_window_start),
  ];

  if (hour <= LAST_HOUR) {
    statements.push(env.DB.prepare(
      `INSERT OR REPLACE INTO predictions
       (window_start, created_at, last_close, predicted_multiplier, predicted_power,
        typical_low, typical_high, wide_low, wide_high, features)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      p.window_start, new Date().toISOString(), p.last_close, p.predicted_volatility_multiplier, p.predicted_power,
      p.typical_low, p.typical_high, p.wide_low, p.wide_high, JSON.stringify(p.features)
    ));
  }

  await env.DB.batch(statements);
  console.log(`Stored window ${p.window_start}, updated actuals for ${prev.previous_window_start}`);
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env));
  },

  // Read-only API for the frontend
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/predictions') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
      const { results } = await env.DB.prepare('SELECT * FROM predictions ORDER BY window_start DESC LIMIT ?')
        .bind(limit).all();
      return Response.json(results, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response('Not found', { status: 404 });
  },
};
