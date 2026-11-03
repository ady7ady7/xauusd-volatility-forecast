import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  etNowIso, windowLabel, isLive, nextUpdateLabel, rowStatus, hitFlags, fmtPrice, fmtPct,
} from '../../frontend/lib.js';

// Rows mirror worker/seed.sql (typical 100-110, wide 98-112)
const band = { typical_low: 100, typical_high: 110, wide_low: 98, wide_high: 112 };
const allInside = { ...band, window_start: '2026-11-02T08:00:00', actual_high: 108, actual_low: 101, actual_range: 7 };
const movedUp = { ...band, window_start: '2026-11-02T09:00:00', actual_high: 113, actual_low: 105, actual_range: 8 };
const tooWide = { ...band, window_start: '2026-11-02T10:00:00', actual_high: 109, actual_low: 97, actual_range: 12 };
const pending = { ...band, window_start: '2026-11-02T11:00:00', actual_high: null, actual_low: null, actual_range: null };

test('etNowIso converts an instant to naive ET (EST, UTC-5)', () => {
  assert.equal(etNowIso(new Date('2026-11-02T13:16:00Z')), '2026-11-02T08:16:00');
});

test('etNowIso handles EDT (UTC-4) before the DST change', () => {
  assert.equal(etNowIso(new Date('2026-10-30T12:15:00Z')), '2026-10-30T08:15:00');
});

test('windowLabel gives the ET date and the prediction span, without weekday or zone', () => {
  assert.deepEqual(windowLabel('2026-11-02T08:00:00'), { day: '2 Nov', span: '8:15–9:00' });
  assert.deepEqual(windowLabel('2026-11-02T15:00:00'), { day: '2 Nov', span: '15:15–16:00' });
});

test('isLive only during the prediction window of that forecast', () => {
  assert.equal(isLive('2026-11-02T08:00:00', '2026-11-02T08:20:00'), true);
  assert.equal(isLive('2026-11-02T08:00:00', '2026-11-02T08:15:00'), true);
  assert.equal(isLive('2026-11-02T08:00:00', '2026-11-02T08:10:00'), false);
  assert.equal(isLive('2026-11-02T08:00:00', '2026-11-02T09:00:00'), false);
  assert.equal(isLive('2026-11-06T15:00:00', '2026-11-07T15:20:00'), false); // Friday forecast, Saturday viewer
});

test('nextUpdateLabel is the next XX:15, or the next trading day after the 15:00 window', () => {
  assert.equal(nextUpdateLabel('2026-11-02T08:00:00'), '9:15 ET');
  assert.equal(nextUpdateLabel('2026-11-02T14:00:00'), '15:15 ET');
  assert.equal(nextUpdateLabel('2026-11-02T15:00:00'), 'next trading day, 3:15 ET');
});

test('rowStatus separates scored, awaiting (newest) and no-data (older) rows', () => {
  assert.equal(rowStatus(allInside, false), 'scored');
  assert.equal(rowStatus(pending, true), 'awaiting');
  assert.equal(rowStatus(pending, false), 'no-data');
});

test('hitFlags: range fit checks width, inside checks position', () => {
  assert.deepEqual(hitFlags(allInside), { fitTypical: true, fitWide: true, insideTypical: true, insideWide: true });
  assert.deepEqual(hitFlags(movedUp), { fitTypical: true, fitWide: true, insideTypical: false, insideWide: false });
  assert.deepEqual(hitFlags(tooWide), { fitTypical: false, fitWide: true, insideTypical: false, insideWide: false });
});

test('hitFlags returns nulls when the outcome is unknown', () => {
  assert.deepEqual(hitFlags(pending), { fitTypical: null, fitWide: null, insideTypical: null, insideWide: null });
});

test('fmtPrice uses 2 decimals and thousands separators', () => {
  assert.equal(fmtPrice(3958.2586), '3,958.26');
  assert.equal(fmtPrice(null), '–');
});

test('fmtPct gives whole percentages, dash for null', () => {
  assert.equal(fmtPct(2 / 3), '67%');
  assert.equal(fmtPct(1), '100%');
  assert.equal(fmtPct(null), '–');
});

import { bandGeometry, priceTicks } from '../../frontend/lib.js';

test('bandGeometry nests typical inside wide and centres the close on the bands', () => {
  const g = bandGeometry(allInside, 200);
  assert.ok(g.wide[0] < g.typical[0] && g.typical[1] < g.wide[1]);
  assert.ok(Math.abs(g.close - (g.typical[0] + g.typical[1]) / 2) < 1e-9);
  assert.ok(g.wide[0] > 0 && g.wide[1] < 200);
});

test('bandGeometry widens the scale to show an actual range that broke out', () => {
  const g = bandGeometry(movedUp, 200);
  assert.ok(g.actual[1] > g.wide[1]);     // high 113 above wide 112
  assert.ok(g.actual[1] <= 200 && g.actual[0] >= 0);
});

test('bandGeometry has no actual bar when the outcome is unknown', () => {
  assert.equal(bandGeometry(pending, 200).actual, null);
});

test('priceTicks gives round, evenly spaced ticks inside the range', () => {
  assert.deepEqual(priceTicks(3955.86, 3971.97), [3960, 3965, 3970]);
  assert.deepEqual(priceTicks(98, 112), [100, 105, 110]);
});

import { statusLine, historyButtonLabel } from '../../frontend/lib.js';

test('statusLine: live forecast shows when it was made and the next update', () => {
  assert.equal(statusLine('2026-11-02T08:00:00', '2026-11-02T08:20:00'), 'Updated 8:15 ET · next update 9:15 ET');
});

test('statusLine: between trading-hour runs it announces the next forecast, not a closed market', () => {
  assert.equal(statusLine('2026-11-02T08:00:00', '2026-11-02T09:05:00'), 'Next forecast at 9:15 ET · last forecast from 2 Nov, 8:15 ET');
  assert.equal(statusLine('2026-11-02T15:00:00', '2026-11-03T03:05:00'), 'Next forecast at 3:15 ET · last forecast from 2 Nov, 15:15 ET');
});

test('statusLine: after the last window, overnight and at weekends it says outside the window', () => {
  const out = 'Outside the forecast window — last forecast from 2 Nov, 15:15 ET';
  assert.equal(statusLine('2026-11-02T15:00:00', '2026-11-02T16:30:00'), out);
  assert.equal(statusLine('2026-11-02T15:00:00', '2026-11-03T02:30:00'), out);
  assert.equal(statusLine('2026-11-06T15:00:00', '2026-11-07T10:05:00'), 'Outside the forecast window — last forecast from 6 Nov, 15:15 ET');
});

test('historyButtonLabel says "all" only while the API returned every row', () => {
  assert.equal(historyButtonLabel(40, 500), 'Show all 40 windows');
  assert.equal(historyButtonLabel(500, 500), 'Show the latest 500 windows');
});

import { hitLevels, rulerTicks, rulerView } from '../../frontend/lib.js';

test('hitLevels names the tightest band that held: inner, outer or neither', () => {
  assert.deepEqual(hitLevels(allInside), { fit: 'inner', inside: 'inner' });
  assert.deepEqual(hitLevels(movedUp), { fit: 'inner', inside: 'neither' });
  assert.deepEqual(hitLevels(tooWide), { fit: 'outer', inside: 'neither' });
  const outerOnly = { ...band, actual_high: 111, actual_low: 99, actual_range: 12 };
  assert.deepEqual(hitLevels(outerOnly), { fit: 'outer', inside: 'outer' });
  const tooWideForBoth = { ...band, actual_high: 115, actual_low: 99, actual_range: 16 };
  assert.deepEqual(hitLevels(tooWideForBoth), { fit: 'neither', inside: 'neither' });
});

test('hitLevels is null while the outcome is unknown', () => {
  assert.deepEqual(hitLevels(pending), { fit: null, inside: null });
});

test('rulerTicks gives one tick per dollar with a major tick every 5', () => {
  const ticks = rulerTicks(98.4, 106.2);
  assert.deepEqual(ticks.map((t) => t.price), [99, 100, 101, 102, 103, 104, 105, 106]);
  assert.deepEqual(ticks.filter((t) => t.major).map((t) => t.price), [100, 105]);
});

test('rulerTicks coarsens the step so a wide span stays readable', () => {
  const ticks = rulerTicks(3900, 4100);
  assert.ok(ticks.length <= 60);
  assert.ok(ticks.every((t) => t.price % 5 === 0));
  assert.ok(ticks.filter((t) => t.major).every((t) => t.price % 25 === 0));
});

test('rulerView centres on the bands and leaves room past the outer band', () => {
  const v = rulerView(allInside, 2);
  assert.equal((v.lo + v.hi) / 2, 105);
  assert.equal(v.hi - v.lo, 28);           // outer width 14, zoom 2
});

test('rulerView widens to keep an actual range that broke out in view', () => {
  const v = rulerView({ ...band, actual_high: 130, actual_low: 101, actual_range: 29 }, 1.2);
  assert.ok(v.hi > 130 && v.lo < 101);
});
