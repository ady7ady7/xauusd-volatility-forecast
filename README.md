# Range Prediction · XAU/USD

Every hour on weekdays this predicts how far gold will move in the next 45 minutes. Not which way, just how much. The forecast is a price range around the last close, shown live at
**https://xauusd-volatility-cron.adrianoovv2.workers.dev**

## How it works

- **The model** is a linear regression (a Random Forest until 10 Nov 2026). It looks at the first 15 minutes of an hour (three M5 bars) and predicts how much more or less the price will move from XX:15 to the full hour. It was trained on about 5.5 years of M5 gold data (2021–2026).
- **The backend** wraps the model in a FastAPI app, packed into Docker and running on Render. It pulls fresh bars from Twelve Data, builds the features and returns the forecast. Only the cron below has the key to call it.
- **A scheduled cron job** (a Cloudflare Worker) calls the backend at XX:15 ET, every hour from 3:15 to 15:15, Monday to Friday. It stores each forecast in a D1 database. An hour later it fills in what the price actually did.
- **The page** is served by the same Worker. It shows the latest forecast and the track record, meaning how often the real move landed inside the inner and outer bands.

## The model

The training procedure is shown in [model_training.ipynb](model_training.ipynb). The full data stays local, and [xauusd_m5_et_example.csv](xauusd_m5_et_example.csv) shows its format.

I started out trying to predict direction, which didn't work. Volatility turned out to be the predictable part. On the held-out test data, the current linear regression gets a MAE of 0.302 on the log ratio with an R² of 0.627. The first model, a Random Forest, got 0.35 and 0.49 (the predict-the-mean baseline was 0.49 MAE). It was trained on the 8:00 ET hour (the London/New York overlap). The other hours it runs on are out of its training range on purpose, to see how it holds up there.

## Collecting results

Every forecast is saved together with what really happened, so the project builds its own test set as it runs. I'll use it to check the model hour by hour and to improve this kind of model later.

## Current state

This is the first iteration. I may still change it, try other algorithms, and add other instruments. That's why the page is called Range Prediction and not "XAU/USD something".

## LLM Assistance

The model, the features, the range calibration and the original prediction pipeline are my own work. With Claude Code I built:

- the Cloudflare Worker (`worker/`): the cron, the D1 schema and migrations, and the read API (`/api/predictions`, `/api/summary`);
- the later backend additions: previous-window actuals in `/predict/live`, error handling, and the API key check;
- the whole public page (`frontend/`, `tests/frontend/`).
