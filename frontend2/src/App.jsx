import { useEffect, useRef, useState } from 'react'
import './App.css'
import TradingChart from './components/TradingChart.jsx'

const desktopBreakpoint = 1200
const splitterWidth = 12
const defaultPanelWidths = { left: 332, right: 368 }
const minLeftPanelWidth = 260
const minCenterPanelWidth = 520
const minRightPanelWidth = 300

const boardTabs = ['持仓', '最近关注etf', 'CPO光', '存储', '铜', 'ETF']
const watchlist = [
  { name: '博通', code: 'AVGO', price: '371.550', change: '+4.69%', trend: 'up' },
  { name: '英伟达', code: 'NVDA', price: '188.630', change: '+2.57%', trend: 'up' },
  { name: '亚马逊', code: 'AMZN', price: '238.380', change: '+2.02%', trend: 'up' },
  { name: '台积电', code: 'TSM', price: '370.600', change: '+1.40%', trend: 'up' },
  { name: '特斯拉', code: 'TSLA', price: '348.950', change: '+0.96%', trend: 'up' },
  { name: 'Meta', code: 'META', price: '629.860', change: '+0.23%', trend: 'up' },
  { name: '苹果', code: 'AAPL', price: '260.480', change: '-0.01%', trend: 'down' },
  { name: '谷歌-C', code: 'GOOG.US', price: '315.720', change: '-0.21%', trend: 'down', active: true },
  { name: '微软', code: 'MSFT', price: '370.870', change: '-0.59%', trend: 'down' },
]

const footerIndexes = [
  { name: '道琼斯', value: '47916.570', change: '-0.56%', trend: 'down' },
  { name: '纳斯达克', value: '22902.894', change: '+0.35%', trend: 'up' },
  { name: '标普500', value: '6816.890', change: '-0.11%', trend: 'down' },
]
const chartSymbol = 'GOOG.US'
const chartShortSymbol = 'GOOG'
const chartDescription = '谷歌-C'
const chartMarketLabel = '美股'
const chartExchange = 'LONGBRIDGE'
const chartUdfBaseUrl = (import.meta.env.VITE_UDF_BASE_URL || 'http://127.0.0.1:5101').replace(/\/$/, '')
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
    content: '我已经接入当前 GOOG.US 的 UDF 日K、均线和最近价格数据。你可以直接问我走势总结、关键位、仓位建议或风险提示。',
    time: '14:05',
  },
  {
    id: 'm2',
    role: 'assistant',
    title: '即时观察',
    content: '当前图表与中间栏指标已经和 UDF 数据源同步。如果你想看支撑、压力、趋势或回撤节奏，可以直接问我。',
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

function buildAssistantReply(prompt) {
  const text = prompt.trim().toLowerCase()

  if (text.includes('支撑') || text.includes('压力') || text.includes('关键位')) {
    return '支撑先看最近一根日K低点和 MA5 一带的动态承接，上方则观察最近 swing high 附近的压力。更稳妥的做法，是结合放量突破或回踩企稳来确认。'
  }

  if (text.includes('计划') || text.includes('策略') || text.includes('交易')) {
    return '如果你偏顺势，就等突破确认后再分批跟；如果你更看重盈亏比，优先等回踩均线或前高转支撑的确认，再决定仓位和止损。'
  }

  if (text.includes('追') || text.includes('买吗') || text.includes('上车')) {
    return '当前位置更适合先分清是做突破还是做回踩，不一定是最舒服的追价位置。等量价确认后再动手，通常会比直接追更从容。'
  }

  if (text.includes('风险') || text.includes('回撤') || text.includes('止损')) {
    return '主要风险在于临近阶段高点时量价配合转弱，一旦重新跌回短期均线下方，短线节奏就可能从强整理转成回撤，需要重新评估仓位和止损。'
  }

  return '从当前图形看，GOOG.US 更像趋势延续中的整理段，结构并没有明显走坏，但离阶段压力也不远。更适合先明确自己做突破还是做回踩，再决定进出节奏。'
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
  const finalMaxLeftWidth = Math.max(
    minLeftPanelWidth,
    availableWidth - nextRightWidth - minCenterPanelWidth
  )

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

  const [chartSnapshot, setChartSnapshot] = useState({
    status: 'loading',
    latest: null,
    ma5: null,
    ma8: null,
    ma13: null,
    changePercent: null,
  })

  const activeResolution = timeframes.find((item) => item.label === activeTimeframe)?.resolution ?? '1D'

  useEffect(() => {
    let cancelled = false

    async function loadChartSnapshot() {
      try {
        const response = await fetch(
          `${chartUdfBaseUrl}/api/udf/history?symbol=${encodeURIComponent(chartSymbol)}&resolution=1D&countback=20`
        )

        if (!response.ok) {
          throw new Error(`Snapshot request failed: ${response.status}`)
        }

        const payload = await response.json()

        if (payload?.code && payload.code !== 0) {
          throw new Error(payload.msg || 'Snapshot request failed.')
        }

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
  }, [])

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

  const shellStyle = {
    '--left-panel-width': `${panelWidths.left}px`,
    '--right-panel-width': `${panelWidths.right}px`,
  }
  const chartChangeTone = Number.isFinite(chartSnapshot.changePercent) && chartSnapshot.changePercent < 0 ? 'down' : 'up'
  const chartPrice = formatLastValue(chartSnapshot.latest?.close)
  const chartMa5 = formatLastValue(chartSnapshot.ma5)
  const chartMa8 = formatLastValue(chartSnapshot.ma8)
  const chartMa13 = formatLastValue(chartSnapshot.ma13)
  const chartVolume = formatVolume(chartSnapshot.latest?.volume)
  const chartResistance = formatLastValue(chartSnapshot.latest?.high)

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
      content: buildAssistantReply(text),
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
            <button type="button" className="tiny-action">
              编辑
            </button>
          </header>

          <div className="board-tabs" aria-label="分组标签">
            {boardTabs.map((tab, index) => (
              <button key={tab} type="button" className={`board-tab ${index === 1 ? 'active' : ''}`}>
                {tab}
              </button>
            ))}
          </div>

          <div className="watchlist-head">
            <span>名称/代码</span>
            <span>最新价</span>
            <span>涨跌幅</span>
          </div>

          <div className="watchlist-rows">
            {watchlist.map((item) => (
              <article key={item.code} className={`watchlist-row ${item.active ? 'active' : ''}`}>
                <div className="watchlist-name">
                  <strong>{item.code}</strong>
                  <span>{item.name}</span>
                </div>
                <div className="watchlist-price">{item.price}</div>
                <div className={`watchlist-change ${item.trend}`}>{item.change}</div>
              </article>
            ))}
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
                <strong>{chartShortSymbol}</strong>
                <span className="after-hours">{chartExchange} · UDF</span>
                <span className={chartChangeTone}>{formatPercent(chartSnapshot.changePercent)}</span>
              </div>
              <p className="chart-subline">{chartDescription} · {chartMarketLabel} · {activeTimeframe}</p>
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
              <div className="ma-strip">
                <span>MA5: {chartMa5}</span>
                <span>MA8: {chartMa8}</span>
                <span>MA13: {chartMa13}</span>
              </div>

              <TradingChart symbol={chartSymbol} description={chartDescription} interval={activeResolution} baseUrl={chartUdfBaseUrl} />
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
            <div className="chart-footnote">{chartUdfBaseUrl}/api/udf · OHLCV · {chartSymbol}</div>
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
                <span className="ai-panel-status">已接入 GOOG.US UDF 日K、均线与价格上下文</span>
              </div>
              <button type="button" className="market-badge ai-live-badge">
                在线
              </button>
            </header>

            <div className="ai-context-strip">
              <span>{chartSymbol}</span>
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
                placeholder="直接问：支撑在哪、还能不能追、给个交易计划..."
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
