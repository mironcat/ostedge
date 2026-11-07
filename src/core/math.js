export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Otsu threshold for an 8-bit grayscale array (Uint8Array / Uint8ClampedArray). */
export function otsuThreshold(data) {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 1) {
    histogram[data[i]] += 1
  }

  const total = data.length
  let sum = 0
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]

  let sumBackground = 0
  let weightBackground = 0
  let maxVariance = -1
  let threshold = 0

  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t]
    if (weightBackground === 0) continue

    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += t * histogram[t]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const between = weightBackground * weightForeground
      * (meanBackground - meanForeground) * (meanBackground - meanForeground)

    if (between > maxVariance) {
      maxVariance = between
      threshold = t
    }
  }

  return threshold
}

/**
 * Percentile-based linear stretch.
 * Returns { alpha, beta, low, high } for cv.convertScaleAbs.
 */
export function percentileStretch(data, lowPercentile = 0.5, highPercentile = 99.5) {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 1) histogram[data[i]] += 1

  const total = data.length
  const lowTarget = (total * lowPercentile) / 100
  const highTarget = (total * highPercentile) / 100

  let accumulated = 0
  let low = 0
  for (let i = 0; i < 256; i += 1) {
    accumulated += histogram[i]
    if (accumulated >= lowTarget) {
      low = i
      break
    }
  }

  accumulated = 0
  let high = 255
  for (let i = 0; i < 256; i += 1) {
    accumulated += histogram[i]
    if (accumulated >= highTarget) {
      high = i
      break
    }
  }

  if (high <= low + 2) {
    return { alpha: 1, beta: 0, low, high }
  }

  const alpha = 255 / (high - low)
  const beta = -low * alpha
  return { alpha, beta, low, high }
}

/** Signed area of a polygon. Positive means clockwise in screen coordinates (y down). */
export function signedArea(points) {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

export function findExtreme(points, side) {
  if (!points.length) return null
  let index = 0
  for (let i = 1; i < points.length; i += 1) {
    if (side === 'left' ? points[i].x < points[index].x : points[i].x > points[index].x) {
      index = i
    }
  }
  return points[index]
}

/** Rotate a closed polygon so that it starts at its leftmost or rightmost point. */
export function rotateToExtreme(points, side) {
  if (!points.length) return points
  let index = 0
  for (let i = 1; i < points.length; i += 1) {
    if (side === 'left' ? points[i].x < points[index].x : points[i].x > points[index].x) {
      index = i
    }
  }
  return points.slice(index).concat(points.slice(0, index))
}

/**
 * Consistent TPS orientation.
 * LV: clockwise (screen coordinates) starting at the leftmost point.
 * RV: counter-clockwise starting at the rightmost point.
 * none: keep direction, start at the leftmost point.
 */
export function orientForValve(points, valve) {
  if (!points.length || valve === 'none') {
    return rotateToExtreme(points.slice(), 'left')
  }

  const clockwise = valve === 'LV'
  const oriented = points.slice()
  const area = signedArea(oriented)
  const isClockwise = area > 0

  if (clockwise !== isClockwise) oriented.reverse()

  return rotateToExtreme(oriented, valve === 'LV' ? 'left' : 'right')
}

/**
 * Resample a closed polygon to exactly `count` points, equally spaced by arc length.
 * The first point is not duplicated at the end.
 */
export function resampleClosed(points, count) {
  const n = Math.max(1, Math.round(count))
  const m = points.length
  if (m === 0) return []
  if (m === 1) return Array.from({ length: n }, () => ({ ...points[0] }))

  const cumulative = new Float64Array(m + 1)
  for (let i = 0; i < m; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % m]
    cumulative[i + 1] = cumulative[i] + Math.hypot(b.x - a.x, b.y - a.y)
  }

  const total = cumulative[m]
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0] }))

  const result = []
  let segment = 0

  for (let k = 0; k < n; k += 1) {
    const target = (total * k) / n
    while (segment < m - 1 && cumulative[segment + 1] < target) segment += 1

    const segmentLength = cumulative[segment + 1] - cumulative[segment]
    const t = segmentLength > 0 ? (target - cumulative[segment]) / segmentLength : 0
    const a = points[segment]
    const b = points[(segment + 1) % m]

    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    })
  }

  return result
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function polygonPath(points, close = true) {
  if (!points.length) return ''
  const parts = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${trim(point.x)} ${trim(point.y)}`)
  return `${parts.join(' ')}${close ? ' Z' : ''}`
}

export function trim(value, digits = 3) {
  return Number(value.toFixed(digits))
}

export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return '—'
  return Number(value.toFixed(digits)).toLocaleString('ru-RU', {
    maximumFractionDigits: digits,
  })
}

export function mean(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.floor((p / 100) * (sorted.length - 1)), 0, sorted.length - 1)
  return sorted[index]
}

export function robustRange(values, low = 1, high = 99) {
  return { low: percentile(values, low), high: percentile(values, high) }
}
