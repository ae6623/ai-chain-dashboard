import { useEffect, useRef, useState } from 'react'
import './App.css'
import TradingChart from './components/TradingChart.jsx'

const desktopBreakpoint = 1200
const splitterWidth = 12
const defaultPanelWidths = { left: 332, right: 368 }
const minLeftPanelWidth = 260
const minCenterPanelWidth = 520
const minRightPanelWidth = 300

const fallbackWatchlistGroups = [
  { id: 'holdings', name: '持仓', itemCount: 0, isDefault: false },
  { id: 'recent-etf', name: '最近关注 ETF', itemCount: 9, isDefault: true },
  { id: 'cpo', name: 'CPO光', itemCount: 0, isDefault: false },
  { id: 'storage', name: '存储', itemCount: 0, isDefault: false },
  { id: 'copper', name: '铜', itemCount: 0, isDefault: false },
  { id: 'etf', name: 'ETF', itemCount: 0, isDefault: false },
]

const fallbackWatchlistRows = [
  { name: '博通', code: 'AVGO', symbol: 'AVGO.US', price: '371.550', change: '+4.69%', trend: 'up' },
  { name: '英伟达', code: 'NVDA', symbol: 'NVDA.US', price: '188.630', change: '+2.57%', trend: 'up' },
  { name: '亚马逊', code: 'AMZN', symbol: 'AMZN.US', price: '238.380', change: '+2.02%', trend: 'up' },
  { name: '台积电', code: 'TSM', symbol: 'TSM.US', price: '370.600', change: '+1.40%', trend: 'up' },
  { name: '特斯拉', code: 'TSLA', symbol: 'TSLA.US', price: '348.950', change: '+0.96%', trend: 'up' },
  { name: 'Meta', code: 'META', symbol: 'META.US', price: '629.860', change: '+0.23%', trend: 'up' },
  { name: '苹果', code: 'AAPL', symbol: 'AAPL.US', price: '260.480', change: '-0.01%', trend: 'down' },
  { name: '谷歌-C', code: 'GOOG', symbol: 'GOOG.US', price: '315.720', change: '-0.21%', trend: 'down', active: true },
  { name: '微软', code: 'MSFT', symbol: 'MSFT.US', price: '370.870', change: '-0.59%', trend: 'down' },
]

const footerIndexes = [
  { name: '道琼斯', value: '47916.570', change: '-0.56%', trend: 'down' },
  { name: '纳斯达克', value: '22902.894', change: '+0.35%', trend: 'up' },
  { name: '标普500', value: '6816.890', change: '-0.11%', trend: 'down' },
]

const defaultChartSymbol = 'GOOG.US'
const defaultChartDescription = '谷歌-C'
const defaultChartExchange = 'LONGBRIDGE'
const chartUdfBaseUrl = (import.meta.env.VITE_UDF_BASE_URL || 'http://127.0.0.1:5200').replace(/\/$/, '')
const watchlistApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || chartUdfBaseUrl).replace(/\/$/, '')

const timeframes = [
  { label: '1分', resolution: '1' },
  { label: '5分', resolution: '5' },
  { label: '15分', resolution: '15' },
  { label: '30分', resolution: '30' },
  { label: '1小时', resolution: '60' },
  { label: '4小时', resolution: '240' },
  { label: '日K', resolution: '1D' },
  { label: '周K', resolution: '1W' },
  { label: '月K', resolution: '1M' },
]

const quickPrompts = ['总结今天走势', '给我一个交易计划', '看下支撑和压力', '这波还能追吗？']

const initialChatMessages = [
  {
    id: 'm1',
    role: 'assistant',
    title: 'AI 盘面助理',
    content: '我已经接入当前图表的 UDF 日K、均线和最近价格数据。你可以直接问我走势总结、关键位、仓位建议或风险提示。',
    time: '14:05',
  },
  {
    id: 'm2',
    role: 'assistant',
    title: '即时观察',
    content: '中间图表和右侧上下文会跟随当前选中的自选股切换。如果你想看支撑、压力、趋势或回撤节奏，可以直接问我。',
    time: '14:06',
  },
]

function calculateMovingAverage(values, windowSize) {
  if (!values.length) {
    return null
  }

  const slice = values.slice(-Math.min(windowSize, values.length))
  const total = slice.reduce((sum, value) => sum + value, 0)
  return total / slice.length
}

function parseHistoryPoints(payload) {
  const timestamps = Array.isArray(payload?.t) ? payload.t : []

  return timestamps
    .map((time, index) => ({
      time,
      open: payload?.o?.[index],
      high: payload?.h?.[index],
      low: payload?.l?.[index],
      close: payload?.c?.[index],
      volume: payload?.v?.[index] ?? 0,
    }))
    .filter((point) =>
      [point.time, point.open, point.high, point.low, point.close].every((value) => Number.isFinite(value))
    )
}

function formatLastValue(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '--'
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function formatVolume(value) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  if (value >= 100000000) {
    return `${(value / 100000000).toFixed(2)}亿股`
  }

  if (value >= 10000) {
    return `${(value / 10000).toFixed(2)}万股`
  }

  return `${Math.round(value)}股`
}

function formatChatTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function getDefaultWatchlistId(groups) {
  return groups.find((group) => group.isDefault)?.id ?? groups[0]?.id ?? null
}

function buildAssistantReply(prompt, symbol) {
  const text = prompt.trim().toLowerCase()

  if (text.includes('支撑') || text.includes('压力') || text.includes('关键位')) {
    return `${symbol} 先看最近一根日K低点和 MA5 一带的动态承接，上方则观察最近 swing high 附近的压力。更稳妥的做法，是结合放量突破或回踩企稳来确认。`
  }

  if (text.includes('计划') || text.includes('策略') || text.includes('交易')) {
    return `${symbol} 如果偏顺势，就等突破确认后再分批跟；如果更看重盈亏比，优先等回踩均线或前高转支撑的确认，再决定仓位和止损。`
  }

  if (text.includes('追') || text.includes('买吗') || text.includes('上车')) {
    return `${symbol} 当前位置更适合先分清是做突破还是做回踩，不一定是最舒服的追价位置。等量价确认后再动手，通常会比直接追更从容。`
  }

  if (text.includes('风险') || text.includes('回撤') || text.includes('止损')) {
    return `${symbol} 的主要风险在于临近阶段高点时量价配合转弱，一旦重新跌回短期均线下方，短线节奏就可能从强整理转成回撤，需要重新评估仓位和止损。`
  }

  return `从当前图形看，${symbol} 更像趋势延续中的整理段，结构并没有明显走坏，但离阶段压力也不远。更适合先明确自己做突破还是做回踩，再决定进出节奏。`
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function clampPanelWidths(containerWidth, leftWidth, rightWidth) {
  const availableWidth = containerWidth - splitterWidth * 2
  const maxLeftWidth = Math.max(minLeftPanelWidth, availableWidth - rightWidth - minCenterPanelWidth)
  const nextLeftWidth = clamp(leftWidth, minLeftPanelWidth, maxLeftWidth)
  const maxRightWidth = Math.max(minRightPanelWidth, availableWidth - nextLeftWidth - minCenterPanelWidth)
  const nextRightWidth = clamp(rightWidth, minRightPanelWidth, maxRightWidth)
  const finalMaxLeftWidth = Math.max(minLeftPanelWidth, availableWidth - nextRightWidth - minCenterPanelWidth)

  return {
    left: clamp(nextLeftWidth, minLeftPanelWidth, finalMaxLeftWidth),
    right: nextRightWidth,
  }
}

function buildUrl(baseUrl, pathname, params = {}) {
  const url = new URL(`${baseUrl}${pathname}`)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  return url
}

async function requestApiData(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  const payload = await response.json()
  if (payload?.code && payload.code !== 0) {
    throw new Error(payload.message || payload.msg || 'Request failed.')
  }

  return payload?.data ?? payload
}

async function fetchHistoryPayload(symbol, resolution = '1D', countback = 20) {
  const response = await fetch(
    buildUrl(chartUdfBaseUrl, '/api/udf/history', { symbol, resolution, countback }),
    { headers: { Accept: 'application/json' } }
  )

  if (!response.ok) {
    throw new Error(`Snapshot request failed: ${response.status}`)
  }

  const payload = await response.json()
  if (payload?.code && payload.code !== 0) {
    throw new Error(payload.message || payload.msg || 'Snapshot request failed.')
  }
  if (payload?.s === 'error') {
    throw new Error(payload.errmsg || 'Snapshot request failed.')
  }

  return payload
}

function mapFallbackWatchlistItem(item, index) {
  return {
    id: `fallback-${item.symbol || item.code}-${index}`,
    symbol: item.symbol || item.code,
    ticker: item.code || item.symbol,
    name: item.name,
    description: item.name,
    displayName: item.name,
    exchange: defaultChartExchange,
    type: 'stocks_us',
    price: item.price,
    change: item.change,
    trend: item.trend,
    isFallback: true,
    active: Boolean(item.active),
  }
}

function getItemName(item) {
  return item?.displayName || item?.description || item?.name || item?.fullName || item?.symbol || '--'
}

function getItemTicker(item) {
  return item?.ticker || item?.symbol || '--'
}

function getShortSymbol(item) {
  const ticker = getItemTicker(item)
  return ticker.split(':').pop().split('.')[0] || ticker
}

function getTrendClass(value) {
  return Number.isFinite(value) && value < 0 ? 'down' : 'up'
}

function inferMarketLabel(item) {
  const type = item?.type || ''
  const symbol = item?.symbol || ''

  if (type === 'stocks_us' || symbol.endsWith('.US')) {
    return '美股'
  }
  if (type === 'stocks_hk' || symbol.endsWith('.HK')) {
    return '港股'
  }
  if (type === 'stocks_cn' || symbol.endsWith('.SH') || symbol.endsWith('.SZ') || symbol.endsWith('.SS')) {
    return 'A股'
  }
  if (type === 'crypto') {
    return '加密'
  }
  if (type === 'fx') {
    return '外汇'
  }
  return '全球市场'
}

function getWatchlistRowPrice(item, quote) {
  if (Number.isFinite(quote?.latestPrice)) {
    return formatLastValue(quote.latestPrice)
  }
  return item?.price || '--'
}

function getWatchlistRowChange(item, quote) {
  if (Number.isFinite(quote?.changePercent)) {
    return formatPercent(quote.changePercent)
  }
  return item?.change || '--'
}

function App() {
  const shellRef = useRef(null)
  const dragStateRef = useRef(null)
  const chatViewportRef = useRef(null)
  const nextMessageIdRef = useRef(initialChatMessages.length + 1)

  const [panelWidths, setPanelWidths] = useState(defaultPanelWidths)
  const [chatMessages, setChatMessages] = useState(initialChatMessages)
  const [chatDraft, setChatDraft] = useState('')
  const [activeTimeframe, setActiveTimeframe] = useState('日K')
  const [watchlistState, setWatchlistState] = useState({
    status: 'loading',
    groups: fallbackWatchlistGroups,
    activeId: getDefaultWatchlistId(fallbackWatchlistGroups),
    error: '',
  })
  const [watchlistItemsState, setWatchlistItemsState] = useState({
    status: 'idle',
    byWatchlistId: {},
    selectedByWatchlistId: {},
    error: '',
  })
  const [quoteSnapshots, setQuoteSnapshots] = useState({})
  const [chartSnapshot, setChartSnapshot] = useState({
    status: 'loading',
    latest: null,
    ma5: null,
    ma8: null,
    ma13: null,
    changePercent: null,
  })
  const [isWatchlistEditing, setIsWatchlistEditing] = useState(false)
  const [itemEditorState, setItemEditorState] = useState({
    mode: 'create',
    itemId: null,
    symbol: '',
    displayName: '',
    saving: false,
    error: '',
  })

  const activeResolution = timeframes.find((item) => item.label === activeTimeframe)?.resolution ?? '1D'
  const watchlistGroups = watchlistState.groups.length ? watchlistState.groups : fallbackWatchlistGroups
  const activeWatchlistId = watchlistState.activeId ?? getDefaultWatchlistId(watchlistGroups)
  const activeWatchlist = watchlistGroups.find((group) => group.id === activeWatchlistId) ?? watchlistGroups[0] ?? null
  const fallbackItems = fallbackWatchlistRows.map(mapFallbackWatchlistItem)
  const activeApiItems = activeWatchlistId ? watchlistItemsState.byWatchlistId[activeWatchlistId] ?? [] : []
  const useFallbackItems = watchlistState.status === 'error' || watchlistItemsState.status === 'error'
  const visibleWatchlistItems = useFallbackItems ? fallbackItems : activeApiItems
  const fallbackActiveId = fallbackItems.find((item) => item.active)?.id
    ?? fallbackItems.find((item) => item.symbol === defaultChartSymbol)?.id
    ?? fallbackItems[0]?.id
    ?? null
  const currentSelection = activeWatchlistId ? watchlistItemsState.selectedByWatchlistId[activeWatchlistId] : null
  const activeWatchlistItem = visibleWatchlistItems.find((item) => item.id === currentSelection)
    ?? visibleWatchlistItems.find((item) => item.active)
    ?? fallbackItems.find((item) => item.id === fallbackActiveId)
    ?? visibleWatchlistItems[0]
    ?? null
  const activeSymbol = activeWatchlistItem?.symbol || defaultChartSymbol
  const activeDescription = getItemName(activeWatchlistItem) || defaultChartDescription
  const activeShortSymbol = getShortSymbol(activeWatchlistItem)
  const activeExchange = activeWatchlistItem?.exchange || defaultChartExchange
  const activeMarketLabel = inferMarketLabel(activeWatchlistItem)
  const watchlistStatusMessage = watchlistState.status === 'loading'
    ? '正在同步后端自选分组...'
    : watchlistState.error || (watchlistItemsState.status === 'loading' ? '正在同步当前分组标的...' : watchlistItemsState.error)
  const chartChangeTone = getTrendClass(chartSnapshot.changePercent)
  const chartPrice = formatLastValue(chartSnapshot.latest?.close)
  const chartMa5 = formatLastValue(chartSnapshot.ma5)
  const chartMa8 = formatLastValue(chartSnapshot.ma8)
  const chartMa13 = formatLastValue(chartSnapshot.ma13)
  const chartVolume = formatVolume(chartSnapshot.latest?.volume)
  const chartResistance = formatLastValue(chartSnapshot.latest?.high)
  const shellStyle = {
    '--left-panel-width': `${panelWidths.left}px`,
    '--right-panel-width': `${panelWidths.right}px`,
  }

  async function loadWatchlists(preferredActiveId = null) {
    try {
      const groups = await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists?includeItemCount=true`)
      const nextGroups = Array.isArray(groups) && groups.length ? groups : fallbackWatchlistGroups

      setWatchlistState((current) => ({
        status: 'ready',
        groups: nextGroups,
        activeId: nextGroups.some((group) => group.id === preferredActiveId)
          ? preferredActiveId
          : nextGroups.some((group) => group.id === current.activeId)
            ? current.activeId
            : getDefaultWatchlistId(nextGroups),
        error: '',
      }))
    } catch (error) {
      console.error('[App] Failed to load watchlists.', error)
      setWatchlistState((current) => ({
        ...current,
        status: 'error',
        groups: fallbackWatchlistGroups,
        activeId: current.activeId ?? getDefaultWatchlistId(fallbackWatchlistGroups),
        error: '后端分组接口暂不可用，当前显示本地示例列表。',
      }))
    }
  }

  async function loadWatchlistItems(watchlistId, preferredItemId = null) {
    if (!watchlistId) {
      return
    }

    try {
      const items = await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(watchlistId)}/items`)
      const nextItems = Array.isArray(items) ? items : []

      setWatchlistItemsState((current) => {
        const selectionCandidate = preferredItemId ?? current.selectedByWatchlistId[watchlistId]
        const nextSelectedId = nextItems.some((item) => item.id === selectionCandidate)
          ? selectionCandidate
          : nextItems[0]?.id ?? null

        return {
          status: 'ready',
          byWatchlistId: {
            ...current.byWatchlistId,
            [watchlistId]: nextItems,
          },
          selectedByWatchlistId: {
            ...current.selectedByWatchlistId,
            [watchlistId]: nextSelectedId,
          },
          error: '',
        }
      })
    } catch (error) {
      console.error('[App] Failed to load watchlist items.', error)
      setWatchlistItemsState((current) => ({
        ...current,
        status: 'error',
        error: '自选项接口暂不可用，当前显示示例股票。',
      }))
    }
  }

  useEffect(() => {
    let cancelled = false

    async function bootstrapWatchlists() {
      setWatchlistState((current) => ({ ...current, status: 'loading', error: '' }))

      try {
        const groups = await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists?includeItemCount=true`)
        if (cancelled) {
          return
        }

        const nextGroups = Array.isArray(groups) && groups.length ? groups : fallbackWatchlistGroups
        setWatchlistState((current) => ({
          status: 'ready',
          groups: nextGroups,
          activeId: nextGroups.some((group) => group.id === current.activeId)
            ? current.activeId
            : getDefaultWatchlistId(nextGroups),
          error: '',
        }))
      } catch (error) {
        console.error('[App] Failed to load watchlists.', error)
        if (!cancelled) {
          setWatchlistState((current) => ({
            ...current,
            status: 'error',
            groups: fallbackWatchlistGroups,
            activeId: current.activeId ?? getDefaultWatchlistId(fallbackWatchlistGroups),
            error: '后端分组接口暂不可用，当前显示本地示例列表。',
          }))
        }
      }
    }

    bootstrapWatchlists()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapWatchlistItems() {
      if (!activeWatchlistId || watchlistState.status === 'error') {
        return
      }

      setWatchlistItemsState((current) => ({ ...current, status: 'loading', error: '' }))

      try {
        const items = await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(activeWatchlistId)}/items`)
        if (cancelled) {
          return
        }

        const nextItems = Array.isArray(items) ? items : []
        setWatchlistItemsState((current) => {
          const selectionCandidate = current.selectedByWatchlistId[activeWatchlistId]
          const nextSelectedId = nextItems.some((item) => item.id === selectionCandidate)
            ? selectionCandidate
            : nextItems[0]?.id ?? null

          return {
            status: 'ready',
            byWatchlistId: {
              ...current.byWatchlistId,
              [activeWatchlistId]: nextItems,
            },
            selectedByWatchlistId: {
              ...current.selectedByWatchlistId,
              [activeWatchlistId]: nextSelectedId,
            },
            error: '',
          }
        })
      } catch (error) {
        console.error('[App] Failed to load watchlist items.', error)
        if (!cancelled) {
          setWatchlistItemsState((current) => ({
            ...current,
            status: 'error',
            error: '自选项接口暂不可用，当前显示示例股票。',
          }))
        }
      }
    }

    bootstrapWatchlistItems()

    return () => {
      cancelled = true
    }
  }, [activeWatchlistId, watchlistState.status])

  useEffect(() => {
    let cancelled = false

    async function loadChartSnapshot() {
      setChartSnapshot((current) => ({ ...current, status: 'loading' }))

      try {
        const payload = await fetchHistoryPayload(activeSymbol, '1D', 20)
        const points = parseHistoryPoints(payload)
        if (!points.length) {
          throw new Error('No snapshot bars returned.')
        }

        const latest = points.at(-1)
        const previous = points.at(-2)
        const closes = points.map((point) => point.close)
        const changePercent = previous?.close
          ? ((latest.close - previous.close) / previous.close) * 100
          : null

        if (!cancelled) {
          setChartSnapshot({
            status: 'ready',
            latest,
            ma5: calculateMovingAverage(closes, 5),
            ma8: calculateMovingAverage(closes, 8),
            ma13: calculateMovingAverage(closes, 13),
            changePercent,
          })
        }
      } catch (error) {
        console.error('[App] Failed to load chart snapshot.', error)
        if (!cancelled) {
          setChartSnapshot((current) => ({ ...current, status: 'error' }))
        }
      }
    }

    loadChartSnapshot()
    const timerId = window.setInterval(loadChartSnapshot, 60000)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [activeSymbol])

  useEffect(() => {
    let cancelled = false
    const symbols = [...new Set(visibleWatchlistItems.map((item) => item.symbol).filter(Boolean))]

    if (!symbols.length) {
      return undefined
    }

    async function loadQuoteSnapshots() {
      const nextEntries = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const payload = await fetchHistoryPayload(symbol, '1D', 2)
            const points = parseHistoryPoints(payload)
            const latest = points.at(-1)
            const previous = points.at(-2)
            const changePercent = previous?.close
              ? ((latest.close - previous.close) / previous.close) * 100
              : null

            return [
              symbol,
              {
                latestPrice: latest?.close ?? null,
                changePercent,
                trend: getTrendClass(changePercent),
              },
            ]
          } catch (error) {
            return [symbol, { latestPrice: null, changePercent: null, trend: 'up' }]
          }
        })
      )

      if (!cancelled) {
        setQuoteSnapshots((current) => ({
          ...current,
          ...Object.fromEntries(nextEntries),
        }))
      }
    }

    loadQuoteSnapshots()
    const timerId = window.setInterval(loadQuoteSnapshots, 60000)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [visibleWatchlistItems.map((item) => item.symbol).join('|')])

  useEffect(() => {
    function syncPanelWidths() {
      const shell = shellRef.current
      if (!shell || window.innerWidth <= desktopBreakpoint) {
        return
      }

      setPanelWidths((current) => {
        const next = clampPanelWidths(shell.clientWidth, current.left, current.right)
        return next.left === current.left && next.right === current.right ? current : next
      })
    }

    syncPanelWidths()
    window.addEventListener('resize', syncPanelWidths)

    return () => {
      window.removeEventListener('resize', syncPanelWidths)
    }
  }, [])

  useEffect(() => {
    function stopDragging() {
      if (!dragStateRef.current) {
        return
      }

      dragStateRef.current = null
      document.body.classList.remove('is-resizing-columns')
    }

    function handlePointerMove(event) {
      const dragState = dragStateRef.current
      const shell = shellRef.current

      if (!dragState || !shell || window.innerWidth <= desktopBreakpoint) {
        return
      }

      const deltaX = event.clientX - dragState.startX

      setPanelWidths(() => {
        if (dragState.type === 'left') {
          return clampPanelWidths(shell.clientWidth, dragState.startLeft + deltaX, dragState.startRight)
        }

        return clampPanelWidths(shell.clientWidth, dragState.startLeft, dragState.startRight - deltaX)
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
      document.body.classList.remove('is-resizing-columns')
    }
  }, [])

  useEffect(() => {
    const viewport = chatViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTop = viewport.scrollHeight
  }, [chatMessages])

  function updatePanelWidths(updater) {
    const shell = shellRef.current
    if (!shell) {
      return
    }

    setPanelWidths((current) => {
      const next = updater(current)
      return clampPanelWidths(shell.clientWidth, next.left, next.right)
    })
  }

  function handleResizeStart(type, event) {
    if (window.innerWidth <= desktopBreakpoint) {
      return
    }

    event.preventDefault()
    dragStateRef.current = {
      type,
      startX: event.clientX,
      startLeft: panelWidths.left,
      startRight: panelWidths.right,
    }
    document.body.classList.add('is-resizing-columns')
  }

  function handleSplitterKeyDown(type, event) {
    if (window.innerWidth <= desktopBreakpoint) {
      return
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    event.preventDefault()
    const step = event.key === 'ArrowLeft' ? -24 : 24

    updatePanelWidths((current) => {
      if (type === 'left') {
        return { ...current, left: current.left + step }
      }

      return { ...current, right: current.right - step }
    })
  }

  function resetPanelWidths() {
    const shell = shellRef.current
    if (!shell) {
      return
    }

    setPanelWidths(clampPanelWidths(shell.clientWidth, defaultPanelWidths.left, defaultPanelWidths.right))
  }

  function handleWatchlistSelect(watchlistId) {
    setWatchlistState((current) => ({ ...current, activeId: watchlistId }))
  }

  function handleWatchlistItemSelect(itemId) {
    if (!activeWatchlistId) {
      return
    }

    setWatchlistItemsState((current) => ({
      ...current,
      selectedByWatchlistId: {
        ...current.selectedByWatchlistId,
        [activeWatchlistId]: itemId,
      },
    }))
  }

  function resetItemEditor() {
    setItemEditorState({
      mode: 'create',
      itemId: null,
      symbol: '',
      displayName: '',
      saving: false,
      error: '',
    })
  }

  function toggleWatchlistEditor() {
    setIsWatchlistEditing((current) => {
      const next = !current
      if (!next) {
        resetItemEditor()
      }
      return next
    })
  }

  function beginEditWatchlistItem(item, event) {
    event.stopPropagation()
    setIsWatchlistEditing(true)
    setItemEditorState({
      mode: 'edit',
      itemId: item.id,
      symbol: item.symbol || '',
      displayName: item.displayName || '',
      saving: false,
      error: '',
    })
  }

  async function handleWatchlistItemDelete(item, event) {
    event.stopPropagation()

    if (!activeWatchlistId || !window.confirm(`确认删除 ${item.symbol} 吗？`)) {
      return
    }

    try {
      await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(activeWatchlistId)}/items/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      await loadWatchlists(activeWatchlistId)
      await loadWatchlistItems(activeWatchlistId)
      if (itemEditorState.itemId === item.id) {
        resetItemEditor()
      }
    } catch (error) {
      console.error('[App] Failed to delete watchlist item.', error)
      setItemEditorState((current) => ({
        ...current,
        error: error.message || '删除失败，请稍后再试。',
      }))
    }
  }

  async function handleWatchlistItemSubmit(event) {
    event.preventDefault()

    if (!activeWatchlistId) {
      return
    }

    const symbol = itemEditorState.symbol.trim().toUpperCase()
    const displayName = itemEditorState.displayName.trim()
    if (!symbol) {
      setItemEditorState((current) => ({
        ...current,
        error: '请输入代码，例如 GOOG.US。',
      }))
      return
    }

    setItemEditorState((current) => ({
      ...current,
      saving: true,
      error: '',
    }))

    const isEditing = itemEditorState.mode === 'edit' && itemEditorState.itemId
    const requestUrl = isEditing
      ? `${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(activeWatchlistId)}/items/${encodeURIComponent(itemEditorState.itemId)}`
      : `${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(activeWatchlistId)}/items`

    try {
      const result = await requestApiData(requestUrl, {
        method: isEditing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          symbol,
          displayName: displayName || null,
        }),
      })

      await loadWatchlists(activeWatchlistId)
      await loadWatchlistItems(activeWatchlistId, result?.id || null)
      resetItemEditor()
    } catch (error) {
      console.error('[App] Failed to save watchlist item.', error)
      setItemEditorState((current) => ({
        ...current,
        saving: false,
        error: error.message || '保存失败，请稍后再试。',
      }))
    }
  }

  function submitChatMessage(message) {
    const text = message.trim()
    if (!text) {
      return
    }

    const userMessage = {
      id: `m${nextMessageIdRef.current++}`,
      role: 'user',
      title: '你',
      content: text,
      time: formatChatTime(),
    }
    const assistantMessage = {
      id: `m${nextMessageIdRef.current++}`,
      role: 'assistant',
      title: 'AI 盘面助理',
      content: buildAssistantReply(text, activeSymbol),
      time: formatChatTime(),
    }

    setChatMessages((current) => [...current, userMessage, assistantMessage])
    setChatDraft('')
  }

  function handleChatSubmit(event) {
    event.preventDefault()
    submitChatMessage(chatDraft)
  }

  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitChatMessage(chatDraft)
    }
  }

  return (
    <main className="terminal-page">
      <section ref={shellRef} className="terminal-shell" style={shellStyle}>
        <aside className="watchlist-panel">
          <header className="panel-title-row">
            <div>
              <p className="panel-kicker">自选列表</p>
              <h1>股票终端</h1>
            </div>
            <button type="button" className="tiny-action" onClick={toggleWatchlistEditor}>
              {isWatchlistEditing ? '收起' : '编辑'}
            </button>
          </header>

          <div className="board-tabs" aria-label="分组标签">
            {watchlistGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`board-tab ${group.id === activeWatchlistId ? 'active' : ''}`}
                onClick={() => handleWatchlistSelect(group.id)}
              >
                <span>{group.name}</span>
                <span className="board-tab-count">{group.itemCount ?? '--'}</span>
              </button>
            ))}
          </div>

          {watchlistStatusMessage ? <p className="watchlist-status-note">{watchlistStatusMessage}</p> : null}

          {isWatchlistEditing ? (
            <form className="watchlist-item-editor" onSubmit={handleWatchlistItemSubmit}>
              <div className="watchlist-item-editor-head">
                <strong>{itemEditorState.mode === 'edit' ? '修改标的' : '新增标的'}</strong>
                <button type="button" className="tiny-action ghost" onClick={resetItemEditor}>
                  {itemEditorState.mode === 'edit' ? '切回新增' : '清空'}
                </button>
              </div>
              <label>
                <span>代码</span>
                <input
                  value={itemEditorState.symbol}
                  onChange={(event) => setItemEditorState((current) => ({ ...current, symbol: event.target.value }))}
                  placeholder="例如 GOOG.US"
                />
              </label>
              <label>
                <span>别名</span>
                <input
                  value={itemEditorState.displayName}
                  onChange={(event) => setItemEditorState((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="可选，例如 谷歌-C"
                />
              </label>
              {itemEditorState.error ? <p className="watchlist-editor-error">{itemEditorState.error}</p> : null}
              <div className="watchlist-item-editor-actions">
                <button type="submit" className="ai-send-button" disabled={itemEditorState.saving}>
                  {itemEditorState.saving ? '保存中...' : itemEditorState.mode === 'edit' ? '保存修改' : '添加标的'}
                </button>
              </div>
            </form>
          ) : null}

          <div className="watchlist-head">
            <span>名称/代码</span>
            <span>最新价</span>
            <span>涨跌幅</span>
          </div>

          <div className="watchlist-rows">
            {visibleWatchlistItems.length ? (
              visibleWatchlistItems.map((item) => {
                const quote = quoteSnapshots[item.symbol]
                const isActive = item.id === activeWatchlistItem?.id
                const rowChange = getWatchlistRowChange(item, quote)
                const rowTone = quote?.trend || item.trend || 'up'

                return (
                  <article
                    key={item.id}
                    className={`watchlist-row ${isActive ? 'active' : ''}`}
                    onClick={() => handleWatchlistItemSelect(item.id)}
                  >
                    <div className="watchlist-name">
                      <strong>{getItemTicker(item)}</strong>
                      <span>{getItemName(item)}</span>
                      {isWatchlistEditing && !useFallbackItems ? (
                        <div className="watchlist-row-actions">
                          <button type="button" className="tiny-action ghost" onClick={(event) => beginEditWatchlistItem(item, event)}>
                            修改
                          </button>
                          <button type="button" className="tiny-action danger" onClick={(event) => handleWatchlistItemDelete(item, event)}>
                            删除
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="watchlist-price">{getWatchlistRowPrice(item, quote)}</div>
                    <div className={`watchlist-change ${rowTone}`}>{rowChange}</div>
                  </article>
                )
              })
            ) : (
              <div className="watchlist-empty-state">
                <strong>当前分组还没有标的</strong>
                <span>{isWatchlistEditing ? '直接在上方输入代码添加第一只股票。' : '点击右上角“编辑”即可添加。'}</span>
              </div>
            )}

            <div className="watchlist-footnote">
              当前分组：{activeWatchlist?.name ?? '--'} · 项数 {activeWatchlist?.itemCount ?? visibleWatchlistItems.length ?? '--'}
            </div>
          </div>
        </aside>

        <div
          role="separator"
          tabIndex={0}
          aria-label="调整左侧列宽"
          aria-orientation="vertical"
          className="panel-splitter"
          onDoubleClick={resetPanelWidths}
          onKeyDown={(event) => handleSplitterKeyDown('left', event)}
          onPointerDown={(event) => handleResizeStart('left', event)}
        />

        <section className="chart-panel">
          <header className="chart-header">
            <div>
              <div className="symbol-line">
                <strong>{activeShortSymbol}</strong>
                <span className="after-hours">{activeExchange} · UDF</span>
                <span className={chartChangeTone}>{formatPercent(chartSnapshot.changePercent)}</span>
              </div>
              <p className="chart-subline">{activeDescription} · {activeMarketLabel} · {activeTimeframe}</p>
            </div>

            <div className="chart-header-metrics">
              <div>
                <span>价格</span>
                <strong>{chartPrice}</strong>
              </div>
              <div>
                <span>MA5</span>
                <strong>{chartMa5}</strong>
              </div>
              <div>
                <span>最新成交量</span>
                <strong>{chartVolume}</strong>
              </div>
            </div>
          </header>

          <div className="chart-stage">
            <div className="chart-surface">
              <TradingChart
                symbol={activeSymbol}
                description={activeDescription}
                interval={activeResolution}
                baseUrl={chartUdfBaseUrl}
              />
            </div>
          </div>

          <footer className="chart-footer">
            <div className="timeframes">
              {timeframes.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={`timeframe ${item.label === activeTimeframe ? 'active' : ''}`}
                  onClick={() => setActiveTimeframe(item.label)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="chart-footnote">{chartUdfBaseUrl}/api/udf · OHLCV · {activeSymbol}</div>
          </footer>
        </section>

        <div
          role="separator"
          tabIndex={0}
          aria-label="调整右侧列宽"
          aria-orientation="vertical"
          className="panel-splitter"
          onDoubleClick={resetPanelWidths}
          onKeyDown={(event) => handleSplitterKeyDown('right', event)}
          onPointerDown={(event) => handleResizeStart('right', event)}
        />

        <aside className="detail-panel">
          <section className="ai-panel panel-card">
            <header className="ai-panel-header">
              <div>
                <p className="panel-kicker">AI Copilot</p>
                <h2>盘面对话框</h2>
                <span className="ai-panel-status">已接入 {activeSymbol} UDF 日K、均线与价格上下文</span>
              </div>
              <button type="button" className="market-badge ai-live-badge">
                在线
              </button>
            </header>

            <div className="ai-context-strip">
              <span>{activeSymbol}</span>
              <strong>{chartPrice}</strong>
              <span>MA5 {chartMa5}</span>
              <span>压力 {chartResistance}</span>
            </div>

            <div className="ai-quick-prompts" aria-label="快捷提问">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" className="ai-prompt-chip" onClick={() => submitChatMessage(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>

            <div ref={chatViewportRef} className="ai-message-list">
              {chatMessages.map((message) => (
                <article key={message.id} className={`ai-message ${message.role}`}>
                  <div className="ai-message-meta">
                    <span>{message.title}</span>
                    <time>{message.time}</time>
                  </div>
                  <div className="ai-message-bubble">{message.content}</div>
                </article>
              ))}
            </div>

            <form className="ai-composer" onSubmit={handleChatSubmit}>
              <textarea
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={4}
                placeholder={`直接问：${activeSymbol} 支撑在哪、还能不能追、给个交易计划...`}
              />
              <div className="ai-composer-footer">
                <span>Enter 发送，Shift + Enter 换行</span>
                <button type="submit" className="ai-send-button" disabled={!chatDraft.trim()}>
                  发送
                </button>
              </div>
            </form>
          </section>
        </aside>
      </section>

      <footer className="terminal-footer">
        <div className="footer-indexes">
          {footerIndexes.map((item) => (
            <article key={item.name} className="footer-index">
              <span>{item.name}</span>
              <strong>{item.value}</strong>
              <em className={item.trend}>{item.change}</em>
            </article>
          ))}
        </div>
        <div className="system-clock">2026/04/12 14:05:42</div>
      </footer>
    </main>
  )
}

export default App
