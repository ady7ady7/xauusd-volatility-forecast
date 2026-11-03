"""The backend answers only callers that send the shared key (the Cloudflare Worker), and publishes no docs.

Run from the repo root with the backend's dependencies installed:  python -m unittest tests/backend/test_api_auth.py
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
os.environ['API_KEY'] = 'test-key'

import api  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FEATURES = {'realized_power_observation': 0.002, 'atr14_mean_observation': 3.0, 'otf_streak_observation': 1,
            'sjv_10_observation': 0.1, 'efficiency_ratio_10_observation': 0.3, 'wtc_10_observation': 2.0,
            'center_of_mass_mean_observation': 0.0, 'atr_trend_observation': 1, 'day_of_week': 1}


class ApiAuthTest(unittest.TestCase):
    def setUp(self):
        patches = [mock.patch.object(api.pvm, 'load_model', return_value=object()),
                   mock.patch.object(api.pvm, 'predict_volatility', return_value=2.0)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(api.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def test_predict_without_key_is_refused(self):
        self.assertEqual(self.client.post('/predict', json=FEATURES).status_code, 401)

    def test_predict_with_wrong_key_is_refused(self):
        self.assertEqual(self.client.post('/predict', json=FEATURES, headers={'X-API-Key': 'nope'}).status_code, 401)

    def test_predict_live_without_key_is_refused(self):
        self.assertEqual(self.client.get('/predict/live').status_code, 401)

    def test_predict_with_key_is_answered(self):
        res = self.client.post('/predict', json=FEATURES, headers={'X-API-Key': 'test-key'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'predicted_volatility_multiplier': 2.0})

    def test_no_public_docs(self):
        for path in ('/docs', '/redoc', '/openapi.json'):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_health_check_needs_no_key_and_reveals_nothing(self):
        res = self.client.get('/health')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'status': 'ok'})

    def test_says_so_when_no_key_is_configured_on_the_server(self):
        with mock.patch.dict(os.environ, {'API_KEY': ''}):
            res = self.client.post('/predict', json=FEATURES, headers={'X-API-Key': ''})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json(), {'detail': 'API_KEY is not set on the server'})

    def test_whitespace_around_either_key_is_ignored(self):
        with mock.patch.dict(os.environ, {'API_KEY': ' test-key\n'}):
            res = self.client.post('/predict', json=FEATURES, headers={'X-API-Key': 'test-key '})
        self.assertEqual(res.status_code, 200)


if __name__ == '__main__':
    unittest.main()
