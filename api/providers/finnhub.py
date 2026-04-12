import logging
from typing import Dict, Any, Optional
from providers.base import HistoryDataProvider
from clients.finnhub import FinnhubClient
from const import Provider
import config

logger = logging.getLogger("app")


class FinnhubHistoryProvider(HistoryDataProvider):
    RESOLUTION_MAPPING = {
        "1": "1", "5": "5", "15": "15", "30": "30",
        "60": "60", "240": "240", "1D": "D", "1W": "W", "1M": "M",
    }

    def __init__(self, api_key=None):
        api_key = api_key or config.FINNHUB_API_KEY
        self.client = FinnhubClient(api_key)

    def get_name(self) -> str:
        return Provider.FINNHUB.value

    def is_available(self) -> bool:
        return config.DATA_PROVIDER.get('finnhub', {}).get('is_available', False)

    def supports_symbol(self, symbol: str, exchange: str = None) -> bool:
        return 'OANDA:' in symbol or ':' in symbol

    def get_history_data(self, symbol: str, resolution: str,
                         from_time: int, to_time: int,
                         countback: int = 0, exchange: str = None, **kwargs) -> Optional[Dict[str, Any]]:
        if not self.is_available():
            return {"s": "error", "errmsg": "Finnhub provider not available"}
        try:
            finnhub_resolution = self.RESOLUTION_MAPPING.get(resolution)
            if not finnhub_resolution:
                return {"s": "error", "errmsg": f"Unsupported resolution: {resolution}"}
            if not from_time:
                from_time = to_time - self._resolution_seconds(resolution) * (countback * 2)
            candles = self.client.get_forex_candles(
                symbol=symbol,
                resolution=finnhub_resolution,
                from_timestamp=from_time,
                to_timestamp=to_time
            )
            if not candles or candles.get('s') != 'ok':
                return {"t":[],"o":[],"h":[],"l":[],"c":[],"v":[],"s":"no_data"}
            return candles
        except Exception as e:
            logger.exception(e)
            return {"s": "error", "errmsg": f"Error fetching data from Finnhub: {str(e)}"}
