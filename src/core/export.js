import { baseName } from './image.js'

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function num(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return ''
  return Number(Number(value).toFixed(digits))
}

export function buildCsv(records) {
  const header = [
    'file',
    'unit',
    'units_per_pixel',
    'area_px',
    'area_unit',
    'perimeter_px',
    'perimeter_unit',
    'major_axis_px',
    'major_axis_unit',
    'minor_axis_px',
    'minor_axis_unit',
    'eccentricity',
    'height_px',
    'height_unit',
    'width_px',
    'width_unit',
    'aspect_ratio',
    'rugosity',
    'solidity',
    'circularity',
    'equivalent_diameter_px',
    'equivalent_diameter_unit',
    'orientation_deg',
    'threshold',
    'components',
    'touches_border',
  ]

  const rows = []

  for (const record of records) {
    const result = record.result
    if (!result) continue
    const m = result.measurements

    rows.push([
      record.name,
      m.unit,
      m.unitsPerPixel ?? '',
      num(m.area.px),
      num(m.area.value),
      num(m.perimeter.px),
      num(m.perimeter.value),
      num(m.majorAxis.px),
      num(m.majorAxis.value),
      num(m.minorAxis.px),
      num(m.minorAxis.value),
      num(m.eccentricity, 6),
      num(m.height.px),
      num(m.height.value),
      num(m.width.px),
      num(m.width.value),
      num(m.aspectRatio, 6),
      num(m.rugosity, 6),
      num(m.solidity, 6),
      num(m.circularity, 6),
      num(m.equivalentDiameter.px),
      num(m.equivalentDiameter.value),
      num(m.orientationDeg, 4),
      num(result.threshold, 2),
      result.componentCount,
      result.touchesBorder ? 'true' : 'false',
    ])
  }

  return [header, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\r\n') + '\r\n'
}

export function buildJson(records, params, calibration) {
  return JSON.stringify({
    app: 'ostedge',
    generatedAt: new Date().toISOString(),
    params,
    calibration,
    results: records
      .filter((record) => record.result)
      .map((record) => ({
        file: record.name,
        width: record.result.width,
        height: record.result.height,
        processedWidth: record.result.processedWidth,
        processedHeight: record.result.processedHeight,
        calibration: record.calibration,
        measurements: record.result.measurements,
        threshold: record.result.threshold,
        thresholdMode: record.result.thresholdMode,
        polarity: record.result.polarity,
        componentCount: record.result.componentCount,
        touchesBorder: record.result.touchesBorder,
        warnings: record.result.warnings,
        tpsPoints: record.result.tpsPoints,
      })),
  }, null, 2)
}

export function suggestedFileName(records, extension) {
  if (records.length === 1) {
    return `${baseName(records[0].name)}.${extension}`
  }
  return `ostedge-measurements.${extension}`
}

export async function saveTextFile({ defaultPath, content, filters, title }) {
  if (window.ostedge?.saveFile) {
    return window.ostedge.saveFile({ defaultPath, content, filters, title })
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = defaultPath
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return { canceled: false, filePath: defaultPath }
}
