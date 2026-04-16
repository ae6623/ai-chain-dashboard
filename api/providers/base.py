from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List


class HistoryDataProvider(ABC):
    """历史数据提供者抽象基类"""

    @abstractmethod
    def get_name(self) -> str:
        pass

    @abstractmethod
    def is_available(self) -> bool:
        pass

    @abstractmethod
    def supports_symbol(self, symbol: str, exchange: str = None) -> bool:
        pass

    @abstractmethod
    def get_history_data(self, symbol: str, resolution: str,
                         from_time: int, to_time: int,
                         countback: int = 0,
                         exchange: str = None, **kwargs) -> Optional[Dict[str, Any]]:
        pass

    def _calculate_data_count(self, resolution: str, from_time: int, to_time: int) -> int:
        time_diff = to_time - from_time
        if resolution == '1':
            count = min(int(time_diff / 60) + 1, 1000)
        elif resolution == '5':
            count = min(int(time_diff / 300) + 1, 1000)
        elif resolution == '15':
            count = min(int(time_diff / 900) + 1, 1000)
        elif resolution == '30':
            count = min(int(time_diff / 1800) + 1, 1000)
        elif resolution == '60':
            count = min(int(time_diff / 3600) + 1, 1000)
        elif resolution == '240':
            count = min(int(time_diff / 14400) + 1, 1000)
        elif resolution == '1D':
            count = min(int(time_diff / 86400) + 1, 1000)
        elif resolution == '1W':
            count = min(int(time_diff / 604800) + 1, 1000)
        elif resolution == '1M':
            count = min(int(time_diff / 2592000) + 1, 1000)
        elif resolution in {'12M', '1Y'}:
            count = min(int(time_diff / 31536000) + 1, 1000)
        else:
            count = min(int(time_diff / 86400) + 1, 1000)
        return max(count, 1)

    def _convert_to_udf_format(
            self, kline_list: List[Dict],
            from_time: int, to_time: int,
            countback: int
    ) -> Dict[str, Any]:
        times = []
        opens = []
        highs = []
        lows = []
        closes = []
        volumes = []

        for bar in kline_list[-countback:]:
            bar_time = int(bar['timestamp'])
            times.append(bar_time)
            opens.append(float(bar['open_price']))
            highs.append(float(bar['high_price']))
            lows.append(float(bar['low_price']))
            closes.append(float(bar['close_price']))
            volumes.append(float(bar['volume']) if bar['volume'] else 0)

        if not times:
            return {"s": "no_data", "nextTime": to_time}

        return {
            "s": "ok", "t": times, "o": opens,
            "h": highs, "l": lows, "c": closes, "v": volumes
        }

    def _resolution_seconds(self, resolution: str) -> int:
        return {
            "1": 60, "5": 300, "15": 900, "30": 1800,
            "60": 3600, "240": 14400,
            "1D": 86400, "1W": 604800, "1M": 2592000,
            "12M": 31536000, "1Y": 31536000
        }[resolution]
