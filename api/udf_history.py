"""
UDF 历史数据查询模块

采用策略模式，支持多个数据提供者，便于未来扩展新的数据源。
"""

import logging
import json
from datetime import datetime, timezone, timedelta
from providers.base import HistoryDataProvider
from providers.alltick import AllTickHistoryProvider
from providers.longbridge import LongBridgeHistoryProvider
from providers.binance import BinanceHistoryProvider
from providers.polygon import PolygonHistoryProvider
from providers.fmp import FMPHistoryProvider
from providers.finnhub import FinnhubHistoryProvider
from typing import List, Dict, Any
from config import (
    ALLTICK_CONFIG, LONGBRIDGE_CONFIG, BINANCE_CONFIG,
    DATA_PROVIDER, POLYGON_API_KEY, FMP_API_KEY, FINNHUB_API_KEY
)

logger = logging.getLogger("app")

# 缓存配置（暂时关闭，cache_key 需要包含 countback/from/to 参数）
CACHE_ENABLED = False
CACHE_TTL_MINUTES = 60


class UDFHistoryManager:
    """UDF 历史数据管理器"""

    def __init__(self):
        self.providers: List[HistoryDataProvider] = []
        self.provider_priority: Dict[str, int] = {}
        self._initialize_providers()

    def _initialize_providers(self):
        if DATA_PROVIDER['alltick']['is_available']:
            alltick_provider = AllTickHistoryProvider(ALLTICK_CONFIG)
            self.add_provider(alltick_provider, priority=DATA_PROVIDER['alltick']['priority'])

        if DATA_PROVIDER['longbridge']['is_available']:
            longbridge_provider = LongBridgeHistoryProvider(LONGBRIDGE_CONFIG)
            self.add_provider(longbridge_provider, priority=DATA_PROVIDER['longbridge']['priority'])

        if DATA_PROVIDER['binance']['is_available']:
            binance_provider = BinanceHistoryProvider(BINANCE_CONFIG)
            self.add_provider(binance_provider, priority=DATA_PROVIDER['binance']['priority'])

        if DATA_PROVIDER['polygon']['is_available']:
            polygon_provider = PolygonHistoryProvider(POLYGON_API_KEY)
            self.add_provider(polygon_provider, priority=DATA_PROVIDER['polygon']['priority'])

        if DATA_PROVIDER['fmp']['is_available']:
            fmp_provider = FMPHistoryProvider(FMP_API_KEY)
            self.add_provider(fmp_provider, priority=DATA_PROVIDER['fmp']['priority'])

        if DATA_PROVIDER['finnhub']['is_available']:
            finnhub_provider = FinnhubHistoryProvider(FINNHUB_API_KEY)
            self.add_provider(finnhub_provider, priority=DATA_PROVIDER['finnhub']['priority'])

        logger.info("[init]providers_count: %s", len(self.providers))

    def add_provider(self, provider: HistoryDataProvider, priority: int = 0):
        self.providers.append(provider)
        self.provider_priority[provider.get_name()] = priority
        self.providers.sort(key=lambda p: self.provider_priority.get(p.get_name(), 999))

    def get_history_data(self,
                         symbol: str = None,
                         resolution: str = None,
                         from_time: int = None,
                         to_time: int = None,
                         countback: int = 0,
                         preferred_provider: str = None,
                         **kwargs) -> Dict[str, Any]:
        logger.info(
            "[get_history_data]symbol: %s, resolution: %s, from_time: %s, to_time: %s, countback: %s, provider: %s",
            symbol, resolution, from_time, to_time, countback, preferred_provider
        )

        # 查缓存（暂时关闭，cache_key 需要包含 countback/from/to 参数）
        if CACHE_ENABLED:
            from models import HistoryCache, db
            cache_key = HistoryCache.make_cache_key(symbol, resolution)
            cached = HistoryCache.query.filter_by(cache_key=cache_key).first()
            if cached and not cached.is_expired():
                logger.info("[cache_hit]key: %s", cache_key)
                return json.loads(cached.data)

        preferred = next((p for p in self.providers if p.get_name() == preferred_provider), None) if preferred_provider else None
        providers = ([preferred] if preferred else []) + [p for p in self.providers if p != preferred]

        for provider in providers:
            if not (provider.is_available() and provider.supports_symbol(symbol)):
                continue
            try:
                result = provider.get_history_data(symbol, resolution, from_time, to_time, countback, **kwargs)
                if result and result.get('s') in ('ok', 'no_data'):
                    # 写入缓存（暂时关闭）
                    if CACHE_ENABLED:
                        try:
                            from models import HistoryCache, db
                            cache_key = HistoryCache.make_cache_key(symbol, resolution)
                            expires_at = datetime.now(timezone.utc) + timedelta(minutes=CACHE_TTL_MINUTES)
                            cache_entry = HistoryCache(
                                symbol=symbol,
                                resolution=resolution,
                                cache_key=cache_key,
                                data=json.dumps(result),
                                provider=provider.get_name(),
                                expires_at=expires_at,
                            )
                            HistoryCache.query.filter_by(cache_key=cache_key).delete()
                            db.session.add(cache_entry)
                            db.session.commit()
                            logger.info("[cache_write]key: %s, provider: %s", cache_key, provider.get_name())
                        except Exception as e:
                            logger.warning("[cache_write_failed]error: %s", e)
                            db.session.rollback()
                    return result
                logger.info("[provider_failed]name: %s, result: %s", provider.get_name(), result)
            except Exception as e:
                logger.error("[provider_error]name: %s, error: %s", provider.get_name(), e)

        return {"s": "error", "errmsg": f"No suitable data provider found for symbol: {symbol}"}
