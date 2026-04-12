import logging
from typing import List, Dict, Any, Optional
from providers.base import HistoryDataProvider
from clients.alltick import AllTickKlineClient
from const import Provider
import config

logger = logging.getLogger("app")


class AllTickHistoryProvider(HistoryDataProvider):
    RESOLUTION_MAPPING = {
        "1": 1, "5": 2, "15": 3, "30": 4,
        "60": 5, "240": 7, "1D": 8, "1W": 9, "1M": 10
    }

    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.client = None
        self._initialize_client()

    def _initialize_client(self):
        try:
            token = self.cfg.get('token')
            if not token:
                logger.warning("AllTick token not configured")
                return
            self.client = AllTickKlineClient(token)
        except Exception as e:
            logger.error(f"Failed to initialize AllTick client: {e}")
            self.client = None

    def get_name(self) -> str:
        return Provider.ALLTICK.value

    def is_available(self) -> bool:
        return config.DATA_PROVIDER['alltick']['is_available']

    def supports_symbol(self, symbol: str) -> bool:
        return True

    def get_history_data(self, symbol: str, resolution: str,
                         from_time: int, to_time: int,
                         countback: int = 0, **kwargs) -> Optional[Dict[str, Any]]:
        if not self.is_available():
            return {"s": "error", "errmsg": "AllTick provider not available"}
        if not from_time:
            from_time = 0
        try:
            alltick_resolution = self.RESOLUTION_MAPPING.get(resolution)
            if not alltick_resolution:
                return {"s": "error", "errmsg": f"Unsupported resolution: {resolution}"}
            if countback:
                count = countback
            elif from_time:
                count = self._calculate_data_count(resolution, from_time, to_time)
            else:
                count = 1000
            kline_list = self.client.query_kline_data(
                code=symbol,
                kline_type=alltick_resolution,
                api_end_timestamp=to_time,
                kline_num=count*2
            )
            if not from_time:
                from_time = to_time - count * self._resolution_seconds(resolution) * 1000
            if not kline_list:
                return {"t":[],"o":[],"h":[],"l":[],"c":[],"v":[],"s":"no_data"}
            return self._convert_to_udf_format(kline_list, from_time, to_time, countback)
        except Exception as e:
            logger.exception(e)
            return {"s": "error", "errmsg": f"AllTick error: {str(e)}"}
