# 2026-04-19 工作记录

## 项目: ai-chain-dashboard

### 环境搭建
- 前端: Vite + React，端口 5173
- 后端: Flask + SQLite，端口 5200
- 数据源: Longbridge (主)、AllTick、Binance、Polygon、FMP、Finnhub
- TradingView Charting Library 已内置

### 踩坑记录

#### 1. Flask 单线程阻塞导致保存慢
- **现象**: 新建股票保存 3-5 秒
- **根因**: Flask 开发服务器默认单线程，浏览器同时发几十个 `/api/udf/history` 请求（每个 1-2s），POST 请求排队等
- **修复**: `app.run(threaded=True)`

#### 2. Longbridge QuoteContext 初始化耗时 2.6s
- **现象**: 首次请求总是特别慢
- **根因**: `QuoteContext(Config.from_env())` 初始化要建立 WebSocket 连接，2.6s
- **修复**: 启动时预热 `_get_longbridge_ctx()`，后续请求复用

#### 3. 保存后重拉整树 18-23 秒
- **现象**: POST 保存成功后前端调 `loadTree()` 刷新，整个操作体感很慢
- **根因**: `/api/v1/portfolios/tree` 扫描全部节点 + 每个节点查 Symbol 表，N+1 问题
- **修复**: 前端保存后乐观更新（直接插入节点到本地 state），不再调 `loadTree()`

#### 4. TradingView 切换股票丢失指标
- **现象**: 手动添加的指标（如 FX 指标），切换股票后消失
- **根因**: `symbol` 变化时 useEffect 触发，整个 widget 销毁重建
- **修复**: 用 `chart.setSymbol()` 切换，widget 只创建一次

### 新增功能
- **实时日志面板**: 右下角浮窗，SSE 推送后端日志，>500ms 标红，选中文字时不自动滚动
- **SSE 接口**: `/api/logs/stream`

### 清理
- 删除 28 条 AMAT.US 测试记录 + 9 个根节点孤立股票

### 待优化
- `/api/v1/portfolios/tree` 的 N+1 查询问题（目前靠乐观更新绕过）
- Longbridge history API 国内延迟 1-2s/请求，可考虑本地缓存
