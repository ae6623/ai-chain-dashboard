import { detectHiddenGaps } from './hiddenGap'

export const openVsLatestCloseStudyName = 'Open vs Latest Close'
export const openVsLatestCloseInputId = 'latestClose'

export const hiddenGapStudyName = 'Hidden Gap'
const HG_BUY_SLOTS = 5
const HG_SELL_SLOTS = 5

export function getCustomIndicators(PineJS) {
  return [
    createOpenVsLatestCloseIndicator(PineJS),
    createHiddenGapIndicator(PineJS),
  ]
}

function createOpenVsLatestCloseIndicator(PineJS) {
  return {
    name: openVsLatestCloseStudyName,
    metainfo: {
      _metainfoVersion: 53,
      id: `${openVsLatestCloseStudyName}@tv-basicstudies-1`,
      description: openVsLatestCloseStudyName,
      shortDescription: '至今涨跌幅',
      is_price_study: true,
      is_hidden_study: false,
      isCustomIndicator: true,
      format: {
        type: 'percent',
        precision: 2,
      },
      plots: [{ id: 'open_vs_latest_close', type: 'line' }],
      styles: {
        open_vs_latest_close: {
          title: '至今涨跌幅',
          histogramBase: 0,
        },
      },
      defaults: {
        styles: {
          open_vs_latest_close: buildLegendStyle('#ef6a64'),
        },
        inputs: {
          [openVsLatestCloseInputId]: 0,
        },
      },
      inputs: [
        {
          id: openVsLatestCloseInputId,
          name: 'Latest Close',
          defval: 0,
          type: 'float',
          isHidden: true,
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

        const open = PineJS.Std.open(this._context)
        const latestClose = Number(this._input(0))
        const openVsLatestClose =
          Number.isFinite(latestClose) && Number.isFinite(open) && open !== 0
            ? ((latestClose - open) / open) * 100
            : Number.NaN

        return [openVsLatestClose]
      }
    },
  }
}

function buildLegendStyle(color) {
  return {
    color,
    linewidth: 1,
    plottype: 0,
    trackPrice: false,
    transparency: 100,
    visible: true,
  }
}

// ---------------- Hidden Gap ----------------

function buildHgLineStyle(color) {
  return {
    color,
    linestyle: 0,
    linewidth: 1,
    plottype: 2,
    trackPrice: false,
    transparency: 30,
    visible: true,
  }
}

function buildHgPlots() {
  const plots = []
  const styles = {}
  const plotDefaults = {}
  const filledAreas = []
  const filledAreasStyle = {}

  const push = (prefix, count, lineColor, fillColor, labelPrefix) => {
    for (let i = 0; i < count; i++) {
      const topId = `${prefix}_top_${i}`
      const bottomId = `${prefix}_bottom_${i}`
      const areaId = `${prefix}_area_${i}`

      plots.push({ id: topId, type: 'line' })
      plots.push({ id: bottomId, type: 'line' })
      styles[topId] = { title: `${labelPrefix} ${i + 1} 顶`, histogramBase: 0 }
      styles[bottomId] = { title: `${labelPrefix} ${i + 1} 底`, histogramBase: 0 }
      plotDefaults[topId] = buildHgLineStyle(lineColor)
      plotDefaults[bottomId] = buildHgLineStyle(lineColor)

      filledAreas.push({
        id: areaId,
        objAId: topId,
        objBId: bottomId,
        type: 'plot_plot',
        title: `${labelPrefix} ${i + 1}`,
      })
      filledAreasStyle[areaId] = {
        color: fillColor,
        transparency: 70,
        visible: true,
      }
    }
  }

  push('buy', HG_BUY_SLOTS, 'rgba(0, 195, 255, 0.8)', 'rgba(0, 195, 255, 0.35)', '看涨')
  push('sell', HG_SELL_SLOTS, 'rgba(255, 26, 26, 0.8)', 'rgba(255, 26, 26, 0.35)', '看跌')

  return { plots, styles, plotDefaults, filledAreas, filledAreasStyle }
}

function createHiddenGapIndicator(PineJS) {
  const { plots, styles, plotDefaults, filledAreas, filledAreasStyle } = buildHgPlots()

  return {
    name: hiddenGapStudyName,
    metainfo: {
      _metainfoVersion: 53,
      id: `${hiddenGapStudyName}@tv-basicstudies-1`,
      description: hiddenGapStudyName,
      shortDescription: 'HG',
      is_price_study: true,
      is_hidden_study: false,
      isCustomIndicator: true,
      format: { type: 'price', precision: 2 },
      plots,
      filledAreas,
      styles,
      defaults: {
        styles: plotDefaults,
        filledAreasStyle,
        inputs: {
          lookback: 5,
          sensitivity: 1.5,
          useBody: true,
          extension: 'stopLoss',
          widthFilter: 0,
          maxScope: 300,
        },
      },
      inputs: [
        { id: 'lookback', name: 'WRB 回看 bar 数', defval: 5, type: 'integer', min: 2, max: 30 },
        { id: 'sensitivity', name: 'WRB 灵敏度', defval: 1.5, type: 'float', min: 1.0, max: 5.0 },
        { id: 'useBody', name: '使用实体长度', defval: true, type: 'bool' },
        {
          id: 'extension',
          name: '扩展模式',
          defval: 'stopLoss',
          type: 'text',
          options: ['none', 'stopLoss', 'both'],
        },
        { id: 'widthFilter', name: '最小宽度过滤', defval: 0, type: 'float', min: 0, max: 1_000_000 },
        { id: 'maxScope', name: 'Gap 最大跨度 bar 数', defval: 300, type: 'integer', min: 10, max: 2000 },
      ],
    },
    constructor: function () {
      const nanSlots = new Array((HG_BUY_SLOTS + HG_SELL_SLOTS) * 2).fill(Number.NaN)

      this.init = function (context, inputCallback) {
        this._context = context
        this._input = inputCallback
        this._bars = []
      }

      this.main = function (context, inputCallback) {
        this._context = context
        this._input = inputCallback

        const time = PineJS.Std.time(context)
        const open = PineJS.Std.open(context)
        const high = PineJS.Std.high(context)
        const low = PineJS.Std.low(context)
        const close = PineJS.Std.close(context)

        if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(close)) {
          return nanSlots
        }

        // TV 在切换 symbol / resolution 时会对同一 instance 重跑历史；
        // 发现时间回溯就重置本地 bar 缓存。
        if (this._bars.length) {
          const lastTime = this._bars[this._bars.length - 1].time
          if (time < lastTime) {
            this._bars = []
          }
        }

        const lastBar = this._bars[this._bars.length - 1]
        if (!lastBar || lastBar.time !== time) {
          this._bars.push({ time, open, high, low, close, volume: 0 })
        } else {
          lastBar.open = open
          lastBar.high = high
          lastBar.low = low
          lastBar.close = close
        }

        const bars = this._bars
        const curIdx = bars.length - 1

        const lookback = Math.max(2, Math.floor(Number(this._input(0)) || 5))
        if (curIdx < lookback + 1) return nanSlots

        const sensitivity = Number(this._input(1)) || 1.5
        const useBody = this._input(2) !== false
        const extension = this._input(3) || 'stopLoss'
        const widthFilter = Number(this._input(4)) || 0
        const maxScope = Math.max(10, Math.floor(Number(this._input(5)) || 300))

        const { gaps } = detectHiddenGaps(bars, {
          lookbackPeriod: lookback,
          wrbSensitivity: sensitivity,
          useBodyRange: useBody,
          gapExtension: extension,
          widthFilter,
          maxFvgScope: maxScope,
          maxGapBoxes: 200,
        })

        const activeBuy = []
        const activeSell = []
        for (const gap of gaps) {
          if (curIdx < gap.startIndex || curIdx > gap.endIndex) continue
          if (gap.type === 'buy') activeBuy.push(gap)
          else activeSell.push(gap)
        }
        activeBuy.sort((a, b) => a.startIndex - b.startIndex)
        activeSell.sort((a, b) => a.startIndex - b.startIndex)

        const out = []
        for (let i = 0; i < HG_BUY_SLOTS; i++) {
          const gap = activeBuy[i]
          if (gap) {
            out.push(gap.top, gap.bottom)
          } else {
            out.push(Number.NaN, Number.NaN)
          }
        }
        for (let i = 0; i < HG_SELL_SLOTS; i++) {
          const gap = activeSell[i]
          if (gap) {
            out.push(gap.top, gap.bottom)
          } else {
            out.push(Number.NaN, Number.NaN)
          }
        }
        return out
      }
    },
  }
}
