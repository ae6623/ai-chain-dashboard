export const openVsLatestCloseStudyName = 'Open vs Latest Close'
export const openVsLatestCloseInputId = 'latestClose'

export function getCustomIndicators(PineJS) {
  return [createOpenVsLatestCloseIndicator(PineJS)]
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
