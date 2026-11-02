-- One row per instrument per hourly window. Prediction columns are written at XX:15 ET,
-- actual_* columns are filled in by the next hour's run (NULL until then, or if the window was incomplete).
CREATE TABLE IF NOT EXISTS predictions (
    symbol TEXT NOT NULL DEFAULT 'XAUUSD', -- instrument; the default matches migrations/0001
    window_start TEXT NOT NULL,         -- ET, naive ISO, start of the observation window (e.g. 2026-11-02T08:00:00)
    created_at TEXT NOT NULL,           -- UTC ISO, when the Worker stored the row
    last_close REAL NOT NULL,
    predicted_multiplier REAL NOT NULL,
    predicted_power REAL NOT NULL,
    typical_low REAL NOT NULL,
    typical_high REAL NOT NULL,
    wide_low REAL NOT NULL,
    wide_high REAL NOT NULL,
    features TEXT NOT NULL,             -- JSON of the observation features
    actual_high REAL,
    actual_low REAL,
    actual_range REAL,
    actual_power REAL,
    PRIMARY KEY (symbol, window_start)
);
