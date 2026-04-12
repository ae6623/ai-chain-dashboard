import requests

_TIMEOUT = 5

class PolygonClient:
    URL_BASE = 'https://api.polygon.io'

    def __init__(self, api_key: str):
        self.api_key = api_key

    def get_klines(
        self, symbol: str, multiplier: int, timespan: str,
        from_time: int, to_time: int,
        sort: str = 'asc', limit: int = 120
    ):
        url = f'{self.URL_BASE}/v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from_time}/{to_time}'
        params = {
            'sort': sort,
            'limit': limit,
            'apikey': self.api_key
        }
        results = []
        while True:
            response = requests.get(url, params=params, timeout=_TIMEOUT)
            data = response.json()
            if data.get('status') == 'OK':
                results.extend(data.get('results', []))
                if len(results) >= limit:
                    break
                if data.get('next_url'):
                    url = data.get('next_url') + '&apikey=' + self.api_key
                    params = {}
                else:
                    break
            else:
                break
        return results
