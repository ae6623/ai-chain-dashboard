
BASE_URL = 'http://127.0.0.1:5101'

## UDF相关

UDF (Universal Data Feed) 是TradingView图表库使用的标准数据格式，用于为图表提供市场数据。

### 获取UDF配置信息
- **接口**: `/api/udf/config`
- **方法**: GET
- **返回**:
  ```json
  {
    "supported_resolutions": ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"],
    "supports_group_request": false,
    "supports_marks": false,
    "supports_timescale_marks": false,
    "supports_time": true,
    "supports_search": true,
    "exchanges": [
      {
        "value": "",
        "name": "All Exchanges",
        "desc": ""
      }
    ],
    "symbols_types": [
      {
        "name": "全部类型",
        "value": ""
      },
      {
        "name": "现货(100)",
        "value": "spot"
      }
    ]
  }
  ```

### 搜索符号
- **接口**: `/api/udf/search`
- **方法**: GET
- **参数**:
  - `query`: 搜索查询字符串（可选）
  - `type`: 符号类型（可选，如"spot"）
  - `exchange`: 交易所（可选）
  - `limit`: 返回结果数量限制（可选，默认50，最大200）
- **返回**:
  ```json
  [
    {
      "symbol": "BTCUSDT",
      "name": "BTC/USDT",
      "exchange": "BINANCE",
      "type": "spot",
      "session": "24x7",
      "timezone": "UTC",
      "ticker": "BTCUSDT",
      "minmov": 1,
      "pricescale": 100,
      "has_intraday": true,
      "has_daily": true,
      "has_weekly": true,
      "has_monthly": true,
      "supported_resolutions": ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"],
      "data_status": "streaming"
    }
  ]
  ```

### 获取符号详细信息
- **接口**: `/api/udf/symbols`
- **方法**: GET
- **参数**:
  - `symbol`: 符号名称（必需）
- **返回**:
  ```json
  {
    "symbol": "BTCUSDT",
    "name": "BTC/USDT",
    "exchange": "BINANCE",
    "type": "spot",
    "session": "24x7",
    "timezone": "UTC",
    "ticker": "BTCUSDT",
    "minmov": 1,
    "pricescale": 100,
    "has_intraday": true,
    "has_daily": true,
    "has_weekly": true,
    "has_monthly": true,
    "supported_resolutions": ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"],
    "data_status": "streaming"
  }
  ```

### 获取历史数据
- **接口**: `/api/udf/history`
- **方法**: GET
- **参数**:
  - `symbol`: 符号名称（必需）
  - `resolution`: 时间分辨率（可选，如"1"、"5"、"15"、"30"、"60"、"240"、"D"、"W"、"M"）
  - `from`: 开始时间戳（可选）
  - `to`: 结束时间戳（可选）
  - `countback`: 返回K线数量（可选）
- **返回**:
  ```json
  {
    "s": "ok",
    "t": [1640995200, 1640995260, 1640995320],
    "o": [47000.0, 47100.0, 47200.0],
    "h": [47500.0, 47600.0, 47700.0],
    "l": [46800.0, 46900.0, 47000.0],
    "c": [47200.0, 47300.0, 47400.0],
    "v": [1500.5, 1600.8, 1700.2]
  }
  ```

**错误响应示例**:
```json
{
  "s": "error",
  "errmsg": "Symbol 'INVALID' not found"
}
```

### 支持的分辨率说明
- `1`: 1分钟
- `5`: 5分钟
- `15`: 15分钟
- `30`: 30分钟
- `60`: 60分钟（1小时）
- `240`: 240分钟（4小时）
- `D`: 日K线
- `W`: 周K线
- `M`: 月K线

### 符号格式说明
- 支持单独符号格式：`BTCUSDT`
- 支持交易所前缀格式：`BINANCE:BTCUSDT`
- 符号名称不区分大小写
