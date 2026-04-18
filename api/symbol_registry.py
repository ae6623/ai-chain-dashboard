import logging
import re
import time
from typing import Dict, Iterable, List, Optional, Tuple

from longport.openapi import Config, Market, QuoteContext, SecurityListCategory

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
LONGPORT_TYPE_SUFFIX_MAP = {
    SymbolType.STOCKS_US.value: ('.US',),
    SymbolType.STOCKS_HK.value: ('.HK',),
    SymbolType.STOCKS_CN.value: ('.SH', '.SZ', '.SS'),
}
LONGPORT_SECURITY_LIST_MARKETS = {
    SymbolType.STOCKS_US.value: (Market.US,),
}
EXACT_SYMBOL_QUERY_RE = re.compile(r'^[A-Z0-9][A-Z0-9.:-]*$')
SECURITY_LIST_CACHE_TTL_SECONDS = 15 * 60

_longbridge_ctx: Optional[QuoteContext] = None
_security_list_cache: Dict[str, Tuple[float, List[object]]] = {}


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


def _upsert_longbridge_infos(infos: Iterable[object]) -> List[Symbol]:
    info_list = list(infos)
    symbol_codes = []
    for info in info_list:
        symbol_code = getattr(info, 'symbol', '').strip().upper()
        if symbol_code and symbol_code not in symbol_codes:
            symbol_codes.append(symbol_code)

    if not symbol_codes:
        return []

    existing_records = {
        record.symbol: record
        for record in Symbol.query.filter(Symbol.symbol.in_(symbol_codes)).all()
    }
    saved_symbols: List[Symbol] = []

    for info in info_list:
        symbol_code = getattr(info, 'symbol', '').strip().upper()
        if not symbol_code:
            continue

        record = existing_records.get(symbol_code)
        if record is None:
            record = Symbol(symbol=symbol_code)
            existing_records[symbol_code] = record

        company_name = _pick_description(info)
        record.ticker = symbol_code
        record.full_name = company_name or symbol_code
        record.description = company_name or symbol_code
        record.exchange = Provider.LONGBRIDGE.value
        record.type = infer_symbol_type(symbol_code)
        record.is_visible = True
        db.session.add(record)
        saved_symbols.append(record)

    db.session.commit()
    return saved_symbols


def upsert_longbridge_symbols(symbols: List[str]) -> List[Symbol]:
    normalized_symbols = []
    for symbol in symbols:
        normalized = (symbol or '').strip().upper()
        if normalized and is_longbridge_symbol(normalized) and normalized not in normalized_symbols:
            normalized_symbols.append(normalized)

    if not normalized_symbols:
        return []

    infos = _get_longbridge_ctx().static_info(normalized_symbols)
    return _upsert_longbridge_infos(infos)


def _normalize_longbridge_query(query: str) -> str:
    normalized = (query or '').strip().upper()
    if ':' in normalized:
        _, normalized = normalized.split(':', 1)
    return normalized


def _candidate_longbridge_symbols(query: str, symbol_type: Optional[str] = None) -> List[str]:
    normalized = _normalize_longbridge_query(query)
    if not normalized or not EXACT_SYMBOL_QUERY_RE.fullmatch(normalized):
        return []
    if is_longbridge_symbol(normalized):
        return [normalized]

    suffixes = LONGPORT_TYPE_SUFFIX_MAP.get(symbol_type)
    if suffixes is None:
        suffixes = tuple(
            suffix
            for suffix_group in LONGPORT_TYPE_SUFFIX_MAP.values()
            for suffix in suffix_group
        )

    return [f'{normalized}{suffix}' for suffix in suffixes]


def _get_security_list(market: Market) -> List[object]:
    cache_key = str(getattr(market, 'value', market))
    cached = _security_list_cache.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < SECURITY_LIST_CACHE_TTL_SECONDS:
        return cached[1]

    rows = list(_get_longbridge_ctx().security_list(market, SecurityListCategory.Overnight))
    _security_list_cache[cache_key] = (now, rows)
    return rows


def _security_list_match_score(info, query_upper: str, query_lower: str) -> Optional[int]:
    symbol_code = (getattr(info, 'symbol', None) or '').upper()
    names = [
        (getattr(info, 'name_en', None) or ''),
        (getattr(info, 'name_cn', None) or ''),
        (getattr(info, 'name_hk', None) or ''),
    ]

    if query_upper == symbol_code:
        return 0
    if symbol_code.startswith(query_upper):
        return 1
    if any(name.lower() == query_lower for name in names if name):
        return 2
    if any(name.lower().startswith(query_lower) for name in names if name):
        return 3
    if query_upper in symbol_code:
        return 4
    if any(query_lower in name.lower() for name in names if name):
        return 5
    return None


def _search_longbridge_security_list(query: str, symbol_type: Optional[str], limit: int) -> List[Symbol]:
    markets = LONGPORT_SECURITY_LIST_MARKETS.get(symbol_type)
    if symbol_type and markets is None:
        return []

    query_text = (query or '').strip()
    if not query_text:
        return []

    query_upper = query_text.upper()
    query_lower = query_text.lower()
    ranked_rows = []
    for market in markets or (Market.US,):
        try:
            rows = _get_security_list(market)
        except Exception as exc:
            logger.warning('[longbridge_security_list_failed] market=%s error=%s', market, exc)
            continue

        for row in rows:
            score = _security_list_match_score(row, query_upper, query_lower)
            if score is not None:
                ranked_rows.append((score, row))

    ranked_rows.sort(key=lambda item: (item[0], getattr(item[1], 'symbol', '')))
    return _upsert_longbridge_infos([row for _, row in ranked_rows[:limit]])


def search_longbridge_symbols(
    query: str,
    symbol_type: Optional[str] = None,
    exchange: Optional[str] = None,
    limit: int = 20,
) -> List[Symbol]:
    normalized_exchange = (exchange or '').strip().upper()
    if limit <= 0 or normalized_exchange not in {'', Provider.LONGBRIDGE.value}:
        return []
    if symbol_type and symbol_type not in LONGPORT_TYPE_SUFFIX_MAP:
        return []

    matches: List[Symbol] = []
    seen_symbols = set()

    candidate_symbols = _candidate_longbridge_symbols(query, symbol_type)
    if candidate_symbols:
        try:
            for symbol in upsert_longbridge_symbols(candidate_symbols):
                if symbol.symbol not in seen_symbols:
                    matches.append(symbol)
                    seen_symbols.add(symbol.symbol)
        except Exception as exc:
            db.session.rollback()
            logger.warning('[longbridge_exact_search_failed] query=%s error=%s', query, exc)

    remaining = limit - len(matches)
    if remaining <= 0:
        return matches[:limit]

    try:
        for symbol in _search_longbridge_security_list(query, symbol_type, remaining):
            if symbol.symbol not in seen_symbols:
                matches.append(symbol)
                seen_symbols.add(symbol.symbol)
                if len(matches) >= limit:
                    break
    except Exception as exc:
        db.session.rollback()
        logger.warning('[longbridge_fuzzy_search_failed] query=%s error=%s', query, exc)

    return matches[:limit]


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
        logger.warning('[symbol_sync_failed] provider=%s symbol=%s error=%s', Provider.LONGBRIDGE.value, normalized, exc)
        return None


STATIC_INFO_CACHE_TTL_SECONDS = 24 * 60 * 60


def _static_info_to_dict(info) -> dict:
    return {
        'symbol': getattr(info, 'symbol', ''),
        'name_cn': getattr(info, 'name_cn', ''),
        'name_en': getattr(info, 'name_en', ''),
        'name_hk': getattr(info, 'name_hk', ''),
        'exchange': getattr(info, 'exchange', ''),
        'currency': getattr(info, 'currency', ''),
        'lot_size': getattr(info, 'lot_size', None),
        'total_shares': getattr(info, 'total_shares', None),
        'circulating_shares': getattr(info, 'circulating_shares', None),
        'hk_shares': getattr(info, 'hk_shares', None),
        'eps': getattr(info, 'eps', None),
        'eps_ttm': getattr(info, 'eps_ttm', None),
        'bps': getattr(info, 'bps', None),
        'dividend_yield': getattr(info, 'dividend_yield', None),
        'stock_derivatives': getattr(info, 'stock_derivatives', []),
        'board': getattr(info, 'board', ''),
        'cached_at': time.time(),
    }


def _is_static_info_fresh(static_info: Optional[dict]) -> bool:
    if not static_info:
        return False
    cached_at = static_info.get('cached_at')
    if not cached_at:
        return False
    return (time.time() - cached_at) < STATIC_INFO_CACHE_TTL_SECONDS


def get_static_info(symbol: str) -> Optional[dict]:
    normalized = (symbol or '').strip().upper()
    if not normalized:
        return None

    record = Symbol.query.filter_by(symbol=normalized).first()
    if record is None:
        record = sync_longbridge_symbol(normalized)
    if record is None:
        return None

    if _is_static_info_fresh(record.static_info):
        return record.static_info

    if not is_longbridge_symbol(normalized):
        return record.static_info

    try:
        infos = _get_longbridge_ctx().static_info([normalized])
        if not infos:
            return record.static_info
        data = _static_info_to_dict(infos[0])
        record.static_info = data
        db.session.commit()
        return data
    except Exception as exc:
        db.session.rollback()
        logger.warning('[static_info_fetch_failed] symbol=%s error=%s', normalized, exc)
        return record.static_info
