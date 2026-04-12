import os
from dotenv import load_dotenv

load_dotenv()

ENV = os.getenv('ENV', 'dev')


class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'a-very-very-secret-key')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'sqlite:///udf.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_size': 3,
        'max_overflow': 2,
        'pool_timeout': 10,
        'pool_recycle': 300,
        'pool_pre_ping': True,
    }


# Data Provider API configs
ALLTICK_CONFIG = {
    "token": os.getenv('ALLTICK_TOKEN', ''),
    "stock_api_url": "https://quote.alltick.io/quote-stock-b-api/kline",
    "crypto_api_url": "https://quote.alltick.io/quote-b-api/kline",
    "timeout": 30,
    "retry_count": 3,
    "retry_delay": 2,
}

LONGBRIDGE_CONFIG = os.getenv('LONGPORT_ACCESS_TOKEN')

BINANCE_CONFIG = {
    'api_key': os.getenv('BINANCE_API_KEY'),
    'api_secret': os.getenv('BINANCE_API_SECRET')
}

DATA_PROVIDER = {
    'binance': {
        'is_available': True,
        'priority': 1
    },
    'longbridge': {
        'is_available': True,
        'priority': 2
    },
    'alltick': {
        'is_available': True,
        'priority': 4
    },
    'polygon': {
        'is_available': True,
        'priority': 5
    },
    'fmp': {
        'is_available': True,
        'priority': 3
    },
    'finnhub': {
        'is_available': True,
        'priority': 6
    }
}

POLYGON_API_KEY = os.getenv('POLYGON_API_KEY')
FMP_API_KEY = os.getenv('FMP_API_KEY')
FINNHUB_API_KEY = os.getenv('FINNHUB_API_KEY')
