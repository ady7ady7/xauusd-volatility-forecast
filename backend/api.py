import datetime as dt
import os
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

import live_data as live_data
import predict_volatility_multiplier as pvm


model_store = {}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    '''
    Loads the model ONCE at server startup and keeps it in model_store,
    so a request doesn't have to load it again. Clears it at shutdown.
    '''
    model_store['model'] = pvm.load_model()  # runs ONCE at server startup
    yield
    model_store.clear()  # runs once, at shutdown


def require_api_key(x_api_key: str = Header(default='')) -> None:
    '''
    Checks the X-API-Key header against BACKEND_KEY (Render env var,
    same name and value as the Worker secret) - only the Cloudflare
    Worker knows it. With no key configured nobody gets in.

    Returns nothing if the key is fine, otherwise raises:
    503 if BACKEND_KEY is not set on the server,
    401 if the header is missing or wrong.
    '''
    # strip: a space or newline pasted into a dashboard must not lock
    # the Worker out
    expected = os.environ.get('BACKEND_KEY', '').strip()
    if not expected:
        raise HTTPException(status_code=503,
                            detail='BACKEND_KEY is not set on the server')
    if not secrets.compare_digest(x_api_key.strip(), expected):
        raise HTTPException(status_code=401,
                            detail='missing or wrong API key')


# private API: no public docs, the prediction routes need the key
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None,
              openapi_url=None)


class ObservationFeatures(BaseModel):
    '''Observation features (as class attributes) the model expects.'''
    realized_power_observation: float
    atr14_mean_observation: float
    otf_streak_observation: int
    sjv_10_observation: float
    efficiency_ratio_10_observation: float
    wtc_10_observation: float
    center_of_mass_mean_observation: float
    atr_trend_observation: int
    day_of_week: int


@app.get('/health')  # open, for Render's health check
def health() -> dict:
    '''
    Open route (no key) for Render's health check.

    Returns {'status': 'ok'} and nothing else.
    '''
    return {'status': 'ok'}


@app.post('/predict', dependencies=[Depends(require_api_key)])
def predict(features: ObservationFeatures) -> dict:
    '''
    Predicts from features sent in the request body, instead of
    fetching live data - handy for testing the model by hand.

    Returns {'predicted_volatility_multiplier': 1.37} - how many times
    more (>1) or less (<1) the price should move in the prediction
    window than it did in the observation window.
    '''
    predicted_multiplier = pvm.predict_volatility(model_store['model'],
                                                  features.model_dump())
    return {'predicted_volatility_multiplier': predicted_multiplier}


@app.get('/predict/live', dependencies=[Depends(require_api_key)])
def predict_live() -> dict:
    '''
    The main route, called by the Cloudflare Worker cron at XX:15 ET.
    Fetches fresh candles from TwelveData, calculates features for this
    hour's observation window (XX:00-XX:15), predicts and turns the
    prediction into price ranges around the last close.
    Also sends back what really happened in the previous hour's window.

    Returns a dict like:
    {'window_start': '2026-11-06T08:00:00',  (ET, start of observation)
     'last_close': 3912.45,
     'predicted_volatility_multiplier': 1.37,
     'predicted_power': 0.0016,  (observation power * multiplier)
     'typical_low': 3906.1, 'typical_high': 3918.8,  (inner band)
     'wide_low': 3899.7, 'wide_high': 3925.2,  (outer band)
     'features': {...},  (the features dict, all values as floats)
     'previous_window': {...}}  (see get_previous_window_actuals)

    Raises 502 if TwelveData fails, 503 if there are no candles for
    this hour yet (market closed).
    '''
    try:
        data = live_data.get_recent_bars(symbol='XAU/USD', interval='5min')
    except RuntimeError as e:
        # upstream (Twelve Data) failure
        raise HTTPException(status_code=502, detail=str(e))
    try:
        observation_data, latest_close = (
            live_data.get_live_observation_features(data))
    except ValueError as e:
        # no observation bars, e.g. market closed
        raise HTTPException(status_code=503, detail=str(e))

    predicted_multiplier = pvm.predict_volatility(model_store['model'],
                                                  observation_data)
    predicted_power = (observation_data['realized_power_observation']
                       * predicted_multiplier)
    typical_low, typical_high, wide_low, wide_high = (
        pvm.calibrate_range_bounds(predicted_power, latest_close))
    previous_window = live_data.get_previous_window_actuals(data)

    window_start = dt.datetime.now(ZoneInfo('America/New_York')).replace(
        minute=0, second=0, microsecond=0, tzinfo=None)
    return {
        'window_start': window_start.isoformat(),  # ET, start of the
                                                   # observation window
        'last_close': float(latest_close),
        'predicted_volatility_multiplier': predicted_multiplier,
        'predicted_power': float(predicted_power),
        'typical_low': float(typical_low),
        'typical_high': float(typical_high),
        'wide_low': float(wide_low),
        'wide_high': float(wide_high),
        'features': {k: float(v) for k, v in observation_data.items()},
        'previous_window': previous_window
    }
