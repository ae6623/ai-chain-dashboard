import argparse
import json
from pathlib import Path

from dotenv import load_dotenv
from longport.openapi import Config, Market, QuoteContext, SecurityListCategory


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Inspect Longbridge security_list output.')
    parser.add_argument('--limit', type=int, default=10, help='Number of sample rows to print')
    return parser.parse_args()


def to_dict(item) -> dict:
    return {
        'symbol': getattr(item, 'symbol', None),
        'name_cn': getattr(item, 'name_cn', None),
        'name_hk': getattr(item, 'name_hk', None),
        'name_en': getattr(item, 'name_en', None),
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    load_dotenv(repo_root / 'api' / '.env')

    args = parse_args()
    ctx = QuoteContext(Config.from_env())
    items = ctx.security_list(Market.US, SecurityListCategory.Overnight)

    rows = [to_dict(item) for item in items]
    summary = {
        'market': 'US',
        'category': 'Overnight',
        'count': len(rows),
        'fields': list(rows[0].keys()) if rows else [],
        'name_cn_nonempty': sum(1 for row in rows if row['name_cn']),
        'name_hk_nonempty': sum(1 for row in rows if row['name_hk']),
        'name_en_nonempty': sum(1 for row in rows if row['name_en']),
        'sample': rows[: max(args.limit, 0)],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
