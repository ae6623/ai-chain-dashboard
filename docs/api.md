# Watchlists API 文档

> 当前文档只保留 `watchlists` 相关接口，范围为自选分组本身的增删改查。
> 
> 不包含行情、K 线、指标、AI、流式推送，也不包含 `watchlist items` 子资源接口。

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

## 5. 后续扩展说明

如果后续需要恢复分组内股票管理，可在此文档基础上单独追加：

- `GET /watchlists/{watchlistId}/items`
- `POST /watchlists/{watchlistId}/items`
- `PATCH /watchlists/{watchlistId}/items/{itemId}`
- `DELETE /watchlists/{watchlistId}/items/{itemId}`
