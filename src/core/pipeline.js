import {
  otsuThreshold,
  percentileStretch,
  clamp,
  resampleClosed,
  orientForValve,
  findExtreme,
} from './math.js'

export const DEFAULT_PARAMS = {
  blur: 3,
  autoContrast: true,
  opening: 5,
  closing: 5,
  thresholdMode: 'otsu',
  adaptiveBlock: 31,
  adaptiveC: 5,
  thresholdOffset: 0,
  polarity: 'auto',
  minObjectArea: 50,
  ignoreBorder: false,
  smoothing: 7,
  simplify: 0.001,
  numPoints: 100,
  valve: 'LV',
  maxDimension: 4096,
  showMask: true,
  showPoints: false,
  showRect: true,
}

class MatPool {
  constructor(cv) {
    this.cv = cv
    this.items = []
  }

  add(mat) {
    this.items.push(mat)
    return mat
  }

  mat(rows, cols, type, scalar) {
    return this.add(new this.cv.Mat(rows, cols, type, scalar))
  }

  zeros(rows, cols, type) {
    return this.add(this.cv.Mat.zeros(rows, cols, type))
  }

  clone(mat) {
    return this.add(mat.clone())
  }

  vector() {
    return this.add(new this.cv.MatVector())
  }

  release() {
    for (const item of this.items) {
      try {
        item.delete()
      } catch {
        // already released
      }
    }
    this.items = []
  }
}

function oddAtLeast3(value) {
  const rounded = Math.round(Number(value) || 0)
  if (rounded < 3) return 3
  return rounded % 2 === 0 ? rounded + 1 : rounded
}

function matToPoints(mat) {
  const data = mat.data32S
  const count = mat.rows
  const points = new Array(count)
  for (let i = 0; i < count; i += 1) {
    points[i] = { x: data[i * 2], y: data[i * 2 + 1] }
  }
  return points
}

function contourTouchesBorder(points, width, height) {
  return points.some((point) => (
    point.x <= 0 || point.y <= 0 || point.x >= width - 1 || point.y >= height - 1
  ))
}

/**
 * Estimate whether the object is brighter or darker than the background.
 * Compares the mean of a border band with the mean of the central region.
 */
function detectPolarity(gray, width, height) {
  const data = gray.data
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.03))

  let borderSum = 0
  let borderCount = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < band || y < band || x >= width - band || y >= height - band) {
        borderSum += data[y * width + x]
        borderCount += 1
      }
    }
  }

  const x0 = Math.floor(width * 0.25)
  const x1 = Math.ceil(width * 0.75)
  const y0 = Math.floor(height * 0.25)
  const y1 = Math.ceil(height * 0.75)

  let centerSum = 0
  let centerCount = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      centerSum += data[y * width + x]
      centerCount += 1
    }
  }

  const borderMean = borderCount ? borderSum / borderCount : 0
  const centerMean = centerCount ? centerSum / centerCount : 0

  return borderMean > centerMean + 8 ? 'dark' : 'light'
}

function applyMorphology(cv, pool, mat, operation, size) {
  const kernelSize = Math.round(Number(size) || 1)
  if (kernelSize < 3) return

  const kernel = pool.add(cv.getStructuringElement(
    cv.MORPH_ELLIPSE,
    new cv.Size(kernelSize, kernelSize),
  ))
  const output = pool.add(new cv.Mat())
  cv.morphologyEx(mat, output, operation, kernel)
  output.copyTo(mat)
}

function selectContour(cv, contours, width, height, ignoreBorder, pool) {
  let best = null

  for (let index = 0; index < contours.size(); index += 1) {
    const view = contours.get(index)
    try {
      const area = cv.contourArea(view)
      if (area < 3) continue

      const points = matToPoints(view)
      const touchesBorder = contourTouchesBorder(points, width, height)
      if (ignoreBorder && touchesBorder) continue

      if (!best || area > best.area) {
        best = {
          index,
          area,
          touchesBorder,
          mat: pool.clone(view),
        }
      }
    } finally {
      view.delete()
    }
  }

  return best
}

function largestContour(cv, mask, pool) {
  const contours = pool.vector()
  const hierarchy = pool.add(new cv.Mat())
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE)

  let best = null
  for (let index = 0; index < contours.size(); index += 1) {
    const view = contours.get(index)
    try {
      const area = cv.contourArea(view)
      if (!best || area > best.area) {
        best = { area, mat: pool.clone(view) }
      }
    } finally {
      view.delete()
    }
  }

  return best?.mat || null
}

function buildTpsPoints(contour, centroid, valve, numPoints, unitsPerPixel) {
  if (!contour.length) return []

  const count = Math.max(3, Math.round(Number(numPoints) || 100))
  const semilandmarks = orientForValve(resampleClosed(contour, count), valve)

  const left = findExtreme(contour, 'left')
  const right = findExtreme(contour, 'right')
  const fixed = valve === 'RV' ? [right, left] : [left, right]

  const factor = unitsPerPixel && unitsPerPixel > 0 ? unitsPerPixel : 1
  const convert = (point) => ({
    x: (point.x - centroid.x) * factor,
    y: -(point.y - centroid.y) * factor,
  })

  return {
    tpsPoints: [...fixed.map(convert), ...semilandmarks.map(convert)],
    semilandmarks,
    fixedLandmarks: fixed,
  }
}

/**
 * Main pipeline: one cropped image with one object → contour + measurements.
 *
 * @param {object} cv OpenCV.js runtime
 * @param {{data: Uint8ClampedArray, width: number, height: number}} imageData RGBA pixels
 * @param {object} params preprocessing / contour parameters
 * @param {{unitsPerPixel?: number|null, unit?: string}} calibration optional scale
 */
export function analyzeImageData(cv, imageData, params = {}, calibration = {}) {
  const p = { ...DEFAULT_PARAMS, ...params }
  const started = performance.now()
  const pool = new MatPool(cv)
  const warnings = []

  try {
    const originalWidth = imageData.width
    const originalHeight = imageData.height

    if (!originalWidth || !originalHeight) {
      throw new Error('Пустое изображение')
    }

    // 1. Load and optionally downscale for very large images.
    let source = pool.add(cv.matFromImageData(imageData))
    let scaleFactor = 1

    const maxDimension = Number(p.maxDimension)
    if (maxDimension > 0 && Math.max(originalWidth, originalHeight) > maxDimension) {
      scaleFactor = maxDimension / Math.max(originalWidth, originalHeight)
      const resizedWidth = Math.max(1, Math.round(originalWidth * scaleFactor))
      const resizedHeight = Math.max(1, Math.round(originalHeight * scaleFactor))
      const resized = pool.add(new cv.Mat())
      cv.resize(source, resized, new cv.Size(resizedWidth, resizedHeight), 0, 0, cv.INTER_AREA)
      source = resized
      warnings.push(`Изображение уменьшено до ${resizedWidth}×${resizedHeight} для обработки.`)
    }

    const width = source.cols
    const height = source.rows

    // 2. Grayscale.
    const gray = pool.add(new cv.Mat())
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)

    // 3. Robust contrast stretch.
    if (p.autoContrast) {
      const { alpha, beta } = percentileStretch(gray.data, 0.5, 99.5)
      if (Math.abs(alpha - 1) > 1e-6 || Math.abs(beta) > 1e-6) {
        const stretched = pool.add(new cv.Mat())
        cv.convertScaleAbs(gray, stretched, alpha, beta)
        stretched.copyTo(gray)
      }
    }

    // 4. Gentle denoising.
    if (p.blur >= 3) {
      const kernel = p.blur % 2 === 0 ? p.blur + 1 : p.blur
      const blurred = pool.add(new cv.Mat())
      cv.GaussianBlur(gray, blurred, new cv.Size(kernel, kernel), 0, 0, cv.BORDER_DEFAULT)
      blurred.copyTo(gray)
    }

    // 5. Decide whether the object is light or dark.
    const polarity = p.polarity === 'auto' ? detectPolarity(gray, width, height) : p.polarity
    const thresholdType = polarity === 'dark' ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY

    // 6. Binarization.
    const binary = pool.add(new cv.Mat())
    let threshold = 0

    if (p.thresholdMode === 'adaptive') {
      const blockSize = oddAtLeast3(p.adaptiveBlock)
      const c = Number(p.adaptiveC) + Number(p.thresholdOffset)
      cv.adaptiveThreshold(
        gray,
        binary,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        thresholdType,
        blockSize,
        c,
      )
      threshold = c
    } else {
      const otsu = otsuThreshold(gray.data)
      threshold = clamp(otsu + Number(p.thresholdOffset), 0, 255)
      cv.threshold(gray, binary, threshold, 255, thresholdType)
    }

    // 7. Morphological cleanup.
    applyMorphology(cv, pool, binary, cv.MORPH_OPEN, p.opening)
    applyMorphology(cv, pool, binary, cv.MORPH_CLOSE, p.closing)

    // 8. Component count (4-connectivity to match the original pipeline).
    const labels = pool.add(new cv.Mat())
    const stats = pool.add(new cv.Mat())
    const centroids = pool.add(new cv.Mat())
    const componentCount = Math.max(
      0,
      cv.connectedComponentsWithStats(binary, labels, stats, centroids, 4, cv.CV_32S) - 1,
    )

    // 9. External contours and object selection.
    const contours = pool.vector()
    const hierarchy = pool.add(new cv.Mat())
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE)

    if (contours.size() === 0) {
      throw new Error('Объект не найден. Измените порог, контраст или морфологию.')
    }

    const selected = selectContour(cv, contours, width, height, p.ignoreBorder, pool)
    if (!selected) {
      throw new Error('Не найден объект, не касающийся края. Отключите «Игнорировать край» или добавьте поля вокруг объекта.')
    }

    if (selected.touchesBorder) {
      warnings.push('Контур касается края изображения — измерения могут быть обрезаны.')
    }

    // 10. Filled object mask.
    const objectMask = pool.zeros(height, width, cv.CV_8UC1)
    cv.drawContours(objectMask, contours, selected.index, new cv.Scalar(255), -1)

    const areaProcessed = cv.countNonZero(objectMask)
    if (areaProcessed < Number(p.minObjectArea)) {
      throw new Error(`Площадь объекта ${areaProcessed} px меньше заданного минимума ${p.minObjectArea} px.`)
    }

    if (componentCount > 1) {
      warnings.push(`Найдено объектов: ${componentCount}. Выбран крупнейший.`)
    }

    // 11. Shape measurements.
    const perimeterProcessed = cv.arcLength(selected.mat, true)
    const moments = cv.moments(objectMask, true)
    if (!moments.m00) {
      throw new Error('Не удалось вычислить моменты объекта.')
    }

    const mu20 = moments.mu20 / moments.m00
    const mu02 = moments.mu02 / moments.m00
    const mu11 = moments.mu11 / moments.m00

    const trace = mu20 + mu02
    const determinant = mu20 * mu02 - mu11 * mu11
    const discriminant = Math.sqrt(Math.max(0, (trace * trace) / 4 - determinant))
    const lambda1 = trace / 2 + discriminant
    const lambda2 = Math.max(0, trace / 2 - discriminant)

    const majorProcessed = 4 * Math.sqrt(Math.max(0, lambda1))
    const minorProcessed = 4 * Math.sqrt(Math.max(0, lambda2))
    const eccentricity = lambda1 > 0
      ? Math.sqrt(Math.max(0, 1 - lambda2 / lambda1))
      : 0
    const orientationDeg = (0.5 * Math.atan2(2 * mu11, mu20 - mu02) * 180) / Math.PI

    const rect = cv.minAreaRect(selected.mat)
    const rectPointsProcessed = cv.RotatedRect.points(rect)
    const rectWidth = rect.size.width
    const rectHeight = rect.size.height
    const heightProcessed = Math.max(rectWidth, rectHeight)
    const widthProcessed = Math.min(rectWidth, rectHeight)
    const aspectRatio = widthProcessed > 0 ? heightProcessed / widthProcessed : 0

    const contourArea = cv.contourArea(selected.mat)
    const hull = pool.add(new cv.Mat())
    cv.convexHull(selected.mat, hull)
    const hullArea = cv.contourArea(hull)
    const solidity = hullArea > 0 ? contourArea / hullArea : 0
    const circularity = perimeterProcessed > 0
      ? (4 * Math.PI * areaProcessed) / (perimeterProcessed * perimeterProcessed)
      : 0
    const equivalentDiameterProcessed = 2 * Math.sqrt(areaProcessed / Math.PI)

    // 12. Smoothed contour for rugosity.
    let smoothedPerimeterProcessed = perimeterProcessed
    let smoothedContourProcessed = []

    if (p.smoothing >= 3) {
      const smoothedMask = pool.clone(objectMask)
      applyMorphology(cv, pool, smoothedMask, cv.MORPH_OPEN, p.smoothing)

      if (cv.countNonZero(smoothedMask) > 0) {
        const smoothed = largestContour(cv, smoothedMask, pool)
        if (smoothed) {
          smoothedPerimeterProcessed = cv.arcLength(smoothed, true)
          smoothedContourProcessed = matToPoints(smoothed)
        }
      } else {
        warnings.push('Сглаживание слишком сильное: объект исчез, Rugosity = 1.')
      }
    }

    const contourPointsProcessed = matToPoints(selected.mat)

    // 13. Simplified contour for display.
    let displayContourProcessed = contourPointsProcessed
    if (p.simplify > 0 && perimeterProcessed > 0) {
      const approximate = pool.add(new cv.Mat())
      cv.approxPolyDP(selected.mat, approximate, p.simplify * perimeterProcessed, true)
      if (approximate.rows >= 3) {
        displayContourProcessed = matToPoints(approximate)
      }
    }

    // 14. Convert everything back to original-image pixels.
    const inverse = 1 / scaleFactor
    const toOriginal = (points) => points.map((point) => ({
      x: point.x * inverse,
      y: point.y * inverse,
    }))

    const contour = toOriginal(contourPointsProcessed)
    const displayContour = toOriginal(displayContourProcessed)
    const smoothedContour = toOriginal(smoothedContourProcessed)
    const rectPoints = rectPointsProcessed.map((point) => ({
      x: point.x * inverse,
      y: point.y * inverse,
    }))
    const centroid = {
      x: (moments.m10 / moments.m00) * inverse,
      y: (moments.m01 / moments.m00) * inverse,
    }

    const areaPx = areaProcessed * inverse * inverse
    const perimeterPx = perimeterProcessed * inverse
    const smoothedPerimeterPx = smoothedPerimeterProcessed * inverse
    const majorPx = majorProcessed * inverse
    const minorPx = minorProcessed * inverse
    const heightPx = heightProcessed * inverse
    const widthPx = widthProcessed * inverse
    const equivalentDiameterPx = equivalentDiameterProcessed * inverse
    const rugosity = smoothedPerimeterPx > 0 ? perimeterPx / smoothedPerimeterPx : 1

    // 15. Optional physical units.
    const requestedScale = Number(calibration?.unitsPerPixel)
    const hasScale = Number.isFinite(requestedScale) && requestedScale > 0
    const unitsPerPixel = hasScale ? requestedScale : null
    const unit = hasScale ? (calibration.unit || 'µm') : 'px'
    const toUnitLength = (value) => (hasScale ? value * unitsPerPixel : value)
    const toUnitArea = (value) => (hasScale ? value * unitsPerPixel * unitsPerPixel : value)

    const measurements = {
      area: { px: areaPx, value: toUnitArea(areaPx) },
      perimeter: { px: perimeterPx, value: toUnitLength(perimeterPx) },
      majorAxis: { px: majorPx, value: toUnitLength(majorPx) },
      minorAxis: { px: minorPx, value: toUnitLength(minorPx) },
      height: { px: heightPx, value: toUnitLength(heightPx) },
      width: { px: widthPx, value: toUnitLength(widthPx) },
      equivalentDiameter: { px: equivalentDiameterPx, value: toUnitLength(equivalentDiameterPx) },
      eccentricity,
      aspectRatio,
      rugosity,
      solidity,
      circularity,
      orientationDeg,
      unit,
      unitsPerPixel,
    }

    // 16. TPS landmarks: 2 fixed + N semilandmarks, centered and y-up.
    const tps = buildTpsPoints(contour, centroid, p.valve, p.numPoints, unitsPerPixel)

    return {
      width: originalWidth,
      height: originalHeight,
      processedWidth: width,
      processedHeight: height,
      scaleFactor,
      threshold,
      thresholdMode: p.thresholdMode,
      polarity,
      componentCount,
      touchesBorder: selected.touchesBorder,
      warnings,
      contour,
      displayContour,
      smoothedContour,
      rectPoints,
      centroid,
      tpsPoints: tps.tpsPoints,
      tpsCount: tps.tpsPoints.length,
      semilandmarks: tps.semilandmarks,
      fixedLandmarks: tps.fixedLandmarks,
      measurements,
      mask: {
        data: new Uint8Array(objectMask.data),
        width,
        height,
      },
      params: { ...p },
      elapsedMs: performance.now() - started,
    }
  } finally {
    pool.release()
  }
}
