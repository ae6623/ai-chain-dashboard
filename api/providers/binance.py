import logging
from typing import Dict, Any, Optional
from providers.base import HistoryDataProvider
from clients.binance import BinanceClient
from const import Provider
import config

logger = logging.getLogger("app")


class BinanceHistoryProvider(HistoryDataProvider):
    RESOLUTION_MAPPING = {
        "1": "1m", "5": "5m", "15": "15m", "30": "30m",
        "60": "1h", "240": "4h", "1D": "1d", "1W": "1w", "1M": "1M"
    }

    def __init__(self, cfg=None):
        self.cfg = cfg
        self.client = BinanceClient(cfg.get('api_key'), cfg.get('api_secret'))

    def get_name(self) -> str:
        return Provider.BINANCE.value

    def is_available(self) -> bool:
        return config.DATA_PROVIDER['binance']['is_available']

    def supports_symbol(self, symbol: str) -> bool:
        un_supported_suffixes = ['.HK', '.US', '.SS', '.SZ', '.SH']
        if any(symbol.endswith(suffix) for suffix in un_supported_suffixes):
            return False
        if not symbol.endswith('USDT'):
            return False
        return True

    def get_history_data(self, symbol: str, resolution: str,
                         from_time: int, to_time: int,
                         countback: int = 0, **kwargs) -> Optional[Dict[str, Any]]:
        if not self.is_available():
            return {"s": "error", "errmsg": "Binance provider not available"}
        try:
            binance_interval = self.RESOLUTION_MAPPING.get(resolution)
            if not binance_interval:
                return {"s": "error", "errmsg": f"Unsupported resolution: {resolution}"}
            if countback:
                count = countback
            elif from_time:
                count = self._calculate_data_count(resolution, from_time, to_time)
            else:
                count = 1000
            klines = self.client.get_klines(
                symbol=symbol.upper(),
                interval=binance_interval,
                startTime=from_time * 1000 if from_time else None,
                endTime=to_time * 1000,
                limit=count
            )
            if not from_time:
                from_time = to_time - count * self._resolution_seconds(resolution)
            if not klines:
                return {"t":[],"o":[],"h":[],"l":[],"c":[],"v":[],"s":"no_data"}
            return self._convert_to_udf_format(klines, from_time, to_time, countback)
        except Exception as e:
            logger.exception(e)
            return {"s": "error", "errmsg": f"Binance error: {str(e)}"}
