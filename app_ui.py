import streamlit as st
import requests

st.title('XAUUSD Volatility Multiplier Predictor')

realized_power = st.number_input('Realized power (observation window)', value=0.002, format='%.6f')
atr14 = st.number_input('ATR14 (mean, observation window)', value=3.0)
otf_streak = st.number_input('OTF streak (last value)', value=0, step=1)
sjv_10 = st.number_input('SJV-10 (mean)', value=0.0)
efficiency_ratio_10 = st.number_input('Efficiency ratio-10 (mean)', value=0.3)
wtc_10 = st.number_input('WTC-10 (mean)', value=2.0)
center_of_mass = st.number_input('Center of mass (mean)', value=0.0)
atr_trend = st.number_input('ATR trend (last value, 0 or 1)', value=0, step=1)
day_of_week = st.number_input('Day of week (0=Mon)', value=2, step=1)

if st.button('Predict'):
    payload = {
        'realized_power_observation': realized_power,
        'atr14_mean_observation': atr14,
        'otf_streak_observation': int(otf_streak),
        'sjv_10_observation': sjv_10,
        'efficiency_ratio_10_observation': efficiency_ratio_10,
        'wtc_10_observation': wtc_10,
        'center_of_mass_mean_observation': center_of_mass,
        'atr_trend_observation': int(atr_trend),
        'day_of_week': int(day_of_week),
    }
    
    
    response = requests.post('http://127.0.0.1:8000/predict', json=payload)
    if response.status_code == 200:
        st.success(f"Predicted multiplier: {response.json()['predicted_volatility_multiplier']:.3f}")
    else:
        st.error(f"Error {response.status_code}: {response.text}")