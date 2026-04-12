import requests
import hmac
import hashlib
from urllib.parse import urlencode
import logging

logger = logging.getLogger("app")

_TIMEOUT = 5

class BinanceClient:
    URL_BASE = "https://api.binance.com/api/v3"

    def __init__(self, api_key=None, api_secret=None):
        self.api_key = api_key
        self.api_secret = api_secret

    def sign(self, params):
        query_string = urlencode(params)
        signature = hmac.new(
            self.api_secret.encode('utf-8'),
            query_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        return signature

    def get_klines(self, symbol, interval, startTime=None, endTime=None, limit=None):
        params = {
            'symbol': symbol,
            'interval': interval,
            'startTime': startTime,
            'limit': limit
        }
        if endTime:
            params['endTime'] = endTime
        try:
            base_url = self.URL_BASE + '/klines'
            response = requests.get(base_url, params=params, headers={
                'X-MBX-APIKEY': self.api_key
            }, timeout=_TIMEOUT)
            response.raise_for_status()
            data = response.json()
            if data:
                return self._convert_db_to_api_format(data)
            else:
                return None
        except requests.exceptions.RequestException as e:
            logger.exception(e)
            return None

    def _convert_db_to_api_format(self, klines):
        api_klines = []
        for kline in klines:
            api_kline = {
                'timestamp': kline[0]/1000,
                'open_price': kline[1],
                'high_price': kline[2],
                'low_price': kline[3],
                'close_price': kline[4],
                'volume': kline[5],
                'turnover': kline[7],
                'trades_count': kline[8],
                'taker_buy_volume': kline[9],
                'taker_buy_quote_volume': kline[10]
            }
            api_klines.append(api_kline)
        return api_klines
