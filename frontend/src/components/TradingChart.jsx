import { useCallback, useEffect, useRef, useState } from 'react'

import {
  getCustomIndicators,
  openVsLatestCloseInputId,
  openVsLatestCloseStudyName,
} from './chart/customIndicators'
import { detectHiddenGaps, formatGapDiff } from './chart/hiddenGap'

const libraryPath = '/charting_library/'
const libraryScriptPath = `${libraryPath}charting_library.js`
const defaultUdfBaseUrl = 'http://127.0.0.1:5200'
const defaultTrendStudyName = 'Moving Average Triple'
const legacyTrendStudyNames = ['Triple EMA']
const defaultDatafeedConfig = {
  supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M', '12M'],
  supports_group_request: false,
  supports_marks: false,
  supports_search: true,
  supports_time: true,
  supports_timescale_marks: false,
}
function mergeBars(existingBars, incomingBars) {
  const merged = new Map(existingBars.map((bar) => [bar.time, bar]))

  incomingBars.forEach((bar) => {
    if (Number.isFinite(bar?.time)) {
      merged.set(bar.time, bar)
    }
  })

  return Array.from(merged.values()).sort((left, right) => left.time - right.time)
}


function getLatestClose(bars) {
  const latestClose = bars.at(-1)?.close
  return Number.isFinite(latestClose) ? latestClose : null
}

function normalizeCrosshairTime(time) {
  return time > 1e12 ? time : time * 1000
}

function loadTradingViewScript() {
  if (window.TradingView?.widget) {
    return Promise.resolve(window.TradingView)
  }

  if (!window.__tradingViewScriptPromise) {
    window.__tradingViewScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${libraryScriptPath}"]`)

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.TradingView), { once: true })
        existingScript.addEventListener('error', () => reject(new Error('TradingView script failed to load.')), {
          once: true,
        })
        return
      }

      const script = document.createElement('script')
      script.src = libraryScriptPath
      script.async = true
      script.onload = () => resolve(window.TradingView)
      script.onerror = () => reject(new Error('TradingView script failed to load.'))
      document.head.appendChild(script)
    })
  }

  return window.__tradingViewScriptPromise
}

function normalizeBaseUrl(baseUrl = defaultUdfBaseUrl) {
  return String(baseUrl || defaultUdfBaseUrl).replace(/\/$/, '')
}

function findStudyIdByName(chart, studyName) {
  return chart.getAllStudies().find(({ name }) => name === studyName)?.id ?? null
}

function normalizeResolution(resolution) {
  const value = String(resolution || '1D').toUpperCase()

  if (defaultDatafeedConfig.supported_resolutions.includes(value)) {
    return value
  }

  if (value === 'D') {
    return '1D'
  }

  if (value === 'W') {
    return '1W'
  }

  if (value === 'M') {
    return '1M'
  }

  if (value === 'Y' || value === '1Y') {
    return '12M'
  }

  if (value === '12M') {
    return '12M'
  }

  return '1D'
}

function buildUrl(baseUrl, pathname, params = {}) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${pathname}`)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  return url
}

async function fetchJson(baseUrl, pathname, params) {
  const response = await fetch(buildUrl(baseUrl, pathname, params), {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`UDF request failed: ${response.status}`)
  }

  const payload = await response.json()

  if (payload?.code && payload.code !== 0 && payload.msg) {
    throw new Error(payload.msg)
  }

  if (payload?.s === 'error') {
    throw new Error(payload.errmsg || 'UDF history request failed.')
  }

  return payload
}

function mapSymbolSearchResult(item) {
  return {
    symbol: item.symbol || item.name,
    full_name: item.full_name || item.symbol || item.name,
    description: item.description || item.symbol || item.name,
    exchange: item.exchange || item['exchange-listed'] || '',
    ticker: item.ticker || item.symbol || item.name,
    type: item.type || 'stock',
  }
}

function mapResolvedSymbolInfo(item, fallbackDescription = '') {
  return {
    name: item.name || item.symbol,
    ticker: item.ticker || item.symbol || item.name,
    full_name: item.full_name || item.symbol || item.name,
    description: item.description || fallbackDescription || item.symbol || item.name,
    type: item.type || 'stock',
    session: item.session || '24x7',
    exchange: item.exchange || item['exchange-listed'] || '',
    listed_exchange: item['exchange-listed'] || item.exchange || '',
    timezone: item.timezone || 'Etc/UTC',
    minmov: item.minmov ?? 1,
    pricescale: item.pricescale ?? 100,
    format: 'price',
    has_intraday: item.has_intraday !== false,
    has_daily: item.has_daily !== false,
    has_weekly_and_monthly: item.has_weekly_and_monthly !== false,
    has_no_volume: false,
    visible_plots_set: item.visible_plots_set || 'ohlcv',
    volume_precision: item.volume_precision ?? 2,
    data_status: item.data_status || 'streaming',
    supported_resolutions: item.supported_resolutions || defaultDatafeedConfig.supported_resolutions,
  }
}

function mapHistoryToBars(payload) {
  const times = Array.isArray(payload?.t) ? payload.t : []

  return times
    .map((time, index) => ({
      time: time * 1000,
      open: payload?.o?.[index],
      high: payload?.h?.[index],
      low: payload?.l?.[index],
      close: payload?.c?.[index],
      volume: payload?.v?.[index] ?? 0,
    }))
    .filter((bar) =>
      [bar.time, bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value))
    )
}

function createUdfDatafeed({ baseUrl, description = '', onBarsLoaded, onBarUpdated }) {
  const subscriptions = new Map()
  let configPromise

  async function getConfig() {
    if (!configPromise) {
      configPromise = fetchJson(baseUrl, '/api/udf/config')
        .then((payload) => ({ ...defaultDatafeedConfig, ...payload }))
        .catch((error) => {
          console.error('[TradingChart] Failed to load UDF config.', error)
          return defaultDatafeedConfig
        })
    }

    return configPromise
  }

  function getSymbolName(symbolInfo) {
    if (typeof symbolInfo === 'string') {
      return symbolInfo
    }

    return symbolInfo?.ticker || symbolInfo?.name || ''
  }

  return {
    onReady(callback) {
      getConfig().then((config) => {
        window.setTimeout(() => callback(config), 0)
      })
    },
    searchSymbols(userInput, exchange, symbolType, onResult) {
      fetchJson(baseUrl, '/api/udf/search', {
        query: userInput.trim(),
        exchange,
        type: symbolType,
        limit: 50,
      })
        .then((payload) => {
          const matches = Array.isArray(payload) ? payload.map(mapSymbolSearchResult) : []
          window.setTimeout(() => onResult(matches), 0)
        })
        .catch((error) => {
          console.error('[TradingChart] searchSymbols failed.', error)
          window.setTimeout(() => onResult([]), 0)
        })
    },
    resolveSymbol(symbolName, onResolve, onError) {
      fetchJson(baseUrl, '/api/udf/symbols', { symbol: symbolName })
        .then((payload) => {
          window.setTimeout(() => onResolve(mapResolvedSymbolInfo(payload, description)), 0)
        })
        .catch((error) => {
          console.error('[TradingChart] resolveSymbol failed.', error)
          window.setTimeout(() => onError(error.message), 0)
        })
    },
    getBars(requestedSymbol, resolution, periodParams, onResult, onError) {
      fetchJson(baseUrl, '/api/udf/history', {
        symbol: getSymbolName(requestedSymbol),
        resolution: normalizeResolution(resolution),
        from: periodParams?.from,
        to: periodParams?.to,
        countback: periodParams?.countBack,
      })
        .then((payload) => {
          const bars = mapHistoryToBars(payload)
          const noData = payload?.s === 'no_data' || bars.length === 0
          onBarsLoaded?.(bars)
          window.setTimeout(() => onResult(bars, { noData }), 0)
        })
        .catch((error) => {
          console.error('[TradingChart] getBars failed.', error)
          window.setTimeout(() => onError(error.message), 0)
        })
    },
    subscribeBars(requestedSymbol, resolution, onTick, listenerGuid) {
      const symbolName = getSymbolName(requestedSymbol)
      let lastBarTime = null

      const pollLatestBar = async () => {
        try {
          const payload = await fetchJson(baseUrl, '/api/udf/history', {
            symbol: symbolName,
            resolution: normalizeResolution(resolution),
            countback: 2,
          })
          const latestBar = mapHistoryToBars(payload).at(-1)

          if (!latestBar || !subscriptions.has(listenerGuid)) {
            return
          }

          lastBarTime = latestBar.time
          onBarUpdated?.({ ...latestBar, time: lastBarTime })
          onTick({ ...latestBar, isBarClosed: false, time: lastBarTime })
        } catch (error) {
          console.error('[TradingChart] subscribeBars poll failed.', error)
        }
      }

      const timerId = window.setInterval(pollLatestBar, 15000)
      subscriptions.set(listenerGuid, timerId)
      pollLatestBar()
    },
    unsubscribeBars(listenerGuid) {
      const timerId = subscriptions.get(listenerGuid)

      if (timerId) {
        window.clearInterval(timerId)
        subscriptions.delete(listenerGuid)
      }
    },
    getServerTime(callback) {
      fetchJson(baseUrl, '/api/udf/time')
        .then((payload) => {
          const serverTime =
            typeof payload === 'number' ? payload : Number(payload?.time ?? payload?.t ?? payload)

          if (Number.isFinite(serverTime)) {
            callback(serverTime)
          }
        })
        .catch(() => {})
    },
  }
}

function TradingChart({ symbol, description, interval = '1D', baseUrl = defaultUdfBaseUrl }) {
  const containerRef = useRef(null)
  const widgetRef = useRef(null)
  const chartApiRef = useRef(null)
  const openVsLatestCloseStudyIdRef = useRef(null)
  const hoveredBarTimeRef = useRef(null)
  const latestCloseSnapshotRef = useRef(null)
  const barsRef = useRef([])
  const [loadError, setLoadError] = useState('')
  const [showHg, setShowHg] = useState(false)
  const [barsVersion, setBarsVersion] = useState(0)
  const [chartReady, setChartReady] = useState(false)
  const hgEntitiesRef = useRef([])
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const syncHoverLegendStudyInput = useCallback((latestClose = latestCloseSnapshotRef.current) => {
    const chart = chartApiRef.current
    const studyId = openVsLatestCloseStudyIdRef.current

    if (!chart || !studyId || latestClose === null) {
      return
    }

    try {
      chart.getStudyById(studyId).setInputValues([{ id: openVsLatestCloseInputId, value: latestClose }])
    } catch (error) {
      console.error('[TradingChart] Failed to sync hover legend study input.', error)
    }
  }, [])
  const storeBars = useCallback((incomingBars) => {
    const nextBars = mergeBars(barsRef.current, incomingBars)
    barsRef.current = nextBars
    setBarsVersion((v) => v + 1)
  }, [])
  const storeLatestBar = useCallback((incomingBar) => {
    if (!incomingBar) {
      return
    }

    const nextBars = mergeBars(barsRef.current, [incomingBar])
    barsRef.current = nextBars
    setBarsVersion((v) => v + 1)
  }, [])
  useEffect(() => {
    barsRef.current = []
    chartApiRef.current = null
    openVsLatestCloseStudyIdRef.current = null
    hoveredBarTimeRef.current = null
    latestCloseSnapshotRef.current = null
    hgEntitiesRef.current = []
    setChartReady(false)
    setBarsVersion(0)

    let cancelled = false
    let localWidget = null

    async function mountWidget() {
      if (!containerRef.current) {
        return
      }

      try {
        setLoadError('')
        await loadTradingViewScript()

        if (cancelled || !window.TradingView?.widget || !containerRef.current) {
          return
        }

        if (widgetRef.current) {
          widgetRef.current.remove()
          widgetRef.current = null
        }

        const datafeed = createUdfDatafeed({
          baseUrl: normalizedBaseUrl,
          description,
          onBarsLoaded: storeBars,
          onBarUpdated: storeLatestBar,
        })

        localWidget = new window.TradingView.widget({
          container: containerRef.current,
          autosize: true,
          symbol,
          interval: normalizeResolution(interval),
          datafeed,
          library_path: libraryPath,
          custom_indicators_getter: (PineJS) => Promise.resolve(getCustomIndicators(PineJS)),
          locale: 'zh',
          timezone: 'Etc/UTC',
          theme: 'dark',
          custom_css_url: '/charting-overrides.css',
          hide_top_toolbar: false,
          hide_legend: false,
          withdateranges: true,
          allow_symbol_change: true,
          disabled_features: [
            'header_compare',
            'header_screenshot',
            'header_undo_redo',
            'display_market_status',
            'timeframes_toolbar',
          ],
          enabled_features: ['study_templates', 'legend_inplace_edit'],
          overrides: {
            'paneProperties.background': '#0d1420',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': 'rgba(177, 189, 210, 0.08)',
            'paneProperties.horzGridProperties.color': 'rgba(177, 189, 210, 0.08)',
            'paneProperties.legendProperties.showStudyArguments': true,
            'paneProperties.legendProperties.showStudyTitles': true,
            'paneProperties.legendProperties.showStudyValues': true,
            'paneProperties.legendProperties.showSeriesTitle': true,
            'paneProperties.legendProperties.showSeriesOHLC': true,
            'paneProperties.legendProperties.showBarChange': true,
            'paneProperties.legendProperties.showVolume': false,
            'paneProperties.legendProperties.showLastDayChange': false,
            'scalesProperties.textColor': '#9baec8',
            'scalesProperties.lineColor': 'rgba(177, 189, 210, 0.12)',
            'mainSeriesProperties.candleStyle.upColor': '#1bbf9b',
            'mainSeriesProperties.candleStyle.downColor': '#ef6a64',
            'mainSeriesProperties.candleStyle.wickUpColor': '#1bbf9b',
            'mainSeriesProperties.candleStyle.wickDownColor': '#ef6a64',
            'mainSeriesProperties.candleStyle.borderUpColor': '#1bbf9b',
            'mainSeriesProperties.candleStyle.borderDownColor': '#ef6a64',
            'mainSeriesProperties.volumePaneSize': 'medium',
          },
          studies_overrides: {
            'volume.volume.color.0': '#ef6a64',
            'volume.volume.color.1': '#1bbf9b',
            'volume.volume.transparency': 70,
            'moving average.length': 5,
            'moving average.source': 'close',
            'moving average.linewidth': 1,
          },
        })

        widgetRef.current = localWidget

        localWidget.onChartReady(async () => {
          if (cancelled || !widgetRef.current) {
            return
          }

          const chart = localWidget.activeChart()
          chartApiRef.current = chart
          setChartReady(true)

          // 强制应用图例设置
          chart.applyOverrides({
            'paneProperties.legendProperties.showSeriesTitle': true,
            'paneProperties.legendProperties.showSeriesOHLC': true,
            'paneProperties.legendProperties.showBarChange': true,
          })

          try {
            legacyTrendStudyNames.forEach((studyName) => {
              const legacyStudyId = findStudyIdByName(chart, studyName)
              if (legacyStudyId) {
                chart.removeEntity(legacyStudyId)
              }
            })

            if (!findStudyIdByName(chart, defaultTrendStudyName)) {
              await chart.createStudy(defaultTrendStudyName, true, false)
            }

            let openVsLatestCloseStudyId = findStudyIdByName(chart, openVsLatestCloseStudyName)

            if (!openVsLatestCloseStudyId) {
              openVsLatestCloseStudyId = await chart.createStudy(
                openVsLatestCloseStudyName,
                true,
                false,
                { [openVsLatestCloseInputId]: getLatestClose(barsRef.current) ?? 0 },
                undefined,
                {
                  priceScale: 'no-scale',
                }
              )
            }

            if (openVsLatestCloseStudyId) {
              openVsLatestCloseStudyIdRef.current = openVsLatestCloseStudyId
            }
          } catch (error) {
            console.error('[TradingChart] Failed to mount chart studies.', error)
          }

          chart.crossHairMoved().subscribe(null, ({ time }) => {
            if (cancelled) {
              return
            }

            if (!Number.isFinite(time)) {
              hoveredBarTimeRef.current = null
              latestCloseSnapshotRef.current = null
              return
            }

            const hoveredBarTime = normalizeCrosshairTime(time)
            const hasHoveredBar = barsRef.current.some((bar) => bar.time === hoveredBarTime)

            if (!hasHoveredBar) {
              hoveredBarTimeRef.current = null
              latestCloseSnapshotRef.current = null
              return
            }

            if (hoveredBarTimeRef.current !== hoveredBarTime) {
              hoveredBarTimeRef.current = hoveredBarTime
              latestCloseSnapshotRef.current = getLatestClose(barsRef.current)
            }

            syncHoverLegendStudyInput()
          })
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'TradingView chart failed to initialize.'
        console.error('[TradingChart] mountWidget failed.', message)
        if (!cancelled) {
          setLoadError(message)
        }
      }
    }

    mountWidget()

    return () => {
      cancelled = true
      chartApiRef.current = null
      openVsLatestCloseStudyIdRef.current = null
      hoveredBarTimeRef.current = null
      latestCloseSnapshotRef.current = null
      hgEntitiesRef.current = []
      setChartReady(false)
      if (localWidget) {
        localWidget.remove()
      }
      if (widgetRef.current === localWidget) {
        widgetRef.current = null
      }
    }
  }, [description, interval, normalizedBaseUrl, storeBars, storeLatestBar, symbol, syncHoverLegendStudyInput])

  // 绘制 / 清除 Hidden Gap
  useEffect(() => {
    const chart = chartApiRef.current
    if (!chartReady || !chart) return

    // 先清除已有 HG 图元
    hgEntitiesRef.current.forEach((id) => {
      try {
        chart.removeEntity(id)
      } catch (error) {
        console.debug('[TradingChart] removeEntity failed', error)
      }
    })
    hgEntitiesRef.current = []

    if (!showHg) return

    const bars = barsRef.current
    if (!bars || bars.length < 10) return

    const { gaps } = detectHiddenGaps(bars)
    if (!gaps.length) return

    const nextIds = []
    gaps.forEach((gap) => {
      const startBar = bars[gap.startIndex]
      const endBar = bars[gap.endIndex] ?? bars[bars.length - 1]
      if (!startBar || !endBar) return

      const startTime = startBar.time / 1000
      const endTime = endBar.time / 1000

      const isBuy = gap.type === 'buy'
      const fillColor = gap.filled
        ? (isBuy ? 'rgba(0, 150, 255, 0.15)' : 'rgba(255, 50, 50, 0.15)')
        : (isBuy ? 'rgba(0, 195, 255, 0.35)' : 'rgba(255, 26, 26, 0.35)')
      const borderColor = gap.pro
        ? (isBuy ? 'rgba(0, 255, 100, 0.9)' : 'rgba(255, 80, 80, 0.9)')
        : (isBuy ? 'rgba(0, 195, 255, 0.6)' : 'rgba(255, 26, 26, 0.6)')

      const labelText = `${isBuy ? '看涨' : '看跌'}${gap.pro ? ' PRO' : ''} · ${formatGapDiff(gap.diff)}`

      try {
        const entityId = chart.createMultipointShape(
          [
            { time: startTime, price: gap.top },
            { time: endTime, price: gap.bottom },
          ],
          {
            shape: 'rectangle',
            lock: true,
            disableSelection: true,
            disableSave: true,
            disableUndo: true,
            text: labelText,
            overrides: {
              color: borderColor,
              linewidth: gap.pro ? 2 : 1,
              fillBackground: true,
              backgroundColor: fillColor,
              transparency: gap.filled ? 80 : 60,
              showLabel: true,
              text: labelText,
              textcolor: gap.pro
                ? (isBuy ? '#00ff64' : '#ff5050')
                : '#ffffff',
              fontsize: 11,
              horzLabelsAlign: 'left',
              vertLabelsAlign: 'top',
              bold: gap.pro,
            },
          }
        )
        if (entityId) nextIds.push(entityId)
      } catch (error) {
        console.warn('[TradingChart] createMultipointShape for HG failed', error)
      }
    })

    hgEntitiesRef.current = nextIds
  }, [showHg, barsVersion, chartReady])

  return (
    <div className="price-chart tv-chart-shell">
      <div className="tv-chart-indicator-bar">
        <button
          type="button"
          className={'tv-indicator-toggle' + (showHg ? ' active' : '')}
          onClick={() => setShowHg((v) => !v)}
          title="Hidden Gap — 识别 WRB 隐藏缺口"
        >
          HG
        </button>
      </div>
      <div ref={containerRef} className="tv-chart-container" />
      {loadError ? (
        <div className="tv-chart-fallback">
          <div>
            无法加载 TradingView 图表。<br />
            {loadError}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default TradingChart
