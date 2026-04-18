# 后台 API 文档

本文档包含两组业务接口：

1. **Portfolios**（推荐）：新版文件夹式自选结构，节点支持 `folder` / `stock` / `markdown` 三种类型，任意深度嵌套。
2. **Watchlists**（保留）：旧版扁平自选分组，仅兼容存量调用；新前端不再使用。

> 2026-04 起所有前端功能应使用 Portfolios；Watchlists 接口进入只读维护期。

## 1. 基础约定

### 1.1 Base URL

```text
/api/v1
```

### 1.2 鉴权

`watchlists` 属于用户个人数据，接口默认要求登录。

```http
Authorization: Bearer <token>
X-Request-Id: <uuid>
```

### 1.3 通用响应格式

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
  "code": 404100,
  "message": "watchlist not found",
  "data": null,
  "requestId": "e7b0d4d6-0d98-4f39-9a55-84e65d4563c8"
}
```

### 1.4 通用错误码

| code | 含义 |
| --- | --- |
| 0 | 成功 |
| 400100 | 参数错误 |
| 401100 | 未登录或 token 无效 |
| 403100 | 无权限访问资源 |
| 404100 | 资源不存在 |
| 409100 | 资源冲突 |
| 500100 | 服务内部错误 |

## 2. 数据模型

### 2.1 Watchlist

```json
{
  "id": 2,
  "name": "最近关注 ETF",
  "sort": 2,
  "isDefault": true,
  "itemCount": 9,
  "createdAt": "2026-04-12T14:05:42Z",
  "updatedAt": "2026-04-12T14:05:42Z"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | integer | 自选分组 ID，自增主键 |
| name | string | 分组名称 |
| sort | integer | 排序值，数值越小越靠前 |
| isDefault | boolean | 是否默认分组 |
| itemCount | integer | 当前分组下股票数量 |
| createdAt | string | 创建时间，ISO 8601 |
| updatedAt | string | 更新时间，ISO 8601 |

## 3. REST API

---

## 3.1 获取自选分组列表

### `GET /watchlists`

返回当前用户的全部自选分组，按 `sort` 升序排列。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| includeItemCount | boolean | 否 | 是否返回 `itemCount`，默认 `true` |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": 1,
      "name": "持仓",
      "sort": 1,
      "isDefault": false,
      "itemCount": 5,
      "createdAt": "2026-04-12T14:05:42Z",
      "updatedAt": "2026-04-12T14:05:42Z"
    },
    {
      "id": 2,
      "name": "最近关注 ETF",
      "sort": 2,
      "isDefault": true,
      "itemCount": 9,
      "createdAt": "2026-04-12T14:05:42Z",
      "updatedAt": "2026-04-12T14:05:42Z"
    }
  ]
}
```

---

## 3.2 获取单个自选分组详情

### `GET /watchlists/{watchlistId}`

根据分组 ID 获取单个自选分组详情。

### Path 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| watchlistId | integer | 是 | 自选分组 ID |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 2,
    "name": "最近关注 ETF",
    "sort": 2,
    "isDefault": true,
    "itemCount": 9,
    "createdAt": "2026-04-12T14:05:42Z",
    "updatedAt": "2026-04-12T14:05:42Z"
  }
}
```

---

## 3.3 创建自选分组

### `POST /watchlists`

创建一个新的自选分组。

### 请求体

```json
{
  "name": "半导体",
  "sort": 3,
  "isDefault": false
}
```

### 请求字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| name | string | 是 | 分组名称，建议 1 到 32 个字符 |
| sort | integer | 否 | 排序值，不传则追加到末尾 |
| isDefault | boolean | 否 | 是否设为默认分组，默认 `false` |

> `id` 由服务端自动分配，返回值为自增整数。

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 3,
    "name": "半导体",
    "sort": 3,
    "isDefault": false,
    "itemCount": 0,
    "createdAt": "2026-04-12T14:10:00Z",
    "updatedAt": "2026-04-12T14:10:00Z"
  }
}
```

---

## 3.4 更新自选分组

### `PATCH /watchlists/{watchlistId}`

更新指定自选分组，支持部分字段修改。

### Path 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| watchlistId | integer | 是 | 自选分组 ID |

### 请求体

```json
{
  "name": "重点观察 ETF",
  "sort": 1,
  "isDefault": true
}
```

### 请求字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| name | string | 否 | 新分组名称 |
| sort | integer | 否 | 新排序值 |
| isDefault | boolean | 否 | 是否设为默认分组 |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 2,
    "name": "重点观察 ETF",
    "sort": 1,
    "isDefault": true,
    "itemCount": 9,
    "createdAt": "2026-04-12T14:05:42Z",
    "updatedAt": "2026-04-12T14:12:30Z"
  }
}
```

---

## 3.5 删除自选分组

### `DELETE /watchlists/{watchlistId}`

删除指定自选分组。

### Path 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| watchlistId | integer | 是 | 自选分组 ID |

### 删除约定

- 如果分组不存在，返回 `404100`
- 如果分组下仍有股票，后端可二选一：
  - 直接删除并级联删除关联数据
  - 返回 `409100`，要求前端先清空分组
- 如果该分组是唯一默认分组，后端应在删除前重新指定新的默认分组，或拒绝删除并返回 `409100`

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": true
}
```

## 4. 推荐校验规则

- `name` 不能为空，建议去除首尾空格后校验长度
- 同一用户下的 `watchlist name` 建议唯一，重复时返回 `409100`
- `sort` 应为非负整数
- 同一用户应始终最多只有一个默认分组

---

# Portfolios API（新版）

Portfolios 模块借鉴 Unix VFS 的 **inode + dentry** 抽象，用一棵树表达"文件夹 / 股票 / markdown 笔记"三类节点，可以任意层级嵌套。

- **inode**：节点本体，决定「这是什么」（`folder` / `stock` / `markdown`），承载类型私有数据（股票的 symbol、markdown 的 content）。
- **dentry**：节点在树里的挂载位置，决定「叫什么名字，挂在谁下面，排在第几位」。一个 inode 理论上可以被挂到多处（硬链接），当前接口默认 1:1。

前端大部分操作都针对 **dentry**（节点位置），通过 `dentryId` 访问。

## P1. 数据模型

### P1.1 PortfolioNode（响应返回的节点形状）

```json
{
  "dentryId": 12,
  "inodeId": 5,
  "parentId": 3,
  "type": "stock",
  "name": "苹果",
  "sort": 0,
  "createdAt": "2026-04-17T12:00:00Z",
  "updatedAt": "2026-04-17T12:00:00Z",

  "symbol": "AAPL.US",
  "ticker": "AAPL",
  "fullName": "NASDAQ:AAPL",
  "description": "Apple Inc.",
  "exchange": "NASDAQ",
  "stockType": "stocks-us"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| dentryId | integer | 挂载点 ID（前端通常用这个） |
| inodeId | integer | 节点本体 ID |
| parentId | integer / null | 父 inode ID；顶层节点为 `null` |
| type | string | `folder` / `stock` / `markdown` |
| name | string | 显示名（来自 dentry.name，可随位置不同而不同） |
| sort | integer | 同级排序，越小越靠前 |
| createdAt / updatedAt | string | ISO 8601 |

类型相关的附加字段：

| 节点类型 | 额外字段 |
| --- | --- |
| `stock` | `symbol` (规范化代码) / `ticker` / `fullName` / `description` / `exchange` / `stockType`；`ticker` 及之后若 symbol 未在 `symbol` 表解析到，将回退为 `symbol` 原值 |
| `markdown` | `content`（字符串，可能为空字符串，列表响应会省略以节省体积） |

### P1.2 树形响应（`GET /portfolios/tree`）

在 PortfolioNode 基础上额外增加 `children` 数组，递归嵌套：

```json
{
  "dentryId": 1,
  "type": "folder",
  "name": "主仓",
  "parentId": null,
  "children": [
    { "dentryId": 2, "type": "folder", "name": "美股", "children": [
      { "dentryId": 12, "type": "stock", "symbol": "AAPL.US", "children": [] }
    ]}
  ]
}
```

> 列表/树视图响应中，`markdown` 节点**不返回 `content`**；需要内容请调用 `GET /portfolios/nodes/{dentryId}`。

## P2. 端点列表

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/portfolios/tree` | 一次拉取整棵森林，嵌套 children |
| GET | `/portfolios/roots` | 只列顶层节点（不含 children） |
| GET | `/portfolios/nodes/{dentryId}` | 获取单节点详情（含 markdown `content`） |
| GET | `/portfolios/nodes/{dentryId}/children` | 只列直接子节点 |
| POST | `/portfolios/nodes` | 创建节点 |
| PATCH | `/portfolios/nodes/{dentryId}` | 改名 / 移动 / 改排序 / 改类型内容 |
| DELETE | `/portfolios/nodes/{dentryId}` | 解挂该位置；若 inode 无其他挂载则递归删除其子树 |

### P2.1 GET /portfolios/tree

获取整棵森林。单次请求拉齐所有 dentry + inode + 类型数据，内存拼装。

**响应示例：**

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "dentryId": 1, "inodeId": 1, "parentId": null,
      "type": "folder", "name": "主仓", "sort": 0,
      "createdAt": "...", "updatedAt": "...",
      "children": [ /* PortfolioNode 数组 */ ]
    }
  ]
}
```

### P2.2 GET /portfolios/roots

只列顶层节点（`parentId = null`），不含 children；用于顶层分组管理。

### P2.3 GET /portfolios/nodes/{dentryId}

获取单个节点详情。markdown 节点返回完整 `content`。

**错误：** `404200` - 节点不存在。

### P2.4 GET /portfolios/nodes/{dentryId}/children

只列直接子节点，不递归。

### P2.5 POST /portfolios/nodes

创建新节点。会在同一事务里：新建 `inode` → 建类型数据行（stock/markdown）→ 建 `dentry`。

**请求体：**

```json
{
  "type": "stock",
  "name": "英伟达",
  "parentId": 2,
  "sort": 3,
  "symbol": "NVDA.US"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| type | string | 是 | `folder` / `stock` / `markdown` |
| name | string | 是 | 显示名，1~255 字符 |
| parentId | integer / null | 否 | 父 inode ID；默认 `null`（挂到顶层） |
| sort | integer | 否 | 非负整数；不传则追加到同级末尾 |
| symbol | string | type=stock 时必填 | 股票代码，1~32 字符；服务端会通过 `symbol` 表 / Longbridge 规范化 |
| content | string / null | type=markdown 时可选 | markdown 正文，默认空字符串 |

**错误码：**

| code | 含义 |
| --- | --- |
| 400100 | 参数错误（字段缺失 / 非法 / type 不合法 / 长度超限等） |
| 400200 | parentId 指向的 inode 不存在 |
| 409200 | 约束冲突（同 parent 下 inode 已被挂载） |

**响应：** 返回新建节点（含 `dentryId`、`inodeId`）。

### P2.6 PATCH /portfolios/nodes/{dentryId}

部分字段更新，支持改名、移动、换股票代码、改 markdown 内容。

**请求体示例：**

```json
{
  "name": "新名字",
  "parentId": 5,
  "sort": 2,
  "content": "# 新笔记"
}
```

| 字段 | 适用类型 | 说明 |
| --- | --- | --- |
| name | 所有 | 新显示名 |
| parentId | 所有 | 移动到新父节点；传 `null` 表示提升到顶层 |
| sort | 所有 | 新排序值 |
| symbol | stock | 更新股票代码，会重新规范化 |
| content | markdown | 覆盖 markdown 正文 |

**错误码：**

| code | 含义 |
| --- | --- |
| 400100 | 参数错误 |
| 400200 | parentId 指向的 inode 不存在 |
| 400201 | 企图把节点移入自己的后代（循环） |
| 400202 | 在非 stock 节点上传了 `symbol` |
| 400203 | 在非 markdown 节点上传了 `content` |
| 404200 | dentry 不存在 |
| 409200 | 冲突 |

### P2.7 DELETE /portfolios/nodes/{dentryId}

删除挂载点。语义：

1. 删除当前 dentry。
2. 若该 inode 再没有任何 dentry 指向它（当前默认 1:1 就是这种情况），递归删除其子 dentry 对应的 inode（子树 cascade 消失）。
3. 子节点若存在**外部硬链接**（被子树外的 dentry 引用），跳过该节点及其后代，保留其他引用。

**错误码：** `404200`。

---

# 迁移说明：Watchlist → Portfolio

2026-04 的迁移脚本 (`api/scripts/migrate_watchlist_to_portfolio.py`) 把旧数据一次性灌入新树：

- 每个 **Watchlist** → 顶层 `folder` dentry，`name` 复用，`sort` 复用。
- 每个 **WatchlistItem** → `stock` 节点：
  - 若 `category` / `group_name` 有值，在对应 watchlist folder 下先建（或复用）同名 `folder` 再挂 stock。
  - 无分类则直接挂在 watchlist folder 下。
- Watchlist 及 WatchlistItem 表**不删**，继续保留以便回滚；新写入请走 Portfolios 接口。

---

# Symbols API

## S1. 获取证券基本信息

### `GET /symbols/{symbol}/static-info`

根据股票代码获取公司基本信息。数据来源于长桥 OpenAPI，首次请求会从长桥拉取并缓存到 `symbol` 表的 `static_info` 字段（JSON），后续请求优先读取缓存，缓存有效期 24 小时。

### Path 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| symbol | string | 是 | 股票代码，格式 `ticker.region`，如 `AAPL.US`、`700.HK`、`600519.SH` |

### 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "symbol": "AAPL.US",
    "name_cn": "苹果",
    "name_en": "Apple Inc.",
    "name_hk": "",
    "exchange": "NASD",
    "currency": "USD",
    "lot_size": 1,
    "total_shares": 1631944100,
    "circulating_shares": 16302661350,
    "hk_shares": null,
    "eps": "5.669",
    "eps_ttm": "6.0771",
    "bps": "4.40197",
    "dividend_yield": "0.85",
    "stock_derivatives": [1],
    "board": "USMain",
    "cached_at": 1713451200.123
  }
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| symbol | string | 证券代码 |
| name_cn | string | 中文简体名称 |
| name_en | string | 英文名称 |
| name_hk | string | 中文繁体名称 |
| exchange | string | 所属交易所 |
| currency | string | 交易币种（`CNY` / `USD` / `HKD` / `SGD`） |
| lot_size | integer | 每手股数 |
| total_shares | integer | 总股本 |
| circulating_shares | integer | 流通股本 |
| hk_shares | integer / null | 港股股本（仅港股） |
| eps | string / null | 每股收益 |
| eps_ttm | string / null | 每股收益（TTM） |
| bps | string / null | 每股净资产 |
| dividend_yield | string / null | 股息率 |
| stock_derivatives | integer[] | 支持的衍生品类型（`1` = 期权，`2` = 窝轮） |
| board | string | 所属板块 |
| cached_at | number | 缓存时间戳（Unix epoch 秒） |

### 错误码

| code | 含义 |
| --- | --- |
| 404100 | symbol 不存在或无法获取基本信息 |

---

## 旧 Watchlists 接口后续扩展

如需再给旧接口加股票子资源（不推荐），可在此文档基础上追加：

- `GET /watchlists/{watchlistId}/items`
- `POST /watchlists/{watchlistId}/items`
- `PATCH /watchlists/{watchlistId}/items/{itemId}`
- `DELETE /watchlists/{watchlistId}/items/{itemId}`
