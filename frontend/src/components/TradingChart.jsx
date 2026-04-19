import { useCallback, useEffect, useRef, useState } from 'react'

import {
  getCustomIndicators,
  openVsLatestCloseInputId,
  openVsLatestCloseStudyName,
  volumeProfileStudyName,
} from './chart/customIndicators'
import VolumeProfileOverlay from './chart/VolumeProfileOverlay'

const libraryPath = '/trade-tv/charting_library/'
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
  const full = `${normalizeBaseUrl(baseUrl)}${pathname}`
  // relative URLs need window.location as base
  const url = full.startsWith('http') ? new URL(full) : new URL(full, window.location.origin)

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
      configPromise = fetchJson(baseUrl, '/udf/config')
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
      fetchJson(baseUrl, '/udf/search', {
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
      fetchJson(baseUrl, '/udf/symbols', { symbol: symbolName })
        .then((payload) => {
          window.setTimeout(() => onResolve(mapResolvedSymbolInfo(payload, description)), 0)
        })
        .catch((error) => {
          console.error('[TradingChart] resolveSymbol failed.', error)
          window.setTimeout(() => onError(error.message), 0)
        })
    },
    getBars(requestedSymbol, resolution, periodParams, onResult, onError) {
      fetchJson(baseUrl, '/udf/history', {
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
          const payload = await fetchJson(baseUrl, '/udf/history', {
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
      fetchJson(baseUrl, '/udf/time')
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
  const [chartReady, setChartReady] = useState(false)
  const [vpState, setVpState] = useState({
    enabled: false,
    options: { num: 200, algorithm: 'default', width: 30, position: 'right' },
  })
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const descriptionRef = useRef(description)
  const initialSymbolRef = useRef(symbol)
  const initialIntervalRef = useRef(interval)
  useEffect(() => {
    descriptionRef.current = description
  }, [description])
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
    barsRef.current = mergeBars(barsRef.current, incomingBars)
  }, [])
  const storeLatestBar = useCallback((incomingBar) => {
    if (!incomingBar) {
      return
    }

    barsRef.current = mergeBars(barsRef.current, [incomingBar])
  }, [])
  useEffect(() => {
    barsRef.current = []
    chartApiRef.current = null
    openVsLatestCloseStudyIdRef.current = null
    hoveredBarTimeRef.current = null
    latestCloseSnapshotRef.current = null
    setChartReady(false)

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
          description: descriptionRef.current,
          onBarsLoaded: storeBars,
          onBarUpdated: storeLatestBar,
        })

        localWidget = new window.TradingView.widget({
          container: containerRef.current,
          autosize: true,
          symbol: initialSymbolRef.current,
          interval: normalizeResolution(initialIntervalRef.current),
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
          enabled_features: ['legend_inplace_edit'],
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
      setChartReady(false)
      if (localWidget) {
        localWidget.remove()
      }
      if (widgetRef.current === localWidget) {
        widgetRef.current = null
      }
    }
  }, [normalizedBaseUrl, storeBars, storeLatestBar, syncHoverLegendStudyInput])

  // Switch symbol/interval on existing widget to preserve studies.
  useEffect(() => {
    const widget = widgetRef.current
    if (!widget || !chartReady) return
    const chart = chartApiRef.current
    if (!chart) return

    const targetSymbol = symbol
    const targetResolution = normalizeResolution(interval)
    let currentSymbol = ''
    let currentResolution = ''
    try {
      currentSymbol = chart.symbol?.() || ''
      currentResolution = String(chart.resolution?.() || '').toUpperCase()
    } catch (error) {
      console.debug('[TradingChart] read current symbol/resolution failed', error)
    }

    if (currentSymbol === targetSymbol && currentResolution === targetResolution) {
      return
    }

    barsRef.current = []
    hoveredBarTimeRef.current = null
    latestCloseSnapshotRef.current = null

    try {
      if (typeof widget.setSymbol === 'function') {
        widget.setSymbol(targetSymbol, targetResolution, () => {})
      } else if (currentSymbol !== targetSymbol && typeof chart.setSymbol === 'function') {
        chart.setSymbol(targetSymbol, () => {})
        if (currentResolution !== targetResolution && typeof chart.setResolution === 'function') {
          chart.setResolution(targetResolution, () => {})
        }
      } else if (typeof chart.setResolution === 'function') {
        chart.setResolution(targetResolution, () => {})
      }
    } catch (error) {
      console.error('[TradingChart] setSymbol/setResolution failed.', error)
    }
  }, [symbol, interval, chartReady])

  // Watch for VP study presence and input changes, then drive the overlay.
  useEffect(() => {
    if (!chartReady) return undefined
    const chart = chartApiRef.current
    if (!chart) return undefined

    const readVpState = () => {
      try {
        const study = chart.getAllStudies?.().find(({ name }) => name === volumeProfileStudyName)
        if (!study) return { enabled: false, options: null }
        const api = chart.getStudyById?.(study.id)
        const inputs = api?.getInputValues?.() || []
        const optionMap = {}
        inputs.forEach(({ id, value }) => {
          optionMap[id] = value
        })
        return {
          enabled: true,
          options: {
            algorithm: optionMap.algorithm || 'default',
            num: Number(optionMap.num) || 200,
            width: Number(optionMap.width) || 30,
            position: optionMap.position || 'right',
          },
        }
      } catch (error) {
        console.debug('[TradingChart] readVpState failed', error)
        return { enabled: false, options: null }
      }
    }

    let lastJson = ''
    const tick = () => {
      const next = readVpState()
      const nextJson = JSON.stringify(next)
      if (nextJson !== lastJson) {
        lastJson = nextJson
        setVpState((prev) =>
          next.enabled
            ? { enabled: true, options: next.options || prev.options }
            : { enabled: false, options: prev.options }
        )
      }
    }
    tick()
    const timerId = window.setInterval(tick, 500)
    return () => window.clearInterval(timerId)
  }, [chartReady])

  return (
    <div className="price-chart tv-chart-shell">
      <div ref={containerRef} className="tv-chart-container" />

      {chartReady && chartApiRef.current && widgetRef.current ? (
        <VolumeProfileOverlay
          enabled={vpState.enabled}
          chart={chartApiRef.current}
          widget={widgetRef.current}
          barsRef={barsRef}
          options={vpState.options}
        />
      ) : null}

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
