#!/usr/bin/env python3
"""
从东方财富免费 API 批量获取 A股/港股 全量股票列表，导入到 Symbol 表。

用法:
    cd /home/deploy/stock-platform/api
    .venv/bin/python3 scripts/import_stock_symbols.py [--dry-run] [--market cn] [--market hk]

说明:
    - 默认同时导入 A股 和 港股
    - --dry-run  只拉数据不写库，用于预览
    - 已有 symbol 会更新 full_name / description（支持中文名覆盖英文名）
"""
import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from app import app
from models import Symbol, db

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

EASTMONEY_API = 'https://82.push2.eastmoney.com/api/qt/clist/get'

MARKET_CONFIG = {
    'cn': {
        'fs': 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
        'label': 'A股',
        'type': 'stocks-cn',
        'exchange': 'LONGBRIDGE',
        'format_symbol': lambda code: f'{code}.SH' if code.startswith('6') else f'{code}.SZ',
    },
    'hk': {
        'fs': 'm:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2',
        'label': '港股',
        'type': 'stocks-hk',
        'exchange': 'LONGBRIDGE',
        'format_symbol': lambda code: f'{code}.HK',
    },
}

PAGE_SIZE = 100  # 东方财富 API 每页最多 100 条
MAX_RETRIES = 3


def fetch_stock_list(market_key: str) -> list[dict]:
    """从东方财富 API 拉取全量股票列表"""
    config = MARKET_CONFIG[market_key]
    all_items = []
    page = 1
    total = None

    while True:
        params = {
            'pn': page,
            'pz': PAGE_SIZE,
            'po': 1,
            'np': 1,
            'fltt': 2,
            'invt': 2,
            'fid': 'f3',
            'fs': config['fs'],
            'fields': 'f12,f14',
        }

        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.get(EASTMONEY_API, params=params, timeout=15)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f'[{config["label"]}] 第{page}页第{attempt+1}次失败, {wait}s后重试: {e}')
                    time.sleep(wait)
                else:
                    logger.error(f'[{config["label"]}] 第{page}页请求失败(已重试{MAX_RETRIES}次): {e}')
                    return all_items

        if not data.get('data') or not data['data'].get('diff'):
            break

        items = data['data']['diff']
        if total is None:
            total = data['data'].get('total', 0)
        all_items.extend(items)

        if page % 10 == 0 or len(all_items) >= total:
            logger.info(f'[{config["label"]}] 进度: {len(all_items)}/{total}')

        if len(all_items) >= total:
            break
        page += 1
        time.sleep(0.3)

    logger.info(f'[{config["label"]}] 拉取完成: {len(all_items)} 条')
    return all_items


def import_market(market_key: str, dry_run: bool = False) -> tuple[int, int]:
    """导入一个市场的股票数据，返回 (新增数, 更新数)"""
    config = MARKET_CONFIG[market_key]
    items = fetch_stock_list(market_key)
    if not items:
        logger.warning(f'[{config["label"]}] 未获取到数据')
        return 0, 0

    created, updated = 0, 0
    for item in items:
        code = str(item.get('f12', '')).strip()
        name = str(item.get('f14', '')).strip()
        if not code or not name or name == '-':
            continue

        symbol_str = config['format_symbol'](code)
        if dry_run:
            created += 1
            continue

        existing = Symbol.get_by_symbol(symbol_str)
        if existing:
            changed = False
            if existing.full_name != name:
                existing.full_name = name
                changed = True
            if existing.description != name:
                existing.description = name
                changed = True
            if changed:
                updated += 1
        else:
            sym = Symbol(
                symbol=symbol_str,
                ticker=symbol_str,
                full_name=name,
                description=name,
                exchange=config['exchange'],
                type=config['type'],
                is_visible=True,
            )
            db.session.add(sym)
            created += 1

        if (created + updated) % 1000 == 0 and not dry_run:
            db.session.commit()

    if not dry_run:
        db.session.commit()

    logger.info(f'[{config["label"]}] 完成: 新增 {created}, 更新 {updated}')
    return created, updated


def main():
    parser = argparse.ArgumentParser(description='批量导入 A股/港股 股票列表到数据库')
    parser.add_argument('--dry-run', action='store_true', help='只预览不写库')
    parser.add_argument('--market', action='append', choices=['cn', 'hk'],
                        help='指定市场 (可多次使用, 默认全部)')
    args = parser.parse_args()

    markets = args.market or ['cn', 'hk']

    with app.app_context():
        total_created, total_updated = 0, 0
        for market in markets:
            c, u = import_market(market, dry_run=args.dry_run)
            total_created += c
            total_updated += u

        action = '预览' if args.dry_run else '写入'
        logger.info(f'=== 全部完成 ({action}): 新增 {total_created}, 更新 {total_updated} ===')


if __name__ == '__main__':
    main()
