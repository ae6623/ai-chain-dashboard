import json
import logging
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Iterable, List, Optional, Tuple

from longport.openapi import Config, Market, QuoteContext, SecurityListCategory, HttpClient

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


def _to_json_safe(value):
    if value is None:
        return None
    if isinstance(value, (int, float, bool, str)):
        return value
    if hasattr(value, 'value'):
        return value.value
    return str(value)


def _static_info_to_dict(info) -> dict:
    derivatives = getattr(info, 'stock_derivatives', []) or []
    return {
        'symbol': getattr(info, 'symbol', ''),
        'name_cn': getattr(info, 'name_cn', ''),
        'name_en': getattr(info, 'name_en', ''),
        'name_hk': getattr(info, 'name_hk', ''),
        'exchange': _to_json_safe(getattr(info, 'exchange', '')),
        'currency': _to_json_safe(getattr(info, 'currency', '')),
        'lot_size': getattr(info, 'lot_size', None),
        'total_shares': getattr(info, 'total_shares', None),
        'circulating_shares': getattr(info, 'circulating_shares', None),
        'hk_shares': getattr(info, 'hk_shares', None),
        'eps': _to_json_safe(getattr(info, 'eps', None)),
        'eps_ttm': _to_json_safe(getattr(info, 'eps_ttm', None)),
        'bps': _to_json_safe(getattr(info, 'bps', None)),
        'dividend_yield': _to_json_safe(getattr(info, 'dividend_yield', None)),
        'stock_derivatives': [_to_json_safe(d) for d in derivatives],
        'board': _to_json_safe(getattr(info, 'board', '')),
        'cached_at': time.time(),
    }


def _is_static_info_fresh(static_info: Optional[dict]) -> bool:
    if not static_info:
        return False
    cached_at = static_info.get('cached_at')
    if not cached_at:
        return False
    return (time.time() - cached_at) < STATIC_INFO_CACHE_TTL_SECONDS


_http_client: Optional[HttpClient] = None


def _get_http_client() -> HttpClient:
    """Get HttpClient for making API requests"""
    global _http_client
    if _http_client is None:
        _http_client = HttpClient.from_env()
    return _http_client


def symbol_to_counter_id(symbol: str) -> str:
    """Convert symbol (e.g. AAPL.US) to counter_id (e.g. ST/US/AAPL)"""
    if '.' not in symbol:
        return symbol
    
    code, market = symbol.rsplit('.', 1)
    market = market.upper()
    
    # Index symbols start with dot (e.g. .DJI.US -> IX/US/DJI)
    if code.startswith('.'):
        return f"IX/{market}/{code[1:]}"
    
    # For simplicity, treat all as stocks (ST/)
    # In production, should check ETF list
    return f"ST/{market}/{code}"


def _http_get_fundamentals(path: str, params: dict) -> Optional[dict]:
    """Make HTTP GET request to Longbridge API using HttpClient"""
    try:
        client = _get_http_client()
        
        # Build query string
        query_parts = [f"{k}={v}" for k, v in params.items()]
        full_path = f"{path}?{'&'.join(query_parts)}" if query_parts else path
        
        # Make request using HttpClient
        response = client.request('GET', full_path)
        
        # Parse response - HttpClient returns JSON string
        if isinstance(response, str):
            data = json.loads(response)
        else:
            data = response
            
        # Return data directly (not wrapped in response object)
        return data
        
    except Exception as exc:
        logger.warning('[http_get_fundamentals] path=%s error=%s', path, exc)
        return None


def _build_fundamentals_summary(results: dict) -> dict:
    data: dict = {'source': 'longbridge_http_api', 'cached_at': time.time()}

    # Company overview
    co = results.get('company') or {}
    data['company'] = {
        'profile': co.get('profile'),
        'website': co.get('website'),
        'founded': co.get('founded'),
        'employees': co.get('employees'),
        'manager': co.get('manager'),
        'market': co.get('market'),
        'icon': co.get('icon'),
    }

    # Valuation - extract PE description from metrics
    val = results.get('valuation') or {}
    metrics = val.get('metrics') or {}
    pe_data = metrics.get('pe') or {}
    data['valuation'] = {'pe_desc': pe_data.get('desc')}

    # Institution rating
    rating = results.get('institution_rating') or {}
    evaluate = rating.get('evaluate') or {}
    # Combine buy + strong_buy for total buy count
    buy_count = (evaluate.get('buy') or 0) + (evaluate.get('strong_buy') or 0)
    sell_count = (evaluate.get('sell') or 0) + (evaluate.get('under') or 0)
    # Calculate total from all counts
    hold_count = evaluate.get('hold') or 0
    total = buy_count + hold_count + sell_count if any([buy_count, hold_count, sell_count]) else None
    
    # Target price is a single value, not a dict
    target_price = rating.get('target')
    data['institution_rating'] = {
        'buy': buy_count if buy_count else None,
        'hold': hold_count if hold_count else None,
        'sell': sell_count if sell_count else None,
        'total': total,
        'target_highest': None,  # Not available in this API
        'target_lowest': None,  # Not available in this API
        'target_prev_close': target_price,
    }

    # Dividend - get latest from list
    div_data = results.get('dividend') or {}
    div_list = div_data.get('list') or []
    latest_div = div_list[0] if div_list else {}
    data['dividend'] = {
        'ex_date': latest_div.get('ex_date'),
        'payment_date': latest_div.get('payment_date'),
        'desc': latest_div.get('desc'),
    }

    # Consensus - extract current period data
    cons = results.get('consensus') or {}
    cons_list = cons.get('list') or []
    cons_idx = cons.get('current_index', 0)
    current_cons = cons_list[cons_idx] if 0 <= cons_idx < len(cons_list) else {}
    details = {d['key']: d for d in (current_cons.get('details') or [])}
    data['consensus'] = {
        'period': cons.get('current_period'),
        'revenue_estimate': (details.get('revenue') or {}).get('estimate'),
        'net_income_estimate': (details.get('net_income') or {}).get('estimate'),
        'eps_estimate': (details.get('eps') or {}).get('estimate'),
    }

    # Forecast EPS - get latest item
    eps_data = results.get('forecast_eps') or {}
    eps_items = eps_data.get('items') or []
    latest_eps = eps_items[-1] if eps_items else {}
    data['forecast_eps'] = {
        'mean': latest_eps.get('forecast_eps_mean'),
        'highest': latest_eps.get('forecast_eps_highest'),
        'lowest': latest_eps.get('forecast_eps_lowest'),
    }

    return data


def _fetch_fundamentals(symbol: str) -> Optional[dict]:
    """Fetch fundamentals data using Longbridge HTTP API"""
    if not is_longbridge_symbol(symbol):
        return None
    
    counter_id = symbol_to_counter_id(symbol)
    
    # Define API endpoints  
    endpoints = {
        'company': ('/v1/quote/comp-overview', {'counter_id': counter_id}),
        'valuation': ('/v1/quote/valuation', {'counter_id': counter_id, 'indicator': 'pe', 'range': '1'}),
        'institution_rating': ('/v1/quote/institution-ratings', {'counter_id': counter_id}),
        'dividend': ('/v1/quote/dividends', {'counter_id': counter_id}),
        'consensus': ('/v1/quote/financial-consensus-detail', {'counter_id': counter_id}),
        'forecast_eps': ('/v1/quote/forecast-eps', {'counter_id': counter_id}),
    }
    
    results: Dict[str, Optional[dict]] = {}
    
    # Fetch all endpoints in parallel
    with ThreadPoolExecutor(max_workers=len(endpoints)) as pool:
        futures = {
            pool.submit(_http_get_fundamentals, path, params): key
            for key, (path, params) in endpoints.items()
        }
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except Exception as exc:
                logger.warning('[_fetch_fundamentals] key=%s error=%s', key, exc)
                results[key] = None
    
    return _build_fundamentals_summary(results)


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

        old_fundamentals = ((record.static_info or {}).get('fundamentals') or {})
        try:
            fundamentals = _fetch_fundamentals(normalized)
            data['fundamentals'] = fundamentals if fundamentals else old_fundamentals
        except Exception as exc_f:
            logger.warning('[fundamentals_fetch_failed] symbol=%s error=%s', normalized, exc_f)
            data['fundamentals'] = old_fundamentals

        record.static_info = data
        db.session.commit()
        return data
    except Exception as exc:
        db.session.rollback()
        logger.warning('[static_info_fetch_failed] symbol=%s error=%s', normalized, exc)
        return record.static_info
