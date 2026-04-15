export const hoverLegendStudyName = 'Hover Legend Metrics'

export function getCustomIndicators(PineJS) {
  return [createHoverLegendIndicator(PineJS)]
}

function createHoverLegendIndicator(PineJS) {
  return {
    name: hoverLegendStudyName,
    metainfo: {
      _metainfoVersion: 53,
      id: `${hoverLegendStudyName}@stock-platform-1`,
      description: '悬停涨跌幅',
      shortDescription: '悬停涨跌幅',
      is_price_study: false,
      is_hidden_study: true,
      isCustomIndicator: true,
      format: {
        type: 'percent',
        precision: 2,
      },
      plots: [
        { id: 'close_vs_prev', type: 'line' },
        { id: 'open_vs_latest_close', type: 'line' },
      ],
      styles: {
        close_vs_prev: {
          title: '收盘较昨收',
          histogramBase: 0,
        },
        open_vs_latest_close: {
          title: '开盘较今收',
          histogramBase: 0,
        },
      },
      defaults: {
        styles: {
          close_vs_prev: buildLegendStyle('#1bbf9b'),
          open_vs_latest_close: buildLegendStyle('#ef6a64'),
        },
        inputs: {
          latestClose: 0,
        },
      },
      inputs: [
        {
          id: 'latestClose',
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
        const close = PineJS.Std.close(this._context)
        const previousClose = this._context.new_var(close).get(1)
        const latestClose = Number(this._input(0))
        const closeVsPrev =
          Number.isFinite(previousClose) && previousClose !== 0
            ? ((close - previousClose) / previousClose) * 100
            : Number.NaN
        const openVsLatestClose =
          Number.isFinite(latestClose) && Number.isFinite(open) && open !== 0
            ? ((latestClose - open) / open) * 100
            : Number.NaN

        return [closeVsPrev, openVsLatestClose]
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
