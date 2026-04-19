import { useEffect, useRef, useState, useCallback } from 'react'
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
  const url = new URL(`${chartUdfBaseUrl}/udf/history`)
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

function stripHtml(str) {
  if (typeof str !== 'string') return '--'
  return str.replace(/<[^>]*>/g, '')
}

function formatLargeNumber(value) {
  if (value == null || !Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + ' 万亿'
  if (abs >= 1e8) return (value / 1e8).toFixed(2) + ' 亿'
  if (abs >= 1e4) return (value / 1e4).toFixed(2) + ' 万'
  return String(value)
}

function formatStatValue(value) {
  if (value == null) return '--'
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return String(value)
  const abs = Math.abs(num)
  if (abs >= 100) return num.toFixed(2)
  if (abs >= 1) return num.toFixed(3)
  return num.toFixed(4)
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

  const [panelWidths, setPanelWidths] = useState(defaultPanelWidths)
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
  const [staticInfo, setStaticInfo] = useState(null)

  const activeResolution = timeframes.find((item) => item.label === activeTimeframe)?.resolution ?? '1D'
  const activeSymbol = selectedStock?.symbol || defaultChartSymbol
  const activeDescription = selectedStock?.name || selectedStock?.description || defaultChartDescription
  const activeShortSymbol = getShortSymbol(selectedStock || {})
  const activeExchange = selectedStock?.exchange || defaultChartExchange
  const activeMarketLabel = inferMarketLabel(selectedStock || {})
  const chartChangeTone = getTrendClass(chartSnapshot.changePercent)

  const shellStyle = {
    '--left-panel-width': `${panelWidths.left}px`,
    '--right-panel-width': `${panelWidths.right}px`,
  }

  // --- Admin log panel ---
  const [logLines, setLogLines] = useState([])
  const [logOpen, setLogOpen] = useState(false)
  const logEndRef = useRef(null)
  const esRef = useRef(null)

  const connectLogs = useCallback(() => {
    if (esRef.current) esRef.current.close()
    const es = new EventSource(`${chartUdfBaseUrl}/logs/stream`)
    esRef.current = es
    es.onmessage = (e) => {
      if (e.data && !e.data.startsWith(' : ')) {
        setLogLines((prev) => {
          const next = [...prev, e.data]
          return next.length > 500 ? next.slice(-500) : next
        })
      }
    }
    es.onerror = () => {
      es.close()
      esRef.current = null
    }
  }, [chartUdfBaseUrl])

  useEffect(() => {
    connectLogs()
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [connectLogs])

  useEffect(() => {
    if (logOpen && logEndRef.current) {
      const sel = window.getSelection()
      if (!sel || sel.toString() === '') {
        logEndRef.current.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [logLines, logOpen])

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
    setStaticInfo(null)

    async function loadStaticInfo() {
      try {
        const response = await fetch(`${portfolioApiBaseUrl}/v1/symbols/${encodeURIComponent(activeSymbol)}/static-info`)
        if (!response.ok) return
        const json = await response.json()
        if (!cancelled && json.code === 0 && json.data) {
          setStaticInfo(json.data)
        }
      } catch {
        /* silent */
      }
    }

    loadStaticInfo()
    return () => { cancelled = true }
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
            <div className="chart-footnote">{chartUdfBaseUrl}/udf · OHLCV · {activeSymbol}</div>
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
          {staticInfo && (
            <section className="company-info-card panel-card">
              <header className="company-info-header">
                <div>
                  <p className="panel-kicker">公司概况</p>
                  <h2>{staticInfo.name_cn || staticInfo.name_en || activeSymbol}</h2>
                  <span className="company-info-sub">{staticInfo.name_en}{staticInfo.exchange ? ` · ${staticInfo.exchange}` : ''}</span>
                </div>
                <span className="market-badge">{staticInfo.currency || '--'}</span>
              </header>
              <div className="company-info-grid">
                <div className="company-info-item">
                  <span className="company-info-label">市值</span>
                  <span className="company-info-value">
                    {Number.isFinite(staticInfo.total_shares) && Number.isFinite(chartSnapshot.latest?.close)
                      ? formatLargeNumber(staticInfo.total_shares * chartSnapshot.latest.close)
                      : '--'}
                  </span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">流通市值</span>
                  <span className="company-info-value">
                    {Number.isFinite(staticInfo.circulating_shares) && Number.isFinite(chartSnapshot.latest?.close)
                      ? formatLargeNumber(staticInfo.circulating_shares * chartSnapshot.latest.close)
                      : '--'}
                  </span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">总股本</span>
                  <span className="company-info-value">{formatLargeNumber(staticInfo.total_shares)}</span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">流通股</span>
                  <span className="company-info-value">{formatLargeNumber(staticInfo.circulating_shares)}</span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">每手</span>
                  <span className="company-info-value">{staticInfo.lot_size ?? '--'}</span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">EPS</span>
                  <span className="company-info-value">{formatStatValue(staticInfo.eps)}</span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">EPS (TTM)</span>
                  <span className="company-info-value">{formatStatValue(staticInfo.eps_ttm)}</span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">每股净资产</span>
                  <span className="company-info-value">{formatStatValue(staticInfo.bps)}</span>
                </div>
                <div className="company-info-item">
                  <span className="company-info-label">股息率</span>
                  <span className="company-info-value">{staticInfo.dividend_yield != null ? staticInfo.dividend_yield + '%' : '--'}</span>
                </div>

              </div>

              {staticInfo.fundamentals && (
                <>
                  {staticInfo.fundamentals.company?.profile && (
                    <div className="company-info-section">
                      <span className="company-info-label">公司简介</span>
                      <p className="company-info-value" title={staticInfo.fundamentals.company.profile}>
                        {staticInfo.fundamentals.company.profile}
                      </p>
                      <small className="company-info-sub">
                        {[
                          staticInfo.fundamentals.company?.manager && `CEO: ${staticInfo.fundamentals.company.manager}`,
                          staticInfo.fundamentals.company?.employees && `员工: ${Number(staticInfo.fundamentals.company.employees).toLocaleString()}`,
                          staticInfo.fundamentals.company?.founded && `成立: ${staticInfo.fundamentals.company.founded}`,
                          staticInfo.fundamentals.company?.website && staticInfo.fundamentals.company.website,
                        ].filter(Boolean).join(' · ')}
                      </small>
                    </div>
                  )}

                  {staticInfo.fundamentals.valuation?.pe_desc && (
                    <>
                      <div className="company-info-subheader">PE 估值</div>
                      <div
                        className="company-info-pe"
                        dangerouslySetInnerHTML={{ __html: staticInfo.fundamentals.valuation.pe_desc }}
                      />
                    </>
                  )}

                  <div className="company-info-subheader">机构评级 & 预测</div>
                  <div className="company-info-grid">
                    {staticInfo.fundamentals.institution_rating && (
                      <>
                        <div className="company-info-item">
                          <span className="company-info-label">买/持/卖</span>
                          <span className="company-info-value">
                            {`${staticInfo.fundamentals.institution_rating.buy ?? '-'}/${staticInfo.fundamentals.institution_rating.hold ?? '-'}/${staticInfo.fundamentals.institution_rating.sell ?? '-'}`}
                          </span>
                        </div>
                        <div className="company-info-item">
                          <span className="company-info-label">目标价</span>
                          <span className="company-info-value">
                            {formatStatValue(staticInfo.fundamentals.institution_rating.target_prev_close)}
                          </span>
                        </div>
                      </>
                    )}
                    {staticInfo.fundamentals.consensus?.eps_estimate && (
                      <div className="company-info-item">
                        <span className="company-info-label">预期 EPS</span>
                        <span className="company-info-value">{formatStatValue(staticInfo.fundamentals.consensus.eps_estimate)}</span>
                      </div>
                    )}
                    {staticInfo.fundamentals.consensus?.revenue_estimate && (
                      <div className="company-info-item">
                        <span className="company-info-label">预期营收</span>
                        <span className="company-info-value">{formatLargeNumber(Number(staticInfo.fundamentals.consensus.revenue_estimate))}</span>
                      </div>
                    )}
                    {staticInfo.fundamentals.consensus?.net_income_estimate && (
                      <div className="company-info-item">
                        <span className="company-info-label">预期净利润</span>
                        <span className="company-info-value">{formatLargeNumber(Number(staticInfo.fundamentals.consensus.net_income_estimate))}</span>
                      </div>
                    )}
                    {staticInfo.fundamentals.forecast_eps?.mean && (
                      <div className="company-info-item">
                        <span className="company-info-label">预测 EPS</span>
                        <span className="company-info-value">
                          {`${formatStatValue(staticInfo.fundamentals.forecast_eps.lowest)}~${formatStatValue(staticInfo.fundamentals.forecast_eps.highest)}`}
                        </span>
                      </div>
                    )}
                    {staticInfo.fundamentals.dividend?.desc && (
                      <div className="company-info-item">
                        <span className="company-info-label">派息</span>
                        <span className="company-info-value" title={staticInfo.fundamentals.dividend.desc}>
                          {staticInfo.fundamentals.dividend.desc}
                        </span>
                      </div>
                    )}
                    {staticInfo.fundamentals.dividend?.ex_date && (
                      <div className="company-info-item">
                        <span className="company-info-label">除息日</span>
                        <span className="company-info-value">{staticInfo.fundamentals.dividend.ex_date}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
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

      {/* Admin: Live log panel */}
      <button
        type="button"
        onClick={() => setLogOpen((v) => !v)}
        style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
          background: '#222', color: '#4d4', border: '1px solid #4d4',
          borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
          fontFamily: 'monospace',
        }}
      >
        {logOpen ? '日志 ▲' : '日志 ▼'}
      </button>

      {logOpen && (
        <div style={{
          position: 'fixed', bottom: 52, right: 16, zIndex: 9998,
          width: 700, height: 400, background: '#0a0',
          border: '1px solid #3a3', borderRadius: 4,
          display: 'flex', flexDirection: 'column', fontSize: 11,
          fontFamily: 'Consolas, "Courier New", monospace',
        }}>
          <div style={{ padding: '6px 10px', background: '#1a1', borderBottom: '1px solid #2a2',
            color: '#8f8', fontSize: 12, flexShrink: 0, userSelect: 'none' }}>
            实时日志 (SSE) —— {chartUdfBaseUrl}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px', color: '#ccc' }}>
            {logLines.map((line, i) => {
              const ms = line.match(/duration_ms=(\d+\.?\d*)/)
              const slow = ms && parseFloat(ms[1]) > 500
              return (
                <div key={i} style={{
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  color: slow ? '#f66' : line.includes('ERROR') ? '#f77' : line.includes('WARN') ? '#fa0' : '#ccc',
                  fontWeight: slow ? 'bold' : 'normal',
                }}>{line}</div>
              )
            })}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </main>
  )
}

export default App
