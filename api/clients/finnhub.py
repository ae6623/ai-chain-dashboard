import requests
import logging

logger = logging.getLogger("app")

class FinnhubClient:
    URL_BASE = "https://finnhub.io/api/v1"

    def __init__(self, api_key=None):
        self.api_key = api_key

    def get_forex_candles(self, symbol, resolution='1', from_timestamp=None, to_timestamp=None):
        params = {
            'symbol': symbol,
            'resolution': resolution
        }
        if from_timestamp:
            params['from'] = from_timestamp
        if to_timestamp:
            params['to'] = to_timestamp
        if self.api_key:
            params['token'] = self.api_key
        try:
            url = f'{self.URL_BASE}/forex/candle'
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            return data
        except requests.exceptions.RequestException as e:
            logger.exception(e)
            return None
