import datetime as dt
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv


def get_recent_bars(symbol: str, interval: str) -> pd.DataFrame:
    '''
    Fetches the last 100 candles for a symbol from the TwelveData API,
    with timestamps in ET (America/New_York).
    The API key is read from the TWELVEDATA_API_KEY env variable.

    Returns a DataFrame straight from the API, newest candle first,
    with columns: datetime, open, high, low, close (+ volume if the
    symbol has it). All values are STRINGS, e.g. '2026-11-06 08:05:00'
    and '3912.45000' - the feature functions below convert them.

    Raises RuntimeError if the request fails or TwelveData returns
    an error (wrong key, limit hit, unknown symbol...).
    '''
    load_dotenv()
    API_KEY = os.getenv('TWELVEDATA_API_KEY')

    response = requests.get('https://api.twelvedata.com/time_series', params={
        'symbol': symbol,
        'interval': interval,
        'outputsize': 500,
        'timezone': 'America/New_York',
        'apikey': API_KEY
    })

    if response.status_code != 200:
        raise RuntimeError(
            f'API Error: {response.status_code}: {response.text}')

    data = response.json()

    if data.get('status') == 'error':
        raise RuntimeError(f'Twelve Data API error: {data.get('message')}')

    data = pd.DataFrame(data['values'])
    return data


def otf_streak(highs: list[float], lows: list[float]) -> list[int]:
    '''
    Counts one-time-framing streaks - how many candles in a row made
    a higher low (going up) or a lower high (going down).
    An inside candle (higher low AND lower high) keeps the streak as is.

    Returns a list of ints, one per candle, same length as the input:
    positive = up streak (3 means 3rd higher low in a row),
    negative = down streak, 0 = no streak (an outside candle resets it).
    The first candle is always 0.
    '''
    otf_streaks = [0] * len(highs)
    for i in range(1, len(otf_streaks)):
        if (lows[i] > lows[i-1]) and (highs[i] < highs[i-1]):
            otf_streaks[i] = otf_streaks[i-1]
        elif lows[i] > lows[i-1]:
            otf_streaks[i] = (1 if otf_streaks[i-1] < 0
                              else otf_streaks[i-1] + 1)
        elif highs[i] < highs[i-1]:
            otf_streaks[i] = (-1 if otf_streaks[i-1] > 0
                              else otf_streaks[i-1] - 1)
    return otf_streaks


def center_of_mass(abs_returns_window: np.ndarray) -> float:
    '''
    Shows WHERE in the window the movement happened - at the start
    or at the end. Used inside rolling(10).apply(), so it gets
    a plain numpy array of absolute returns.

    Returns a float from -1 to 1:
    -1 = all the movement in the first candle, 1 = all in the last one,
    0 = spread evenly (or no movement at all).
    '''
    n = len(abs_returns_window)
    positions = np.arange(1, n + 1)
    total_weight = np.sum(abs_returns_window)
    if total_weight == 0:
        return 0.0
    raw_com = np.sum(positions * abs_returns_window) / total_weight
    center = (n + 1) / 2
    radius = (n - 1) / 2
    return (raw_com - center) / radius


def get_live_observation_features(data: pd.DataFrame) -> tuple[dict, float]:
    '''
    Receives OHLC candle data - here it's fetched from TwelveData API
    (get_recent_bars). Then it converts data and calculates relevant
    features for the current hour's observation window
    (XX:00-XX:15 ET, so the 3 M5 candles from XX:00, XX:05, XX:10).

    Model features (LinReg, updated 10.11.2026):
    log_power_obs, log_atr14_obs, center_of_mass_mean_observation,
    log_parkinson_obs, log_har_d, is_cpi, is_nfp, is_thursday

    Returns a tuple of 2 things:
    1. dict of calculated features - the model's 8 plus a few extra
       ones kept for the response (e.g. realized_power_observation,
       needed for predicted power). predict_volatility picks the
       model's columns by name, so extra keys don't matter.
    2. latest close as float, e.g. 3912.45 (as I need it for actual
       range predictions based on quantiles and range-per-point
       historical checks)

    Raises ValueError if there are no candles for the current hour yet
    (market closed, weekend, holiday) or no previous-day candles for
    log_har_d.
    '''
    data = data.sort_values('datetime').reset_index(drop=True)
    data['hour'] = pd.to_datetime(data['datetime']).dt.hour
    data['minute'] = pd.to_datetime(data['datetime']).dt.minute
    data['trade_date'] = pd.to_datetime(data['datetime']).dt.date

    # adjusted to ET timezone
    current_time = dt.datetime.now(ZoneInfo('America/New_York'))
    current_hour = current_time.hour
    current_minute = current_time.minute
    current_date = current_time.date()
    print(f'Current time: {current_time}, hour: {current_hour}, '
          f'minute: {current_minute}, date: {current_date}')

    # FEATURES CALC
    data['close'] = data['close'].astype('float')
    data['open'] = data['open'].astype('float')
    data['high'] = data['high'].astype('float')
    data['low'] = data['low'].astype('float')

    # realized_power
    data['ret_1bar'] = data['close'].pct_change()
    data['abs_ret_1bar'] = data['ret_1bar'].abs()

    # Parkinson volatility - uses the high-low swing inside the bar,
    # not only close-to-close
    data['parkinson_volatility'] = (np.log(data['high'] / data['low']) ** 2
                                    / (4 * np.log(2)))

    # atr14 (Wilder ATR, 14-period) - M5 file has no atr14 column,
    # built fresh here
    data['prev_close'] = data['close'].shift(1)
    data['tr'] = data[['high', 'low', 'prev_close']].apply(
        lambda row: max(row['high'] - row['low'],
                        abs(row['high'] - row['prev_close']),
                        abs(row['low'] - row['prev_close'])), axis=1)
    data['atr14'] = data['tr'].ewm(alpha=1/14, adjust=False).mean()

    # otf_streak - exact function from Week 9 Day 1, unchanged
    data['otf_streak'] = otf_streak(data['high'].tolist(),
                                    data['low'].tolist())

    # atr_trend (1 if atr rising over last 5 bars, else 0 - same def
    # as Week 8)
    data['atr_trend'] = (data['atr14'] - data['atr14'].shift(5) > 0
                         ).astype(int)

    # efficiency_ratio_10, sjv_10, center_of_mass, wtc_10 - same
    # window-10 defs as Week 8 Day 3
    data['net_displacement_10'] = data['ret_1bar'].rolling(10).sum().abs()
    data['realized_power_10'] = data['abs_ret_1bar'].rolling(10).sum()
    data['efficiency_ratio_10'] = (data['net_displacement_10']
                                   / data['realized_power_10'])

    data['sq_ret_pos_10'] = (
        data['ret_1bar'].where(data['ret_1bar'] > 0, 0) ** 2
    ).rolling(10).sum()
    data['sq_ret_neg_10'] = (
        data['ret_1bar'].where(data['ret_1bar'] < 0, 0) ** 2
    ).rolling(10).sum()
    data['sjv_10'] = ((data['sq_ret_pos_10'] - data['sq_ret_neg_10'])
                      / (data['sq_ret_pos_10'] + data['sq_ret_neg_10']))

    data['center_of_mass'] = data['abs_ret_1bar'].rolling(10).apply(
        center_of_mass, raw=True)

    data['wtc_10'] = (np.log(data['high'] / data['low']).rolling(10).sum()
                      / data['realized_power_10'])

    # OBSERVATION WINDOW
    prediction_window = data.loc[
        (data['hour'] == current_hour) &
        (data['trade_date'] == current_date) &
        (data['minute'].between(0, 10))
    ]

    prediction_window_agg = prediction_window.groupby('trade_date').agg(
        realized_power_observation=('abs_ret_1bar', 'sum'),
        atr14_mean_observation=('atr14', 'mean'),
        otf_streak_observation=('otf_streak', 'last'),
        sjv_10_observation=('sjv_10', 'mean'),
        efficiency_ratio_10_observation=('efficiency_ratio_10', 'mean'),
        wtc_10_observation=('wtc_10', 'mean'),
        center_of_mass_mean_observation=('center_of_mass', 'mean'),
        atr_trend_observation=('atr_trend', 'last'),
        parkinson_obs=('parkinson_volatility', 'sum')
    ).reset_index()

    if prediction_window.empty:
        raise ValueError(
            f'No bars in the observation window for {current_date} '
            f'{current_hour}:00-{current_hour}:10 ET (market closed?)')

    # logs - the linear model was trained on log features
    prediction_window_agg['log_power_obs'] = np.log(
        prediction_window_agg['realized_power_observation'])
    prediction_window_agg['log_atr14_obs'] = np.log(
        prediction_window_agg['atr14_mean_observation'])
    prediction_window_agg['log_parkinson_obs'] = np.log(
        prediction_window_agg['parkinson_obs'])

    # log_har_d - power of the same hour's XX:15-XX:59 window on the
    # previous trading day (on Monday that's Friday)
    prev_window = data.loc[
        (data['hour'] == current_hour) &
        (data['minute'] >= 15) &
        (data['trade_date'] < current_date)
    ]
    prev_date = prev_window['trade_date'].max()
    har_d_power = prev_window.loc[prev_window['trade_date'] == prev_date,
                                  'abs_ret_1bar'].sum()
    if har_d_power == 0:
        raise ValueError(
            f'No previous-day bars for {current_hour}:15-{current_hour}:59 '
            f'ET - cannot compute log_har_d')
    prediction_window_agg['log_har_d'] = np.log(har_d_power)

    # macro calendar flags - releases (and Thursday jobless claims) are
    # at 8:30 ET; the model learned their effect only for the 8:15-9:00
    # window (at other hours the effect is ~1.0x), so flags = 0 there
    news_releases = pd.read_csv(Path(__file__).parent / 'macro_releases.csv')
    news_releases['date'] = pd.to_datetime(news_releases['date'])
    nfp_dates = news_releases.loc[news_releases['event'] == 'NFP', 'date']
    cpi_dates = news_releases.loc[news_releases['event'] == 'CPI', 'date']
    fomc_dates = news_releases.loc[news_releases['event'] == 'FOMC', 'date']

    is_8am = int(current_hour == 8)
    trade_date = pd.to_datetime(prediction_window_agg['trade_date'])
    prediction_window_agg['day_of_week'] = trade_date.dt.day_of_week
    prediction_window_agg['is_nfp'] = trade_date.isin(nfp_dates).astype(int) * is_8am
    prediction_window_agg['is_cpi'] = trade_date.isin(cpi_dates).astype(int) * is_8am
    # FOMC: no dates in macro_releases.csv yet and not in the model -
    # always 0 for now
    prediction_window_agg['is_fomc'] = trade_date.isin(fomc_dates).astype(int)
    prediction_window_agg['is_thursday'] = (
        (prediction_window_agg['day_of_week'] == 3).astype(int) * is_8am)

    prediction_window_agg = prediction_window_agg.drop(columns='trade_date')
    return (prediction_window_agg.iloc[0].to_dict(),
            prediction_window['close'].iloc[-1])


def get_previous_window_actuals(data: pd.DataFrame) -> dict:
    '''
    What actually happened in the PREVIOUS hour's prediction window
    (XX:15-XX+1:00 ET, 9 M5 bars).
    The 500 fetched bars (~40h) already cover it, so no extra API call
    is needed. Used to pair each stored prediction with its realized
    outcome.

    Returns a dict like:
    {'previous_window_start': '2026-11-06T07:00:00',  (ET, the full hour)
     'actual_high': 3918.2, 'actual_low': 3905.6,
     'actual_range': 12.6,  (high - low, in price points)
     'actual_power': 0.0031}  (sum of absolute M5 returns)

    actual_* = None if the window is incomplete (e.g. first run
    of the day, market gap).
    '''
    data = data.sort_values('datetime').reset_index(drop=True)
    data['datetime'] = pd.to_datetime(data['datetime'])
    for col in ['open', 'high', 'low', 'close']:
        data[col] = data[col].astype('float')
    # same realized_power definition as the observation window
    data['abs_ret_1bar'] = data['close'].pct_change().abs()

    current_window_start = dt.datetime.now(
        ZoneInfo('America/New_York')).replace(
            minute=0, second=0, microsecond=0, tzinfo=None)
    previous_window_start = current_window_start - dt.timedelta(hours=1)

    window = data.loc[
        (data['datetime'] >= previous_window_start
         + dt.timedelta(minutes=15)) &
        (data['datetime'] < current_window_start)
    ]

    result = {'previous_window_start': previous_window_start.isoformat()}
    if len(window) != 9:
        result.update(actual_high=None, actual_low=None,
                      actual_range=None, actual_power=None)
        return result

    result.update(
        actual_high=float(window['high'].max()),
        actual_low=float(window['low'].min()),
        actual_range=float(window['high'].max() - window['low'].min()),
        actual_power=float(window['abs_ret_1bar'].sum()),
    )
    return result
