import time
import json
import requests
import logging

logger = logging.getLogger("app")

_TIMEOUT = 5

class AllTickKlineClient:
    def __init__(self, token):
        self.token = token
        self.base_url_stock = "https://quote.alltick.io/quote-stock-b-api/kline"
        self.base_url_crypto = "https://quote.alltick.io/quote-b-api/kline"

    def is_stock_symbol(self, symbol):
        return any(symbol.endswith(suffix) for suffix in ['.HK', '.US', '.SS', '.SZ', '.SH'])

    def get_url_for_symbol(self, symbol):
        if self.is_stock_symbol(symbol):
            return self.base_url_stock
        else:
            return self.base_url_crypto

    def query_kline_data(self, code, kline_type, api_end_timestamp=None, kline_num=100):
        result = self.fetch_kline_data(code, kline_type, kline_num, api_end_timestamp)
        if not result:
            return []
        if not result.get('data', {}).get('kline_list'):
            logger.error(f"没有获取到数据: {code}-{kline_type}-{api_end_timestamp}-{kline_num}, {result}")
            return []
        return result['data']['kline_list']

    def fetch_kline_data(self, symbol, kline_type, num_records=1000, end_timestamp=0):
        url = self.get_url_for_symbol(symbol)
        data = {
            "trace": f"kline_fetch_{symbol}_{kline_type}_{int(time.time())}",
            "data": {
                "code": symbol,
                "kline_type": kline_type,
                "kline_timestamp_end": end_timestamp,
                "query_kline_num": min(num_records, 1000),
                "adjust_type": 0
            }
        }
        params = {
            "token": self.token,
            "query": json.dumps(data)
        }
        try:
            response = requests.get(
                url, params=params,
                headers={'Content-Type': 'application/json'},
                timeout=_TIMEOUT
            )
            response.raise_for_status()
            result = response.json()
            if not result.get('data') or not result.get('data').get('kline_list'):
                logger.error(f"API请求失败: {result}")
                return None
            return result
        except requests.exceptions.RequestException as e:
            logger.error(f"请求失败: {e}")
            return None
