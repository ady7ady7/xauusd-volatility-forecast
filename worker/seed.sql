-- Local dev data only (npx wrangler d1 execute xauusd-predictions --local --file seed.sql).
-- All bands: typical 100-110, wide 98-112. Expected hit flags per row in comments.
INSERT OR REPLACE INTO predictions
(symbol, window_start, created_at, last_close, predicted_multiplier, predicted_power,
 typical_low, typical_high, wide_low, wide_high, features, actual_high, actual_low, actual_range, actual_power)
VALUES
-- range fit T+ W+, inside T+ W+
('XAUUSD', '2026-11-02T08:00:00', '2026-11-02T13:15:30Z', 105, 3.1, 0.0048, 100, 110, 98, 112,
 '{"realized_power_observation":0.00155,"atr14_mean_observation":3.4,"otf_streak_observation":2,"sjv_10_observation":0.21,"efficiency_ratio_10_observation":0.33,"wtc_10_observation":1.9,"center_of_mass_mean_observation":-0.05,"atr_trend_observation":1,"day_of_week":0}',
 108, 101, 7, 0.0041),
-- range fit T+ W+, inside T- W- (moved up out of the symmetric band)
('XAUUSD', '2026-11-02T09:00:00', '2026-11-02T14:15:30Z', 105, 2.8, 0.0045, 100, 110, 98, 112,
 '{"realized_power_observation":0.00161,"atr14_mean_observation":3.5,"otf_streak_observation":3,"sjv_10_observation":0.44,"efficiency_ratio_10_observation":0.51,"wtc_10_observation":1.7,"center_of_mass_mean_observation":0.12,"atr_trend_observation":1,"day_of_week":0}',
 113, 105, 8, 0.0052),
-- range fit T- W+, inside T- W-
('XAUUSD', '2026-11-02T10:00:00', '2026-11-02T15:15:30Z', 105, 2.5, 0.0040, 100, 110, 98, 112,
 '{"realized_power_observation":0.00160,"atr14_mean_observation":3.6,"otf_streak_observation":-1,"sjv_10_observation":-0.30,"efficiency_ratio_10_observation":0.22,"wtc_10_observation":2.1,"center_of_mass_mean_observation":-0.20,"atr_trend_observation":0,"day_of_week":0}',
 109, 97, 12, 0.0071),
-- older row without actuals (incomplete window) -> "no data"
('XAUUSD', '2026-11-02T11:00:00', '2026-11-02T16:15:30Z', 105, 2.9, 0.0043, 100, 110, 98, 112,
 '{"realized_power_observation":0.00148,"atr14_mean_observation":3.3,"otf_streak_observation":0,"sjv_10_observation":0.05,"efficiency_ratio_10_observation":0.40,"wtc_10_observation":1.8,"center_of_mass_mean_observation":0.01,"atr_trend_observation":0,"day_of_week":0}',
 NULL, NULL, NULL, NULL),
-- newest row -> "awaiting outcome"
('XAUUSD', '2026-11-02T12:00:00', '2026-11-02T17:15:30Z', 105, 3.0, 0.0046, 100, 110, 98, 112,
 '{"realized_power_observation":0.00153,"atr14_mean_observation":3.4,"otf_streak_observation":1,"sjv_10_observation":0.10,"efficiency_ratio_10_observation":0.36,"wtc_10_observation":1.9,"center_of_mass_mean_observation":0.03,"atr_trend_observation":1,"day_of_week":0}',
 NULL, NULL, NULL, NULL),
-- other instrument, must not affect XAUUSD results
('TEST', '2026-11-02T08:00:00', '2026-11-02T13:15:30Z', 50, 2.0, 0.0030, 45, 55, 40, 60, '{}', 70, 30, 40, 0.0100);
