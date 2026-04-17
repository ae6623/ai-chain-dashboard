"""
UDF API - Standalone TradingView Data Feed Server

独立的 UDF 数据服务，提供 TradingView 兼容的行情数据接口。
"""

import sys
import os
import time
import logging
import datetime
from logging.handlers import RotatingFileHandler
from uuid import uuid4
from flask import Flask, Blueprint, jsonify, request, g
from flask_cors import CORS
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

# 确保当前目录在 sys.path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models import db, Symbol, Watchlist, WatchlistItem, Inode, Dentry, DataStock, DataMarkdown, to_iso8601
from form import F_str, F_int, form_validator, FormError
from const import SymbolType, Provider
from symbol_registry import search_longbridge_symbols, sync_longbridge_symbol

# ---------- logging ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, 'logs')
LOG_FORMAT = "[%(asctime)s] %(levelname)s in %(module)s: %(message)s"
RUNTIME_LOG_FILE = os.path.join(LOG_DIR, 'app.log')
ERROR_LOG_FILE = os.path.join(LOG_DIR, 'error.log')


def build_rotating_handler(path, level):
    handler = RotatingFileHandler(path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding='utf-8')
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    return handler


def configure_logging():
    os.makedirs(LOG_DIR, exist_ok=True)

    app_logger = logging.getLogger("app")
    app_logger.setLevel(logging.INFO)
    app_logger.propagate = False

    for existing_handler in list(app_logger.handlers):
        app_logger.removeHandler(existing_handler)
        existing_handler.close()

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))

    runtime_handler = build_rotating_handler(RUNTIME_LOG_FILE, logging.INFO)
    error_handler = build_rotating_handler(ERROR_LOG_FILE, logging.ERROR)

    for handler in (console_handler, runtime_handler, error_handler):
        app_logger.addHandler(handler)

    return app_logger


logger = configure_logging()

LEGACY_WATCHLIST_INDEXES = (
    'idx_watchlist_sort',
    'idx_watchlist_default',
)
LEGACY_WATCHLIST_ITEM_INDEXES = (
    'idx_watchlist_item_watchlist_sort',
    'idx_watchlist_item_symbol',
)


def column_uses_integer_type(column_info):
    return 'INT' in str(column_info.get('type', '')).upper()


def watchlist_schema_needs_id_migration():
    inspector = inspect(db.engine)
    if not inspector.has_table('watchlist'):
        return False

    watchlist_columns = {column['name']: column for column in inspector.get_columns('watchlist')}
    if not column_uses_integer_type(watchlist_columns.get('id', {})):
        return True

    if not inspector.has_table('watchlist_item'):
        return False

    item_columns = {column['name']: column for column in inspector.get_columns('watchlist_item')}
    return not column_uses_integer_type(item_columns.get('id', {})) or not column_uses_integer_type(
        item_columns.get('watchlist_id', {})
    )


def migrate_watchlist_ids_to_integer():
    inspector = inspect(db.engine)
    if not inspector.has_table('watchlist') or not watchlist_schema_needs_id_migration():
        return

    if db.engine.dialect.name != 'sqlite':
        raise RuntimeError('watchlist id migration requires sqlite or a manual migration for this database backend')

    watchlist_item_exists = inspector.has_table('watchlist_item')
    logger.info('Migrating watchlist and watchlist item ids to integer primary keys')

    with db.engine.begin() as connection:
        connection.exec_driver_sql('PRAGMA foreign_keys=OFF')
        if watchlist_item_exists:
            connection.exec_driver_sql('ALTER TABLE watchlist_item RENAME TO watchlist_item_legacy')
        connection.exec_driver_sql('ALTER TABLE watchlist RENAME TO watchlist_legacy')

        for index_name in LEGACY_WATCHLIST_INDEXES:
            connection.exec_driver_sql(f'DROP INDEX IF EXISTS {index_name}')
        if watchlist_item_exists:
            for index_name in LEGACY_WATCHLIST_ITEM_INDEXES:
                connection.exec_driver_sql(f'DROP INDEX IF EXISTS {index_name}')

    db.metadata.create_all(bind=db.engine, tables=[Watchlist.__table__, WatchlistItem.__table__])

    watchlist_count = 0
    item_count = 0
    with db.engine.begin() as connection:
        watchlist_id_map = {}
        legacy_watchlists = connection.exec_driver_sql(
            'SELECT id, name, sort, is_default, item_count, created_at, updated_at '
            'FROM watchlist_legacy ORDER BY sort ASC, created_at ASC'
        ).mappings().all()
        for row in legacy_watchlists:
            result = connection.execute(
                text(
                    'INSERT INTO watchlist (name, sort, is_default, item_count, created_at, updated_at) '
                    'VALUES (:name, :sort, :is_default, :item_count, :created_at, :updated_at)'
                ),
                {
                    'name': row['name'],
                    'sort': row['sort'],
                    'is_default': row['is_default'],
                    'item_count': row['item_count'],
                    'created_at': row['created_at'],
                    'updated_at': row['updated_at'],
                },
            )
            watchlist_id_map[str(row['id'])] = int(result.lastrowid)
            watchlist_count += 1

        if watchlist_item_exists:
            legacy_items = connection.exec_driver_sql(
                'SELECT id, watchlist_id, symbol, display_name, sort, created_at, updated_at '
                'FROM watchlist_item_legacy ORDER BY sort ASC, created_at ASC'
            ).mappings().all()
            for row in legacy_items:
                next_watchlist_id = watchlist_id_map.get(str(row['watchlist_id']))
                if next_watchlist_id is None:
                    continue

                connection.execute(
                    text(
                        'INSERT INTO watchlist_item '
                        '(watchlist_id, symbol, display_name, sort, created_at, updated_at) '
                        'VALUES (:watchlist_id, :symbol, :display_name, :sort, :created_at, :updated_at)'
                    ),
                    {
                        'watchlist_id': next_watchlist_id,
                        'symbol': row['symbol'],
                        'display_name': row['display_name'],
                        'sort': row['sort'],
                        'created_at': row['created_at'],
                        'updated_at': row['updated_at'],
                    },
                )
                item_count += 1

        connection.execute(
            text(
                'UPDATE watchlist '
                'SET item_count = ('
                'SELECT COUNT(*) FROM watchlist_item WHERE watchlist_item.watchlist_id = watchlist.id'
                ')'
            )
        )

        if watchlist_item_exists:
            connection.exec_driver_sql('DROP TABLE watchlist_item_legacy')
        connection.exec_driver_sql('DROP TABLE watchlist_legacy')
        connection.exec_driver_sql('PRAGMA foreign_keys=ON')

    logger.info('Watchlist id migration finished: watchlists=%s items=%s', watchlist_count, item_count)


def ensure_watchlist_item_category_column():
    inspector = inspect(db.engine)
    if not inspector.has_table('watchlist_item'):
        return

    columns = {column['name'] for column in inspector.get_columns('watchlist_item')}
    if 'category' in columns:
        return

    logger.info('Adding category column to watchlist_item table')
    with db.engine.begin() as connection:
        connection.exec_driver_sql('ALTER TABLE watchlist_item ADD COLUMN category VARCHAR(64)')
        existing_indexes = {index['name'] for index in inspector.get_indexes('watchlist_item')}
        if 'idx_watchlist_item_category' not in existing_indexes:
            connection.exec_driver_sql(
                'CREATE INDEX IF NOT EXISTS idx_watchlist_item_category '
                'ON watchlist_item (watchlist_id, category)'
            )


# ---------- Flask app ----------
app = Flask(__name__)
app.config.from_object('config.Config')
CORS(app)
db.init_app(app)
with app.app_context():
    migrate_watchlist_ids_to_integer()
    db.create_all()
    ensure_watchlist_item_category_column()


@app.before_request
def start_request_logging():
    g.request_started_at = time.perf_counter()
    g.request_id = request.headers.get('X-Request-Id') or uuid4().hex[:12]


@app.after_request
def log_request(response):
    started_at = getattr(g, 'request_started_at', None)
    duration_ms = (time.perf_counter() - started_at) * 1000 if started_at is not None else 0
    response.headers['X-Request-Id'] = getattr(g, 'request_id', '-')

    logger.info(
        "[request] id=%s method=%s path=%s query=%s status=%s duration_ms=%.2f remote=%s",
        getattr(g, 'request_id', '-'),
        request.method,
        request.path,
        request.query_string.decode('utf-8', errors='ignore'),
        response.status_code,
        duration_ms,
        request.headers.get('X-Forwarded-For', request.remote_addr),
    )
    return response


logger.info("API logging initialized: runtime_log=%s error_log=%s", RUNTIME_LOG_FILE, ERROR_LOG_FILE)

# ---------- UDF history (延迟初始化) ----------
udf_manager = None


def get_udf_manager():
    global udf_manager
    if udf_manager is None:
        from udf_history import UDFHistoryManager
        udf_manager = UDFHistoryManager()
    return udf_manager


# ---------- Helpers ----------
def json_error(msg='', data=None, code=400):
    return jsonify({'code': code, 'msg': msg, 'data': data})


def api_v1_success(data=None, message='ok'):
    return jsonify({'code': 0, 'message': message, 'data': data})


def api_v1_error(code, message, data=None, status=200):
    payload = {'code': code, 'message': message, 'data': data}
    request_id = request.headers.get('X-Request-Id')
    if request_id:
        payload['requestId'] = request_id
    return jsonify(payload), status


def parse_bool_arg(value, default=True):
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'n', 'off'}:
        return False
    raise ValueError('invalid boolean query parameter')


def parse_watchlist_payload(payload, partial=False):
    if payload is None or not isinstance(payload, dict):
        raise ValueError('request body must be a JSON object')

    cleaned = {}

    if 'name' in payload:
        name = payload.get('name')
        if not isinstance(name, str):
            raise ValueError('name must be a string')
        name = name.strip()
        if not name:
            raise ValueError('name cannot be blank')
        if len(name) > 32:
            raise ValueError('name length must be between 1 and 32 characters')
        cleaned['name'] = name
    elif not partial:
        raise ValueError('name is required')

    if 'sort' in payload:
        sort = payload.get('sort')
        if not isinstance(sort, int) or isinstance(sort, bool):
            raise ValueError('sort must be a non-negative integer')
        if sort < 0:
            raise ValueError('sort must be a non-negative integer')
        cleaned['sort'] = sort

    if 'isDefault' in payload:
        is_default = payload.get('isDefault')
        if not isinstance(is_default, bool):
            raise ValueError('isDefault must be a boolean')
        cleaned['isDefault'] = is_default

    if partial and not cleaned:
        raise ValueError('at least one field is required')

    return cleaned


def parse_watchlist_item_payload(payload, partial=False):
    if payload is None or not isinstance(payload, dict):
        raise ValueError('request body must be a JSON object')

    cleaned = {}

    if 'symbol' in payload:
        symbol = payload.get('symbol')
        if not isinstance(symbol, str):
            raise ValueError('symbol must be a string')
        symbol = symbol.strip().upper()
        if not symbol:
            raise ValueError('symbol cannot be blank')
        if len(symbol) > 32:
            raise ValueError('symbol length must be between 1 and 32 characters')
        cleaned['symbol'] = symbol
    elif not partial:
        raise ValueError('symbol is required')

    if 'displayName' in payload:
        display_name = payload.get('displayName')
        if display_name is None:
            cleaned['displayName'] = None
        else:
            if not isinstance(display_name, str):
                raise ValueError('displayName must be a string or null')
            display_name = display_name.strip()
            if len(display_name) > 128:
                raise ValueError('displayName length must be 128 characters or fewer')
            cleaned['displayName'] = display_name or None

    if 'category' in payload:
        category = payload.get('category')
        if category is None:
            cleaned['category'] = None
        else:
            if not isinstance(category, str):
                raise ValueError('category must be a string or null')
            category = category.strip()
            if len(category) > 64:
                raise ValueError('category length must be 64 characters or fewer')
            cleaned['category'] = category or None

    if 'sort' in payload:
        sort = payload.get('sort')
        if not isinstance(sort, int) or isinstance(sort, bool):
            raise ValueError('sort must be a non-negative integer')
        if sort < 0:
            raise ValueError('sort must be a non-negative integer')
        cleaned['sort'] = sort

    if partial and not cleaned:
        raise ValueError('at least one field is required')

    return cleaned


def get_watchlist_or_error(watchlist_id):
    watchlist = Watchlist.query.get(watchlist_id)
    if watchlist is None:
        return None, api_v1_error(404100, 'watchlist not found')
    return watchlist, None


def resolve_watchlist_item_symbol(symbol):
    normalized_symbol = (symbol or '').strip().upper()
    if not normalized_symbol:
        return None

    symbol_obj = Symbol.query.filter(db.func.upper(Symbol.symbol) == normalized_symbol).first()
    if symbol_obj is not None:
        return symbol_obj

    ticker_obj = Symbol.query.filter(db.func.upper(Symbol.ticker) == normalized_symbol).first()
    if ticker_obj is not None:
        return ticker_obj

    return validate_symbol(normalized_symbol)


def sync_watchlist_item_count(watchlist_id):
    watchlist = Watchlist.query.get(watchlist_id)
    if watchlist is None:
        return None
    watchlist.item_count = WatchlistItem.count_for_watchlist(watchlist_id)
    return watchlist


def ensure_single_default(target_watchlist=None):
    if target_watchlist is None:
        return
    Watchlist.query.filter(Watchlist.id != target_watchlist.id, Watchlist.is_default.is_(True)).update(
        {'is_default': False}, synchronize_session=False
    )


def align_timestamp_to_resolution(timestamp, resolution):
    dt = datetime.datetime.fromtimestamp(timestamp, tz=datetime.timezone.utc)
    if resolution in ["1", "5", "15", "30", "60", "240"]:
        interval_minutes = int(resolution)
        current_minutes = dt.minute
        aligned_minutes = ((current_minutes // interval_minutes) + 1) * interval_minutes
        if aligned_minutes >= 60:
            aligned_dt = dt.replace(minute=0, second=0, microsecond=0)
            hours_to_add = aligned_minutes // 60
            aligned_dt = aligned_dt + datetime.timedelta(hours=hours_to_add)
            aligned_dt = aligned_dt.replace(minute=aligned_minutes % 60)
        else:
            aligned_dt = dt.replace(minute=aligned_minutes, second=0, microsecond=0)
    elif resolution == "1D":
        aligned_dt = dt.replace(hour=0, minute=0, second=0, microsecond=0) + datetime.timedelta(days=1)
    elif resolution == "1W":
        days_until_next_monday = (7 - dt.weekday()) % 7
        if days_until_next_monday == 0:
            days_until_next_monday = 7
        aligned_dt = dt.replace(hour=0, minute=0, second=0, microsecond=0) + datetime.timedelta(days=days_until_next_monday)
    elif resolution == "1M":
        if dt.month == 12:
            aligned_dt = dt.replace(year=dt.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            aligned_dt = dt.replace(month=dt.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif resolution in {"12M", "1Y"}:
        aligned_dt = dt.replace(year=dt.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        return timestamp
    return int(aligned_dt.timestamp())


def normalize_udf_history_window(result, from_time, to_time, countback):
    timestamps = result.get('t') or []
    if not timestamps:
        return result

    opens = result.get('o') or []
    highs = result.get('h') or []
    lows = result.get('l') or []
    closes = result.get('c') or []
    volumes = result.get('v') or []
    bars = []

    for index, ts in enumerate(timestamps):
        if ts > to_time:
            continue
        bars.append({
            't': ts,
            'o': opens[index] if index < len(opens) else None,
            'h': highs[index] if index < len(highs) else None,
            'l': lows[index] if index < len(lows) else None,
            'c': closes[index] if index < len(closes) else None,
            'v': volumes[index] if index < len(volumes) else None,
        })

    if not bars:
        return {"s": "no_data", "nextTime": to_time}

    selected = bars
    if from_time:
        in_range = [bar for bar in bars if bar['t'] >= from_time]
        if countback and len(in_range) < countback:
            older = [bar for bar in bars if bar['t'] < from_time]
            selected = older[-(countback - len(in_range)):] + in_range
        else:
            selected = in_range
    elif countback:
        selected = bars[-countback:]

    if not selected:
        next_time = max((bar['t'] for bar in bars if bar['t'] < from_time), default=to_time)
        return {"s": "no_data", "nextTime": next_time}

    return {
        "s": "ok",
        "t": [bar['t'] for bar in selected],
        "o": [bar['o'] for bar in selected],
        "h": [bar['h'] for bar in selected],
        "l": [bar['l'] for bar in selected],
        "c": [bar['c'] for bar in selected],
        "v": [bar['v'] for bar in selected],
    }


# ---------- Error handlers ----------
@app.errorhandler(FormError)
def handle_form_error(e):
    logger.warning("[form_error] id=%s path=%s error=%s", getattr(g, 'request_id', '-'), request.path, e)
    return json_error(msg=str(e)), 200


@app.errorhandler(Exception)
def handle_error(e):
    db.session.rollback()
    logger.exception(
        "[unhandled_exception] id=%s method=%s path=%s query=%s remote=%s",
        getattr(g, 'request_id', '-'),
        request.method,
        request.path,
        request.query_string.decode('utf-8', errors='ignore'),
        request.headers.get('X-Forwarded-For', request.remote_addr),
    )
    return json_error(msg='server error, retry later'), 200


# ---------- Watchlists Blueprint ----------
api_v1_bp = Blueprint('api_v1', __name__, url_prefix='/api/v1')


@api_v1_bp.route('/watchlists', methods=['GET'])
def list_watchlists():
    try:
        include_item_count = parse_bool_arg(request.args.get('includeItemCount'), default=True)
    except ValueError:
        return api_v1_error(400100, 'invalid includeItemCount')

    watchlists = Watchlist.query.order_by(Watchlist.sort.asc(), Watchlist.created_at.asc()).all()
    return api_v1_success([watchlist.to_api_dict(include_item_count=include_item_count) for watchlist in watchlists])


@api_v1_bp.route('/watchlists/<int:watchlist_id>', methods=['GET'])
def get_watchlist(watchlist_id):
    watchlist = Watchlist.query.get(watchlist_id)
    if not watchlist:
        return api_v1_error(404100, 'watchlist not found')
    return api_v1_success(watchlist.to_api_dict())


@api_v1_bp.route('/watchlists', methods=['POST'])
def create_watchlist():
    try:
        payload = parse_watchlist_payload(request.get_json(silent=True), partial=False)
    except ValueError as exc:
        return api_v1_error(400100, str(exc))

    watchlist = Watchlist(
        name=payload['name'],
        sort=payload.get('sort', Watchlist.get_next_sort()),
        is_default=payload.get('isDefault', False),
    )

    try:
        db.session.add(watchlist)
        db.session.flush()
        if watchlist.is_default:
            ensure_single_default(watchlist)
        elif Watchlist.get_default() is None:
            watchlist.is_default = True
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_v1_error(409100, 'watchlist name already exists')

    return api_v1_success(watchlist.to_api_dict())


@api_v1_bp.route('/watchlists/<int:watchlist_id>', methods=['PATCH'])
def update_watchlist(watchlist_id):
    watchlist = Watchlist.query.get(watchlist_id)
    if not watchlist:
        return api_v1_error(404100, 'watchlist not found')

    try:
        payload = parse_watchlist_payload(request.get_json(silent=True), partial=True)
    except ValueError as exc:
        return api_v1_error(400100, str(exc))

    if 'name' in payload:
        watchlist.name = payload['name']
    if 'sort' in payload:
        watchlist.sort = payload['sort']
    if 'isDefault' in payload:
        watchlist.is_default = payload['isDefault']

    try:
        db.session.flush()
        if watchlist.is_default:
            ensure_single_default(watchlist)
        elif Watchlist.get_default() is None:
            watchlist.is_default = True
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_v1_error(409100, 'watchlist name already exists')

    return api_v1_success(watchlist.to_api_dict())


@api_v1_bp.route('/watchlists/<int:watchlist_id>', methods=['DELETE'])
def delete_watchlist(watchlist_id):
    watchlist = Watchlist.query.get(watchlist_id)
    if not watchlist:
        return api_v1_error(404100, 'watchlist not found')

    replacement = None
    if watchlist.is_default:
        replacement = Watchlist.get_default_replacement(watchlist.id)

    db.session.delete(watchlist)
    if replacement:
        replacement.is_default = True
    db.session.commit()

    return api_v1_success(True)


@api_v1_bp.route('/watchlists/<int:watchlist_id>/items', methods=['GET'])
def list_watchlist_items(watchlist_id):
    watchlist, error_response = get_watchlist_or_error(watchlist_id)
    if error_response is not None:
        return error_response

    items = WatchlistItem.query.filter_by(watchlist_id=watchlist.id).order_by(
        WatchlistItem.sort.asc(), WatchlistItem.created_at.asc()
    ).all()
    return api_v1_success([item.to_api_dict() for item in items])


@api_v1_bp.route('/watchlists/<int:watchlist_id>/items', methods=['POST'])
def create_watchlist_item(watchlist_id):
    watchlist, error_response = get_watchlist_or_error(watchlist_id)
    if error_response is not None:
        return error_response

    try:
        payload = parse_watchlist_item_payload(request.get_json(silent=True), partial=False)
    except ValueError as exc:
        return api_v1_error(400100, str(exc))

    symbol_obj = resolve_watchlist_item_symbol(payload['symbol'])
    resolved_symbol = symbol_obj.symbol if symbol_obj is not None else payload['symbol']
    item = WatchlistItem(
        watchlist_id=watchlist.id,
        symbol=resolved_symbol,
        display_name=payload.get('displayName'),
        category=payload.get('category'),
        sort=payload.get('sort', WatchlistItem.get_next_sort(watchlist.id)),
    )

    try:
        db.session.add(item)
        db.session.flush()
        sync_watchlist_item_count(watchlist.id)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_v1_error(409101, 'watchlist item already exists')

    return api_v1_success(item.to_api_dict(symbol_obj=symbol_obj))


@api_v1_bp.route('/watchlists/<int:watchlist_id>/items/<int:item_id>', methods=['PATCH'])
def update_watchlist_item(watchlist_id, item_id):
    watchlist, error_response = get_watchlist_or_error(watchlist_id)
    if error_response is not None:
        return error_response

    item = WatchlistItem.query.filter_by(id=item_id, watchlist_id=watchlist.id).first()
    if item is None:
        return api_v1_error(404101, 'watchlist item not found')

    try:
        payload = parse_watchlist_item_payload(request.get_json(silent=True), partial=True)
    except ValueError as exc:
        return api_v1_error(400100, str(exc))

    symbol_obj = None
    if 'symbol' in payload:
        symbol_obj = resolve_watchlist_item_symbol(payload['symbol'])
        item.symbol = symbol_obj.symbol if symbol_obj is not None else payload['symbol']
    if 'displayName' in payload:
        item.display_name = payload['displayName']
    if 'category' in payload:
        item.category = payload['category']
    if 'sort' in payload:
        item.sort = payload['sort']

    try:
        db.session.flush()
        sync_watchlist_item_count(watchlist.id)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_v1_error(409101, 'watchlist item already exists')

    return api_v1_success(item.to_api_dict(symbol_obj=symbol_obj))


@api_v1_bp.route('/watchlists/<int:watchlist_id>/items/<int:item_id>', methods=['DELETE'])
def delete_watchlist_item(watchlist_id, item_id):
    watchlist, error_response = get_watchlist_or_error(watchlist_id)
    if error_response is not None:
        return error_response

    item = WatchlistItem.query.filter_by(id=item_id, watchlist_id=watchlist.id).first()
    if item is None:
        return api_v1_error(404101, 'watchlist item not found')

    db.session.delete(item)
    db.session.flush()
    sync_watchlist_item_count(watchlist.id)
    db.session.commit()

    return api_v1_success(True)


# ---------- Portfolio (Inode Tree) ----------
PORTFOLIO_NODE_TYPES = set(Inode.ALLOWED_TYPES)


def parse_node_create_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError('request body must be a JSON object')

    cleaned = {}

    node_type = payload.get('type')
    if node_type not in PORTFOLIO_NODE_TYPES:
        raise ValueError('type must be one of folder/stock/markdown')
    cleaned['type'] = node_type

    name = payload.get('name')
    if not isinstance(name, str):
        raise ValueError('name must be a string')
    name = name.strip()
    if not name:
        raise ValueError('name cannot be blank')
    if len(name) > 255:
        raise ValueError('name length must be 255 characters or fewer')
    cleaned['name'] = name

    parent_id = payload.get('parentId')
    if parent_id is not None and (not isinstance(parent_id, int) or isinstance(parent_id, bool)):
        raise ValueError('parentId must be an integer or null')
    cleaned['parentId'] = parent_id

    if 'sort' in payload and payload['sort'] is not None:
        sort = payload['sort']
        if not isinstance(sort, int) or isinstance(sort, bool) or sort < 0:
            raise ValueError('sort must be a non-negative integer')
        cleaned['sort'] = sort

    if node_type == Inode.TYPE_STOCK:
        symbol = payload.get('symbol')
        if not isinstance(symbol, str):
            raise ValueError('symbol is required for stock node')
        symbol = symbol.strip().upper()
        if not symbol:
            raise ValueError('symbol cannot be blank')
        if len(symbol) > 32:
            raise ValueError('symbol length must be 32 characters or fewer')
        cleaned['symbol'] = symbol
    elif node_type == Inode.TYPE_MARKDOWN:
        content = payload.get('content', '')
        if content is None:
            content = ''
        if not isinstance(content, str):
            raise ValueError('content must be a string or null')
        cleaned['content'] = content

    return cleaned


def parse_node_update_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError('request body must be a JSON object')

    cleaned = {}

    if 'name' in payload:
        name = payload['name']
        if not isinstance(name, str):
            raise ValueError('name must be a string')
        name = name.strip()
        if not name:
            raise ValueError('name cannot be blank')
        if len(name) > 255:
            raise ValueError('name length must be 255 characters or fewer')
        cleaned['name'] = name

    if 'parentId' in payload:
        parent_id = payload['parentId']
        if parent_id is not None and (not isinstance(parent_id, int) or isinstance(parent_id, bool)):
            raise ValueError('parentId must be an integer or null')
        cleaned['parentId'] = parent_id

    if 'sort' in payload:
        sort = payload['sort']
        if not isinstance(sort, int) or isinstance(sort, bool) or sort < 0:
            raise ValueError('sort must be a non-negative integer')
        cleaned['sort'] = sort

    if 'symbol' in payload:
        symbol = payload['symbol']
        if not isinstance(symbol, str):
            raise ValueError('symbol must be a string')
        symbol = symbol.strip().upper()
        if not symbol:
            raise ValueError('symbol cannot be blank')
        if len(symbol) > 32:
            raise ValueError('symbol length must be 32 characters or fewer')
        cleaned['symbol'] = symbol

    if 'content' in payload:
        content = payload['content']
        if content is not None and not isinstance(content, str):
            raise ValueError('content must be a string or null')
        cleaned['content'] = content if content is not None else ''

    if not cleaned:
        raise ValueError('at least one field is required')

    return cleaned


def resolve_stock_symbol(symbol):
    normalized = (symbol or '').strip().upper()
    if not normalized:
        return None, normalized
    symbol_obj = Symbol.query.filter(db.func.upper(Symbol.symbol) == normalized).first()
    if symbol_obj is not None:
        return symbol_obj, symbol_obj.symbol
    ticker_obj = Symbol.query.filter(db.func.upper(Symbol.ticker) == normalized).first()
    if ticker_obj is not None:
        return ticker_obj, ticker_obj.symbol
    validated = validate_symbol(normalized)
    if validated is not None:
        return validated, validated.symbol
    return None, normalized


def build_stock_payload(symbol_string, symbol_obj=None):
    resolved = symbol_obj
    if resolved is None and symbol_string:
        resolved = Symbol.query.filter_by(symbol=symbol_string).first()
    return {
        'symbol': symbol_string,
        'ticker': getattr(resolved, 'ticker', symbol_string),
        'fullName': getattr(resolved, 'full_name', symbol_string),
        'description': getattr(resolved, 'description', symbol_string),
        'exchange': getattr(resolved, 'exchange', ''),
        'stockType': getattr(resolved, 'type', ''),
    }


def node_to_api_dict(dentry, inode, stock=None, markdown=None, include_content=True):
    payload = {
        'dentryId': dentry.id,
        'inodeId': inode.id,
        'parentId': dentry.parent_id,
        'type': inode.type,
        'name': dentry.name,
        'sort': dentry.sort,
        'createdAt': to_iso8601(dentry.created_at),
        'updatedAt': to_iso8601(dentry.updated_at),
    }
    if inode.type == Inode.TYPE_STOCK:
        stock = stock if stock is not None else inode.stock_data
        payload.update(build_stock_payload(stock.symbol if stock else None))
    elif inode.type == Inode.TYPE_MARKDOWN and include_content:
        markdown = markdown if markdown is not None else inode.markdown_data
        payload['content'] = markdown.content if markdown else ''
    return payload


def get_dentry_or_error(dentry_id):
    dentry = Dentry.query.get(dentry_id)
    if dentry is None:
        return None, api_v1_error(404200, 'portfolio node not found')
    return dentry, None


def collect_subtree_inode_ids(root_inode_id):
    """BFS 收集子树下所有 inode id（用于删除 / 循环检测）"""
    visited = {root_inode_id}
    queue = [root_inode_id]
    while queue:
        current = queue.pop(0)
        child_rows = db.session.query(Dentry.child_id).filter(Dentry.parent_id == current).all()
        for (child_id,) in child_rows:
            if child_id in visited:
                continue
            visited.add(child_id)
            queue.append(child_id)
    return visited


def validate_parent(parent_id, self_inode_id=None):
    """返回 (parent_inode, error_response)"""
    if parent_id is None:
        return None, None
    parent_inode = Inode.query.get(parent_id)
    if parent_inode is None:
        return None, api_v1_error(400200, 'parentId not found')
    if self_inode_id is not None:
        descendants = collect_subtree_inode_ids(self_inode_id)
        if parent_id in descendants:
            return None, api_v1_error(400201, 'cannot move node into its own descendant')
    return parent_inode, None


@api_v1_bp.route('/portfolios/tree', methods=['GET'])
def get_portfolio_tree():
    """一次拿整个森林：O(N) 扫描 + 内存拼装"""
    dentries = Dentry.query.order_by(
        Dentry.parent_id.asc(),
        Dentry.sort.asc(),
        Dentry.created_at.asc(),
    ).all()
    inode_ids = {d.child_id for d in dentries}
    inodes = {i.id: i for i in Inode.query.filter(Inode.id.in_(inode_ids)).all()} if inode_ids else {}
    stock_rows = {s.inode_id: s for s in DataStock.query.filter(DataStock.inode_id.in_(inode_ids)).all()} if inode_ids else {}
    md_rows = {m.inode_id: m for m in DataMarkdown.query.filter(DataMarkdown.inode_id.in_(inode_ids)).all()} if inode_ids else {}

    nodes_by_id = {}
    roots = []
    for dentry in dentries:
        inode = inodes.get(dentry.child_id)
        if inode is None:
            continue
        node = node_to_api_dict(
            dentry, inode,
            stock=stock_rows.get(inode.id),
            markdown=md_rows.get(inode.id),
            include_content=False,
        )
        node['children'] = []
        nodes_by_id[dentry.id] = node

    # link children under their parent dentry (match by parent inode -> dentry(s))
    # parent_id on Dentry references inode.id. So find all dentries whose child_id == parent_id.
    dentries_by_child_inode = {}
    for dentry in dentries:
        dentries_by_child_inode.setdefault(dentry.child_id, []).append(dentry.id)

    for dentry in dentries:
        node = nodes_by_id.get(dentry.id)
        if node is None:
            continue
        if dentry.parent_id is None:
            roots.append(node)
            continue
        parent_dentry_ids = dentries_by_child_inode.get(dentry.parent_id, [])
        if not parent_dentry_ids:
            roots.append(node)
            continue
        for parent_dentry_id in parent_dentry_ids:
            parent_node = nodes_by_id.get(parent_dentry_id)
            if parent_node is not None:
                parent_node['children'].append(node if len(parent_dentry_ids) == 1 else dict(node))

    return api_v1_success(roots)


@api_v1_bp.route('/portfolios/nodes/<int:dentry_id>', methods=['GET'])
def get_portfolio_node(dentry_id):
    dentry, error_response = get_dentry_or_error(dentry_id)
    if error_response is not None:
        return error_response
    inode = dentry.child
    return api_v1_success(node_to_api_dict(dentry, inode))


@api_v1_bp.route('/portfolios/nodes/<int:dentry_id>/children', methods=['GET'])
def list_portfolio_children(dentry_id):
    dentry, error_response = get_dentry_or_error(dentry_id)
    if error_response is not None:
        return error_response

    children = Dentry.query.filter(Dentry.parent_id == dentry.child_id).order_by(
        Dentry.sort.asc(), Dentry.created_at.asc()
    ).all()
    inode_ids = [c.child_id for c in children]
    inodes = {i.id: i for i in Inode.query.filter(Inode.id.in_(inode_ids)).all()} if inode_ids else {}

    payload = []
    for child in children:
        inode = inodes.get(child.child_id)
        if inode is None:
            continue
        payload.append(node_to_api_dict(child, inode, include_content=False))
    return api_v1_success(payload)


@api_v1_bp.route('/portfolios/roots', methods=['GET'])
def list_portfolio_roots():
    roots = Dentry.query.filter(Dentry.parent_id.is_(None)).order_by(
        Dentry.sort.asc(), Dentry.created_at.asc()
    ).all()
    inode_ids = [r.child_id for r in roots]
    inodes = {i.id: i for i in Inode.query.filter(Inode.id.in_(inode_ids)).all()} if inode_ids else {}
    payload = []
    for dentry in roots:
        inode = inodes.get(dentry.child_id)
        if inode is None:
            continue
        payload.append(node_to_api_dict(dentry, inode, include_content=False))
    return api_v1_success(payload)


@api_v1_bp.route('/portfolios/nodes', methods=['POST'])
def create_portfolio_node():
    try:
        payload = parse_node_create_payload(request.get_json(silent=True))
    except ValueError as exc:
        return api_v1_error(400100, str(exc))

    parent_inode, error_response = validate_parent(payload['parentId'])
    if error_response is not None:
        return error_response

    inode = Inode(type=payload['type'])
    db.session.add(inode)

    symbol_obj = None
    try:
        db.session.flush()

        if payload['type'] == Inode.TYPE_STOCK:
            symbol_obj, resolved_symbol = resolve_stock_symbol(payload['symbol'])
            db.session.add(DataStock(inode_id=inode.id, symbol=resolved_symbol))
        elif payload['type'] == Inode.TYPE_MARKDOWN:
            db.session.add(DataMarkdown(inode_id=inode.id, content=payload.get('content', '')))

        sort_value = payload.get('sort')
        if sort_value is None:
            sort_value = Dentry.get_next_sort(payload['parentId'])

        dentry = Dentry(
            parent_id=payload['parentId'],
            child_id=inode.id,
            name=payload['name'],
            sort=sort_value,
        )
        db.session.add(dentry)
        db.session.flush()
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_v1_error(409200, 'portfolio node conflict')

    return api_v1_success(node_to_api_dict(
        dentry, inode,
        stock=inode.stock_data,
        markdown=inode.markdown_data,
    ))


@api_v1_bp.route('/portfolios/nodes/<int:dentry_id>', methods=['PATCH'])
def update_portfolio_node(dentry_id):
    dentry, error_response = get_dentry_or_error(dentry_id)
    if error_response is not None:
        return error_response

    try:
        payload = parse_node_update_payload(request.get_json(silent=True))
    except ValueError as exc:
        return api_v1_error(400100, str(exc))

    inode = dentry.child
    if 'symbol' in payload and inode.type != Inode.TYPE_STOCK:
        return api_v1_error(400202, 'symbol can only be set on stock nodes')
    if 'content' in payload and inode.type != Inode.TYPE_MARKDOWN:
        return api_v1_error(400203, 'content can only be set on markdown nodes')

    if 'parentId' in payload and payload['parentId'] != dentry.parent_id:
        _, error_response = validate_parent(payload['parentId'], self_inode_id=inode.id)
        if error_response is not None:
            return error_response
        dentry.parent_id = payload['parentId']

    if 'name' in payload:
        dentry.name = payload['name']
    if 'sort' in payload:
        dentry.sort = payload['sort']

    symbol_obj = None
    if 'symbol' in payload:
        symbol_obj, resolved_symbol = resolve_stock_symbol(payload['symbol'])
        if inode.stock_data is None:
            db.session.add(DataStock(inode_id=inode.id, symbol=resolved_symbol))
        else:
            inode.stock_data.symbol = resolved_symbol

    if 'content' in payload:
        if inode.markdown_data is None:
            db.session.add(DataMarkdown(inode_id=inode.id, content=payload['content']))
        else:
            inode.markdown_data.content = payload['content']

    try:
        db.session.flush()
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_v1_error(409200, 'portfolio node conflict')

    return api_v1_success(node_to_api_dict(
        dentry, inode,
        stock=inode.stock_data,
        markdown=inode.markdown_data,
    ))


def delete_dentry_recursive(dentry):
    """解挂当前 dentry；若其 inode 再无任何挂载点，则递归删除其子 dentry，最后删除该 inode。"""
    inode_id = dentry.child_id
    db.session.delete(dentry)
    db.session.flush()

    still_mounted = db.session.query(Dentry.id).filter(Dentry.child_id == inode_id).first()
    if still_mounted is not None:
        return

    child_dentries = Dentry.query.filter(Dentry.parent_id == inode_id).all()
    for child_dentry in child_dentries:
        delete_dentry_recursive(child_dentry)

    inode = Inode.query.get(inode_id)
    if inode is not None:
        db.session.delete(inode)


@api_v1_bp.route('/portfolios/nodes/<int:dentry_id>', methods=['DELETE'])
def delete_portfolio_node(dentry_id):
    dentry, error_response = get_dentry_or_error(dentry_id)
    if error_response is not None:
        return error_response

    delete_dentry_recursive(dentry)
    db.session.commit()
    return api_v1_success(True)


# ---------- UDF Blueprint ----------
BASE_UDF_CONFIG = {
    "supported_resolutions": ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M", "12M"],
    "supports_group_request": False,
    "supports_marks": False,
    "supports_timescale_marks": False,
    "supports_time": True,
    "supports_search": True
}

bp = Blueprint('udf', __name__, url_prefix='/api/udf')


def get_dynamic_udf_config():
    try:
        exchanges = [{"value": "", "name": "All Exchanges", "desc": ""}]
        types_query = db.session.query(Symbol.type, db.func.count(Symbol.id)).group_by(Symbol.type).all()
        symbols_types = [{"name": "全部", "value": ""}]
        for symbol_type, count in types_query:
            if symbol_type:
                type_desc = SymbolType.get_desc(symbol_type)
                symbols_types.append({"name": type_desc, "value": symbol_type})
        config = BASE_UDF_CONFIG.copy()
        config["exchanges"] = exchanges
        config["symbols_types"] = symbols_types
        return config
    except Exception:
        return {
            **BASE_UDF_CONFIG,
            "exchanges": [{"value": "", "name": "All Exchanges", "desc": ""}],
            "symbols_types": [{"name": "All types", "value": ""}]
        }


def validate_symbol(symbol):
    try:
        normalized_symbol = symbol.upper()
        lookup_symbol = normalized_symbol

        if ":" in normalized_symbol:
            exchange, symbol_name = normalized_symbol.split(":", 1)
            symbol_obj = Symbol.query.filter_by(
                exchange=exchange.upper(), symbol=symbol_name.upper()
            ).first()
            if symbol_obj:
                return symbol_obj
            lookup_symbol = symbol_name.upper()

        symbol_obj = Symbol.get_by_symbol(lookup_symbol)
        if symbol_obj:
            return symbol_obj

        return sync_longbridge_symbol(lookup_symbol)
    except Exception:
        return None


def build_udf_symbol_payload(symbol_obj):
    symbol_data = symbol_obj.to_dict_extended()
    if 'supported_resolutions' not in symbol_data:
        symbol_data['supported_resolutions'] = BASE_UDF_CONFIG['supported_resolutions']
    return symbol_data


@bp.route('/config')
def config_route():
    return jsonify(get_dynamic_udf_config())


@bp.route('/time')
def server_time():
    return str(int(time.time()))


@bp.route('/symbols')
@form_validator([
    ('symbol', F_str('symbol') & 'strict' & 'required'),
])
def symbols(vars):
    symbol_obj = validate_symbol(vars['symbol'])
    if not symbol_obj:
        return json_error(f"Symbol '{vars['symbol']}' not found")
    return jsonify(build_udf_symbol_payload(symbol_obj))


@bp.route('/search')
@form_validator([
    ('query', F_str('query') & 'strict' & 'optional'),
    ('type', F_str('type') & 'strict' & 'optional'),
    ('exchange', F_str('exchange') & 'strict' & 'optional'),
    ('limit', (F_int('limit', 50) <= 200) & 'optional'),
])
def search(vars):
    symbols_list = Symbol.search_symbols(
        query=vars['query'],
        symbol_type=vars['type'],
        exchange=vars['exchange'],
        is_visible=True,
        limit=vars['limit']
    )
    if vars['query'] and len(symbols_list) < vars['limit']:
        remaining = vars['limit'] - len(symbols_list)
        seen_symbols = {symbol.symbol for symbol in symbols_list}
        for symbol in search_longbridge_symbols(
            query=vars['query'],
            symbol_type=vars['type'],
            exchange=vars['exchange'],
            limit=remaining,
        ):
            if symbol.symbol not in seen_symbols:
                symbols_list.append(symbol)
                seen_symbols.add(symbol.symbol)
                if len(symbols_list) >= vars['limit']:
                    break

    matching_symbols = []
    for symbol in symbols_list:
        matching_symbols.append(build_udf_symbol_payload(symbol))
    return jsonify(matching_symbols)


@bp.route('/exchanges')
def exchanges():
    exchanges_query = db.session.query(Symbol.exchange).distinct().all()
    exchange_list = []
    for (exchange,) in exchanges_query:
        if exchange:
            count = Symbol.query.filter_by(exchange=exchange).count()
            exchange_list.append({"exchange": exchange, "name": exchange, "symbol_count": count})
    return jsonify(exchange_list)


@bp.route('/symbol_types')
def symbol_types():
    types_query = db.session.query(Symbol.type).distinct().all()
    type_list = []
    for (symbol_type,) in types_query:
        if symbol_type:
            count = Symbol.query.filter_by(type=symbol_type).count()
            type_list.append({"type": symbol_type, "name": symbol_type.title(), "symbol_count": count})
    return jsonify(type_list)


@bp.route('/stats')
def stats():
    try:
        total_symbols = Symbol.query.count()
        exchange_stats = db.session.query(Symbol.exchange, db.func.count(Symbol.id).label('count')).group_by(Symbol.exchange).all()
        type_stats = db.session.query(Symbol.type, db.func.count(Symbol.id).label('count')).group_by(Symbol.type).all()
        return jsonify({
            "total_symbols": total_symbols,
            "by_exchange": {exchange: count for exchange, count in exchange_stats if exchange},
            "by_type": {symbol_type: count for symbol_type, count in type_stats if symbol_type},
            "supported_resolutions": BASE_UDF_CONFIG["supported_resolutions"],
            "last_updated": datetime.datetime.utcnow().isoformat() + "Z"
        })
    except Exception as e:
        return json_error(f"Stats error: {str(e)}")


@bp.route('/history')
@form_validator([
    ('symbol', F_str('symbol') & 'strict' & 'required'),
    ('resolution', F_str('resolution') & 'strict' & 'optional'),
    ('from', F_int('from') & 'strict' & 'optional'),
    ('to', F_int('to') & 'strict' & 'optional'),
    ('countback', F_int('countback') & 'strict' & 'optional'),
    ('provider', F_str('provider', choices=Provider) & 'strict' & 'optional'),
])
def history(vars):
    if not vars['to']:
        vars['to'] = int(time.time())
    if not vars['countback']:
        vars['countback'] = 0 if vars['from'] else 300
    if vars['countback'] >= 1000:
        vars['countback'] = 1000
    if not vars['resolution']:
        vars['resolution'] = "15"

    from_time = vars['from']
    to_time = align_timestamp_to_resolution(vars['to'], vars['resolution'])

    try:
        symbol_obj = validate_symbol(vars['symbol'])
        if not symbol_obj:
            return jsonify({"s": "error", "errmsg": f"Symbol '{vars['symbol']}' not found"})

        mgr = get_udf_manager()
        preferred_provider = vars['provider'] or symbol_obj.exchange.upper()

        result = mgr.get_history_data(
            symbol=symbol_obj.ticker,
            resolution=vars['resolution'],
            from_time=from_time,
            to_time=to_time,
            countback=vars['countback'],
            preferred_provider=preferred_provider,
        )

        if result.get('s') == 'ok' and result.get('t'):
            effective_to = to_time if vars['resolution'] in {'1D', '1W', '1M', '12M', '1Y'} else vars['to']
            result = normalize_udf_history_window(result, from_time, effective_to, vars['countback'])

        return jsonify(result)

    except Exception as e:
        logger.exception(e)
        return jsonify({"s": "error", "errmsg": f"History error: {str(e)}"})


app.register_blueprint(api_v1_bp)
app.register_blueprint(bp)


# ---------- Health check ----------
@app.route('/health')
def health():
    return jsonify({"status": "ok"})


if __name__ == '__main__':
    with app.app_context():
        db.create_all()

    debug_mode = os.getenv('FLASK_DEBUG', '').strip().lower() in {'1', 'true', 'yes', 'on'}
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', '5200'))

    logger.info("Starting API server host=%s port=%s debug=%s", host, port, debug_mode)
    app.run(host=host, port=port, debug=debug_mode)
