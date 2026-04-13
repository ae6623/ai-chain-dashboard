import argparse
from pathlib import Path
from typing import List

from dotenv import load_dotenv

from app import app
from symbol_registry import upsert_longbridge_symbols


def load_symbols_from_file(path: str) -> List[str]:
    symbols = []
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        symbol = line.strip()
        if symbol and not symbol.startswith('#'):
            symbols.append(symbol)
    return symbols


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Import Longbridge-backed symbols into the local symbol table.')
    parser.add_argument('symbols', nargs='*', help='Symbols to import, for example GOOG.US AAPL.US TSLA.US')
    parser.add_argument('--file', dest='file_path', help='Text file containing one symbol per line')
    return parser.parse_args()


def main() -> int:
    load_dotenv('.env')
    args = parse_args()

    symbols = list(args.symbols)
    if args.file_path:
        symbols.extend(load_symbols_from_file(args.file_path))

    deduped_symbols = []
    for symbol in symbols:
        normalized = symbol.strip().upper()
        if normalized and normalized not in deduped_symbols:
            deduped_symbols.append(normalized)

    if not deduped_symbols:
        print('No symbols provided.')
        return 1

    with app.app_context():
        records = upsert_longbridge_symbols(deduped_symbols)

    print(f'Imported {len(records)} symbols.')
    for record in records:
        print(f'{record.symbol}\t{record.description}\t{record.exchange}\t{record.type}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
