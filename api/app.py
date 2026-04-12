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
from sqlalchemy.exc import IntegrityError

# 确保当前目录在 sys.path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models import db, Symbol, Watchlist
from form import F_str, F_int, form_validator, FormError
from const import SymbolType, Provider

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

# ---------- Flask app ----------
app = Flask(__name__)
app.config.from_object('config.Config')
CORS(app)
db.init_app(app)
with app.app_context():
    db.create_all()


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
    else:
        return timestamp
    return int(aligned_dt.timestamp())


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


@api_v1_bp.route('/watchlists/<string:watchlist_id>', methods=['GET'])
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
        id=f"wl_{uuid4().hex[:12]}",
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


@api_v1_bp.route('/watchlists/<string:watchlist_id>', methods=['PATCH'])
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


@api_v1_bp.route('/watchlists/<string:watchlist_id>', methods=['DELETE'])
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


# ---------- UDF Blueprint ----------
BASE_UDF_CONFIG = {
    "supported_resolutions": ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"],
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
        if ":" in symbol:
            exchange, symbol_name = symbol.split(":", 1)
            symbol_obj = Symbol.query.filter_by(
                exchange=exchange.upper(), symbol=symbol_name.upper()
            ).first()
            if symbol_obj:
                return symbol_obj
            symbol_obj = Symbol.get_by_symbol(symbol.upper())
        else:
            symbol_obj = Symbol.get_by_symbol(symbol.upper())
        return symbol_obj
    except Exception:
        return None


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
    symbol_data = symbol_obj.to_dict_extended()
    if 'supported_resolutions' not in symbol_data:
        symbol_data["supported_resolutions"] = BASE_UDF_CONFIG["supported_resolutions"]
    return jsonify(symbol_data)


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
    matching_symbols = []
    for symbol in symbols_list:
        symbol_data = symbol.to_dict_extended()
        if 'supported_resolutions' not in symbol_data:
            symbol_data["supported_resolutions"] = BASE_UDF_CONFIG["supported_resolutions"]
        matching_symbols.append(symbol_data)
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
    ('countback', F_int('countback') & 'strict' & 'required'),
    ('provider', F_str('provider', choices=Provider) & 'strict' & 'optional'),
])
def history(vars):
    if not vars['to']:
        vars['to'] = int(time.time())
    if vars['countback'] >= 1000:
        vars['countback'] = 1000
    if not vars['resolution']:
        vars['resolution'] = "15"

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
            to_time=to_time,
            countback=vars['countback'],
            preferred_provider=preferred_provider,
        )

        if result.get('s') == 'ok' and result.get('t'):
            timestamps = result['t']
            valid_indices = [i for i, ts in enumerate(timestamps) if ts <= vars['to']]
            if valid_indices:
                result['t'] = [timestamps[i] for i in valid_indices]
                for k in ['o', 'h', 'l', 'c', 'v']:
                    if result.get(k):
                        result[k] = [result[k][i] for i in valid_indices]
            else:
                result = {"s": "no_data", "nextTime": vars['to']}

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
