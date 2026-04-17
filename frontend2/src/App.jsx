import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import TradingChart from './components/TradingChart.jsx'

const desktopBreakpoint = 1200
const splitterWidth = 12
const defaultPanelWidths = { left: 332, right: 368 }
const minLeftPanelWidth = 260
const minCenterPanelWidth = 520
const minRightPanelWidth = 300


const footerIndexes = [
  { name: '道琼斯', value: '47916.570', change: '-0.56%', trend: 'down' },
  { name: '纳斯达克', value: '22902.894', change: '+0.35%', trend: 'up' },
  { name: '标普500', value: '6816.890', change: '-0.11%', trend: 'down' },
]

const defaultChartSymbol = 'GOOG.US'
const defaultChartDescription = '谷歌-C'
const defaultChartExchange = 'LONGBRIDGE'
const watchlistQuotePollingIntervalMs = 5000
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
  { label: '年K', resolution: '12M' },
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
    content: '中间图表和右侧上下文会跟随你点击的自选股切换。如果你想看支撑、压力、趋势或回撤节奏，可以直接问我。',
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

function areStringArraysEqual(left, right) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function createWatchlistModalState(groupCount = 0, overrides = {}) {
  return {
    open: false,
    name: '',
    isDefault: groupCount === 0,
    saving: false,
    error: '',
    ...overrides,
  }
}

function createItemEditorState(overrides = {}) {
  return {
    open: false,
    mode: 'create',
    itemId: null,
    symbol: '',
    displayName: '',
    saving: false,
    error: '',
    ...overrides,
  }
}

function createSymbolSuggestionState(overrides = {}) {
  return {
    status: 'idle',
    items: [],
    activeIndex: -1,
    open: false,
    error: '',
    ...overrides,
  }
}

function normalizeSymbolSuggestion(item) {
  const symbol = item?.symbol || item?.ticker || item?.name || ''
  if (!symbol) {
    return null
  }

  return {
    symbol,
    ticker: item?.ticker || symbol,
    description: item?.description || item?.full_name || item?.name || symbol,
    exchange: item?.exchange || item?.['exchange-listed'] || '',
    type: item?.type || '',
  }
}

function getSuggestionDisplayName(suggestion) {
  const description = suggestion?.description?.trim() || ''
  const symbol = suggestion?.symbol?.trim() || ''

  if (!description || description.toUpperCase() === symbol.toUpperCase()) {
    return ''
  }

  return description
}

function getSymbolSuggestionRank(suggestion, query) {
  const normalizedQuery = query.trim().toUpperCase()
  if (!normalizedQuery) {
    return 0
  }

  const compactQuery = normalizedQuery.replace(/[^A-Z0-9]/g, '')
  const description = getSuggestionDisplayName(suggestion).trim().toUpperCase()
  const symbolVariants = new Set()

  ;[suggestion?.symbol, suggestion?.ticker].forEach((value) => {
    const normalizedValue = value?.trim().toUpperCase()
    if (!normalizedValue) {
      return
    }

    symbolVariants.add(normalizedValue)
    symbolVariants.add(normalizedValue.split(/[.\-:/\s]/)[0])

    const compactValue = normalizedValue.replace(/[^A-Z0-9]/g, '')
    if (compactValue) {
      symbolVariants.add(compactValue)
    }
  })

  let rank = 0

  symbolVariants.forEach((value) => {
    if (!value) {
      return
    }

    if (value === normalizedQuery || (compactQuery && value === compactQuery)) {
      rank = Math.max(rank, 600)
      return
    }

    if (/^[A-Z0-9]+[.\-:/]/.test(value) && value.startsWith(normalizedQuery)) {
      rank = Math.max(rank, 560)
      return
    }

    if (value.startsWith(normalizedQuery) || (compactQuery && value.startsWith(compactQuery))) {
      rank = Math.max(rank, 520)
      return
    }

    if (value.includes(normalizedQuery) || (compactQuery && value.includes(compactQuery))) {
      rank = Math.max(rank, 460)
    }
  })

  if (description.startsWith(normalizedQuery)) {
    rank = Math.max(rank, 320)
  } else if (description.includes(normalizedQuery)) {
    rank = Math.max(rank, 260)
  }

  return rank
}

function rankSymbolSuggestions(items, query) {
  return [...items].sort((left, right) => {
    const rankDelta = getSymbolSuggestionRank(right, query) - getSymbolSuggestionRank(left, query)
    if (rankDelta !== 0) {
      return rankDelta
    }

    const symbolLengthDelta = left.symbol.length - right.symbol.length
    if (symbolLengthDelta !== 0) {
      return symbolLengthDelta
    }

    return left.symbol.localeCompare(right.symbol)
  })
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
  const watchlistRowsRef = useRef(null)
  const watchlistContextMenuRef = useRef(null)
  const symbolInputRef = useRef(null)
  const displayNameInputRef = useRef(null)
  const nextMessageIdRef = useRef(initialChatMessages.length + 1)

  const [panelWidths, setPanelWidths] = useState(defaultPanelWidths)
  const [chatMessages, setChatMessages] = useState(initialChatMessages)
  const [chatDraft, setChatDraft] = useState('')
  const [activeTimeframe, setActiveTimeframe] = useState('日K')
  const [watchlistState, setWatchlistState] = useState({
    status: 'loading',
    groups: [],
    activeId: null,
    error: '',
  })
  const [watchlistItemsState, setWatchlistItemsState] = useState({
    status: 'idle',
    byWatchlistId: {},
    selectedByWatchlistId: {},
    error: '',
  })
  const [chartSelection, setChartSelection] = useState(null)
  const [watchlistContextMenu, setWatchlistContextMenu] = useState(null)
  const [quoteSnapshots, setQuoteSnapshots] = useState({})
  const [pollingWatchlistSymbols, setPollingWatchlistSymbols] = useState([])
  const [chartSnapshot, setChartSnapshot] = useState({
    status: 'loading',
    latest: null,
    ma5: null,
    ma8: null,
    ma13: null,
    changePercent: null,
  })
  const [itemEditorState, setItemEditorState] = useState(() => createItemEditorState())
  const [symbolSuggestionState, setSymbolSuggestionState] = useState(() => createSymbolSuggestionState())
  const [watchlistModalState, setWatchlistModalState] = useState(() => createWatchlistModalState())

  const activeResolution = timeframes.find((item) => item.label === activeTimeframe)?.resolution ?? '1D'
  const watchlistGroups = watchlistState.groups
  const activeWatchlistId = watchlistState.activeId ?? getDefaultWatchlistId(watchlistGroups)
  const activeWatchlist = watchlistGroups.find((group) => group.id === activeWatchlistId) ?? watchlistGroups[0] ?? null
  const resolvedActiveWatchlistId = activeWatchlist?.id ?? activeWatchlistId ?? null
  const activeApiItems = resolvedActiveWatchlistId ? watchlistItemsState.byWatchlistId[resolvedActiveWatchlistId] ?? [] : []
  const visibleWatchlistItems = activeApiItems
  const currentSelection = resolvedActiveWatchlistId ? watchlistItemsState.selectedByWatchlistId[resolvedActiveWatchlistId] : null
  const activeWatchlistItem = visibleWatchlistItems.find((item) => item.id === currentSelection) ?? null
  const chartWatchlistItems = chartSelection?.watchlistId
    ? watchlistItemsState.byWatchlistId[chartSelection.watchlistId] ?? []
    : []
  const chartWatchlistItem = chartSelection
    ? chartWatchlistItems.find((item) => item.id === chartSelection.itemId) ?? null
    : activeWatchlistItem ?? visibleWatchlistItems[0] ?? null
  const highlightedWatchlistItemId = chartSelection?.watchlistId === resolvedActiveWatchlistId
    ? chartSelection.itemId
    : null
  const activeSymbol = chartWatchlistItem?.symbol || defaultChartSymbol
  const activeDescription = getItemName(chartWatchlistItem) || defaultChartDescription
  const activeShortSymbol = getShortSymbol(chartWatchlistItem)
  const activeExchange = chartWatchlistItem?.exchange || defaultChartExchange
  const activeMarketLabel = inferMarketLabel(chartWatchlistItem)
  const chartChangeTone = getTrendClass(chartSnapshot.changePercent)
  const chartPrice = formatLastValue(chartSnapshot.latest?.close)
  const chartMa5 = formatLastValue(chartSnapshot.ma5)
  const chartResistance = formatLastValue(chartSnapshot.latest?.high)
  const activeWatchlistSymbols = useMemo(
    () => [...new Set(visibleWatchlistItems.map((item) => item.symbol).filter(Boolean))],
    [visibleWatchlistItems],
  )
  const shellStyle = {
    '--left-panel-width': `${panelWidths.left}px`,
    '--right-panel-width': `${panelWidths.right}px`,
  }

  async function loadWatchlists(preferredActiveId = null) {
    try {
      const groups = await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists?includeItemCount=true`)
      const nextGroups = Array.isArray(groups) ? groups : []

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
      setWatchlistState({
        status: 'error',
        groups: [],
        activeId: null,
        error: '后端分组接口暂不可用。',
      })
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
        byWatchlistId: {
          ...current.byWatchlistId,
          [watchlistId]: [],
        },
        selectedByWatchlistId: {
          ...current.selectedByWatchlistId,
          [watchlistId]: null,
        },
        error: '自选项接口暂不可用。',
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

        const nextGroups = Array.isArray(groups) ? groups : []
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
          setWatchlistState({
            status: 'error',
            groups: [],
            activeId: null,
            error: '后端分组接口暂不可用。',
          })
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
      if (!resolvedActiveWatchlistId) {
        setWatchlistItemsState((current) => ({ ...current, status: 'idle', error: '' }))
        return
      }

      if (watchlistState.status === 'error') {
        return
      }

      setWatchlistItemsState((current) => ({ ...current, status: 'loading', error: '' }))

      try {
        const items = await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(resolvedActiveWatchlistId)}/items`)
        if (cancelled) {
          return
        }

        const nextItems = Array.isArray(items) ? items : []
        setWatchlistItemsState((current) => {
          const selectionCandidate = current.selectedByWatchlistId[resolvedActiveWatchlistId]
          const nextSelectedId = nextItems.some((item) => item.id === selectionCandidate)
            ? selectionCandidate
            : nextItems[0]?.id ?? null

          return {
            status: 'ready',
            byWatchlistId: {
              ...current.byWatchlistId,
              [resolvedActiveWatchlistId]: nextItems,
            },
            selectedByWatchlistId: {
              ...current.selectedByWatchlistId,
              [resolvedActiveWatchlistId]: nextSelectedId,
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
            byWatchlistId: {
              ...current.byWatchlistId,
              [resolvedActiveWatchlistId]: [],
            },
            selectedByWatchlistId: {
              ...current.selectedByWatchlistId,
              [resolvedActiveWatchlistId]: null,
            },
            error: '自选项接口暂不可用。',
          }))
        }
      }
    }

    bootstrapWatchlistItems()

    return () => {
      cancelled = true
    }
  }, [resolvedActiveWatchlistId, watchlistState.status])

  useEffect(() => {
    if (chartSelection || !resolvedActiveWatchlistId || !visibleWatchlistItems.length) {
      return
    }

    setChartSelection({
      watchlistId: resolvedActiveWatchlistId,
      itemId: currentSelection ?? visibleWatchlistItems[0]?.id ?? null,
    })
  }, [chartSelection, currentSelection, resolvedActiveWatchlistId, visibleWatchlistItems])

  useEffect(() => {
    if (!chartSelection) {
      return
    }

    const selectedItems = watchlistItemsState.byWatchlistId[chartSelection.watchlistId]
    if (!selectedItems) {
      return
    }

    if (selectedItems.some((item) => item.id === chartSelection.itemId)) {
      return
    }

    const fallbackItemId = watchlistItemsState.selectedByWatchlistId[chartSelection.watchlistId]
      ?? selectedItems[0]?.id
      ?? null

    setChartSelection(
      fallbackItemId
        ? { watchlistId: chartSelection.watchlistId, itemId: fallbackItemId }
        : null
    )
  }, [chartSelection, watchlistItemsState.byWatchlistId, watchlistItemsState.selectedByWatchlistId])

  useEffect(() => {
    if (!watchlistContextMenu) {
      return
    }

    function handleWindowPointerDown(event) {
      if (watchlistContextMenuRef.current?.contains(event.target)) {
        return
      }

      closeWatchlistContextMenu()
    }

    function handleWindowKeyDown(event) {
      if (event.key === 'Escape') {
        closeWatchlistContextMenu()
      }
    }

    window.addEventListener('pointerdown', handleWindowPointerDown)
    window.addEventListener('keydown', handleWindowKeyDown)
    window.addEventListener('resize', closeWatchlistContextMenu)
    window.addEventListener('scroll', closeWatchlistContextMenu, true)

    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown)
      window.removeEventListener('keydown', handleWindowKeyDown)
      window.removeEventListener('resize', closeWatchlistContextMenu)
      window.removeEventListener('scroll', closeWatchlistContextMenu, true)
    }
  }, [watchlistContextMenu])

  useEffect(() => {
    if (!watchlistContextMenu || !watchlistContextMenuRef.current) {
      return
    }

    const menu = watchlistContextMenuRef.current
    const nextX = Math.min(watchlistContextMenu.x, window.innerWidth - menu.offsetWidth - 12)
    const nextY = Math.min(watchlistContextMenu.y, window.innerHeight - menu.offsetHeight - 12)

    if (nextX !== watchlistContextMenu.x || nextY !== watchlistContextMenu.y) {
      setWatchlistContextMenu((current) => (
        current
          ? { ...current, x: Math.max(12, nextX), y: Math.max(12, nextY) }
          : current
      ))
    }
  }, [watchlistContextMenu])

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
    const container = watchlistRowsRef.current

    if (!container || !activeWatchlistSymbols.length) {
      setPollingWatchlistSymbols([])
      return undefined
    }

    let frameId = 0

    function syncPollingWatchlistSymbols() {
      frameId = 0
      const containerRect = container.getBoundingClientRect()
      const nextSymbols = [...new Set(
        Array.from(container.querySelectorAll('[data-watchlist-symbol]'))
          .filter((row) => {
            const rect = row.getBoundingClientRect()
            return rect.bottom > containerRect.top && rect.top < containerRect.bottom
          })
          .map((row) => row.dataset.watchlistSymbol)
          .filter(Boolean)
      )]

      setPollingWatchlistSymbols((current) => {
        if (areStringArraysEqual(current, nextSymbols)) {
          return current
        }

        return nextSymbols
      })
    }

    function scheduleSync() {
      if (frameId) {
        return
      }

      frameId = window.requestAnimationFrame(syncPollingWatchlistSymbols)
    }

    syncPollingWatchlistSymbols()
    container.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
      container.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
    }
  }, [activeWatchlistSymbols, visibleWatchlistItems])

  useEffect(() => {
    let cancelled = false

    if (!pollingWatchlistSymbols.length) {
      return undefined
    }

    async function loadQuoteSnapshots() {
      const nextEntries = await Promise.all(
        pollingWatchlistSymbols.map(async (symbol) => {
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
          } catch {
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
    const timerId = window.setInterval(loadQuoteSnapshots, watchlistQuotePollingIntervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [pollingWatchlistSymbols])

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

  useEffect(() => {
    if (!watchlistModalState.open) {
      return undefined
    }

    function handleWindowKeyDown(event) {
      if (event.key === 'Escape' && !watchlistModalState.saving) {
        setWatchlistModalState(createWatchlistModalState(watchlistGroups.length))
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [watchlistGroups.length, watchlistModalState.open, watchlistModalState.saving])

  useEffect(() => {
    if (!itemEditorState.open) {
      setSymbolSuggestionState(createSymbolSuggestionState())
      return undefined
    }

    function handleWindowKeyDown(event) {
      if (event.key === 'Escape' && !itemEditorState.saving) {
        setItemEditorState(createItemEditorState())
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [itemEditorState.open, itemEditorState.saving])

  useEffect(() => {
    if (!itemEditorState.open) {
      return undefined
    }

    const query = itemEditorState.symbol.trim()
    if (!query) {
      setSymbolSuggestionState(createSymbolSuggestionState())
      return undefined
    }

    let cancelled = false
    const controller = new AbortController()
    const timerId = window.setTimeout(async () => {
      setSymbolSuggestionState((current) => ({
        ...current,
        status: 'loading',
        error: '',
      }))

      try {
        const payload = await requestApiData(buildUrl(chartUdfBaseUrl, '/api/udf/search', { query, limit: 8 }), {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (cancelled) {
          return
        }

        const seenSymbols = new Set()
        const items = rankSymbolSuggestions(
          (Array.isArray(payload) ? payload : [])
            .map(normalizeSymbolSuggestion)
            .filter(Boolean),
          query,
        )
          .filter((item) => {
            const symbolKey = item.symbol.toUpperCase()
            if (seenSymbols.has(symbolKey)) {
              return false
            }

            seenSymbols.add(symbolKey)
            return true
          })
          .slice(0, 8)

        setSymbolSuggestionState((current) => ({
          ...current,
          status: 'ready',
          items,
          activeIndex: items.length ? clamp(current.activeIndex, 0, items.length - 1) : -1,
          error: '',
        }))
      } catch (error) {
        if (cancelled || error.name === 'AbortError') {
          return
        }

        setSymbolSuggestionState((current) => ({
          ...current,
          status: 'error',
          items: [],
          activeIndex: -1,
          error: error.message || '搜索失败，请稍后再试。',
        }))
      }
    }, 180)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timerId)
    }
  }, [itemEditorState.open, itemEditorState.symbol])

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

  function closeWatchlistContextMenu() {
    setWatchlistContextMenu(null)
  }

  function handleWatchlistSelect(watchlistId) {
    closeWatchlistContextMenu()
    setWatchlistState((current) => ({ ...current, activeId: watchlistId }))
  }

  function handleWatchlistItemSelect(itemId) {
    if (!resolvedActiveWatchlistId) {
      return
    }

    closeWatchlistContextMenu()
    setWatchlistItemsState((current) => ({
      ...current,
      selectedByWatchlistId: {
        ...current.selectedByWatchlistId,
        [resolvedActiveWatchlistId]: itemId,
      },
    }))
    setChartSelection({ watchlistId: resolvedActiveWatchlistId, itemId })
  }

  function openWatchlistItemMenu(item, event) {
    if (!resolvedActiveWatchlistId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setWatchlistContextMenu({
      type: 'item',
      item,
      watchlistId: resolvedActiveWatchlistId,
      x: event.clientX,
      y: event.clientY,
    })
  }

  function openWatchlistGroupMenu(group, event) {
    event.preventDefault()
    event.stopPropagation()
    setWatchlistContextMenu({
      type: 'group',
      group,
      x: event.clientX,
      y: event.clientY,
    })
  }

  function handleWatchlistTabsWheel(event) {
    const tabs = event.currentTarget
    if (tabs.scrollWidth <= tabs.clientWidth) {
      return
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) {
      return
    }

    tabs.scrollLeft += delta
    event.preventDefault()
  }

  function resetItemEditor(overrides = {}) {
    setItemEditorState(createItemEditorState(overrides))
  }

  function openWatchlistModal() {
    setWatchlistModalState(createWatchlistModalState(watchlistGroups.length, { open: true }))
  }

  function closeWatchlistModal() {
    setWatchlistModalState((current) => {
      if (current.saving) {
        return current
      }

      return createWatchlistModalState(watchlistGroups.length)
    })
  }

  function openWatchlistItemModal(item = null) {
    if (!resolvedActiveWatchlistId) {
      return
    }

    if (item) {
      setItemEditorState(
        createItemEditorState({
          open: true,
          mode: 'edit',
          itemId: item.id,
          symbol: item.symbol || '',
          displayName: item.displayName || '',
        })
      )
      return
    }

    setItemEditorState(createItemEditorState({ open: true }))
  }

  function applySymbolSuggestion(suggestion) {
    const suggestedDisplayName = getSuggestionDisplayName(suggestion)

    setItemEditorState((current) => ({
      ...current,
      symbol: suggestion.symbol,
      displayName: current.displayName.trim() ? current.displayName : suggestedDisplayName,
      error: '',
    }))
    setSymbolSuggestionState((current) => ({
      ...current,
      open: false,
      activeIndex: -1,
      error: '',
    }))

    window.requestAnimationFrame(() => {
      displayNameInputRef.current?.focus()
    })
  }

  function closeWatchlistItemModal() {
    setItemEditorState((current) => {
      if (current.saving) {
        return current
      }

      return createItemEditorState()
    })
  }

  function beginEditWatchlistItem(item, event) {
    event.stopPropagation()
    openWatchlistItemModal(item)
  }

  function handleItemEditorSymbolChange(event) {
    const nextSymbol = event.target.value

    setItemEditorState((current) => ({
      ...current,
      symbol: nextSymbol,
      error: '',
    }))
    setSymbolSuggestionState((current) => ({
      ...current,
      open: Boolean(nextSymbol.trim()),
      activeIndex: nextSymbol.trim() ? 0 : -1,
      error: '',
    }))
  }

  function handleSymbolInputFocus() {
    if (!itemEditorState.symbol.trim()) {
      return
    }

    setSymbolSuggestionState((current) => ({
      ...current,
      open: true,
    }))
  }

  function handleSymbolInputBlur() {
    setSymbolSuggestionState((current) => ({
      ...current,
      open: false,
    }))
  }

  function handleSymbolInputKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSymbolSuggestionState((current) => {
        if (!current.items.length) {
          return { ...current, open: true }
        }

        const nextIndex = current.activeIndex >= 0 ? (current.activeIndex + 1) % current.items.length : 0
        return { ...current, open: true, activeIndex: nextIndex }
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSymbolSuggestionState((current) => {
        if (!current.items.length) {
          return { ...current, open: true }
        }

        const nextIndex = current.activeIndex > 0 ? current.activeIndex - 1 : current.items.length - 1
        return { ...current, open: true, activeIndex: nextIndex }
      })
      return
    }

    if (event.key === 'Escape' && symbolSuggestionState.open) {
      event.preventDefault()
      event.stopPropagation()
      setSymbolSuggestionState((current) => ({
        ...current,
        open: false,
      }))
      return
    }

    if (event.key === 'Enter' && symbolSuggestionState.open && symbolSuggestionState.activeIndex >= 0) {
      const activeSuggestion = symbolSuggestionState.items[symbolSuggestionState.activeIndex]
      if (!activeSuggestion) {
        return
      }

      event.preventDefault()
      applySymbolSuggestion(activeSuggestion)
    }
  }

  async function handleWatchlistItemDelete(item, event = null, watchlistId = resolvedActiveWatchlistId) {
    event?.stopPropagation()

    if (!watchlistId || !window.confirm(`确认从当前 watchlist 移除 ${item.symbol} 吗？`)) {
      return
    }

    closeWatchlistContextMenu()

    try {
      await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(watchlistId)}/items/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      await loadWatchlists(watchlistId)
      await loadWatchlistItems(watchlistId)
      if (itemEditorState.itemId === item.id) {
        resetItemEditor({ open: true })
      }
    } catch (error) {
      console.error('[App] Failed to delete watchlist item.', error)
      setItemEditorState((current) => ({
        ...current,
        error: error.message || '删除失败，请稍后再试。',
      }))
    }
  }

  async function handleWatchlistDelete(group, event = null) {
    event?.stopPropagation()

    if (!group?.id) {
      return
    }

    const groupLabel = group.isDefault ? `“${group.name}”（默认分组）` : `“${group.name}”`
    if (!window.confirm(`确认删除分组 ${groupLabel} 吗？`)) {
      return
    }

    closeWatchlistContextMenu()

    try {
      await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(group.id)}`, {
        method: 'DELETE',
      })

      setWatchlistItemsState((current) => {
        const nextItemsByWatchlistId = { ...current.byWatchlistId }
        const nextSelectedByWatchlistId = { ...current.selectedByWatchlistId }

        delete nextItemsByWatchlistId[group.id]
        delete nextSelectedByWatchlistId[group.id]

        return {
          ...current,
          byWatchlistId: nextItemsByWatchlistId,
          selectedByWatchlistId: nextSelectedByWatchlistId,
        }
      })
      setChartSelection((current) => (
        current?.watchlistId === group.id ? null : current
      ))

      if (resolvedActiveWatchlistId === group.id) {
        resetItemEditor()
      }

      await loadWatchlists(resolvedActiveWatchlistId === group.id ? null : resolvedActiveWatchlistId)
    } catch (error) {
      console.error('[App] Failed to delete watchlist.', error)
      window.alert(error.message || '删除分组失败，请稍后再试。')
    }
  }

  async function handleWatchlistCreate(event) {
    event.preventDefault()

    const name = watchlistModalState.name.trim()
    if (!name) {
      setWatchlistModalState((current) => ({
        ...current,
        error: '请输入分组名称。',
      }))
      return
    }

    setWatchlistModalState((current) => ({
      ...current,
      saving: true,
      error: '',
    }))

    try {
      const result = await requestApiData(`${watchlistApiBaseUrl}/api/v1/watchlists`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          isDefault: watchlistModalState.isDefault,
        }),
      })

      await loadWatchlists(result?.id ?? null)
      setWatchlistModalState(createWatchlistModalState(watchlistGroups.length + 1))
    } catch (error) {
      console.error('[App] Failed to create watchlist.', error)
      setWatchlistModalState((current) => ({
        ...current,
        saving: false,
        error: error.message || '创建分组失败，请稍后再试。',
      }))
    }
  }

  async function handleWatchlistItemSubmit(event) {
    event.preventDefault()

    if (!resolvedActiveWatchlistId) {
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
      ? `${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(resolvedActiveWatchlistId)}/items/${encodeURIComponent(itemEditorState.itemId)}`
      : `${watchlistApiBaseUrl}/api/v1/watchlists/${encodeURIComponent(resolvedActiveWatchlistId)}/items`

    try {
      const result = await requestApiData(requestUrl, {
        method: isEditing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          symbol,
          displayName: displayName || null,
        }),
      })

      await loadWatchlists(resolvedActiveWatchlistId)
      await loadWatchlistItems(resolvedActiveWatchlistId, result?.id || null)
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

  const symbolSuggestionListId = 'watchlist-item-symbol-suggestions'
  const shouldShowSymbolSuggestions = symbolSuggestionState.open && Boolean(itemEditorState.symbol.trim())
  const activeSymbolSuggestionId = shouldShowSymbolSuggestions && symbolSuggestionState.activeIndex >= 0
    ? `${symbolSuggestionListId}-${symbolSuggestionState.activeIndex}`
    : undefined

  return (
    <>
      <main className="terminal-page">
      <section ref={shellRef} className="terminal-shell" style={shellStyle}>
        <aside className="watchlist-panel">
          <header className="panel-title-row">
            <div>
              <p className="panel-kicker">自选列表</p>
              <h1>股票终端</h1>
            </div>
            <div className="panel-title-actions">
              <button type="button" className="tiny-action ghost" onClick={openWatchlistModal}>
                新增分组
              </button>
            </div>
          </header>

          <div className="board-tabs" aria-label="分组标签" onWheel={handleWatchlistTabsWheel}>
            {watchlistGroups.map((group) => {
              const isActiveGroup = group.id === resolvedActiveWatchlistId
              const isGroupMenuOpen = watchlistContextMenu?.type === 'group' && watchlistContextMenu.group.id === group.id

              return (
                <button
                  key={group.id}
                  type="button"
                  className={`board-tab ${isActiveGroup ? 'active' : ''} ${isGroupMenuOpen ? 'menu-open' : ''}`.trim()}
                  onClick={() => handleWatchlistSelect(group.id)}
                  onContextMenu={(event) => openWatchlistGroupMenu(group, event)}
                >
                  <span>{group.name}</span>
                  <span className="board-tab-count">{group.itemCount ?? '--'}</span>
                </button>
              )
            })}
          </div>

          <div className="watchlist-table">
            <div className="watchlist-head">
              <span>名称/代码</span>
              <span>最新价</span>
              <span>涨跌幅</span>
            </div>

            <div ref={watchlistRowsRef} className="watchlist-rows">
              {visibleWatchlistItems.length ? (
                <>
                  {visibleWatchlistItems.map((item) => {
                    const quote = quoteSnapshots[item.symbol]
                    const isActive = item.id === highlightedWatchlistItemId
                    const isMenuOpen = watchlistContextMenu?.type === 'item'
                      && watchlistContextMenu.item.id === item.id
                      && watchlistContextMenu.watchlistId === resolvedActiveWatchlistId
                    const rowChange = getWatchlistRowChange(item, quote)
                    const rowTone = quote?.trend || item.trend || 'up'

                    return (
                      <article
                        key={item.id}
                        className={`watchlist-row ${isActive ? 'active' : ''} ${isMenuOpen ? 'menu-open' : ''}`.trim()}
                        data-watchlist-symbol={item.symbol}
                        onClick={() => handleWatchlistItemSelect(item.id)}
                        onContextMenu={(event) => openWatchlistItemMenu(item, event)}
                      >
                        <div className="watchlist-name">
                          <strong>{getItemTicker(item)}</strong>
                          <span>{getItemName(item)}</span>
                        </div>
                        <div className="watchlist-price">{getWatchlistRowPrice(item, quote)}</div>
                        <div className={`watchlist-change ${rowTone}`}>{rowChange}</div>
                      </article>
                    )
                  })}
                  <div className="watchlist-row watchlist-row-action">
                    <button type="button" className="tiny-action" onClick={() => openWatchlistItemModal()} disabled={!resolvedActiveWatchlistId}>
                      添加
                    </button>
                  </div>
                </>
              ) : activeWatchlist ? (
                <>
                  <div className="watchlist-empty-state">
                    <div className="watchlist-empty-copy">
                      <strong>当前分组还没有标的</strong>
                      <span>点击下方“添加”即可通过弹窗给当前 watchlist 添加标的。</span>
                    </div>
                  </div>
                  <div className="watchlist-row watchlist-row-action">
                    <button type="button" className="tiny-action" onClick={() => openWatchlistItemModal()}>
                      添加
                    </button>
                  </div>
                </>
              ) : (
                <div className="watchlist-empty-state">
                  <div className="watchlist-empty-copy">
                    <strong>暂无可展示的自选内容</strong>
                    <span>点击“新增分组”即可创建你的第一个 watchlist。</span>
                  </div>
                  <button type="button" className="tiny-action watchlist-empty-action" onClick={openWatchlistModal}>
                    添加分组
                  </button>
                </div>
              )}
            </div>

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
            <div className="symbol-line">
              <strong>{activeShortSymbol}</strong>
              <span className="after-hours">{activeExchange} · UDF</span>
              <span className={chartChangeTone}>{formatPercent(chartSnapshot.changePercent)}</span>
              <span
                className="chart-subline"
                title={`${activeDescription} · ${activeMarketLabel} · ${activeTimeframe}`}
              >
                {activeDescription} · {activeMarketLabel} · {activeTimeframe}
              </span>
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

      {watchlistContextMenu ? (
        <div
          ref={watchlistContextMenuRef}
          className="watchlist-context-menu"
          style={{ left: `${watchlistContextMenu.x}px`, top: `${watchlistContextMenu.y}px` }}
          role="menu"
          aria-label={watchlistContextMenu.type === 'group'
            ? `${watchlistContextMenu.group.name} 操作菜单`
            : `${watchlistContextMenu.item.symbol} 操作菜单`}
        >
          {watchlistContextMenu.type === 'group' ? (
            <button
              type="button"
              className="watchlist-context-menu-item danger"
              onClick={(event) => handleWatchlistDelete(watchlistContextMenu.group, event)}
            >
              删除分组
            </button>
          ) : (
            <button
              type="button"
              className="watchlist-context-menu-item danger"
              onClick={(event) => handleWatchlistItemDelete(watchlistContextMenu.item, event, watchlistContextMenu.watchlistId)}
            >
              从当前 watchlist 移除
            </button>
          )}
        </div>
      ) : null}

      {watchlistModalState.open ? (
        <div className="watchlist-modal-backdrop" onClick={closeWatchlistModal}>
          <div className="watchlist-modal" role="dialog" aria-modal="true" aria-labelledby="watchlist-modal-title" onClick={(event) => event.stopPropagation()}>
            <form className="watchlist-modal-form" onSubmit={handleWatchlistCreate}>
              <div className="watchlist-modal-head">
                <div>
                  <p className="panel-kicker">Watchlist</p>
                  <h2 id="watchlist-modal-title">新增分组</h2>
                </div>
                <button type="button" className="tiny-action ghost" onClick={closeWatchlistModal} disabled={watchlistModalState.saving}>
                  关闭
                </button>
              </div>

              <label>
                <span>分组名称</span>
                <input
                  autoFocus
                  value={watchlistModalState.name}
                  onChange={(event) => setWatchlistModalState((current) => ({ ...current, name: event.target.value, error: '' }))}
                  placeholder="例如 AI 观察池"
                />
              </label>

              <label className="watchlist-modal-checkbox">
                <input
                  type="checkbox"
                  checked={watchlistModalState.isDefault}
                  onChange={(event) => setWatchlistModalState((current) => ({ ...current, isDefault: event.target.checked }))}
                />
                <span>设为默认分组</span>
              </label>

              {watchlistModalState.error ? <p className="watchlist-editor-error">{watchlistModalState.error}</p> : null}

              <div className="watchlist-modal-actions">
                <button type="button" className="tiny-action ghost" onClick={closeWatchlistModal} disabled={watchlistModalState.saving}>
                  取消
                </button>
                <button type="submit" className="ai-send-button" disabled={watchlistModalState.saving}>
                  {watchlistModalState.saving ? '创建中...' : '创建分组'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {itemEditorState.open ? (
        <div className="watchlist-modal-backdrop" onClick={closeWatchlistItemModal}>
          <div
            className="watchlist-modal watchlist-item-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="watchlist-item-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="watchlist-item-modal-layout">
              <form className="watchlist-modal-form watchlist-item-modal-form" onSubmit={handleWatchlistItemSubmit}>
                <div className="watchlist-modal-head">
                  <div>
                    <p className="panel-kicker">{activeWatchlist?.name ?? 'Watchlist'}</p>
                    <h2 id="watchlist-item-modal-title">{itemEditorState.mode === 'edit' ? '编辑标的' : '新增标的'}</h2>
                  </div>
                  <button type="button" className="tiny-action ghost" onClick={closeWatchlistItemModal} disabled={itemEditorState.saving}>
                    关闭
                  </button>
                </div>

                <div className="watchlist-symbol-field">
                  <label>
                    <span>代码</span>
                    <input
                      ref={symbolInputRef}
                      autoFocus
                      value={itemEditorState.symbol}
                      onChange={handleItemEditorSymbolChange}
                      onFocus={handleSymbolInputFocus}
                      onBlur={handleSymbolInputBlur}
                      onKeyDown={handleSymbolInputKeyDown}
                      placeholder="例如 GOOG.US 或 谷歌"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={shouldShowSymbolSuggestions}
                      aria-controls={shouldShowSymbolSuggestions ? symbolSuggestionListId : undefined}
                      aria-activedescendant={activeSymbolSuggestionId}
                    />
                  </label>
                  <p className="watchlist-symbol-hint">支持输入代码或名称，键盘上下可直接选中候选项。</p>

                  {shouldShowSymbolSuggestions ? (
                    <div className="watchlist-symbol-suggestions" id={symbolSuggestionListId} role="listbox" aria-label="候选代码">
                      {symbolSuggestionState.status === 'loading' ? (
                        <div className="watchlist-symbol-suggestion-state">正在匹配代码...</div>
                      ) : symbolSuggestionState.error ? (
                        <div className="watchlist-symbol-suggestion-state">{symbolSuggestionState.error}</div>
                      ) : symbolSuggestionState.items.length ? (
                        symbolSuggestionState.items.map((suggestion, index) => {
                          const suggestionDisplayName = getSuggestionDisplayName(suggestion)
                          const suggestionMeta = [suggestion.exchange, inferMarketLabel(suggestion)].filter(Boolean).join(' · ')

                          return (
                            <button
                              key={`${suggestion.symbol}-${index}`}
                              id={`${symbolSuggestionListId}-${index}`}
                              type="button"
                              className={`watchlist-symbol-suggestion ${symbolSuggestionState.activeIndex === index ? 'active' : ''}`.trim()}
                              role="option"
                              aria-selected={symbolSuggestionState.activeIndex === index}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => applySymbolSuggestion(suggestion)}
                            >
                              <div className="watchlist-symbol-suggestion-copy">
                                <strong>{suggestion.symbol}</strong>
                                <span title={suggestionDisplayName || '代码匹配结果'}>{suggestionDisplayName || '代码匹配结果'}</span>
                              </div>
                              <span className="watchlist-symbol-suggestion-meta">{suggestionMeta || '可直接加入当前 watchlist'}</span>
                            </button>
                          )
                        })
                      ) : (
                        <div className="watchlist-symbol-suggestion-state">未找到匹配结果，可直接保存你输入的代码。</div>
                      )}
                    </div>
                  ) : null}
                </div>

                <label>
                  <span>别名</span>
                  <input
                    ref={displayNameInputRef}
                    value={itemEditorState.displayName}
                    onChange={(event) => setItemEditorState((current) => ({ ...current, displayName: event.target.value, error: '' }))}
                    placeholder="可选，例如 谷歌-C"
                  />
                </label>

                {itemEditorState.error ? <p className="watchlist-editor-error">{itemEditorState.error}</p> : null}

                <div className="watchlist-modal-actions">
                  <button
                    type="button"
                    className="tiny-action ghost"
                    onClick={() => resetItemEditor({ open: true })}
                    disabled={itemEditorState.saving}
                  >
                    {itemEditorState.mode === 'edit' ? '切换到新增' : '清空'}
                  </button>
                  <button type="submit" className="ai-send-button" disabled={itemEditorState.saving}>
                    {itemEditorState.saving ? '保存中...' : itemEditorState.mode === 'edit' ? '保存修改' : '添加标的'}
                  </button>
                </div>
              </form>

              <section className="watchlist-item-manage-list" aria-label="当前分组标的">
                <div className="watchlist-item-manage-head">
                  <strong>当前分组标的</strong>
                  <span>{activeWatchlist?.itemCount ?? visibleWatchlistItems.length ?? 0} 项</span>
                </div>

                {visibleWatchlistItems.length ? (
                  <div className="watchlist-item-manage-rows">
                    {visibleWatchlistItems.map((item) => (
                      <article
                        key={item.id}
                        className={`watchlist-item-manage-row ${itemEditorState.itemId === item.id ? 'active' : ''}`}
                      >
                        <div className="watchlist-item-manage-copy">
                          <strong>{getItemTicker(item)}</strong>
                          <span>{getItemName(item)}</span>
                        </div>
                        <div className="watchlist-item-manage-actions">
                          <button
                            type="button"
                            className="tiny-action ghost"
                            onClick={(event) => beginEditWatchlistItem(item, event)}
                            disabled={itemEditorState.saving}
                          >
                            {itemEditorState.itemId === item.id && itemEditorState.mode === 'edit' ? '编辑中' : '修改'}
                          </button>
                          <button
                            type="button"
                            className="tiny-action danger"
                            onClick={(event) => handleWatchlistItemDelete(item, event)}
                            disabled={itemEditorState.saving}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="watchlist-item-manage-empty">
                    <strong>当前分组还没有标的</strong>
                    <span>先在上方输入代码，再点击“添加标的”。</span>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default App
