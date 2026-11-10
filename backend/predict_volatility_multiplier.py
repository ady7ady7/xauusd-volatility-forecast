import mlflow
import numpy as np
import pandas as pd
from pathlib import Path

#MODEL_PATH = Path(__file__).parent / 'mlruns/1/models/m-85c2422119fb4d26b4641c22614051bc/artifacts' #first RF model
MODEL_PATH = Path(__file__).parent / 'mlruns/1/models/m-8d6d224f1fbb4cd8bfbad287096e0b1b/artifacts' #new LinReg - 10.11.26

def load_model():
    return mlflow.sklearn.load_model(str(MODEL_PATH))

def predict_volatility(model, observation_features: dict) -> float:
    '''
    observation features:
    dict with the 9 feature names as keys (same order-independent, since we build a one row DF from it)
    
    '''
    row = pd.DataFrame([observation_features])[model.feature_names_in_]
    log_ratio = model.predict(row)[0]
    return float(np.exp(log_ratio))




def calibrate_range_bounds(predicted_power: float, last_close: float) -> tuple[float, float, float, float]:
    """
    predicted_power: power_obs * model's predicted multiplier (already computed)
    last_close: close of the most recent CLOSED bar in the observation window
    Returns four price levels per band - NOT a directional forecast, a symmetric
    width estimate around last_close (direction is never predicted).
    """
    #k_p75, k_p90 = 2079.53, 2961.72 #hardcoded 75th and 90th percentile of a range to power ratio 
    k_p75, k_p90 = 2138.6352561046688, 3063.5539822916144 #updated values as I've updated the model to LinReg
    
    
    range_points_p75 = predicted_power * k_p75
    range_points_p90 = predicted_power * k_p90
    
    typical_low = last_close - range_points_p75 / 2
    typical_high = last_close + range_points_p75 / 2

    wide_low = last_close - range_points_p90 / 2
    wide_high = last_close + range_points_p90 / 2
        
    return typical_low, typical_high, wide_low, wide_high

        
        
    
    
    