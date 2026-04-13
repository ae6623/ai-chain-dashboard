import logging
from typing import List, Optional

from longport.openapi import Config, QuoteContext

from const import Provider, SymbolType
from models import Symbol, db

logger = logging.getLogger("app")

LONGPORT_SUFFIX_TYPE_MAP = {
    '.US': SymbolType.STOCKS_US.value,
    '.HK': SymbolType.STOCKS_HK.value,
    '.SH': SymbolType.STOCKS_CN.value,
    '.SZ': SymbolType.STOCKS_CN.value,
    '.SS': SymbolType.STOCKS_CN.value,
}

_longbridge_ctx: Optional[QuoteContext] = None


def _get_longbridge_ctx() -> QuoteContext:
    global _longbridge_ctx
    if _longbridge_ctx is None:
        _longbridge_ctx = QuoteContext(Config.from_env())
    return _longbridge_ctx


def is_longbridge_symbol(symbol: str) -> bool:
    symbol = (symbol or '').upper()
    return any(symbol.endswith(suffix) for suffix in LONGPORT_SUFFIX_TYPE_MAP)


def infer_symbol_type(symbol: str) -> str:
    symbol = (symbol or '').upper()
    for suffix, symbol_type in LONGPORT_SUFFIX_TYPE_MAP.items():
        if symbol.endswith(suffix):
            return symbol_type
    return SymbolType.STOCKS_US.value


def _pick_description(info) -> str:
    return (
        getattr(info, 'name_en', None)
        or getattr(info, 'name_cn', None)
        or getattr(info, 'name_hk', None)
        or getattr(info, 'symbol', None)
        or ''
    )


def upsert_longbridge_symbols(symbols: List[str]) -> List[Symbol]:
    normalized_symbols = []
    for symbol in symbols:
        normalized = (symbol or '').strip().upper()
        if normalized and is_longbridge_symbol(normalized) and normalized not in normalized_symbols:
            normalized_symbols.append(normalized)

    if not normalized_symbols:
        return []

    infos = _get_longbridge_ctx().static_info(normalized_symbols)
    saved_symbols: List[Symbol] = []

    for info in infos:
        symbol_code = getattr(info, 'symbol', '').strip().upper()
        if not symbol_code:
            continue

        record = Symbol.query.filter_by(symbol=symbol_code).first()
        if record is None:
            record = Symbol(symbol=symbol_code)

        record.ticker = symbol_code
        record.full_name = symbol_code
        record.description = _pick_description(info)
        record.exchange = Provider.LONGBRIDGE.value
        record.type = infer_symbol_type(symbol_code)
        record.is_visible = True
        db.session.add(record)
        saved_symbols.append(record)

    db.session.commit()
    return saved_symbols


def sync_longbridge_symbol(symbol: str) -> Optional[Symbol]:
    normalized = (symbol or '').strip().upper()
    if not is_longbridge_symbol(normalized):
        return None

    existing = Symbol.query.filter_by(symbol=normalized).first()
    if existing is not None:
        return existing

    try:
        saved_symbols = upsert_longbridge_symbols([normalized])
        return saved_symbols[0] if saved_symbols else None
    except Exception as exc:
        db.session.rollback()
        logger.warning("[symbol_sync_failed] provider=%s symbol=%s error=%s", Provider.LONGBRIDGE.value, normalized, exc)
        return None
