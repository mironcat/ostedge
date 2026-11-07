import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

import { analyzeImageData, DEFAULT_PARAMS } from '../src/core/pipeline.js'
import { buildCsv, buildJson } from '../src/core/export.js'
import { buildTps } from '../src/core/tps.js'

const require = createRequire(import.meta.url)
const cv = require('@techstark/opencv-js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const projectRoot = path.resolve(root, '..')

const PARAMS = {
  ...DEFAULT_PARAMS,
  blur: 0,
  autoContrast: true,
  opening: 7,
  closing: 5,
  thresholdOffset: 0,
  smoothing: 1,
  valve: 'LV',
}

function waitForOpenCV() {
  return new Promise((resolve) => {
    if (cv.Mat) {
      resolve()
      return
    }
    cv.onRuntimeInitialized = () => resolve()
  })
}

function readPng(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath))
  return {
    data: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height,
  }
}

function readPythonCsv(filePath) {
  if (!fs.existsSync(filePath)) return new Map()

  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/)
  if (lines.length < 2) return new Map()

  const header = lines[0].split(',')
  const rows = new Map()

  for (const line of lines.slice(1)) {
    const values = line.split(',')
    const row = {}
    header.forEach((key, index) => { row[key] = values[index] })
    rows.set(row.ObjectID, row)
  }

  return rows
}

function percentDifference(jsValue, pyValue) {
  const js = Number(jsValue)
  const py = Number(pyValue)
  if (!Number.isFinite(js) || !Number.isFinite(py) || py === 0) return null
  return ((js - py) / py) * 100
}

function formatDiff(value) {
  if (value === null) return '  n/a '
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

async function main() {
  await waitForOpenCV()

  const cases = [
    {
      file: path.join(projectRoot, 'demo', 'input', 'ostracod_01.png'),
      pythonCsv: path.join(projectRoot, 'demo', 'output', 'demo_morph2d_properties.csv'),
      pythonId: 'ostracod_01',
    },
    ...['001', '002', '003', '004', '005', '006'].map((number) => ({
      file: path.join(projectRoot, 'demo', 'input_montage', `ostracods_edges_${number}.png`),
      pythonCsv: path.join(projectRoot, 'demo', 'output_montage', 'montage_morph2d_properties.csv'),
      pythonId: `ostracods_edges_${number}`,
    })),
  ]

  const pythonCache = new Map()
  const records = []

  console.log('\nfile                         area JS      area PY     Δarea   Δmajor  Δminor  Δaspect  JS aspect  JS rugosity')
  console.log('-'.repeat(120))

  for (const testCase of cases) {
    if (!fs.existsSync(testCase.file)) {
      console.log(`SKIP ${testCase.file} (not found)`)
      continue
    }

    const imageData = readPng(testCase.file)
    const result = analyzeImageData(cv, imageData, PARAMS, { unitsPerPixel: null, unit: 'px' })
    const m = result.measurements

    if (!pythonCache.has(testCase.pythonCsv)) {
      pythonCache.set(testCase.pythonCsv, readPythonCsv(testCase.pythonCsv))
    }
    const pythonRows = pythonCache.get(testCase.pythonCsv)
    const python = pythonRows.get(testCase.pythonId)

    const name = path.basename(testCase.file)
    records.push({ name, result, calibration: { unitsPerPixel: null, unit: 'px' } })
    const areaJs = m.area.px
    const areaPy = python?.Area
    const dArea = percentDifference(areaJs, areaPy)
    const dMajor = percentDifference(m.majorAxis.px, python?.MajorAxisLength)
    const dMinor = percentDifference(m.minorAxis.px, python?.MinorAxisLength)
    const dAspect = percentDifference(m.aspectRatio, python?.AspectRatio)

    console.log(
      `${name.padEnd(28)} ${String(Math.round(areaJs)).padStart(8)} ${String(areaPy ? Math.round(areaPy) : '—').padStart(11)}`
      + ` ${formatDiff(dArea).padStart(8)} ${formatDiff(dMajor).padStart(8)} ${formatDiff(dMinor).padStart(8)}`
      + ` ${formatDiff(dAspect).padStart(8)} ${m.aspectRatio.toFixed(3).padStart(9)} ${m.rugosity.toFixed(3).padStart(12)}`,
    )

    if (result.warnings.length) {
      console.log(`   warnings: ${result.warnings.join(' | ')}`)
    }
  }

  // Export round-trip checks.
  const csv = buildCsv(records)
  const tps = buildTps(records)
  const json = buildJson(records, PARAMS, { unitsPerPixel: null, unit: 'px' })

  const csvRows = csv.trim().split(/\r?\n/).length
  assert.equal(csvRows, records.length + 1, 'CSV must contain a header and one row per record')

  const tpsBlocks = tps.trim().split(/\n\n+/)
  assert.equal(tpsBlocks.length, records.length, 'TPS must contain one block per record')

  for (const block of tpsBlocks) {
    const lines = block.trim().split('\n')
    assert.equal(lines[0], 'LM=102', 'TPS block must start with LM=102')
    assert.equal(lines.length, 1 + 102 + 2, 'TPS block must have LM + 102 points + ID + SCALE')
    assert.ok(lines.at(-2).startsWith('ID='), 'TPS block must contain ID')
    assert.equal(lines.at(-1), 'SCALE=1', 'TPS block must contain SCALE=1')
  }

  const parsedJson = JSON.parse(json)
  assert.equal(parsedJson.results.length, records.length, 'JSON must contain all records')

  console.log('\nEXPORT_RESULT', JSON.stringify({
    csvRows,
    tpsSpecimens: tpsBlocks.length,
    tpsPointsPerSpecimen: 102,
    jsonResults: parsedJson.results.length,
  }, null, 2))

  console.log('\nTPS preview:')
  console.log(tpsBlocks[0].split('\n').slice(0, 4).join('\n'))
  console.log('...')
  console.log(tpsBlocks[0].split('\n').slice(-2).join('\n'))

  console.log('\nDone. Differences are expected: the JavaScript pipeline is more robust and not bit-compatible with Python.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
