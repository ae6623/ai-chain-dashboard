# Stock Platform

TradingView 兼容的行情看板平台，包含后端 UDF 数据服务和前端图表界面。

## 项目结构

```
stock-platform/
├── api/            # Flask 后端 — UDF 数据服务 (Binance / LongBridge / FMP 等多数据源)
├── frontend2/      # Vite + React 前端 — Lightweight Charts 行情看板
└── docs/           # 接口文档 & 自定义指标说明
```

## 快速开始

### 后端

```bash
cd api
cp .env.example .env   # 配置数据源密钥
pip install -r requirements.txt
python app.py
```

### 前端

```bash
cd frontend2
npm install
npm run dev
```

## 文档

- [API 接口文档](docs/api.md)
- [UDF 协议说明](docs/udf.md)
- [自定义指标](docs/custom-indicators.md)
