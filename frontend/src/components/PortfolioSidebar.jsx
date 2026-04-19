import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import './PortfolioSidebar.css'

marked.setOptions({ gfm: true, breaks: false })

const quotePollingIntervalMs = 5000

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

function formatPrice(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '--'
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function toneOf(value) {
  return Number.isFinite(value) && value < 0 ? 'down' : 'up'
}

function countStocksInSubtree(node) {
  if (!node) return 0
  if (node.type === 'stock') return 1
  if (!node.children?.length) return 0
  let total = 0
  for (const child of node.children) {
    total += countStocksInSubtree(child)
  }
  return total
}

function orderChildren(children) {
  if (!children?.length) return children || []
  // Stable sort: folders first, then others. Original order kept within each group.
  return [...children]
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const aFolder = a.child.type === 'folder' ? 0 : 1
      const bFolder = b.child.type === 'folder' ? 0 : 1
      if (aFolder !== bFolder) return aFolder - bFolder
      return a.index - b.index
    })
    .map((entry) => entry.child)
}

function collectSubtreeDentryIds(node, collected = new Set()) {
  if (!node) return collected
  collected.add(node.dentryId)
  if (node.children?.length) {
    for (const child of node.children) collectSubtreeDentryIds(child, collected)
  }
  return collected
}

const DRAG_MIME = 'application/x-portfolio-dentry'

const EXPANSION_STORAGE_KEY = 'portfolio:expanded-dentries'

function loadExpansionFromStorage() {
  try {
    const raw = window.localStorage.getItem(EXPANSION_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed) : new Set()
  } catch {
    return new Set()
  }
}

function persistExpansion(set) {
  try {
    window.localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore quota errors */
  }
}

const typeLabel = {
  folder: '文件夹',
  stock: '股票',
  markdown: '笔记',
}

const typeIcon = {
  folder: '📁',
  folderOpen: '📂',
  stock: '📈',
  markdown: '📝',
}

const contextMenuActionsByType = {
  folder: [
    { action: 'add-folder', label: '新建子文件夹' },
    { action: 'add-stock', label: '新建股票' },
    { action: 'add-markdown', label: '新建笔记' },
    { action: 'rename', label: '重命名' },
    { action: 'delete', label: '删除', tone: 'danger' },
  ],
  stock: [
    { action: 'add-markdown', label: '新建子笔记' },
    { action: 'rename', label: '重命名' },
    { action: 'edit-symbol', label: '修改代码' },
    { action: 'delete', label: '删除', tone: 'danger' },
  ],
  markdown: [
    { action: 'view-markdown', label: '查看 / 编辑内容' },
    { action: 'rename', label: '重命名' },
    { action: 'delete', label: '删除', tone: 'danger' },
  ],
}

function TreeNode({
  node,
  depth,
  expandedSet,
  onToggle,
  onSelectStock,
  onSelectMarkdown,
  selectedDentryId,
  contextMenuDentryId,
  onContextMenu,
  quoteSnapshots,
  draggingDentryId,
  dropTargetDentryId,
  onDragStart,
  onDragEnd,
  onDragOverNode,
  onDragLeaveNode,
  onDropNode,
  isValidDropTarget,
}) {
  const hasChildren = (node.children?.length ?? 0) > 0
  const isExpandable = (node.type === 'folder' || node.type === 'stock') && hasChildren
  const isExpanded = expandedSet.has(node.dentryId)
  const isSelected = selectedDentryId === node.dentryId
  const isMenuTarget = contextMenuDentryId === node.dentryId
  const quote = node.type === 'stock' ? quoteSnapshots[node.symbol] : null
  const displayIcon = node.type === 'folder'
    ? (isExpanded && hasChildren ? typeIcon.folderOpen : typeIcon.folder)
    : typeIcon[node.type]
  const isDragging = draggingDentryId === node.dentryId
  const isDropTarget = dropTargetDentryId === node.dentryId

  function handleRowClick() {
    if (node.type === 'folder') {
      onToggle(node.dentryId)
      return
    }
    if (node.type === 'stock') {
      onSelectStock(node)
      return
    }
    if (node.type === 'markdown') {
      onSelectMarkdown(node)
    }
  }

  function handleChevronClick(event) {
    event.stopPropagation()
    onToggle(node.dentryId)
  }

  function handleContextMenu(event) {
    event.preventDefault()
    event.stopPropagation()
    onContextMenu(node, event.clientX, event.clientY)
  }

  function handleDragStart(event) {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    try {
      event.dataTransfer.setData(DRAG_MIME, String(node.dentryId))
      event.dataTransfer.setData('text/plain', node.name || node.symbol || String(node.dentryId))
    } catch {
      /* some browsers may reject custom mime types on setData for ui drags */
    }
    onDragStart(node)
  }

  function handleDragEnd() {
    onDragEnd()
  }

  function handleDragOver(event) {
    if (!isValidDropTarget(node)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    onDragOverNode(node)
  }

  function handleDragLeave(event) {
    if (!isValidDropTarget(node)) return
    event.stopPropagation()
    onDragLeaveNode(node)
  }

  function handleDrop(event) {
    if (!isValidDropTarget(node)) return
    event.preventDefault()
    event.stopPropagation()
    onDropNode(node)
  }

  return (
    <>
      <div
        className={
          'tree-row' +
          ` type-${node.type}` +
          (isSelected ? ' selected' : '') +
          (isMenuTarget ? ' menu-open' : '') +
          (isDragging ? ' dragging' : '') +
          (isDropTarget ? ' drop-target' : '')
        }
        style={{ paddingLeft: 6 + depth * 14 }}
        data-portfolio-dentry={node.dentryId}
        data-portfolio-symbol={node.type === 'stock' ? node.symbol : undefined}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        title={`${typeLabel[node.type]} · ${node.name}`}
      >
        {isExpandable ? (
          <button
            type="button"
            className={'tree-chevron' + (isExpanded ? ' expanded' : '')}
            onClick={handleChevronClick}
            aria-label={isExpanded ? '折叠' : '展开'}
            aria-expanded={isExpanded}
            tabIndex={-1}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-chevron placeholder" />
        )}
        <span className="tree-icon" aria-hidden>{displayIcon}</span>
        {node.type === 'stock' ? (
          <span className="tree-name tree-name-stock">
            <span className="tree-name-primary">{node.ticker || node.symbol || '--'}</span>
            <span className="tree-name-secondary">{node.name || node.description || node.symbol || ''}</span>
          </span>
        ) : (
          <span className="tree-name">{node.name || node.symbol || '未命名'}</span>
        )}
        {node.type === 'folder' ? (
          <span className="tree-folder-count" title="包含的股票数（含子文件夹）">
            {countStocksInSubtree(node)}
          </span>
        ) : null}
        {node.type === 'stock' ? (
          <span className={'tree-quote ' + (quote?.trend || 'up')}>
            <span className="tree-quote-price">{formatPrice(quote?.latestPrice)}</span>
            <span className="tree-quote-change">{formatPercent(quote?.changePercent)}</span>
          </span>
        ) : null}
      </div>

      {isExpanded && hasChildren ? (
        <div className="tree-children">
          {orderChildren(node.children).map((child) => (
            <TreeNode
              key={child.dentryId}
              node={child}
              depth={depth + 1}
              expandedSet={expandedSet}
              onToggle={onToggle}
              onSelectStock={onSelectStock}
              onSelectMarkdown={onSelectMarkdown}
              selectedDentryId={selectedDentryId}
              contextMenuDentryId={contextMenuDentryId}
              onContextMenu={onContextMenu}
              quoteSnapshots={quoteSnapshots}
              draggingDentryId={draggingDentryId}
              dropTargetDentryId={dropTargetDentryId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOverNode={onDragOverNode}
              onDragLeaveNode={onDragLeaveNode}
              onDropNode={onDropNode}
              isValidDropTarget={isValidDropTarget}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

function NodeEditorModal({ state, onChange, onClose, onSubmit, onSymbolSearch }) {
  const nameInputRef = useRef(null)
  const symbolInputRef = useRef(null)
  const [suggestionState, setSuggestionState] = useState({ items: [], status: 'idle', activeIndex: -1 })
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)

  useEffect(() => {
    if (!state.open) return undefined
    const timer = setTimeout(() => {
      if (state.mode === 'create' && state.type === 'stock') {
        symbolInputRef.current?.focus()
      } else {
        nameInputRef.current?.focus()
      }
    }, 20)
    return () => clearTimeout(timer)
  }, [state.open, state.mode, state.type])

  useEffect(() => {
    if (!state.open || state.type !== 'stock') return undefined
    const query = state.symbol?.trim()
    if (!query) return undefined
    const controller = new AbortController()
    let cancelled = false
    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const items = await onSymbolSearch(query, controller.signal)
        if (cancelled) return
        setSuggestionState({ items, status: 'ready', activeIndex: items.length ? 0 : -1 })
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return
        setSuggestionState({ items: [], status: 'error', activeIndex: -1 })
      }
    }, 200)
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [state.open, state.type, state.symbol, onSymbolSearch])

  const suggestionOpen = state.open
    && state.type === 'stock'
    && Boolean(state.symbol?.trim())
    && !suggestionDismissed

  function applySuggestion(suggestion) {
    onChange({
      symbol: suggestion.symbol,
      name: state.name?.trim() ? state.name : (suggestion.description || suggestion.symbol),
    })
    setSuggestionDismissed(true)
    window.requestAnimationFrame(() => nameInputRef.current?.focus())
  }

  if (!state.open) return null

  const title = state.mode === 'create'
    ? `新建${typeLabel[state.type] || '节点'}`
    : `编辑${typeLabel[state.type] || '节点'}`

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <div className="portfolio-modal-backdrop" onClick={onClose}>
      <div
        className="portfolio-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <form className="portfolio-modal-form" onSubmit={handleSubmit}>
          <div className="portfolio-modal-head">
            <div>
              <p className="portfolio-kicker">Portfolio</p>
              <h2 id="portfolio-modal-title">{title}</h2>
            </div>
            <button type="button" className="portfolio-ghost-btn" onClick={onClose} disabled={state.saving}>
              关闭
            </button>
          </div>

          {state.mode === 'create' ? (
            <div className="portfolio-type-picker" role="radiogroup" aria-label="节点类型">
              {['folder', 'stock', 'markdown'].map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={state.type === t}
                  className={'portfolio-type-option' + (state.type === t ? ' active' : '')}
                  onClick={() => onChange({ type: t })}
                >
                  <span className="portfolio-type-icon" aria-hidden>{typeIcon[t]}</span>
                  <span>{typeLabel[t]}</span>
                </button>
              ))}
            </div>
          ) : null}

          {state.type === 'stock' ? (
            <label className="portfolio-modal-field portfolio-symbol-field">
              <span>代码</span>
              <input
                ref={symbolInputRef}
                value={state.symbol || ''}
                onChange={(event) => {
                  onChange({ symbol: event.target.value })
                  setSuggestionDismissed(false)
                }}
                onBlur={() => setSuggestionDismissed(true)}
                onFocus={() => {
                  if (state.symbol?.trim()) setSuggestionDismissed(false)
                }}
                placeholder="例如 GOOG.US 或 苹果"
                autoComplete="off"
              />
              {suggestionOpen ? (
                <div className="portfolio-symbol-suggestions" role="listbox">
                  {suggestionState.status === 'loading' ? (
                    <div className="portfolio-symbol-suggestion-state">正在匹配代码...</div>
                  ) : suggestionState.status === 'error' ? (
                    <div className="portfolio-symbol-suggestion-state">搜索失败，可直接保存。</div>
                  ) : suggestionState.items.length ? (
                    suggestionState.items.map((item, index) => (
                      <button
                        key={`${item.symbol}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === suggestionState.activeIndex}
                        className={'portfolio-symbol-suggestion' + (index === suggestionState.activeIndex ? ' active' : '')}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applySuggestion(item)}
                      >
                        <strong>{item.symbol}</strong>
                        <span>{item.description || item.symbol}</span>
                        <em>{item.exchange}</em>
                      </button>
                    ))
                  ) : (
                    <div className="portfolio-symbol-suggestion-state">未命中候选，可直接保存。</div>
                  )}
                </div>
              ) : null}
            </label>
          ) : null}

          <label className="portfolio-modal-field">
            <span>显示名</span>
            <input
              ref={nameInputRef}
              value={state.name || ''}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder={state.type === 'folder' ? '例如 美股科技' : state.type === 'markdown' ? '例如 2026Q1 复盘' : '可选，默认使用代码'}
            />
          </label>

          {state.type === 'markdown' ? (
            <label className="portfolio-modal-field">
              <span>内容</span>
              <textarea
                value={state.content || ''}
                onChange={(event) => onChange({ content: event.target.value })}
                rows={10}
                placeholder="# 在这里写 Markdown..."
              />
            </label>
          ) : null}

          {state.error ? <p className="portfolio-editor-error">{state.error}</p> : null}

          <div className="portfolio-modal-actions">
            <button type="button" className="portfolio-ghost-btn" onClick={onClose} disabled={state.saving}>
              取消
            </button>
            <button type="submit" className="portfolio-primary-btn" disabled={state.saving}>
              {state.saving ? '保存中...' : state.mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MarkdownViewerModalInner({ state, onClose, onSave }) {
  const [draft, setDraft] = useState(state?.content || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editorRef = useRef(null)
  const previewRef = useRef(null)
  const scrollSourceRef = useRef(null)
  const scrollResetTimerRef = useRef(null)

  const previewHtml = useMemo(() => {
    try {
      return marked.parse(draft || '')
    } catch {
      return ''
    }
  }, [draft])

  function syncScroll(source) {
    if (scrollSourceRef.current && scrollSourceRef.current !== source) return
    const editor = editorRef.current
    const preview = previewRef.current
    if (!editor || !preview) return

    scrollSourceRef.current = source
    const src = source === 'editor' ? editor : preview
    const dst = source === 'editor' ? preview : editor
    const srcMax = Math.max(1, src.scrollHeight - src.clientHeight)
    const dstMax = Math.max(0, dst.scrollHeight - dst.clientHeight)
    const ratio = Math.min(1, Math.max(0, src.scrollTop / srcMax))
    dst.scrollTop = ratio * dstMax

    if (scrollResetTimerRef.current) clearTimeout(scrollResetTimerRef.current)
    scrollResetTimerRef.current = setTimeout(() => {
      scrollSourceRef.current = null
    }, 80)
  }

  useEffect(() => () => {
    if (scrollResetTimerRef.current) clearTimeout(scrollResetTimerRef.current)
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSave(draft)
      onClose()
    } catch (err) {
      setError(err.message || '保存失败')
      setSaving(false)
    }
  }

  return (
    <div className="portfolio-modal-backdrop" onClick={onClose}>
      <div
        className="portfolio-modal portfolio-markdown-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="portfolio-modal-head">
          <div>
            <p className="portfolio-kicker">Markdown</p>
            <h2>{state.name}</h2>
          </div>
          <button type="button" className="portfolio-ghost-btn" onClick={onClose} disabled={saving}>
            关闭
          </button>
        </div>
        <div className="portfolio-markdown-split">
          <div className="portfolio-markdown-pane">
            <div className="portfolio-markdown-pane-label">编辑</div>
            <textarea
              ref={editorRef}
              className="portfolio-markdown-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onScroll={() => syncScroll('editor')}
              placeholder="# 开始写笔记..."
            />
          </div>
          <div className="portfolio-markdown-pane">
            <div className="portfolio-markdown-pane-label">预览</div>
            <div
              ref={previewRef}
              className="portfolio-markdown-preview"
              onScroll={() => syncScroll('preview')}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
        {error ? <p className="portfolio-editor-error">{error}</p> : null}
        <div className="portfolio-modal-actions">
          <button type="button" className="portfolio-ghost-btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="portfolio-primary-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MarkdownViewerModal({ state, onClose, onSave }) {
  if (!state?.open) return null
  // Use dentryId as key to reset internal state when switching nodes.
  return <MarkdownViewerModalInner key={state.dentryId} state={state} onClose={onClose} onSave={onSave} />
}

export default function PortfolioSidebar({
  apiBaseUrl,
  chartUdfBaseUrl,
  selectedStockDentryId,
  onSelectStock,
}) {
  const [treeState, setTreeState] = useState({ status: 'loading', roots: [], error: '' })
  const [expanded, setExpanded] = useState(() => loadExpansionFromStorage())
  const [contextMenu, setContextMenu] = useState(null)
  const [editor, setEditor] = useState({ open: false })
  const [markdownViewer, setMarkdownViewer] = useState({ open: false })
  const [quoteSnapshots, setQuoteSnapshots] = useState({})
  const [visibleSymbols, setVisibleSymbols] = useState([])
  const [draggingNode, setDraggingNode] = useState(null)
  const [dropTargetDentryId, setDropTargetDentryId] = useState(null)
  const [rootDropHover, setRootDropHover] = useState(false)

  const contextMenuRef = useRef(null)
  const rowsRef = useRef(null)

  useEffect(() => {
    persistExpansion(expanded)
  }, [expanded])

  const loadTree = useCallback(async () => {
    setTreeState((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'loading', error: '' }))
    try {
      const roots = await requestApiData(`${apiBaseUrl}/api/v1/portfolios/tree`)
      setTreeState({ status: 'ready', roots: Array.isArray(roots) ? roots : [], error: '' })
    } catch (error) {
      console.error('[PortfolioSidebar] load tree failed', error)
      setTreeState({ status: 'error', roots: [], error: error.message || '加载自选树失败。' })
    }
  }, [apiBaseUrl])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  // Auto-expand the first top-level folder on initial load (if no saved expansion)
  useEffect(() => {
    if (treeState.status !== 'ready' || expanded.size > 0) return
    const firstFolder = treeState.roots.find((node) => node.type === 'folder')
    if (firstFolder) {
      setExpanded(new Set([firstFolder.dentryId]))
    }
  }, [treeState.status, treeState.roots, expanded.size])

  function toggleExpand(dentryId) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(dentryId)) next.delete(dentryId)
      else next.add(dentryId)
      return next
    })
  }

  // Quote polling for visible stock rows
  const computeVisibleSymbols = useCallback(() => {
    const container = rowsRef.current
    if (!container) {
      setVisibleSymbols([])
      return
    }
    const containerRect = container.getBoundingClientRect()
    const symbols = new Set()
    container.querySelectorAll('[data-portfolio-symbol]').forEach((row) => {
      const symbol = row.getAttribute('data-portfolio-symbol')
      if (!symbol) return
      const rect = row.getBoundingClientRect()
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        symbols.add(symbol)
      }
    })
    const next = [...symbols]
    setVisibleSymbols((current) => {
      if (current.length === next.length && current.every((sym, i) => sym === next[i])) {
        return current
      }
      return next
    })
  }, [])

  useEffect(() => {
    const container = rowsRef.current
    if (!container) return undefined
    computeVisibleSymbols()
    let frameId = 0
    function schedule() {
      if (frameId) return
      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        computeVisibleSymbols()
      })
    }
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [computeVisibleSymbols, treeState.roots, expanded])

  useEffect(() => {
    if (!visibleSymbols.length) return undefined
    let cancelled = false
    async function loadQuotes() {
      const entries = await Promise.all(visibleSymbols.map(async (symbol) => {
        try {
          const response = await fetch(
            buildUrl(chartUdfBaseUrl, '/api/udf/history', { symbol, resolution: '1D', countback: 2 }),
            { headers: { Accept: 'application/json' } },
          )
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (payload?.s === 'error') throw new Error(payload?.errmsg || 'snapshot error')
          const points = parseHistoryPoints(payload)
          const latest = points.at(-1)
          const previous = points.at(-2)
          const changePercent = previous?.close ? ((latest.close - previous.close) / previous.close) * 100 : null
          return [symbol, { latestPrice: latest?.close ?? null, changePercent, trend: toneOf(changePercent) }]
        } catch {
          return [symbol, { latestPrice: null, changePercent: null, trend: 'up' }]
        }
      }))
      if (cancelled) return
      setQuoteSnapshots((current) => ({ ...current, ...Object.fromEntries(entries) }))
    }
    loadQuotes()
    const timerId = window.setInterval(loadQuotes, quotePollingIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [visibleSymbols, chartUdfBaseUrl])

  // Context menu lifecycle
  useEffect(() => {
    if (!contextMenu) return undefined
    function handlePointerDown(event) {
      if (contextMenuRef.current?.contains(event.target)) return
      setContextMenu(null)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', () => setContextMenu(null))
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const menu = contextMenuRef.current
    const nextX = Math.min(contextMenu.x, window.innerWidth - menu.offsetWidth - 12)
    const nextY = Math.min(contextMenu.y, window.innerHeight - menu.offsetHeight - 12)
    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((current) => (current ? { ...current, x: Math.max(12, nextX), y: Math.max(12, nextY) } : current))
    }
  }, [contextMenu])

  function openContextMenu(node, x, y) {
    setContextMenu({ node, x, y })
  }

  function openEditorForCreate(parentInodeId, defaultType = 'folder') {
    setContextMenu(null)
    setEditor({
      open: true,
      mode: 'create',
      parentInodeId: parentInodeId ?? null,
      type: defaultType,
      name: '',
      symbol: '',
      content: '',
      saving: false,
      error: '',
    })
  }

  function openEditorForRename(node) {
    setContextMenu(null)
    setEditor({
      open: true,
      mode: 'edit',
      dentryId: node.dentryId,
      type: node.type,
      name: node.name || '',
      symbol: node.symbol || '',
      content: '',
      editingField: 'name',
      saving: false,
      error: '',
    })
  }

  function openEditorForSymbol(node) {
    setContextMenu(null)
    setEditor({
      open: true,
      mode: 'edit',
      dentryId: node.dentryId,
      type: 'stock',
      name: node.name || '',
      symbol: node.symbol || '',
      content: '',
      editingField: 'symbol',
      saving: false,
      error: '',
    })
  }

  async function openMarkdownViewer(node) {
    setContextMenu(null)
    try {
      const fresh = await requestApiData(`${apiBaseUrl}/api/v1/portfolios/nodes/${node.dentryId}`)
      setMarkdownViewer({
        open: true,
        dentryId: node.dentryId,
        name: fresh.name,
        content: fresh.content || '',
      })
    } catch (error) {
      window.alert(error.message || '读取笔记失败')
    }
  }

  async function handleContextMenuAction(action) {
    const node = contextMenu?.node
    if (!node) return
    if (action === 'add-folder') openEditorForCreate(node.inodeId, 'folder')
    else if (action === 'add-stock') openEditorForCreate(node.inodeId, 'stock')
    else if (action === 'add-markdown') openEditorForCreate(node.inodeId, 'markdown')
    else if (action === 'rename') openEditorForRename(node)
    else if (action === 'edit-symbol') openEditorForSymbol(node)
    else if (action === 'view-markdown') openMarkdownViewer(node)
    else if (action === 'delete') handleDelete(node)
  }

  async function handleDelete(node) {
    setContextMenu(null)
    const nodeLabel = `${typeLabel[node.type]}「${node.name || node.symbol}」`
    const warning = node.type === 'folder'
      ? `确认删除 ${nodeLabel}？包含的所有子节点都会一并删除。`
      : `确认删除 ${nodeLabel}？`
    if (!window.confirm(warning)) return
    try {
      await requestApiData(`${apiBaseUrl}/api/v1/portfolios/nodes/${node.dentryId}`, { method: 'DELETE' })
      await loadTree()
    } catch (error) {
      window.alert(error.message || '删除失败')
    }
  }

  function updateEditor(patch) {
    setEditor((current) => ({ ...current, ...patch, error: '' }))
  }

  async function submitEditor() {
    setEditor((current) => ({ ...current, saving: true, error: '' }))
    try {
      const body = {}
      const name = (editor.name || '').trim()
      const symbol = (editor.symbol || '').trim().toUpperCase()

      if (editor.mode === 'create') {
        if (!name && editor.type !== 'stock') {
          setEditor((current) => ({ ...current, saving: false, error: '请填写显示名。' }))
          return
        }
        if (editor.type === 'stock' && !symbol) {
          setEditor((current) => ({ ...current, saving: false, error: '请填写股票代码。' }))
          return
        }
        body.type = editor.type
        body.name = name || symbol
        body.parentId = editor.parentInodeId ?? null
        if (editor.type === 'stock') body.symbol = symbol
        if (editor.type === 'markdown') body.content = editor.content ?? ''

        const created = await requestApiData(`${apiBaseUrl}/api/v1/portfolios/nodes`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        // 乐观更新：直接插入节点，不重拉整树
        if (created) {
          const newNode = { ...created, children: [] }
          if (created.parentId == null) {
            setTreeState((current) => ({
              ...current,
              roots: [...current.roots, newNode],
            }))
          } else {
            setTreeState((current) => ({
              ...current,
              roots: _insertNodeIntoTree(current.roots, created.parentId, newNode),
            }))
          }
          if (created.type === 'folder') {
            setExpanded((current) => new Set(current).add(created.dentryId))
          }
          if (editor.parentInodeId) {
            const parentDentryId = findParentDentryByInode(treeState.roots, editor.parentInodeId)
            if (parentDentryId) setExpanded((current) => new Set(current).add(parentDentryId))
          }
        }
      } else {
        if (editor.editingField !== 'symbol' && !name) {
          setEditor((current) => ({ ...current, saving: false, error: '显示名不能为空。' }))
          return
        }
        if (editor.editingField === 'name' || editor.editingField === undefined) {
          body.name = name
        }
        if (editor.editingField === 'symbol') {
          if (!symbol) {
            setEditor((current) => ({ ...current, saving: false, error: '请填写股票代码。' }))
            return
          }
          body.symbol = symbol
        }
        await requestApiData(`${apiBaseUrl}/api/v1/portfolios/nodes/${editor.dentryId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        await loadTree()
      }
      setEditor({ open: false })
    } catch (error) {
      setEditor((current) => ({ ...current, saving: false, error: error.message || '保存失败' }))
    }
  }

  async function onSymbolSearch(query, signal) {
    const payload = await requestApiData(
      buildUrl(chartUdfBaseUrl, '/api/udf/search', { query, limit: 8 }),
      { signal },
    )
    const seen = new Set()
    return (Array.isArray(payload) ? payload : [])
      .map((item) => ({
        symbol: item.symbol || item.ticker || '',
        description: item.description || item.full_name || item.name || '',
        exchange: item.exchange || item['exchange-listed'] || '',
        type: item.type || '',
      }))
      .filter((item) => {
        if (!item.symbol) return false
        const key = item.symbol.toUpperCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 8)
  }

  async function saveMarkdownContent(content) {
    if (!markdownViewer?.dentryId) return
    await requestApiData(`${apiBaseUrl}/api/v1/portfolios/nodes/${markdownViewer.dentryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    })
    setMarkdownViewer((current) => ({ ...current, content }))
  }

  function handleSelectStock(node) {
    onSelectStock?.(node)
  }

  function handleSelectMarkdown(node) {
    openMarkdownViewer(node)
  }

  // --- Drag and drop ---
  const draggingDescendantIds = useMemo(() => {
    if (!draggingNode) return null
    return collectSubtreeDentryIds(draggingNode)
  }, [draggingNode])

  const isValidDropTarget = useCallback((node) => {
    if (!draggingNode) return false
    if (node.type !== 'folder') return false
    if (draggingDescendantIds?.has(node.dentryId)) return false
    // Also skip if the drag target is already the node's current parent (no-op move)
    if (draggingNode.parentId === node.inodeId) return false
    return true
  }, [draggingNode, draggingDescendantIds])

  function handleDragStart(node) {
    setDraggingNode(node)
    setDropTargetDentryId(null)
    setRootDropHover(false)
  }

  function handleDragEnd() {
    setDraggingNode(null)
    setDropTargetDentryId(null)
    setRootDropHover(false)
  }

  function handleDragOverNode(node) {
    setDropTargetDentryId((current) => (current === node.dentryId ? current : node.dentryId))
  }

  function handleDragLeaveNode(node) {
    setDropTargetDentryId((current) => (current === node.dentryId ? null : current))
  }

  async function moveNode(sourceNode, targetParentInodeId) {
    try {
      await requestApiData(`${apiBaseUrl}/api/v1/portfolios/nodes/${sourceNode.dentryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId: targetParentInodeId }),
      })
      await loadTree()
      // Auto-expand the destination folder so the user sees where it landed
      if (targetParentInodeId != null) {
        const targetDentryId = findParentDentryByInode(treeState.roots, targetParentInodeId)
        if (targetDentryId) {
          setExpanded((current) => new Set(current).add(targetDentryId))
        }
      }
    } catch (error) {
      window.alert(error.message || '移动失败')
    }
  }

  async function handleDropNode(targetNode) {
    const source = draggingNode
    setDraggingNode(null)
    setDropTargetDentryId(null)
    if (!source) return
    if (source.parentId === targetNode.inodeId) return
    await moveNode(source, targetNode.inodeId)
  }

  function handleRootDragOver(event) {
    if (!draggingNode) return
    if (draggingNode.parentId == null) return // already at root
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setRootDropHover(true)
  }

  function handleRootDragLeave() {
    setRootDropHover(false)
  }

  async function handleRootDrop(event) {
    if (!draggingNode) return
    event.preventDefault()
    const source = draggingNode
    setDraggingNode(null)
    setRootDropHover(false)
    if (source.parentId == null) return
    await moveNode(source, null)
  }

  // Recompute visible symbols whenever the tree or expansion changes
  useEffect(() => {
    const timer = setTimeout(() => {
      // Wait for DOM update
      const container = rowsRef.current
      if (!container) return
      const containerRect = container.getBoundingClientRect()
      const symbols = new Set()
      container.querySelectorAll('[data-portfolio-symbol]').forEach((row) => {
        const symbol = row.getAttribute('data-portfolio-symbol')
        if (!symbol) return
        const rect = row.getBoundingClientRect()
        if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) symbols.add(symbol)
      })
      const next = [...symbols]
      setVisibleSymbols((current) => {
        if (current.length === next.length && current.every((sym, i) => sym === next[i])) return current
        return next
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [treeState.roots, expanded])

  const menuActions = contextMenu ? contextMenuActionsByType[contextMenu.node.type] || [] : []
  const totalStockCount = useMemo(() => {
    function count(nodes) {
      return nodes.reduce((sum, node) => sum + (node.type === 'stock' ? 1 : 0) + count(node.children || []), 0)
    }
    return count(treeState.roots)
  }, [treeState.roots])

  return (
    <>
      <aside className="portfolio-panel">
        <header className="portfolio-panel-head">
          <div>
            <p className="portfolio-kicker">Portfolio</p>
            <h1>自选树</h1>
          </div>
          <div className="portfolio-panel-actions">
            <button type="button" className="portfolio-ghost-btn" onClick={() => loadTree()} title="刷新">
              ↻
            </button>
            <button type="button" className="portfolio-ghost-btn" onClick={() => openEditorForCreate(null, 'folder')}>
              新增根节点
            </button>
          </div>
        </header>

        <div className="portfolio-tree-wrap" ref={rowsRef}>
          {treeState.status === 'loading' ? (
            <div className="portfolio-empty">加载中...</div>
          ) : treeState.status === 'error' ? (
            <div className="portfolio-empty">
              <strong>加载失败</strong>
              <span>{treeState.error}</span>
              <button type="button" className="portfolio-ghost-btn" onClick={() => loadTree()}>重试</button>
            </div>
          ) : treeState.roots.length === 0 ? (
            <div className="portfolio-empty">
              <strong>还没有任何节点</strong>
              <span>点击右上角“新增根节点”开始。</span>
            </div>
          ) : (
            <>
              {orderChildren(treeState.roots).map((node) => (
                <TreeNode
                  key={node.dentryId}
                  node={node}
                  depth={0}
                  expandedSet={expanded}
                  onToggle={toggleExpand}
                  onSelectStock={handleSelectStock}
                  onSelectMarkdown={handleSelectMarkdown}
                  selectedDentryId={selectedStockDentryId}
                  contextMenuDentryId={contextMenu?.node?.dentryId ?? null}
                  onContextMenu={openContextMenu}
                  quoteSnapshots={quoteSnapshots}
                  draggingDentryId={draggingNode?.dentryId ?? null}
                  dropTargetDentryId={dropTargetDentryId}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOverNode={handleDragOverNode}
                  onDragLeaveNode={handleDragLeaveNode}
                  onDropNode={handleDropNode}
                  isValidDropTarget={isValidDropTarget}
                />
              ))}
              {draggingNode && draggingNode.parentId != null ? (
                <div
                  className={'portfolio-root-drop-zone' + (rootDropHover ? ' active' : '')}
                  onDragOver={handleRootDragOver}
                  onDragLeave={handleRootDragLeave}
                  onDrop={handleRootDrop}
                >
                  放到这里 → 移动到顶层
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="portfolio-footnote">
          股票总数 {totalStockCount} · 可见 {visibleSymbols.length}
        </div>
      </aside>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="portfolio-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          role="menu"
        >
          {menuActions.map((entry) => (
            <button
              key={entry.action}
              type="button"
              className={'portfolio-context-menu-item' + (entry.tone === 'danger' ? ' danger' : '')}
              onClick={() => handleContextMenuAction(entry.action)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      <NodeEditorModal
        state={editor}
        onChange={updateEditor}
        onClose={() => (!editor.saving && setEditor({ open: false }))}
        onSubmit={submitEditor}
        onSymbolSearch={onSymbolSearch}
      />

      <MarkdownViewerModal
        state={markdownViewer}
        onClose={() => setMarkdownViewer({ open: false })}
        onSave={saveMarkdownContent}
      />
    </>
  )
}

function findParentDentryByInode(nodes, inodeId) {
  for (const node of nodes) {
    if (node.inodeId === inodeId) return node.dentryId
    if (node.children?.length) {
      const nested = findParentDentryByInode(node.children, inodeId)
      if (nested) return nested
    }
  }
  return null
}

function _insertNodeIntoTree(nodes, parentInodeId, newNode) {
  return nodes.map((node) => {
    if (node.inodeId === parentInodeId) {
      return { ...node, children: [...(node.children || []), newNode] }
    }
    if (node.children?.length) {
      return { ...node, children: _insertNodeIntoTree(node.children, parentInodeId, newNode) }
    }
    return node
  })
}
