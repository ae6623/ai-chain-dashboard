# TradingView 自定义指标接入说明

本文记录当前项目里，如何给中间的 TradingView 图表增加自定义指标，供后续开发直接复用。

## 1. 当前实现位置

图表组件在：

- `frontend/src/components/TradingChart.jsx`

当前图表接入方式：

- 使用 `TradingView Charting Library`
- 使用项目自己的 UDF datafeed
- 默认均线通过 `chart.createStudy(...)` 自动挂载

关键位置：

- 图表初始化：`frontend/src/components/TradingChart.jsx:321`
- 默认均线挂载：`frontend/src/components/TradingChart.jsx:380`
- K 线数据映射：`frontend/src/components/TradingChart.jsx:145`

## 2. 先判断指标属于哪一类

### 2.1 内置指标

如果只是想加 TradingView 已有指标，例如：

- RSI
- MACD
- Bollinger Bands
- EMA
- Volume

可以直接在 `onChartReady` 后调用：

```js
await chart.createStudy('RSI', true, false)
await chart.createStudy('MACD', true, false)
await chart.createStudy('Bollinger Bands', true, false)
```

这种方式不需要写 `custom_indicators_getter`。

### 2.2 自定义指标

如果指标公式是我们自己的，例如：

- 自定义均线组合
- 策略买卖点
- 通道/带状指标
- 自定义震荡器
- 依赖特定业务逻辑的信号线

就需要在 TradingView widget 配置里增加 `custom_indicators_getter`。

## 3. 当前项目的数据边界

当前 `TradingChart` 传给图表的数据只有：

- `open`
- `high`
- `low`
- `close`
- `volume`

对应代码在 `frontend/src/components/TradingChart.jsx:145`。

这意味着：

- 如果指标只依赖 OHLCV，前端可以直接实现
- 如果指标还依赖额外字段，比如资金流、主力行为、情绪值、策略信号结果，就需要先扩展后端 datafeed

## 4. 接入步骤

### 4.1 在 widget 配置中加入 `custom_indicators_getter`

在 `frontend/src/components/TradingChart.jsx` 的 `new window.TradingView.widget({...})` 配置对象中加入：

```js
custom_indicators_getter: (PineJS) =>
  Promise.resolve([
    createCustomMaIndicator(PineJS),
  ]),
```

建议把具体指标定义提取成独立函数，避免 widget 配置过长。

### 4.2 定义自定义指标对象

下面是一个最小可用示例，演示如何添加一个自定义均线指标：

```js
function createCustomMaIndicator(PineJS) {
  return {
    name: 'My Custom MA',
    metainfo: {
      _metainfoVersion: 53,
      id: 'My Custom MA@tv-basicstudies-1',
      description: 'My Custom MA',
      shortDescription: 'MCMA',
      is_price_study: true,
      is_hidden_study: false,
      isCustomIndicator: true,
      format: {
        type: 'price',
        precision: 2,
      },
      plots: [{ id: 'plot_0', type: 'line' }],
      styles: {
        plot_0: {
          title: 'MCMA',
          histogramBase: 0,
        },
      },
      defaults: {
        styles: {
          plot_0: {
            color: '#ffb703',
            linewidth: 2,
            plottype: 2,
            transparency: 0,
            visible: true,
          },
        },
        inputs: {
          length: 20,
        },
      },
      inputs: [
        {
          id: 'length',
          name: 'Length',
          defval: 20,
          type: 'integer',
          min: 1,
          max: 300,
        },
      ],
    },
    constructor: function () {
      this.init = function (context, inputCallback) {
        this._context = context
        this._input = inputCallback
      }

      this.main = function (context, inputCallback) {
        this._context = context
        this._input = inputCallback

        const length = this._input(0)
        const close = PineJS.Std.close(this._context)
        const value = PineJS.Std.sma(close, length, this._context)

        return [value]
      }
    },
  }
}
```

说明：

- `name` 是图表内部和菜单里识别指标的名称
- `metainfo` 定义指标元信息、输入参数、样式、绘图类型
- `constructor.main` 是每根 bar 的计算逻辑
- 返回数组的顺序，要和 `plots` 的顺序对应

### 4.3 图表初始化后自动加载指标

如果希望图表一打开就自动挂载这个指标，在 `onChartReady` 中继续调用：

```js
await chart.createStudy('My Custom MA', true, false, { length: 20 })
```

如果不自动加载，也可以只注册指标，让用户从指标菜单里自己添加。

## 5. 推荐的代码组织方式

建议把自定义指标从 `TradingChart.jsx` 中拆出来，例如新增：

- `frontend/src/components/chart/customIndicators.js`

示例：

```js
export function getCustomIndicators(PineJS) {
  return [
    createCustomMaIndicator(PineJS),
  ]
}
```

然后在 `TradingChart.jsx` 中接入：

```js
import { getCustomIndicators } from './chart/customIndicators'

custom_indicators_getter: (PineJS) => Promise.resolve(getCustomIndicators(PineJS))
```

这样做的好处：

- `TradingChart.jsx` 不会越来越长
- 多个指标可以集中管理
- 后续更容易拆分公共样式和参数模板

## 6. 什么时候需要改后端

下面这几种情况，不能只改前端：

- 指标依赖 OHLCV 之外的字段
- 指标计算依赖服务端预处理结果
- 指标需要返回买卖信号、评分、标签、事件流
- 指标需要与策略回测结果联动

此时需要一起扩展：

- UDF 接口返回内容
- `TradingChart.jsx` 中的 datafeed 映射逻辑
- 自定义指标的读取逻辑

## 7. 当前项目里的注意事项

### 7.1 切换 symbol 或 interval 会重建 widget

`TradingChart` 的 `useEffect` 依赖包含：

- `datafeed`
- `description`
- `interval`
- `symbol`

因此切换标的或周期时，widget 会重新创建。

影响：

- 用户手动添加的指标可能丢失
- 默认自动挂载的指标需要在 `onChartReady` 里重新创建

所以如果某个指标必须始终显示，应该放到自动挂载逻辑里。

### 7.2 `studies_overrides` 只适合改已挂载指标样式

`studies_overrides` 更适合：

- 修改内置指标样式
- 修改默认参数
- 调整颜色、线宽、透明度

它不是注册自定义指标的入口。

真正的自定义指标入口是：

- `custom_indicators_getter`

## 8. 开发流程建议

后续新增自定义指标时，建议统一按下面流程走：

1. 明确指标名
2. 明确显示位置：主图还是副图
3. 明确输入参数及默认值
4. 确认公式是否只依赖 OHLCV
5. 用 `custom_indicators_getter` 注册指标
6. 决定是否在 `onChartReady` 自动加载
7. 手动验证不同 symbol 和 interval 下是否正常

## 9. 验证清单

接入完一个新指标后，至少验证以下内容：

- 图表能正常初始化，没有控制台报错
- 指标能在菜单中出现
- 指标参数面板能正常修改
- 切换 symbol 后指标还能显示
- 切换 interval 后指标数值正常
- 指标在移动端和桌面端都没有遮挡问题

## 10. 后续新增指标时建议提供的规格

为了让实现更快，后续新增指标时请尽量提供：

```text
指标名：
显示位置：主图 / 副图
输入参数：例如 n=20, m=5
公式：
线条/颜色要求：
是否默认加载：是 / 否
是否只依赖 OHLCV：是 / 否
```

如果只给出自然语言描述，也可以先落一个简化版本，但最好最终补齐公式和参数定义。
