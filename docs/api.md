# 股票终端后端 API 文档

> 面向当前 `frontend2` 页面设计。
> 
> 目标覆盖以下能力：自选分组、自选股票列表、个股快照、K 线与叠加指标、页脚指数摘要、AI 盘面对话、实时推送。
> 
> 当前仓库只有前端页面，本文件为后端接口设计稿，可直接作为后端实现和前后端联调的基础。

## 1. 设计目标

页面当前包含 3 个核心区域：

1. 左侧：自选分组 + 股票列表
2. 中间：个股头部行情 + K 线图 + MA 指标 + 时间周期
3. 右侧：AI 盘面对话框 + 快捷问题 + 上下文摘要
4. 底部：市场指数摘要

因此后端需要提供两类能力：

- `REST API`：用于首屏加载、切换股票、读取历史数据、管理会话
- `流式 API`：用于实时行情更新、AI 对话流式输出

## 2. 基础约定

### 2.1 Base URL

```text
/api/v1
```

### 2.2 鉴权

当前页面没有登录态 UI，但建议后端预留鉴权能力。

```http
Authorization: Bearer <token>
X-Request-Id: <uuid>
```

说明：

- 行情只读接口可根据实际业务决定是否允许匿名访问
- 自选列表、AI 会话接口建议要求登录

### 2.3 通用响应格式

成功：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

失败：

```json
{
  "code": 400100,
  "message": "invalid symbol",
  "data": null,
  "requestId": "e7b0d4d6-0d98-4f39-9a55-84e65d4563c8"
}
```

### 2.4 通用错误码

| code | 含义 |
| --- | --- |
| 0 | 成功 |
| 400100 | 参数错误 |
| 401100 | 未登录或 token 无效 |
| 403100 | 无权限访问资源 |
| 404100 | 资源不存在 |
| 409100 | 资源冲突 |
| 429100 | 请求过于频繁 |
| 500100 | 服务内部错误 |
| 502100 | 上游行情源异常 |
| 503100 | AI 服务暂不可用 |

### 2.5 字段约定

- 时间统一使用 ISO 8601，示例：`2026-04-12T14:05:42Z`
- 金额、价格、百分比等业务字段建议返回数值型，前端负责格式化展示
- 枚举值统一使用英文小写
- 证券代码统一使用交易所后缀格式，例如：`GOOG.US`、`TSM.US`

## 3. 前端功能与接口映射

| 页面功能 | 建议接口 |
| --- | --- |
| 自选分组标签 | `GET /watchlists` |
| 分组下股票列表 | `GET /watchlists/{watchlistId}/items` |
| 切换股票后的头部行情 | `GET /symbols/{symbol}/snapshot` |
| K 线图 | `GET /symbols/{symbol}/candles` |
| MA5/MA8/MA13 叠加指标 | `GET /symbols/{symbol}/indicators` |
| 页脚指数 | `GET /market/overview` |
| AI 面板初始上下文 | `GET /ai/context` |
| AI 快捷问题 | `GET /ai/prompt-suggestions` |
| 创建 AI 会话 | `POST /ai/chat/sessions` |
| 发送 AI 消息 | `POST /ai/chat/sessions/{sessionId}/messages` |
| 获取历史消息 | `GET /ai/chat/sessions/{sessionId}/messages` |
| 实时行情更新 | `GET /stream/quotes` (SSE) |
| AI 流式回复 | `POST /ai/chat/sessions/{sessionId}/messages:stream` (SSE) |

## 4. 数据模型

### 4.1 Watchlist

```json
{
  "id": "wl_recent_etf",
  "name": "最近关注etf",
  "sort": 2,
  "isDefault": true,
  "itemCount": 9
}
```

### 4.2 WatchlistItem

```json
{
  "symbol": "GOOG.US",
  "code": "GOOG",
  "name": "谷歌-C",
  "market": "us",
  "price": 315.72,
  "changePercent": -0.21,
  "changeAmount": -0.65,
  "trend": "down",
  "isActive": true,
  "updatedAt": "2026-04-12T14:05:42Z"
}
```

### 4.3 QuoteSnapshot

```json
{
  "symbol": "GOOG.US",
  "code": "GOOG",
  "name": "谷歌-C",
  "market": "us",
  "currency": "USD",
  "status": "closed",
  "lastPrice": 315.72,
  "changeAmount": -0.65,
  "changePercent": -0.21,
  "open": 316.2,
  "prevClose": 316.37,
  "high": 319.5,
  "low": 314.54,
  "amplitude": 1.57,
  "turnoverRate": 0.38,
  "volume": 11997600,
  "volumeDisplay": "1199.76万股",
  "avgPrice": 303.144,
  "afterHours": {
    "price": 316.3,
    "changeAmount": 0.58,
    "changePercent": 0.18,
    "updatedAt": "2026-04-12T20:00:00Z"
  },
  "updatedAt": "2026-04-12T20:00:00Z"
}
```

### 4.4 Candle

```json
{
  "time": "2026-04-07",
  "open": 308,
  "high": 319.5,
  "low": 314.54,
  "close": 315.72,
  "volume": 12.0
}
```

说明：

- `time` 对于日线返回 `YYYY-MM-DD`
- 分时或分钟线可返回完整时间，例如 `2026-04-12T14:00:00Z`
- `volume` 可返回原始值，若前端图表直接消费数值，建议不要格式化成字符串

### 4.5 IndicatorSeries

```json
{
  "name": "ma5",
  "label": "MA5",
  "color": "#7fd1ff",
  "lineWidth": 2,
  "data": [
    {
      "time": "2026-04-07",
      "value": 303.144
    }
  ]
}
```

### 4.6 MarketIndex

```json
{
  "symbol": "IXIC",
  "name": "纳斯达克",
  "value": 22902.894,
  "changePercent": 0.35,
  "trend": "up",
  "updatedAt": "2026-04-12T14:05:42Z"
}
```

### 4.7 AIContext

```json
{
  "symbol": "GOOG.US",
  "lastPrice": 315.72,
  "indicators": {
    "ma5": 303.144,
    "ma8": 297.34,
    "ma13": 289.11
  },
  "levels": {
    "support": [314.54, 303.144],
    "resistance": [319.5, 325.0]
  },
  "summary": "当前价格仍运行在 MA5 上方，短线结构偏强，但接近前高压力区。"
}
```

### 4.8 ChatSession

```json
{
  "id": "chat_01jre2m6w39w0q2m6j5z1mmb1a",
  "symbol": "GOOG.US",
  "title": "GOOG 盘面对话",
  "createdAt": "2026-04-12T14:05:42Z",
  "updatedAt": "2026-04-12T14:06:18Z"
}
```

### 4.9 ChatMessage

```json
{
  "id": "msg_01jre2myvbh7dsb3g29m0jv5zh",
  "sessionId": "chat_01jre2m6w39w0q2m6j5z1mmb1a",
  "role": "assistant",
  "content": "短线先看 314.540 一带的低点支撑，其次是 MA5 附近 303.144。",
  "status": "done",
  "tokens": 132,
  "createdAt": "2026-04-12T14:06:18Z"
}
```

## 5. REST API 设计

---

## 5.1 获取自选分组

### `GET /watchlists`

用于渲染左侧分组标签，例如：`持仓`、`最近关注etf`、`CPO光`、`ETF`。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| includeItemCount | boolean | 否 | 是否返回每组股票数，默认 `true` |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "wl_holdings",
      "name": "持仓",
      "sort": 1,
      "isDefault": false,
      "itemCount": 5
    },
    {
      "id": "wl_recent_etf",
      "name": "最近关注etf",
      "sort": 2,
      "isDefault": true,
      "itemCount": 9
    }
  ]
}
```

---

## 5.2 获取分组下股票列表

### `GET /watchlists/{watchlistId}/items`

用于渲染左侧股票表格。

### Path 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| watchlistId | string | 是 | 自选分组 ID |

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| page | integer | 否 | 默认 `1` |
| pageSize | integer | 否 | 默认 `50` |
| activeSymbol | string | 否 | 当前选中证券代码，用于返回 `isActive` |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "symbol": "AVGO.US",
        "code": "AVGO",
        "name": "博通",
        "market": "us",
        "price": 371.55,
        "changePercent": 4.69,
        "changeAmount": 16.64,
        "trend": "up",
        "isActive": false,
        "updatedAt": "2026-04-12T14:05:42Z"
      },
      {
        "symbol": "GOOG.US",
        "code": "GOOG",
        "name": "谷歌-C",
        "market": "us",
        "price": 315.72,
        "changePercent": -0.21,
        "changeAmount": -0.65,
        "trend": "down",
        "isActive": true,
        "updatedAt": "2026-04-12T14:05:42Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 50,
      "total": 9
    }
  }
}
```

---

## 5.3 添加自选股票

### `POST /watchlists/{watchlistId}/items`

### 请求体

```json
{
  "symbol": "TSLA.US"
}
```

### 响应

返回新增后的 `WatchlistItem`。

---

## 5.4 删除自选股票

### `DELETE /watchlists/{watchlistId}/items/{symbol}`

### 响应

```json
{
  "code": 0,
  "message": "ok",
  "data": true
}
```

---

## 5.5 获取个股快照

### `GET /symbols/{symbol}/snapshot`

用于中间头部、右侧上下文摘要、行情状态展示。

### Path 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| symbol | string | 是 | 证券代码，例如 `GOOG.US` |

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| includeAfterHours | boolean | 否 | 是否包含盘后数据，默认 `true` |
| includeStats | boolean | 否 | 是否返回扩展统计字段，默认 `true` |

### 响应

返回 `QuoteSnapshot`。

---

## 5.6 获取 K 线数据

### `GET /symbols/{symbol}/candles`

用于中间主图和成交量柱。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| interval | string | 是 | `1m` `5m` `15m` `1d` `1w` `1M` |
| from | string | 否 | 起始时间，ISO 8601 或 `YYYY-MM-DD` |
| to | string | 否 | 结束时间，ISO 8601 或 `YYYY-MM-DD` |
| limit | integer | 否 | 默认 `500`，最大 `2000` |
| adjustment | string | 否 | `none` `forward` `backward` |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "symbol": "GOOG.US",
    "interval": "1d",
    "candles": [
      {
        "time": "2026-04-07",
        "open": 308,
        "high": 319.5,
        "low": 314.54,
        "close": 315.72,
        "volume": 12000000
      }
    ]
  }
}
```

---

## 5.7 获取技术指标序列

### `GET /symbols/{symbol}/indicators`

用于前端绘制 MA5 / MA8 / MA13 等叠加线。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| interval | string | 是 | 与 K 线周期保持一致 |
| indicators | string | 是 | 逗号分隔，例如 `ma5,ma8,ma13` |
| from | string | 否 | 起始时间 |
| to | string | 否 | 结束时间 |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "symbol": "GOOG.US",
    "interval": "1d",
    "series": [
      {
        "name": "ma5",
        "label": "MA5",
        "color": "#7fd1ff",
        "lineWidth": 2,
        "data": [
          {
            "time": "2026-04-07",
            "value": 303.144
          }
        ]
      },
      {
        "name": "ma8",
        "label": "MA8",
        "color": "#ffc857",
        "lineWidth": 2,
        "data": [
          {
            "time": "2026-04-07",
            "value": 297.34
          }
        ]
      }
    ]
  }
}
```

---

## 5.8 获取市场指数摘要

### `GET /market/overview`

用于底部指数条，例如：道琼斯、纳斯达克、标普 500。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| symbols | string | 否 | 逗号分隔，不传则返回默认指数集合 |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "symbol": "DJI",
      "name": "道琼斯",
      "value": 47916.57,
      "changePercent": -0.56,
      "trend": "down",
      "updatedAt": "2026-04-12T14:05:42Z"
    },
    {
      "symbol": "IXIC",
      "name": "纳斯达克",
      "value": 22902.894,
      "changePercent": 0.35,
      "trend": "up",
      "updatedAt": "2026-04-12T14:05:42Z"
    }
  ]
}
```

---

## 5.9 获取 AI 面板上下文

### `GET /ai/context`

用于右侧 AI 面板首次加载时展示摘要和上下文条。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| symbol | string | 是 | 当前选中的证券代码 |
| interval | string | 否 | 默认 `1d` |

### 响应

返回 `AIContext`。

---

## 5.10 获取 AI 快捷问题

### `GET /ai/prompt-suggestions`

用于右侧快捷按钮，如“总结今天走势”“给我一个交易计划”。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| symbol | string | 是 | 当前证券代码 |
| scene | string | 否 | 默认 `chart_copilot` |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    "总结今天走势",
    "给我一个交易计划",
    "看下支撑和压力",
    "这波还能追吗？"
  ]
}
```

---

## 5.11 创建 AI 会话

### `POST /ai/chat/sessions`

当用户打开新股票或第一次发起 AI 对话时创建会话。

### 请求体

```json
{
  "symbol": "GOOG.US",
  "interval": "1d",
  "title": "GOOG 盘面对话"
}
```

### 响应

返回 `ChatSession`。

---

## 5.12 获取会话消息列表

### `GET /ai/chat/sessions/{sessionId}/messages`

用于恢复历史消息。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| cursor | string | 否 | 游标分页 |
| limit | integer | 否 | 默认 `50`，最大 `200` |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": "msg_01",
        "sessionId": "chat_01",
        "role": "assistant",
        "content": "我已经接入当前 GOOG 日K、均线和最近价格数据。",
        "status": "done",
        "createdAt": "2026-04-12T14:05:42Z"
      },
      {
        "id": "msg_02",
        "sessionId": "chat_01",
        "role": "user",
        "content": "看下支撑和压力",
        "status": "done",
        "createdAt": "2026-04-12T14:06:02Z"
      }
    ],
    "nextCursor": null
  }
}
```

---

## 5.13 发送 AI 消息（非流式）

### `POST /ai/chat/sessions/{sessionId}/messages`

适用于普通同步请求，返回完整答复。

### 请求体

```json
{
  "content": "看下支撑和压力",
  "symbol": "GOOG.US",
  "interval": "1d",
  "context": {
    "includeSnapshot": true,
    "includeIndicators": ["ma5", "ma8", "ma13"],
    "includeRecentCandles": 60
  }
}
```

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "userMessage": {
      "id": "msg_user_01",
      "sessionId": "chat_01",
      "role": "user",
      "content": "看下支撑和压力",
      "status": "done",
      "createdAt": "2026-04-12T14:06:02Z"
    },
    "assistantMessage": {
      "id": "msg_ai_01",
      "sessionId": "chat_01",
      "role": "assistant",
      "content": "短线先看 314.540 一带的低点支撑，其次是 MA5 附近 303.144。上方第一压力在 319.500。",
      "status": "done",
      "tokens": 148,
      "createdAt": "2026-04-12T14:06:18Z"
    }
  }
}
```

---

## 5.14 发送 AI 消息（流式）

### `POST /ai/chat/sessions/{sessionId}/messages:stream`

建议使用 `SSE`，便于前端实现“正在分析中”或逐字输出效果。

### 请求体

同 `POST /ai/chat/sessions/{sessionId}/messages`。

### 响应头

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### SSE 事件示例

```text
event: message.created
data: {"messageId":"msg_ai_01","role":"assistant"}

event: message.delta
data: {"messageId":"msg_ai_01","delta":"短线先看 314.540 一带的低点支撑"}

event: message.delta
data: {"messageId":"msg_ai_01","delta":"，其次是 MA5 附近 303.144。"}

event: message.completed
data: {"messageId":"msg_ai_01","tokens":148}
```

### 事件定义

| event | 说明 |
| --- | --- |
| `message.created` | AI 消息已创建 |
| `message.delta` | 增量文本 |
| `message.completed` | 输出完成 |
| `message.error` | 生成失败 |

---

## 6. 实时推送 API

## 6.1 实时行情 SSE

### `GET /stream/quotes?symbols=GOOG.US,AVGO.US,TSLA.US`

用于更新：

- 左侧自选列表最新价和涨跌幅
- 中间头部实时价格
- 右侧上下文摘要中的最新价
- 底部指数实时数据

### SSE 事件示例

```text
event: quote
data: {"symbol":"GOOG.US","price":316.1,"changeAmount":-0.27,"changePercent":-0.09,"updatedAt":"2026-04-12T14:07:03Z"}

event: index
data: {"symbol":"IXIC","value":22920.124,"changePercent":0.43,"updatedAt":"2026-04-12T14:07:03Z"}
```

### 建议

- 服务端每 1 到 3 秒推送一次合并事件
- 无变更时可每 15 秒发送 heartbeat

---

## 7. 推荐前端加载流程

## 7.1 首屏加载

1. `GET /watchlists`
2. `GET /watchlists/{defaultWatchlistId}/items`
3. 选中默认股票后并行请求：
   - `GET /symbols/{symbol}/snapshot`
   - `GET /symbols/{symbol}/candles?interval=1d`
   - `GET /symbols/{symbol}/indicators?interval=1d&indicators=ma5,ma8,ma13`
   - `GET /ai/context?symbol={symbol}&interval=1d`
   - `GET /ai/prompt-suggestions?symbol={symbol}`
4. `GET /market/overview`
5. 建立 `GET /stream/quotes` SSE 连接

## 7.2 切换股票

1. 更新当前 `activeSymbol`
2. 重拉：`snapshot`、`candles`、`indicators`、`ai/context`、`prompt-suggestions`
3. 若需要保留独立会话：为新股票创建新的 `chat session`

## 7.3 发送 AI 消息

1. 如果无会话，先 `POST /ai/chat/sessions`
2. 调用 `POST /ai/chat/sessions/{sessionId}/messages:stream`
3. 前端接收 `message.delta` 并逐步渲染
4. 完成后把消息写入本地消息列表

---

## 8. 非功能性要求

### 8.1 性能建议

- `snapshot` 接口响应时间建议小于 `200ms`
- `candles` 和 `indicators` 接口响应时间建议小于 `500ms`
- AI 首字返回时间建议小于 `2s`
- SSE 长连接应支持断线重连

### 8.2 缓存建议

- `watchlists`：可短缓存 30 到 60 秒
- `candles` 日线：可缓存 30 到 300 秒
- `market/overview`：可缓存 1 到 5 秒
- `snapshot`：实时交易时段建议不走长缓存

### 8.3 幂等与审计

- `POST /ai/chat/sessions/{sessionId}/messages` 建议支持 `Idempotency-Key`
- 所有写操作记录 `userId`、`requestId`、`createdAt`

---

## 9. 最小可实现版本（MVP）

如果先服务当前页面，建议优先实现以下接口：

1. `GET /watchlists`
2. `GET /watchlists/{watchlistId}/items`
3. `GET /symbols/{symbol}/snapshot`
4. `GET /symbols/{symbol}/candles`
5. `GET /symbols/{symbol}/indicators`
6. `GET /market/overview`
7. `GET /ai/context`
8. `GET /ai/prompt-suggestions`
9. `POST /ai/chat/sessions`
10. `POST /ai/chat/sessions/{sessionId}/messages:stream`
11. `GET /stream/quotes`

这样就足够支撑当前页面从静态演示升级为真实可联调版本。

---

## 10. 后续可扩展方向

- 增加财务、估值、公告、研报相关接口
- 增加更多技术指标：MACD、RSI、BOLL、VOL MA
- 增加多市场支持：A 股、港股、ETF、期货、加密资产
- 增加 AI 工具调用，例如“生成交易计划”“识别形态”“给出风险清单”
- 增加用户偏好和多终端会话同步
