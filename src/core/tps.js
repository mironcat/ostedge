import { baseName } from './image.js'

function format(value) {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(5)).toString()
}

/**
 * Build a TPS landmark file from processed records.
 * Each specimen gets 2 fixed landmarks + N semilandmarks (default 102 points).
 */
export function buildTps(records, options = {}) {
  const prefix = String(options.sampleId || '').trim()
  const blocks = []

  for (const record of records) {
    const result = record.result
    if (!result || !result.tpsPoints?.length) continue

    const id = prefix ? `${prefix}_${baseName(record.name)}` : baseName(record.name)
    const lines = [`LM=${result.tpsPoints.length}`]

    for (const point of result.tpsPoints) {
      lines.push(`${format(point.x)} ${format(point.y)}`)
    }

    lines.push(`ID=${id}`)
    lines.push('SCALE=1')
    blocks.push(lines.join('\n'))
  }

  return blocks.length ? `${blocks.join('\n\n')}\n` : ''
}
