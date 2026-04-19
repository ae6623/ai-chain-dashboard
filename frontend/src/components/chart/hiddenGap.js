// Hidden Gap (HG) 指标算法 —— 移植自 monitor/hg.js
// 返回 { gaps, wrbs }，可直接交给 TradingView Shape API 绘制。

export const DEFAULT_HG_OPTIONS = {
  lookbackPeriod: 5,         // 判定 WRB 时回看的 bar 数
  wrbSensitivity: 1.5,       // WRB 灵敏度：currentRange 必须 > 过去每一根 * sensitivity
  useBodyRange: true,        // true=用实体长度，false=用 high-low
  gapExtension: 'stopLoss',  // 'none' | 'stopLoss' | 'both'
  maxFvgScope: 999,          // 单个 gap 最长存活多少根 bar
  widthFilter: 0,            // 宽度过滤（价格单位，0 表示关闭）
  maxGapBoxes: 100,          // 最多保留多少个 gap（保留最近的）
}

function rangeOf(bar, useBodyRange) {
  return useBodyRange
    ? Math.abs(bar.close - bar.open)
    : bar.high - bar.low
}

function isWideRangeBar(bars, index, { lookbackPeriod, wrbSensitivity, useBodyRange }) {
  if (index < lookbackPeriod) return false
  const currentRange = rangeOf(bars[index], useBodyRange)
  if (currentRange === 0) return false
  for (let j = 1; j <= lookbackPeriod; j++) {
    const prev = bars[index - j]
    if (!prev) return false
    const prevRange = rangeOf(prev, useBodyRange)
    if (currentRange <= prevRange * wrbSensitivity) return false
  }
  return true
}

function checkProQuality(bars, index, gapType) {
  if (index < 1) return false
  const oldBar = bars[index - 1]
  const wrbBar = bars[index]

  const wrbBull = wrbBar.close > wrbBar.open
  const oldBull = oldBar.close > oldBar.open
  const oldBody = Math.abs(oldBar.open - oldBar.close)

  // (a) wrbBar 与 oldBar 颜色相反，且 wrb 实体 > oldBody * 0.9
  if (wrbBull !== oldBull
      && Math.abs(wrbBar.open - wrbBar.close) > oldBody * 0.9) {
    return true
  }

  // (b) oldBar 长下/上影线（>= 实体 * 2）
  if (gapType === 'buy') {
    const lowerWick = Math.min(oldBar.open, oldBar.close) - oldBar.low
    if (lowerWick >= oldBody * 2) return true
  } else {
    const upperWick = oldBar.high - Math.max(oldBar.open, oldBar.close)
    if (upperWick >= oldBody * 2) return true
  }

  // (c) oldBar 与 prev2 颜色相反，且 oldBody > prev2Body * 0.9
  if (index > 1) {
    const prev2 = bars[index - 2]
    const prev2Bull = prev2.close > prev2.open
    if (oldBull !== prev2Bull
        && oldBody > Math.abs(prev2.open - prev2.close) * 0.9) {
      return true
    }
  }
  return false
}

function checkHiddenGap(bars, index, options) {
  if (index < 1 || index >= bars.length - 1) return null
  if (!isWideRangeBar(bars, index, options)) return null

  const oldBar = bars[index - 1]
  const wrbBar = bars[index]
  const newBar = bars[index + 1]

  const isBuyGap = newBar.low > oldBar.high
  const isSellGap = newBar.high < oldBar.low
  if (!isBuyGap && !isSellGap) return null

  const gapType = isBuyGap ? 'buy' : 'sell'
  let gapTop = 0
  let gapBottom = 0

  if (isBuyGap) {
    switch (options.gapExtension) {
      case 'none':
        gapTop = newBar.low
        gapBottom = oldBar.high
        break
      case 'stopLoss':
        gapTop = Math.min(wrbBar.high, newBar.low)
        gapBottom = wrbBar.low
        break
      case 'both':
        gapTop = wrbBar.high
        gapBottom = wrbBar.low
        break
      default:
        return null
    }
  } else {
    switch (options.gapExtension) {
      case 'none':
        gapTop = oldBar.low
        gapBottom = newBar.high
        break
      case 'stopLoss':
        gapTop = wrbBar.high
        gapBottom = Math.max(wrbBar.low, newBar.high)
        break
      case 'both':
        gapTop = wrbBar.high
        gapBottom = wrbBar.low
        break
      default:
        return null
    }
  }

  if (gapTop <= gapBottom) return null

  const diff = Math.abs(gapTop - gapBottom)
  if (options.widthFilter > 0 && diff < options.widthFilter) return null

  return {
    type: gapType,
    top: gapTop,
    bottom: gapBottom,
    diff,
    startIndex: index,
    endIndex: Math.min(index + options.maxFvgScope, bars.length - 1),
    filled: false,
    pro: checkProQuality(bars, index, gapType),
  }
}

export function detectHiddenGaps(bars, userOptions = {}) {
  const options = { ...DEFAULT_HG_OPTIONS, ...userOptions }
  if (!Array.isArray(bars) || bars.length < options.lookbackPeriod + 2) {
    return { gaps: [], wrbs: [] }
  }

  const gaps = []
  const wrbs = []
  const activeGapIdx = []

  bars.forEach((bar, i) => {
    if (isWideRangeBar(bars, i, options)) {
      const midPrice = options.useBodyRange
        ? (bar.open + bar.close) / 2
        : (bar.high + bar.low) / 2
      wrbs.push({ index: i, time: bar.time, price: midPrice })

      const gap = checkHiddenGap(bars, i, options)
      if (gap) {
        gaps.push(gap)
        activeGapIdx.push(gaps.length - 1)
      }
    }

    // 检测被当前 bar 填补的 active gap
    for (let j = activeGapIdx.length - 1; j >= 0; j--) {
      const gap = gaps[activeGapIdx[j]]
      if (i > gap.startIndex && i < gap.endIndex) {
        const isFilled = gap.type === 'buy'
          ? bar.low <= gap.bottom
          : bar.high >= gap.top
        if (isFilled) {
          gap.endIndex = i
          gap.filled = true
          activeGapIdx.splice(j, 1)
        }
      }
    }
  })

  const cropped = gaps.slice(-options.maxGapBoxes)
  return { gaps: cropped, wrbs }
}

// 格式化价格差，保留合理精度
export function formatGapDiff(diff) {
  if (!Number.isFinite(diff)) return ''
  if (diff >= 100) return diff.toFixed(2)
  if (diff >= 1) return diff.toFixed(3)
  return diff.toFixed(4)
}
