import { useEffect, useRef, useState } from 'react'
import './App.css'
import TradingChart from './components/TradingChart.jsx'
import PortfolioSidebar from './components/PortfolioSidebar.jsx'

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

const chartUdfBaseUrl = (import.meta.env.VITE_UDF_BASE_URL || 'http://127.0.0.1:5200').replace(/\/$/, '')
const portfolioApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || chartUdfBaseUrl).replace(/\/$/, '')

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
    content: '左侧自选树支持文件夹 / 股票 / 笔记三种节点，点击股票节点即可在中央加载 K 线图；右键节点可新增子级、重命名或删除。',
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

function getTrendClass(value) {
  return Number.isFinite(value) && value < 0 ? 'down' : 'up'
}

function getShortSymbol(item) {
  const ticker = item?.ticker || item?.symbol || ''
  return ticker.split(':').pop().split('.')[0] || ticker || '--'
}

function inferMarketLabel(item) {
  const type = item?.stockType || item?.type || ''
  const symbol = item?.symbol || ''
  if (type === 'stocks-us' || type === 'stocks_us' || symbol.endsWith('.US')) return '美股'
  if (type === 'stocks-hk' || type === 'stocks_hk' || symbol.endsWith('.HK')) return '港股'
  if (type === 'stocks-cn' || type === 'stocks_cn' || symbol.endsWith('.SH') || symbol.endsWith('.SZ') || symbol.endsWith('.SS')) return 'A股'
  if (type === 'crypto') return '加密'
  if (type === 'fx') return '外汇'
  return '全球市场'
}

async function fetchHistoryPayload(symbol, resolution = '1D', countback = 20) {
  const url = new URL(`${chartUdfBaseUrl}/api/udf/history`)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('resolution', resolution)
  url.searchParams.set('countback', String(countback))
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
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

function App() {
  const shellRef = useRef(null)
  const dragStateRef = useRef(null)
  const chatViewportRef = useRef(null)
  const nextMessageIdRef = useRef(initialChatMessages.length + 1)

  const [panelWidths, setPanelWidths] = useState(defaultPanelWidths)
  const [chatMessages, setChatMessages] = useState(initialChatMessages)
  const [chatDraft, setChatDraft] = useState('')
  const [activeTimeframe, setActiveTimeframe] = useState('日K')
  const [selectedStock, setSelectedStock] = useState(null)
  const [chartSnapshot, setChartSnapshot] = useState({
    status: 'loading',
    latest: null,
    ma5: null,
    ma8: null,
    ma13: null,
    changePercent: null,
  })

  const activeResolution = timeframes.find((item) => item.label === activeTimeframe)?.resolution ?? '1D'
  const activeSymbol = selectedStock?.symbol || defaultChartSymbol
  const activeDescription = selectedStock?.name || selectedStock?.description || defaultChartDescription
  const activeShortSymbol = getShortSymbol(selectedStock || {})
  const activeExchange = selectedStock?.exchange || defaultChartExchange
  const activeMarketLabel = inferMarketLabel(selectedStock || {})
  const chartChangeTone = getTrendClass(chartSnapshot.changePercent)
  const chartPrice = formatLastValue(chartSnapshot.latest?.close)
  const chartMa5 = formatLastValue(chartSnapshot.ma5)
  const chartResistance = formatLastValue(chartSnapshot.latest?.high)

  const shellStyle = {
    '--left-panel-width': `${panelWidths.left}px`,
    '--right-panel-width': `${panelWidths.right}px`,
  }

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
    return () => window.removeEventListener('resize', syncPanelWidths)
  }, [])

  useEffect(() => {
    function stopDragging() {
      if (!dragStateRef.current) return
      dragStateRef.current = null
      document.body.classList.remove('is-resizing-columns')
    }

    function handlePointerMove(event) {
      const dragState = dragStateRef.current
      const shell = shellRef.current
      if (!dragState || !shell || window.innerWidth <= desktopBreakpoint) return
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
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [chatMessages])

  function updatePanelWidths(updater) {
    const shell = shellRef.current
    if (!shell) return
    setPanelWidths((current) => {
      const next = updater(current)
      return clampPanelWidths(shell.clientWidth, next.left, next.right)
    })
  }

  function handleResizeStart(type, event) {
    if (window.innerWidth <= desktopBreakpoint) return
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
    if (window.innerWidth <= desktopBreakpoint) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
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
    if (!shell) return
    setPanelWidths(clampPanelWidths(shell.clientWidth, defaultPanelWidths.left, defaultPanelWidths.right))
  }

  function handleSelectStockNode(node) {
    setSelectedStock({
      dentryId: node.dentryId,
      inodeId: node.inodeId,
      symbol: node.symbol,
      ticker: node.ticker || node.symbol,
      name: node.name,
      description: node.description || node.name,
      exchange: node.exchange || '',
      stockType: node.stockType || node.type || '',
    })
  }

  function submitChatMessage(message) {
    const text = message.trim()
    if (!text) return
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
        <PortfolioSidebar
          apiBaseUrl={portfolioApiBaseUrl}
          chartUdfBaseUrl={chartUdfBaseUrl}
          selectedStockDentryId={selectedStock?.dentryId ?? null}
          onSelectStock={handleSelectStockNode}
        />

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
        <div className="system-clock">2026/04/17 14:05:42</div>
      </footer>
    </main>
  )
}

export default App
