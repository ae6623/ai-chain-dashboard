import { useEffect, useRef } from 'react'

import { colorForRatio, computeVolumeProfile } from './volumeProfile'

// Approximate insets for the TV widget's main pane inside its iframe.
// Measured empirically on Charting Library v27 with right-side price scale.
const PANE_INSETS = {
  top: 42,     // top toolbar height
  bottom: 32,  // bottom time-axis height
  right: 68,   // right-side price-axis width
  left: 8,     // left padding
}

function readPriceRange(chart) {
  try {
    const scale = chart.getPanes?.()[0]?.getMainSourcePriceScale?.() || chart.priceScale?.('right')
    if (scale?.getVisiblePriceRange) {
      const range = scale.getVisiblePriceRange()
      if (range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from) {
        return { from: range.from, to: range.to }
      }
    }
  } catch (error) {
    console.debug('[VP] getVisiblePriceRange failed', error)
  }
  return null
}

function readTimeRange(chart) {
  try {
    const r = chart.getVisibleRange?.()
    if (r && Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from) {
      return { from: r.from * 1000, to: r.to * 1000 }
    }
  } catch (error) {
    console.debug('[VP] getVisibleRange failed', error)
  }
  return null
}

function filterVisibleBars(bars, fromMs, toMs) {
  if (!bars || bars.length === 0) return []
  let left = 0
  let right = bars.length
  let start = -1
  while (left < right) {
    const mid = (left + right) >>> 1
    if (bars[mid].time >= fromMs) { start = mid; right = mid }
    else left = mid + 1
  }
  if (start === -1) return []
  const out = []
  for (let i = start; i < bars.length; i++) {
    if (bars[i].time > toMs) break
    out.push(bars[i])
  }
  return out
}

function drawProfile(canvas, chart, barsRef, options) {
  if (!canvas || !chart) return
  const parent = canvas.parentElement
  if (!parent) return

  const width = parent.clientWidth
  const height = parent.clientHeight
  const dpr = window.devicePixelRatio || 1

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const priceRange = readPriceRange(chart)
  const timeRange = readTimeRange(chart)
  if (!priceRange || !timeRange) return

  const paneTop = PANE_INSETS.top
  const paneBottom = height - PANE_INSETS.bottom
  const paneLeft = PANE_INSETS.left
  const paneRight = width - PANE_INSETS.right
  const paneHeight = paneBottom - paneTop
  const paneWidth = paneRight - paneLeft
  if (paneHeight <= 10 || paneWidth <= 50) return

  const visibleBars = filterVisibleBars(barsRef.current || [], timeRange.from, timeRange.to)
  if (visibleBars.length < 2) return

  const vp = computeVolumeProfile(visibleBars, {
    num: options.num,
    algorithm: options.algorithm,
  })
  if (!vp.maxVolume || !vp.volumeArray.length) return

  const priceToY = (price) => {
    const ratio = (priceRange.to - price) / (priceRange.to - priceRange.from)
    return paneTop + ratio * paneHeight
  }

  const showWidthPx = paneWidth * (options.width / 100)
  const fromRight = options.position === 'right'

  // Determine per-slot pixel height; if tickSize maps to <1px, merge visually.
  const slotHeightPx = paneHeight / vp.num  // height per level in price space on screen (same direction)

  for (let i = 0; i < vp.num; i++) {
    const vol = vp.volumeArray[i]
    if (vol <= 0) continue
    const price = vp.priceLevels[i]
    const priceEnd = vp.priceLevels[i + 1] ?? (price + vp.tickSize)

    const y1 = priceToY(priceEnd)  // higher price -> smaller y
    const y2 = priceToY(price)     // lower price -> larger y
    const rectH = Math.max(1, y2 - y1)

    // Skip rows entirely outside visible pane
    if (y2 < paneTop || y1 > paneBottom) continue

    const barWidth = (vol / vp.maxVolume) * showWidthPx
    if (barWidth < 0.5) continue

    const ratio = vol / vp.maxVolume
    const color = colorForRatio(ratio, i === vp.pocIndex)

    const x1 = fromRight ? paneRight - barWidth : paneLeft
    const rectTop = Math.max(paneTop, y1)
    const rectBottom = Math.min(paneBottom, y1 + rectH)

    ctx.fillStyle = color
    ctx.fillRect(x1, rectTop, barWidth, rectBottom - rectTop)

    // Thin separator for crisper look when slotHeightPx is small
    if (slotHeightPx >= 2) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
      ctx.fillRect(x1, rectBottom - 1, barWidth, 1)
    }
  }

  // POC horizontal line
  if (vp.pocIndex >= 0) {
    const pocY = priceToY(vp.priceLevels[vp.pocIndex] + vp.tickSize / 2)
    ctx.strokeStyle = 'rgba(195, 0, 255, 0.9)'
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(paneLeft, pocY)
    ctx.lineTo(paneRight, pocY)
    ctx.stroke()
    ctx.setLineDash([])

    // POC price label
    const pocPrice = vp.priceLevels[vp.pocIndex]
    const labelText = `POC ${pocPrice.toFixed(2)}`
    ctx.font = '11px sans-serif'
    ctx.textBaseline = 'middle'
    const textWidth = ctx.measureText(labelText).width + 8
    const labelX = fromRight ? paneLeft : paneRight - textWidth
    ctx.fillStyle = 'rgba(195, 0, 255, 0.85)'
    ctx.fillRect(labelX, pocY - 8, textWidth, 16)
    ctx.fillStyle = '#fff'
    ctx.fillText(labelText, labelX + 4, pocY)
  }
}

function VolumeProfileOverlay({ enabled, chart, widget, barsRef, options }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const dataVersionRef = useRef(0)

  // Increment dataVersion when bars change via a poll.
  useEffect(() => {
    if (!enabled) return undefined
    const id = window.setInterval(() => {
      dataVersionRef.current += 1
      scheduleRedraw()
    }, 5000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const scheduleRedraw = () => {
    if (rafRef.current) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      drawProfile(canvasRef.current, chart, barsRef, options)
    })
  }

  useEffect(() => {
    if (!enabled || !chart || !widget) return undefined

    let unsub1, unsub2, unsub3
    try {
      unsub1 = chart.onVisibleRangeChanged?.().subscribe(null, scheduleRedraw)
    } catch (e) { console.debug('[VP] onVisibleRangeChanged sub failed', e) }
    try {
      unsub2 = chart.onDataLoaded?.().subscribe(null, scheduleRedraw)
    } catch (e) { console.debug('[VP] onDataLoaded sub failed', e) }
    try {
      unsub3 = widget.subscribe?.('onAutoSaveNeeded', scheduleRedraw)
    } catch (e) { console.debug('[VP] widget subscribe failed', e) }

    const onResize = () => scheduleRedraw()
    window.addEventListener('resize', onResize)

    scheduleRedraw()

    return () => {
      window.removeEventListener('resize', onResize)
      try { unsub1?.() } catch { /* noop */ }
      try { unsub2?.() } catch { /* noop */ }
      try { unsub3?.() } catch { /* noop */ }
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const c = canvasRef.current
      if (c) {
        const ctx = c.getContext('2d')
        ctx?.clearRect(0, 0, c.width, c.height)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, chart, widget, options.num, options.algorithm, options.width, options.position])

  if (!enabled) return null
  return (
    <canvas
      ref={canvasRef}
      className="vp-overlay-canvas"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 3,
      }}
    />
  )
}

export default VolumeProfileOverlay
