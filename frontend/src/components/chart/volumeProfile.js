// Volume Profile (成交量分布) algorithms, ported from /home/deploy/monitor/vp.js.
// Pure functions, no DOM. Given a list of OHLCV bars and options, compute the
// per-price-level volume array and the POC index.

export const DEFAULT_VP_OPTIONS = {
  num: 200,              // resolution (number of price slots between low and high)
  algorithm: 'default',  // 'default' | 'classic' | 'delta'
}

export const VP_ALGORITHMS = ['default', 'classic', 'delta']

function findNearestLevelIndex(price, minPrice, tickSize, num) {
  const idx = Math.round((price - minPrice) / tickSize)
  if (idx < 0) return 0
  if (idx >= num) return num - 1
  return idx
}

function simplifiedAlgorithm(bar, ctx) {
  const { num, minPrice, tickSize } = ctx
  const temp = new Array(num).fill(0)
  const range = bar.high - bar.low
  if (range === 0 || !Number.isFinite(range)) {
    temp[findNearestLevelIndex(bar.close, minPrice, tickSize, num)] = bar.volume
    return temp
  }
  const s = findNearestLevelIndex(bar.low, minPrice, tickSize, num)
  const e = findNearestLevelIndex(bar.high, minPrice, tickSize, num)
  if (s === e) {
    temp[s] = bar.volume
  } else {
    const per = bar.volume / (e - s + 1)
    for (let i = s; i <= e; i++) temp[i] = per
  }
  return temp
}

function weightedAlgorithm(bar, ctx) {
  const { num, minPrice, tickSize, priceLevels } = ctx
  const temp = new Array(num).fill(0)
  const range = bar.high - bar.low
  if (range === 0 || !Number.isFinite(range)) {
    temp[findNearestLevelIndex(bar.close, minPrice, tickSize, num)] = bar.volume
    return temp
  }
  const s = findNearestLevelIndex(bar.low, minPrice, tickSize, num)
  const e = findNearestLevelIndex(bar.high, minPrice, tickSize, num)
  if (s === e) {
    temp[s] = bar.volume
    return temp
  }
  const weights = new Array(num).fill(0)
  let totalWeight = 0
  for (let i = s; i <= e; i++) {
    const pStart = priceLevels[i]
    const pEnd = priceLevels[i + 1] ?? (pStart + tickSize)
    const overlapStart = Math.max(pStart, bar.low)
    const overlapEnd = Math.min(pEnd, bar.high)
    const overlap = Math.max(0, overlapEnd - overlapStart)
    if (overlap > 0) {
      const center = (pStart + pEnd) / 2
      const distanceFromClose = Math.abs(center - bar.close)
      const maxDistance = range / 2
      const distanceWeight = Math.max(0.1, 1 - (distanceFromClose / maxDistance))
      const overlapWeight = overlap / tickSize
      const w = distanceWeight * overlapWeight
      weights[i] = w
      totalWeight += w
    }
  }
  if (totalWeight > 0) {
    for (let i = s; i <= e; i++) {
      if (weights[i] > 0) temp[i] = (weights[i] / totalWeight) * bar.volume
    }
  }
  return temp
}

function distributeAlgorithm(bar, ctx, segments = 10) {
  const { num, minPrice, tickSize } = ctx
  const temp = new Array(num).fill(0)
  const range = bar.high - bar.low
  if (range === 0 || !Number.isFinite(range)) {
    temp[findNearestLevelIndex(bar.close, minPrice, tickSize, num)] = bar.volume
    return temp
  }
  const step = range / segments
  const typical = (bar.open + bar.high + bar.low + bar.close) / 4
  for (let i = 0; i <= segments; i++) {
    const price = bar.low + i * step
    const idx = findNearestLevelIndex(price, minPrice, tickSize, num)
    const distFromTypical = Math.abs(price - typical)
    const w = Math.max(0.1, 1 - (distFromTypical / (range / 2)))
    temp[idx] += w
  }
  let totalWeight = 0
  for (let i = 0; i < num; i++) totalWeight += temp[i]
  if (totalWeight > 0) {
    for (let i = 0; i < num; i++) temp[i] = (temp[i] / totalWeight) * bar.volume
  }
  return temp
}

function executeAlgorithm(bar, algorithm, ctx) {
  switch (algorithm) {
    case 'classic':
      return distributeAlgorithm(bar, ctx)
    case 'delta':
      return weightedAlgorithm(bar, ctx)
    case 'default':
    default:
      return simplifiedAlgorithm(bar, ctx)
  }
}

// bars: [{time, open, high, low, close, volume}], time in ms epoch
export function computeVolumeProfile(bars, userOptions = {}) {
  const options = { ...DEFAULT_VP_OPTIONS, ...userOptions }
  const num = Math.max(10, Math.min(999, Math.floor(options.num)))

  if (!bars || bars.length === 0) {
    return { num, volumeArray: [], priceLevels: [], pocIndex: -1, maxVolume: 0, minPrice: 0, maxPrice: 0, tickSize: 0, totalVolume: 0, barCount: 0 }
  }

  let minPrice = Infinity
  let maxPrice = -Infinity
  let totalVolume = 0
  for (const b of bars) {
    if (!Number.isFinite(b.low) || !Number.isFinite(b.high)) continue
    if (b.low < minPrice) minPrice = b.low
    if (b.high > maxPrice) maxPrice = b.high
    totalVolume += b.volume || 0
  }

  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || maxPrice <= minPrice) {
    return { num, volumeArray: [], priceLevels: [], pocIndex: -1, maxVolume: 0, minPrice: 0, maxPrice: 0, tickSize: 0, totalVolume: 0, barCount: 0 }
  }

  const priceRange = maxPrice - minPrice
  const tickSize = priceRange / num
  const priceLevels = new Array(num)
  for (let i = 0; i < num; i++) priceLevels[i] = minPrice + i * tickSize

  const ctx = { num, minPrice, maxPrice, tickSize, priceLevels }
  const volumeArray = new Array(num).fill(0)

  for (const bar of bars) {
    if (!bar || !(bar.volume > 0)) continue
    const contribution = executeAlgorithm(bar, options.algorithm, ctx)
    for (let i = 0; i < num; i++) {
      if (contribution[i] > 0) volumeArray[i] += contribution[i]
    }
  }

  let maxVolume = 0
  let pocIndex = 0
  for (let i = 0; i < num; i++) {
    if (volumeArray[i] > maxVolume) {
      maxVolume = volumeArray[i]
      pocIndex = i
    }
  }

  return {
    num,
    volumeArray,
    priceLevels,
    pocIndex,
    maxVolume,
    minPrice,
    maxPrice,
    tickSize,
    totalVolume,
    barCount: bars.length,
  }
}

// Gradient color palette matching vp.js (10 levels by volume ratio)
export const VP_COLORS = [
  'rgba(192,   0,   0, 0.80)', // 0 (<=0.2, base red)
  'rgba(255,   0,   0, 0.80)', // 1 (>0.2)
  'rgba(192, 128,   0, 0.80)', // 2 (>0.3)
  'rgba(255, 128,   0, 0.80)', // 3 (>0.4)
  'rgba(255, 192,   0, 0.80)', // 4 (>0.5)
  'rgba(255, 255,   0, 0.80)', // 5 (>0.6)
  'rgba(  0, 192,   0, 0.80)', // 6 (>0.7)
  'rgba(  0, 255,   0, 0.80)', // 7 (>0.8)
  'rgba(  0, 128, 128, 0.80)', // 8 (>0.9)
  'rgba(  0, 128, 255, 0.80)', // 9 (POC)
]

export function colorForRatio(ratio, isPoc) {
  if (isPoc) return VP_COLORS[9]
  if (ratio > 0.9) return VP_COLORS[8]
  if (ratio > 0.8) return VP_COLORS[7]
  if (ratio > 0.7) return VP_COLORS[6]
  if (ratio > 0.6) return VP_COLORS[5]
  if (ratio > 0.5) return VP_COLORS[4]
  if (ratio > 0.4) return VP_COLORS[3]
  if (ratio > 0.3) return VP_COLORS[2]
  if (ratio > 0.2) return VP_COLORS[1]
  return VP_COLORS[0]
}
