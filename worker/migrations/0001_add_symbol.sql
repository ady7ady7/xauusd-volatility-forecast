-- Adds the `symbol` column (multi-instrument support). Existing rows are all XAUUSD.
CREATE TABLE predictions_new (
    symbol TEXT NOT NULL DEFAULT 'XAUUSD', -- default keeps the previous Worker version writing until the new one is deployed
    window_start TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_close REAL NOT NULL,
    predicted_multiplier REAL NOT NULL,
    predicted_power REAL NOT NULL,
    typical_low REAL NOT NULL,
    typical_high REAL NOT NULL,
    wide_low REAL NOT NULL,
    wide_high REAL NOT NULL,
    features TEXT NOT NULL,
    actual_high REAL,
    actual_low REAL,
    actual_range REAL,
    actual_power REAL,
    PRIMARY KEY (symbol, window_start)
);

INSERT INTO predictions_new
SELECT 'XAUUSD', window_start, created_at, last_close, predicted_multiplier, predicted_power,
       typical_low, typical_high, wide_low, wide_high, features,
       actual_high, actual_low, actual_range, actual_power
FROM predictions;

DROP TABLE predictions;
ALTER TABLE predictions_new RENAME TO predictions;
