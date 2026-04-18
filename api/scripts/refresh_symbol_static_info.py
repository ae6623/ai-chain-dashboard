"""刷新 Symbol 表中所有证券的 static_info 缓存。

用于预热 / 定时刷新 longbridge 静态信息 + fundamentals 数据，
避免用户访问时等待慢速的外部 API 调用。

常见用法：
    # 默认：只刷新 portfolio 中引用到的 symbol，且跳过 24h 内 fresh 的
    .venv/bin/python scripts/refresh_symbol_static_info.py

    # 强制刷新 portfolio 内所有股票（忽略 fresh 缓存）
    .venv/bin/python scripts/refresh_symbol_static_info.py --force

    # 刷新所有 longbridge symbol（不限于 portfolio）
    .venv/bin/python scripts/refresh_symbol_static_info.py --all

    # 只刷新指定 symbol
    .venv/bin/python scripts/refresh_symbol_static_info.py --symbols AAPL.US TSLA.US 700.HK

    # 限制最多刷新 50 个
    .venv/bin/python scripts/refresh_symbol_static_info.py --limit 50

    # 并发 3 个（默认 1，注意 Longbridge API 10 req/s 限制，每个 symbol 发 ~7 个请求）
    .venv/bin/python scripts/refresh_symbol_static_info.py --workers 3

    # 只看计划要刷新哪些，不实际调用
    .venv/bin/python scripts/refresh_symbol_static_info.py --dry-run

部署建议：放到 crontab 每日凌晨跑一次：
    0 3 * * * cd /home/deploy/stock-platform/api && .venv/bin/python scripts/refresh_symbol_static_info.py >> logs/refresh_static_info.log 2>&1
"""

import argparse
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

from app import app
from models import DataStock, Symbol, db
from symbol_registry import get_static_info, is_longbridge_symbol, _is_static_info_fresh

logger = logging.getLogger('refresh_static_info')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Refresh static_info cache for all Longbridge-backed symbols.')
    parser.add_argument('--force', action='store_true',
                        help='强制刷新所有 symbol，忽略 fresh 缓存')
    parser.add_argument('--symbols', nargs='*',
                        help='只刷新指定 symbol（例：AAPL.US TSLA.US）')
    parser.add_argument('--all', action='store_true',
                        help='刷新所有 longbridge symbol（默认只刷新 portfolio 中引用到的）')
    parser.add_argument('--limit', type=int, default=0,
                        help='最多刷新多少个 symbol（0 = 不限制）')
    parser.add_argument('--workers', type=int, default=1,
                        help='并发 worker 数量（默认 1；注意 Longbridge 速率限制）')
    parser.add_argument('--sleep', type=float, default=0.3,
                        help='每个 symbol 之间 sleep 秒数（workers=1 时生效，避免限流）')
    parser.add_argument('--dry-run', action='store_true',
                        help='只打印计划刷新的 symbol，不实际调用 API')
    parser.add_argument('--verbose', action='store_true',
                        help='打印更详细的日志')
    return parser.parse_args()


def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )


def _get_portfolio_symbols() -> set:
    """从 data_stock 表读取所有 portfolio 中引用的 symbol（去重、标准化大写）"""
    rows = db.session.query(DataStock.symbol).distinct().all()
    return {(r[0] or '').strip().upper() for r in rows if r[0]}


def select_symbols(target_symbols: Optional[List[str]], force: bool, limit: int,
                   include_all: bool) -> List[Symbol]:
    """挑出需要刷新的 Symbol 记录"""
    query = Symbol.query
    if target_symbols:
        normalized = [s.strip().upper() for s in target_symbols if s.strip()]
        query = query.filter(Symbol.symbol.in_(normalized))

    records: List[Symbol] = query.order_by(Symbol.symbol.asc()).all()

    # 过滤非 longbridge 的
    records = [r for r in records if is_longbridge_symbol(r.symbol)]

    # 默认只保留 portfolio 中引用的；--all 或显式 --symbols 时不过滤
    if not include_all and not target_symbols:
        portfolio_set = _get_portfolio_symbols()
        records = [r for r in records if r.symbol in portfolio_set]

    if not force:
        # 过滤掉 fresh 的
        records = [r for r in records if not _is_static_info_fresh(r.static_info)]

    if limit and limit > 0:
        records = records[:limit]

    return records


def invalidate_cache(record: Symbol) -> None:
    """把 cached_at 清空，使 get_static_info 认为缓存已过期，必须重新拉取。"""
    if not record.static_info:
        return
    info = dict(record.static_info)
    info.pop('cached_at', None)
    record.static_info = info
    db.session.commit()


def refresh_one(symbol: str, force: bool) -> tuple:
    """刷新一个 symbol，返回 (symbol, ok, has_fundamentals, duration)"""
    start = time.time()
    try:
        with app.app_context():
            if force:
                record = Symbol.query.filter_by(symbol=symbol).first()
                if record:
                    invalidate_cache(record)

            data = get_static_info(symbol)
            duration = time.time() - start
            if not data:
                return (symbol, False, False, duration)
            has_fundamentals = bool(data.get('fundamentals'))
            return (symbol, True, has_fundamentals, duration)
    except Exception as exc:
        duration = time.time() - start
        logger.warning('[refresh_one] symbol=%s error=%s', symbol, exc)
        return (symbol, False, False, duration)


def run_serial(symbols: List[str], force: bool, sleep_s: float) -> dict:
    """串行刷新（推荐）"""
    stats = {'total': len(symbols), 'ok': 0, 'fail': 0, 'with_fundamentals': 0}
    for idx, symbol in enumerate(symbols, 1):
        sym, ok, has_fund, duration = refresh_one(symbol, force)
        if ok:
            stats['ok'] += 1
            if has_fund:
                stats['with_fundamentals'] += 1
        else:
            stats['fail'] += 1
        status = 'OK' if ok else 'FAIL'
        fund_tag = '+fund' if has_fund else '     '
        logger.info('[%d/%d] %s %s %s %.2fs',
                    idx, len(symbols), status, fund_tag, sym, duration)
        if idx < len(symbols) and sleep_s > 0:
            time.sleep(sleep_s)
    return stats


def run_parallel(symbols: List[str], force: bool, workers: int) -> dict:
    """并发刷新（注意速率限制）"""
    stats = {'total': len(symbols), 'ok': 0, 'fail': 0, 'with_fundamentals': 0}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(refresh_one, s, force): s for s in symbols}
        for idx, future in enumerate(as_completed(futures), 1):
            sym, ok, has_fund, duration = future.result()
            if ok:
                stats['ok'] += 1
                if has_fund:
                    stats['with_fundamentals'] += 1
            else:
                stats['fail'] += 1
            status = 'OK' if ok else 'FAIL'
            fund_tag = '+fund' if has_fund else '     '
            logger.info('[%d/%d] %s %s %s %.2fs',
                        idx, len(symbols), status, fund_tag, sym, duration)
    return stats


def main() -> int:
    load_dotenv('.env')
    args = parse_args()
    setup_logging(args.verbose)

    with app.app_context():
        records = select_symbols(args.symbols, args.force, args.limit, args.all)

        if not records:
            logger.info('No symbols to refresh. (all fresh, or no matching records)')
            return 0

        symbols = [r.symbol for r in records]
        logger.info('Planning to refresh %d symbols (force=%s, workers=%d)',
                    len(symbols), args.force, args.workers)

        if args.dry_run:
            for s in symbols:
                print(s)
            return 0

        start = time.time()
        if args.workers <= 1:
            stats = run_serial(symbols, args.force, args.sleep)
        else:
            stats = run_parallel(symbols, args.force, args.workers)
        elapsed = time.time() - start

        logger.info('Done. total=%d ok=%d fail=%d with_fundamentals=%d elapsed=%.1fs (avg %.2fs/symbol)',
                    stats['total'], stats['ok'], stats['fail'], stats['with_fundamentals'],
                    elapsed, elapsed / max(stats['total'], 1))
    return 0 if records else 1


if __name__ == '__main__':
    sys.exit(main())
