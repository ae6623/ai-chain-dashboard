# UDF API - Standalone TradingView Data Feed Server

从 crypta-server 项目中抽离出的独立 UDF (Universal Data Feed) 服务，提供 TradingView 兼容的行情数据接口。

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 配置环境变量（复制并修改）
cp .env.example .env

# 启动开发服务器
python app.py

# 可选：批量导入一组 Longbridge 标的
python scripts/import_longbridge_symbols.py GOOG.US AAPL.US
```

## 接口列表

| 路径 | 说明 |
|------|------|
| `/api/udf/config` | UDF 配置信息 |
| `/api/udf/time` | 服务器时间 |
| `/api/udf/symbols?symbol=BTCUSDT` | 符号详细信息 |
| `/api/udf/search?query=BTC` | 搜索符号 |
| `/api/udf/history?symbol=BTCUSDT&resolution=15&countback=300` | 历史K线数据 |
| `/api/udf/exchanges` | 所有交易所 |
| `/api/udf/symbol_types` | 所有符号类型 |
| `/api/udf/stats` | 统计信息 |

## 环境变量

参见 `.env.example` 中的配置项说明。

## 数据提供者

支持多个数据源，按优先级依次尝试：
- Binance（加密货币）
- LongBridge（港美股）
- FMP（综合）
- AllTick（综合）
- Polygon（外汇/指数）
- Finnhub（综合）
