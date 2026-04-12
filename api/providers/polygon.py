import logging
from typing import Dict, Any, Optional, List
from providers.base import HistoryDataProvider
from clients.polygon import PolygonClient
from const import Provider
import config

logger = logging.getLogger("app")


class PolygonHistoryProvider(HistoryDataProvider):
    RESOLUTION_MAPPING = {
        "1": (1, "minute"), "5": (5, "minute"), "15": (15, "minute"),
        "30": (30, "minute"), "60": (1, "hour"), "240": (4, "hour"),
        "1D": (1, "day"), "1W": (1, "week"), "1M": (1, "month")
    }

    def __init__(self, api_key):
        self.client = PolygonClient(api_key) if api_key else None

    def get_name(self) -> str:
        return Provider.POLYGON.value

    def is_available(self) -> bool:
        return config.DATA_PROVIDER['polygon']['is_available']

    def supports_symbol(self, symbol: str, exchange: str = None) -> bool:
        return True

    def get_history_data(self, symbol: str, resolution: str,
                         from_time: int, to_time: int,
                         countback: int = 0,
                         exchange: str = None, **kwargs) -> Optional[Dict[str, Any]]:
        if not self.is_available():
            return {"s": "error", "errmsg": "Polygon provider not available"}
        if not self.client:
            return {"s": "error", "errmsg": "Polygon API key not configured"}
        try:
            resolution_config = self.RESOLUTION_MAPPING.get(resolution)
            if not resolution_config:
                return {"s": "error", "errmsg": f"Unsupported resolution: {resolution}"}
            multiplier, timespan = resolution_config
            clean_symbol = symbol.replace('.US', '').upper()
            if countback:
                limit = min(countback, 50000)
            else:
                limit = min(self._calculate_data_count(resolution, from_time, to_time), 50000)
            if not from_time:
                from_time = to_time - self._resolution_seconds(resolution) * countback * 2
            results = self.client.get_klines(
                symbol=clean_symbol, multiplier=multiplier, timespan=timespan,
                from_time=from_time * 1000, to_time=to_time * 1000,
                sort='desc', limit=limit
            )
            if not results:
                return {"t":[],"o":[],"h":[],"l":[],"c":[],"v":[],"s":"no_data"}
            results.reverse()
            return self._convert_polygon_to_udf_format(results, from_time, to_time, countback)
        except Exception as e:
            logger.exception(f"Polygon provider error: {e}")
            return {"s": "error", "errmsg": f"Polygon error: {str(e)}"}

    def _convert_polygon_to_udf_format(self, polygon_data: List[Dict],
                                        from_time: int, to_time: int, countback: int) -> Dict[str, Any]:
        times, opens, highs, lows, closes, volumes = [], [], [], [], [], []
        for bar in polygon_data[-countback:]:
            bar_time = int(bar['t'] / 1000)
            times.append(bar_time)
            opens.append(float(bar['o']))
            highs.append(float(bar['h']))
            lows.append(float(bar['l']))
            closes.append(float(bar['c']))
            volumes.append(float(bar.get('v', 0)))
        if not times:
            return {"s": "no_data", "nextTime": to_time}
        return {"s": "ok", "t": times, "o": opens, "h": highs, "l": lows, "c": closes, "v": volumes}
