import { useEffect, useMemo, useRef, useState } from 'react'

const libraryPath = '/charting_library/'
const libraryScriptPath = `${libraryPath}charting_library.js`
const defaultUdfBaseUrl = 'http://127.0.0.1:5200'
const defaultDatafeedConfig = {
  supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'],
  supports_group_request: false,
  supports_marks: false,
  supports_search: true,
  supports_time: true,
  supports_timescale_marks: false,
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

function createUdfDatafeed({ baseUrl, description = '' }) {
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
  const mountedRef = useRef(false)
  const [loadError, setLoadError] = useState('')
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const datafeed = useMemo(
    () => createUdfDatafeed({ baseUrl: normalizedBaseUrl, description }),
    [description, normalizedBaseUrl]
  )

  useEffect(() => {
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

        localWidget = new window.TradingView.widget({
          container: containerRef.current,
          autosize: true,
          symbol,
          interval: normalizeResolution(interval),
          datafeed,
          library_path: libraryPath,
          locale: 'zh',
          timezone: 'Etc/UTC',
          theme: 'dark',
          custom_css_url: '/charting-overrides.css',
          hide_top_toolbar: false,
          hide_legend: false,
          withdateranges: true,
          allow_symbol_change: false,
          disabled_features: [
            'header_symbol_search',
            'header_compare',
            'header_screenshot',
            'header_undo_redo',
            'display_market_status',
            'timeframes_toolbar',
            'use_localstorage_for_settings',
          ],
          enabled_features: ['study_templates'],
          overrides: {
            'paneProperties.background': '#0d1420',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': 'rgba(177, 189, 210, 0.08)',
            'paneProperties.horzGridProperties.color': 'rgba(177, 189, 210, 0.08)',
            'paneProperties.legendProperties.showStudyArguments': false,
            'paneProperties.legendProperties.showStudyTitles': false,
            'paneProperties.legendProperties.showStudyValues': false,
            'paneProperties.legendProperties.showSeriesTitle': false,
            'paneProperties.legendProperties.showSeriesOHLC': false,
            'paneProperties.legendProperties.showBarChange': false,
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

        localWidget.onChartReady(() => {
          if (cancelled || !widgetRef.current) {
            return
          }

          const chart = localWidget.activeChart()
          chart.createStudy('Moving Average', false, false, [5], null, {
            'Plot.color': '#7fd1ff',
            'Plot.linewidth': 2,
          })
          chart.createStudy('Moving Average', false, false, [8], null, {
            'Plot.color': '#ffc857',
            'Plot.linewidth': 2,
          })
          chart.createStudy('Moving Average', false, false, [13], null, {
            'Plot.color': '#b983ff',
            'Plot.linewidth': 2,
          })
          mountedRef.current = true
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
      mountedRef.current = false
      if (localWidget) {
        localWidget.remove()
      }
      if (widgetRef.current === localWidget) {
        widgetRef.current = null
      }
    }
  }, [datafeed, description, interval, symbol])

  return (
    <div className="price-chart tv-chart-shell">
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
