"""扫描 portfolio 中 fundamentals 缺失的 symbol，强制重新拉取。

判断"缺失"标准：static_info.fundamentals 整个缺失，或 company.profile 为空。
(ETF 本身没有 profile，为避免无限刷新，使用 fundamentals.cached_at 的 cooldown)

用法：
    # 默认：只列出缺失的
    .venv/bin/python scripts/refill_missing_fundamentals.py --dry-run

    # 实际补刷（会跳过 1 小时内刚刷过的，避免无意义的重试 ETF）
    .venv/bin/python scripts/refill_missing_fundamentals.py

    # 跳过 cooldown，强制刷所有缺失的
    .venv/bin/python scripts/refill_missing_fundamentals.py --cooldown-hours 0

    # 并发
    .venv/bin/python scripts/refill_missing_fundamentals.py --workers 2
"""

import argparse
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

from app import app
from models import DataStock, Symbol, db
from symbol_registry import get_static_info, is_longbridge_symbol

logger = logging.getLogger('refill_missing_fundamentals')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Refill missing fundamentals for portfolio symbols.')
    parser.add_argument('--cooldown-hours', type=float, default=1.0,
                        help='若 fundamentals.cached_at 距今小于该小时数则跳过，避免无限刷新 ETF（默认 1 小时；设 0 强制刷新）')
    parser.add_argument('--workers', type=int, default=1, help='并发 worker（默认 1，注意速率限制）')
    parser.add_argument('--sleep', type=float, default=0.3, help='串行模式下每个 symbol 之间 sleep 秒数')
    parser.add_argument('--dry-run', action='store_true', help='只列出缺失，不刷新')
    parser.add_argument('--verbose', action='store_true', help='打印更详细日志')
    return parser.parse_args()


def setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )


def _is_fundamentals_missing(static_info, cooldown_hours: float) -> bool:
    """判断 fundamentals 是否需要补"""
    if not static_info:
        return True
    fund = static_info.get('fundamentals') or {}
    if not fund:
        return True
    # cooldown 保护，避免反复刷 ETF
    cached_at = fund.get('cached_at')
    if cooldown_hours > 0 and cached_at:
        try:
            if time.time() - float(cached_at) < cooldown_hours * 3600:
                return False
        except (TypeError, ValueError):
            pass
    company = fund.get('company') or {}
    # profile 为空视为缺失
    return not company.get('profile')


def select_missing_portfolio_symbols(cooldown_hours: float) -> List[str]:
    """找出 portfolio 中 fundamentals 缺失的 symbol"""
    portfolio_set = {
        (s[0] or '').strip().upper()
        for s in db.session.query(DataStock.symbol).distinct().all()
        if s[0]
    }
    records = Symbol.query.filter(Symbol.symbol.in_(portfolio_set)).order_by(Symbol.symbol.asc()).all()
    missing = []
    for r in records:
        if not is_longbridge_symbol(r.symbol):
            continue
        if _is_fundamentals_missing(r.static_info, cooldown_hours):
            missing.append(r.symbol)
    return missing


def _invalidate_cache(symbol: str) -> None:
    """清掉 cached_at 让 get_static_info 再次拉取"""
    record = Symbol.query.filter_by(symbol=symbol).first()
    if not record or not record.static_info:
        return
    info = dict(record.static_info)
    info.pop('cached_at', None)
    # 同时清 fundamentals.cached_at，强制走 _fetch_fundamentals
    fund = dict(info.get('fundamentals') or {})
    fund.pop('cached_at', None)
    if fund:
        info['fundamentals'] = fund
    record.static_info = info
    db.session.commit()


def refill_one(symbol: str) -> tuple:
    start = time.time()
    try:
        with app.app_context():
            _invalidate_cache(symbol)
            data = get_static_info(symbol)
            duration = time.time() - start
            if not data:
                return (symbol, False, False, duration)
            fund = data.get('fundamentals') or {}
            has_profile = bool((fund.get('company') or {}).get('profile'))
            return (symbol, True, has_profile, duration)
    except Exception as exc:
        logger.warning('[refill_one] symbol=%s error=%s', symbol, exc)
        return (symbol, False, False, time.time() - start)


def run_serial(symbols: List[str], sleep_s: float) -> dict:
    stats = {'total': len(symbols), 'ok': 0, 'fail': 0, 'with_profile': 0}
    for idx, sym in enumerate(symbols, 1):
        s, ok, has_profile, dur = refill_one(sym)
        if ok:
            stats['ok'] += 1
            if has_profile:
                stats['with_profile'] += 1
        else:
            stats['fail'] += 1
        tag = '+profile' if has_profile else ('ok-empty' if ok else 'FAIL')
        logger.info('[%d/%d] %-9s %s %.2fs', idx, len(symbols), tag, s, dur)
        if idx < len(symbols) and sleep_s > 0:
            time.sleep(sleep_s)
    return stats


def run_parallel(symbols: List[str], workers: int) -> dict:
    stats = {'total': len(symbols), 'ok': 0, 'fail': 0, 'with_profile': 0}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(refill_one, s): s for s in symbols}
        for idx, future in enumerate(as_completed(futures), 1):
            s, ok, has_profile, dur = future.result()
            if ok:
                stats['ok'] += 1
                if has_profile:
                    stats['with_profile'] += 1
            else:
                stats['fail'] += 1
            tag = '+profile' if has_profile else ('ok-empty' if ok else 'FAIL')
            logger.info('[%d/%d] %-9s %s %.2fs', idx, len(symbols), tag, s, dur)
    return stats


def main() -> int:
    load_dotenv('.env')
    args = parse_args()
    setup_logging(args.verbose)

    with app.app_context():
        missing = select_missing_portfolio_symbols(args.cooldown_hours)

    if not missing:
        logger.info('No missing fundamentals. All portfolio symbols are good.')
        return 0

    logger.info('Found %d portfolio symbols with missing fundamentals:', len(missing))
    for s in missing:
        logger.info('  %s', s)

    if args.dry_run:
        return 0

    start = time.time()
    if args.workers <= 1:
        stats = run_serial(missing, args.sleep)
    else:
        stats = run_parallel(missing, args.workers)
    elapsed = time.time() - start

    empty_after = stats['ok'] - stats['with_profile']
    logger.info('Done. total=%d ok=%d fail=%d with_profile=%d still_empty=%d elapsed=%.1fs',
                stats['total'], stats['ok'], stats['fail'], stats['with_profile'], empty_after, elapsed)
    if empty_after:
        logger.info('Note: %d symbols still have empty profile after refill (likely ETFs / indexes without profile).',
                    empty_after)
    return 0


if __name__ == '__main__':
    sys.exit(main())
