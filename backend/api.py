from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import datetime as dt
import os
import secrets
from zoneinfo import ZoneInfo
import predict_volatility_multiplier as pvm
import live_data as live_data


model_store = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    model_store['model'] = pvm.load_model()#runs ONCE at server startup
    yield
    model_store.clear()  #$##runs once, at shutdown
    
def require_api_key(x_api_key: str = Header(default='')):
    #only the Cloudflare Worker knows API_KEY (Render env var); with no key configured nobody gets in
    expected = os.environ.get('API_KEY', '').strip() #strip: a space or newline pasted into a dashboard must not lock the Worker out
    if not expected:
        raise HTTPException(status_code=503, detail='API_KEY is not set on the server')
    if not secrets.compare_digest(x_api_key.strip(), expected):
        raise HTTPException(status_code=401, detail='missing or wrong API key')

#private API: no public docs, the prediction routes need the key
app = FastAPI(lifespan = lifespan, docs_url=None, redoc_url=None, openapi_url=None)

#observation features as class attributes
class ObservationFeatures(BaseModel):
    realized_power_observation: float
    atr14_mean_observation: float
    otf_streak_observation: int
    sjv_10_observation: float
    efficiency_ratio_10_observation: float
    wtc_10_observation: float
    center_of_mass_mean_observation: float
    atr_trend_observation: int
    day_of_week: int
    

@app.get('/health') #open, for Render's health check
def health() -> dict:
    return {'status': 'ok'}


@app.post('/predict', dependencies=[Depends(require_api_key)]) #/predict route for FastAPI
def predict(features: ObservationFeatures) -> dict:
    predicted_multiplier = pvm.predict_volatility(model_store['model'], features.model_dump())
    return {'predicted_volatility_multiplier': predicted_multiplier}


@app.get('/predict/live', dependencies=[Depends(require_api_key)])
def predict_live() -> dict:
    try:
        data = live_data.get_recent_bars(symbol='XAU/USD', interval='5min')
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) #upstream (Twelve Data) failure
    try:
        observation_data, latest_close = live_data.get_live_observation_features(data)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) #no observation bars, e.g. market closed

    predicted_multiplier = pvm.predict_volatility(model_store['model'], observation_data)
    predicted_power = observation_data['realized_power_observation'] * predicted_multiplier
    typical_low, typical_high, wide_low, wide_high = pvm.calibrate_range_bounds(predicted_power, latest_close)
    previous_window = live_data.get_previous_window_actuals(data)

    window_start = dt.datetime.now(ZoneInfo('America/New_York')).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    return {
        'window_start': window_start.isoformat(), #ET, start of the observation window
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