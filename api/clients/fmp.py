import requests
import logging

logger = logging.getLogger("app")

class FMPClient:
    URL_BASE = "https://financialmodelingprep.com/stable"

    def __init__(self, api_key=None):
        self.api_key = api_key

    def get_klines(self, symbol, interval='1min', from_date=None, to_date=None, nonadjusted=False):
        params = {'symbol': symbol}
        if from_date:
            params['from'] = from_date
        if to_date:
            params['to'] = to_date
        if nonadjusted:
            params['nonadjusted'] = 'true'
        if self.api_key:
            params['apikey'] = self.api_key
        try:
            if interval == '1day':
                base_url = f'{self.URL_BASE}/historical-price-eod/full'
            else:
                base_url = f"{self.URL_BASE}/historical-chart/{interval}"
            response = requests.get(base_url, params=params)
            response.raise_for_status()
            data = response.json()
            return data
        except requests.exceptions.RequestException as e:
            logger.exception(e)
            return None
