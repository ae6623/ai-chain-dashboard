import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from providers.base import HistoryDataProvider
from const import Provider
from longport.openapi import QuoteContext, Config, Period, AdjustType, HttpClient
import config

logger = logging.getLogger("app")


class LongBridgeHistoryProvider(HistoryDataProvider):
    RESOLUTION_MAPPING = {
        "1": Period.Min_1, "2": Period.Min_2, "3": Period.Min_3,
        "5": Period.Min_5, "10": Period.Min_10, "15": Period.Min_15,
        "20": Period.Min_20, "30": Period.Min_30, "45": Period.Min_45,
        "60": Period.Min_60, "120": Period.Min_120, "180": Period.Min_180,
        "240": Period.Min_240,
        "1D": Period.Day, "1W": Period.Week, "1M": Period.Month,
        "3M": Period.Quarter, "12M": Period.Year, "1Y": Period.Year
    }

    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.ctx = None
        self.http_cli = None
        self._initialize()

    def _initialize(self):
        try:
            self.http_cli = HttpClient.from_env()
            self.ctx = QuoteContext(Config.from_env())
        except Exception as e:
            logger.error(f'LongBridge 初始化失败: {str(e)}')

    def get_name(self) -> str:
        return Provider.LONGBRIDGE.value

    def is_available(self) -> bool:
        return config.DATA_PROVIDER['longbridge']['is_available'] and self.ctx is not None

    def supports_symbol(self, symbol: str) -> bool:
        supported_suffixes = ['.HK', '.US', '.SS', '.SZ', '.SH']
        return any(symbol.endswith(suffix) for suffix in supported_suffixes)

    def _normalize_bar_timestamp(self, bar_time: int, resolution: str) -> int:
        if resolution not in {'1D', '1W', '1M', '12M', '1Y'}:
            return bar_time

        dt = datetime.fromtimestamp(bar_time, tz=timezone.utc)
        if resolution in {'12M', '1Y'}:
            return int(dt.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())

        return int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())

    def get_history_data(self, symbol: str, resolution: str,
                         from_time: int, to_time: int,
                         countback: int = 0, **kwargs) -> Optional[Dict[str, Any]]:
        if not self.is_available():
            return {"s": "error", "errmsg": "LongBridge provider not available"}
        if not from_time:
            from_time = 0
        try:
            longbridge_period = self.RESOLUTION_MAPPING.get(resolution)
            if longbridge_period is None:
                return {"s": "error", "errmsg": f"Unsupported resolution: {resolution}"}
            if not self.supports_symbol(symbol):
                return {"s": "error", "errmsg": f"Unsupported symbol: {symbol}"}
            requested_range_count = 0
            if from_time:
                requested_range_count = self._calculate_data_count(resolution, from_time, to_time)

            if countback:
                # Fetch enough bars for the requested window plus any older backfill
                # TradingView asks for via countBack.
                count = max(countback, requested_range_count)
            elif requested_range_count:
                count = requested_range_count
            else:
                count = 1000
            kline_list = self.ctx.history_candlesticks_by_offset(
                symbol=symbol,
                period=longbridge_period,
                adjust_type=AdjustType.ForwardAdjust,
                forward=False,
                time=datetime.fromtimestamp(to_time, tz=timezone.utc),
                count=count
            )
            if not kline_list:
                return {"t":[],"o":[],"h":[],"l":[],"c":[],"v":[],"s":"no_data"}
            return self._convert_to_udf_format(kline_list, from_time, to_time, resolution)
        except Exception as e:
            logger.exception(e)
            return {"s": "error", "errmsg": f"LongBridge error: {str(e)}"}

    def _convert_to_udf_format(self, kline_list: List[Dict],
                                from_time: int, to_time: int,
                                resolution: str) -> Dict[str, Any]:
        times, opens, highs, lows, closes, volumes = [], [], [], [], [], []
        for bar in kline_list:
            bar_time = int(bar.timestamp.timestamp())
            if bar_time > to_time:
                continue
            times.append(self._normalize_bar_timestamp(bar_time, resolution))
            opens.append(float(bar.open))
            highs.append(float(bar.high))
            lows.append(float(bar.low))
            closes.append(float(bar.close))
            volumes.append(float(bar.volume))
        if not times:
            return {"s": "no_data", "nextTime": to_time}
        combined = list(zip(times, opens, highs, lows, closes, volumes))
        combined.sort(key=lambda x: x[0])
        if combined:
            times, opens, highs, lows, closes, volumes = zip(*combined)
            times, opens, highs, lows, closes, volumes = list(times), list(opens), list(highs), list(lows), list(closes), list(volumes)
        return {"s": "ok", "t": times, "o": opens, "h": highs, "l": lows, "c": closes, "v": volumes}
