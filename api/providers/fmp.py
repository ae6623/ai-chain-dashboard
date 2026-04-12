import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from providers.base import HistoryDataProvider
from clients.fmp import FMPClient
from const import Provider
import config

logger = logging.getLogger("app")


class FMPHistoryProvider(HistoryDataProvider):
    RESOLUTION_MAPPING = {
        "1": "1min", "5": "5min", "60": "1hour", "1D": "1day",
    }

    def __init__(self, api_key=None):
        self.client = FMPClient(api_key)

    def get_name(self) -> str:
        return Provider.FMP.value

    def is_available(self) -> bool:
        return config.DATA_PROVIDER['fmp']['is_available']

    def supports_symbol(self, symbol: str) -> bool:
        return True

    def get_history_data(self, symbol: str, resolution: str,
                         from_time: int, to_time: int,
                         countback: int = 0, **kwargs) -> Optional[Dict[str, Any]]:
        if not self.is_available():
            return {"s": "error", "errmsg": "FMP provider not available"}
        to_time -= 12 * 60 * 60
        try:
            fmp_interval = self.RESOLUTION_MAPPING.get(resolution)
            if not fmp_interval:
                return {"s": "error", "errmsg": f"Unsupported resolution: {resolution}"}
            if not from_time:
                from_time = to_time - self._resolution_seconds(resolution) * (countback * 2)
            klines = self.client.get_klines(
                symbol, fmp_interval,
                datetime.fromtimestamp(from_time).strftime('%Y-%m-%d'),
                datetime.fromtimestamp(to_time).strftime('%Y-%m-%d')
            )
            if not klines:
                return {"t":[],"o":[],"h":[],"l":[],"c":[],"v":[],"s":"no_data"}
            return self._convert_to_udf_format(klines, from_time, to_time, countback)
        except Exception as e:
            logger.exception(e)
            return {"s": "error", "errmsg": f"Error fetching data from FMP: {str(e)}"}

    def _convert_to_udf_format(self, kline_list: List[Dict],
                                from_time: int, to_time: int,
                                countback: int) -> Dict[str, Any]:
        times, opens, highs, lows, closes, volumes = [], [], [], [], [], []
        count = 0
        for bar in kline_list:
            if ' ' in bar['date']:
                bar_time = datetime.strptime(bar['date'], '%Y-%m-%d %H:%M:%S').timestamp()
            else:
                bar_time = datetime.strptime(bar['date'], '%Y-%m-%d').timestamp()
            bar_time = int(bar_time) + 12 * 60 * 60
            times.append(bar_time)
            opens.append(float(bar['open']))
            highs.append(float(bar['high']))
            lows.append(float(bar['low']))
            closes.append(float(bar['close']))
            volumes.append(float(bar['volume']) if bar['volume'] else 0)
            count += 1
            if count >= countback:
                break
        if not times:
            return {"s": "no_data", "nextTime": to_time}
        times.reverse()
        opens.reverse()
        highs.reverse()
        lows.reverse()
        closes.reverse()
        volumes.reverse()
        return {"s": "ok", "t": times, "o": opens, "h": highs, "l": lows, "c": closes, "v": volumes}
