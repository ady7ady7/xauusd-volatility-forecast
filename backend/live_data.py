from dotenv import load_dotenv
import os
import requests
import pandas as pd
import numpy as np

import datetime as dt
from zoneinfo import ZoneInfo
from typing import List, Tuple

def get_recent_bars(symbol: str, interval: str) -> pd.DataFrame:
    load_dotenv()
    API_KEY = os.getenv('TWELVEDATA_API_KEY')

    response = requests.get('https://api.twelvedata.com/time_series', params = {
        'symbol': symbol,
        'interval': interval,
        'outputsize': 100,
        'timezone': 'America/New_York',
        'apikey': API_KEY 
    })
    
    if response.status_code != 200:
        raise RuntimeError(f'API Error: {response.status_code}: {response.text}')

    data = response.json()

    if data.get('status') == 'error':
        raise RuntimeError(f'Twelve Data API error: {data.get('message')}')
    
    data = pd.DataFrame(data['values'])
    return data

def otf_streak(highs: List, lows: List) -> List:
    otf_streaks = [0] * len(highs)
    for i in range(1, len(otf_streaks)):
        if (lows[i] > lows[i-1]) and (highs[i] < highs[i-1]):
            otf_streaks[i] = otf_streaks[i-1]
        elif lows[i] > lows[i-1]:
            otf_streaks[i] = 1 if otf_streaks[i-1] < 0 else otf_streaks[i-1] + 1
        elif highs[i] < highs[i-1]:
            otf_streaks[i] = -1 if otf_streaks[i-1] > 0 else otf_streaks[i-1] - 1
    return otf_streaks

def center_of_mass(abs_returns_window):
    n = len(abs_returns_window)
    positions = np.arange(1, n + 1)
    total_weight = np.sum(abs_returns_window)
    if total_weight == 0:
        return 0.0
    raw_com = np.sum(positions * abs_returns_window) / total_weight
    center = (n + 1) / 2
    radius = (n - 1) / 2
    return (raw_com - center) / radius




def get_live_observation_features(data: pd.DataFrame) -> Tuple[dict, float]:
    '''
    Receives OHLC candle data - here it's fetched from TwelveData API
    Then it converts data and calculates relevant features.
    
    Returns a dict of calculated features ready for predictions
    + ALSO latest close (as I need it for actual range predictions based on quantiles and range-per-point historical checks)
    '''
    
    
    
    data = data.sort_values('datetime').reset_index(drop=True)
    data['hour'] = pd.to_datetime(data['datetime']).dt.hour
    data['minute'] = pd.to_datetime(data['datetime']).dt.minute
    data['trade_date'] = pd.to_datetime(data['datetime']).dt.date

    current_time = dt.datetime.now(ZoneInfo('America/New_York')) #adjusted to ET timezone
    current_hour = current_time.hour
    current_minute = current_time.minute
    current_date = current_time.date()
    print(f'Current time: {current_time}, hour: {current_hour}, minute: {current_minute}, date: {current_date}')



    ###FEATURES CALC
    data['close'] = data['close'].astype('float')
    data['open'] = data['open'].astype('float')
    data['high'] = data['high'].astype('float')
    data['low'] = data['low'].astype('float')

    # realized_power
    data['ret_1bar'] = data['close'].pct_change()
    data['abs_ret_1bar'] = data['ret_1bar'].abs()

    # atr14 (Wilder ATR, 14-period) - M5 file has no atr14 column, built fresh here
    data['prev_close'] = data['close'].shift(1)
    data['tr'] = data[['high', 'low', 'prev_close']].apply(
    lambda row: max(row['high'] - row['low'],
        abs(row['high'] - row['prev_close']),
        abs(row['low'] - row['prev_close'])), axis=1)
    data['atr14'] = data['tr'].ewm(alpha=1/14, adjust=False).mean()

    # otf_streak - exact function from Week 9 Day 1, unchanged
    data['otf_streak'] = otf_streak(data['high'].tolist(), data['low'].tolist())

    # atr_trend (1 if atr rising over last 5 bars, else 0 - same def as Week 8)
    data['atr_trend'] = (data['atr14'] - data['atr14'].shift(5) > 0).astype(int)

    # efficiency_ratio_10, sjv_10, center_of_mass, wtc_10 - same window-10 defs as Week 8 Day 3
    data['net_displacement_10'] = data['ret_1bar'].rolling(10).sum().abs()
    data['realized_power_10'] = data['abs_ret_1bar'].rolling(10).sum()
    data['efficiency_ratio_10'] = data['net_displacement_10'] / data['realized_power_10']

    data['sq_ret_pos_10'] = (data['ret_1bar'].where(data['ret_1bar'] > 0, 0) ** 2).rolling(10).sum()
    data['sq_ret_neg_10'] = (data['ret_1bar'].where(data['ret_1bar'] < 0, 0) ** 2).rolling(10).sum()
    data['sjv_10'] = (data['sq_ret_pos_10'] - data['sq_ret_neg_10']) / (data['sq_ret_pos_10'] + data['sq_ret_neg_10'])


    data['center_of_mass'] = data['abs_ret_1bar'].rolling(10).apply(center_of_mass, raw=True)

    data['wtc_10'] = np.log(data['high'] / data['low']).rolling(10).sum() / data['realized_power_10']

    ##########
    prediction_window = data.loc[
    (data['hour'] == current_hour) & 
    (data['trade_date'] == current_date) &
    (data['minute'].between(0, 10))
    ]


    prediction_window_agg = prediction_window.groupby('trade_date').agg(
    realized_power_observation = ('abs_ret_1bar', 'sum'),
    atr14_mean_observation = ('atr14', 'mean'),
    otf_streak_observation = ('otf_streak', 'last'),
    sjv_10_observation = ('sjv_10', 'mean'),
    efficiency_ratio_10_observation = ('efficiency_ratio_10', 'mean'),
    wtc_10_observation = ('wtc_10', 'mean'),
    center_of_mass_mean_observation = ('center_of_mass', 'mean'),
    atr_trend_observation = ('atr_trend', 'last')
    ).reset_index()


    prediction_window_agg['day_of_week'] = current_date.weekday()
    prediction_window_agg = prediction_window_agg.drop(columns = 'trade_date')
    return prediction_window_agg.iloc[0].to_dict(), prediction_window['close'].iloc[-1]

