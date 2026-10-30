from fastapi import FastAPI
from pydantic import BaseModel
from contextlib import asynccontextmanager
import predict_volatility_multiplier as pvm
import live_data as live_data


model_store = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    model_store['model'] = pvm.load_model()#runs ONCE at server startup
    yield
    model_store.clear()  #$##runs once, at shutdown
    
app = FastAPI(lifespan = lifespan)

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
    

@app.post('/predict') #/predict route for FastAPI
def predict(features: ObservationFeatures) -> dict:
    predicted_multiplier = pvm.predict_volatility(model_store['model'], features.model_dump())
    return {'predicted_volatility_multiplier': predicted_multiplier}


@app.get('/predict/live')
def predict_live() -> dict:
    data = live_data.get_recent_bars(symbol='XAU/USD', interval='5min')
    observation_data, latest_close = live_data.get_live_observation_features(data)
    predicted_multiplier = pvm.predict_volatility(model_store['model'], observation_data)
    predicted_power = observation_data['realized_power_observation'] * predicted_multiplier
    typical_low, typical_high, wide_low, wide_high = pvm.calibrate_range_bounds(predicted_power, latest_close)
    return {
        'predicted_volatility_multiplier': predicted_multiplier,
        'predicted_power': predicted_power,
        'typical_low': typical_low,
        'typical_high': typical_high,
        'wide_low': wide_low,
        'wide_high': wide_high
    }