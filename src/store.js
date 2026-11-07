import { computed, markRaw, reactive } from 'vue'
import { analyzeImageData, DEFAULT_PARAMS } from './core/pipeline.js'
import { loadOpenCV } from './core/opencv.js'
import {
  baseName,
  dataUrlToImageData,
  fileToDataUrl,
  isSupportedImageFile,
  makeThumbnail,
} from './core/image.js'

const PROCESSING_KEYS = [
  'blur',
  'autoContrast',
  'opening',
  'closing',
  'thresholdMode',
  'adaptiveBlock',
  'adaptiveC',
  'thresholdOffset',
  'polarity',
  'minObjectArea',
  'ignoreBorder',
  'smoothing',
  'simplify',
  'numPoints',
  'valve',
  'maxDimension',
]

export const state = reactive({
  files: [],
  activeId: null,
  params: { ...DEFAULT_PARAMS },
  // Used for new files; each file then owns its own calibration.
  defaultCalibration: { unitsPerPixel: null, unit: 'µm' },
  cvStatus: 'loading',
  cvError: '',
  processing: false,
  progress: { done: 0, total: 0 },
  dragging: false,
})

let nextId = 1

// OpenCV is a huge Emscripten module. Keep it outside Vue reactivity:
// proxying it (or its methods) makes the renderer unresponsive.
let cvRuntime = null

export const activeFile = computed(
  () => state.files.find((file) => file.id === state.activeId) || null,
)

export const doneFiles = computed(
  () => state.files.filter((file) => file.result && file.status === 'done'),
)

export const errorFiles = computed(
  () => state.files.filter((file) => file.status === 'error'),
)

export function processingKey(params = state.params, calibration = state.defaultCalibration) {
  const payload = {}
  for (const key of PROCESSING_KEYS) payload[key] = params[key]

  const scale = Number(calibration.unitsPerPixel)
  payload.unitsPerPixel = Number.isFinite(scale) && scale > 0 ? scale : null
  payload.unit = calibration.unit || 'µm'

  return JSON.stringify(payload)
}

export function isStale(record) {
  return record.status === 'done'
    && record.signature !== processingKey(state.params, record.calibration)
}

export async function initOpenCV() {
  try {
    state.cvStatus = 'loading'
    const loaded = await loadOpenCV()
    cvRuntime = loaded.cv
    state.cvStatus = 'ready'
    if (state.files.some((file) => file.imageData)) {
      await processAll()
    }
  } catch (error) {
    state.cvStatus = 'error'
    state.cvError = error?.message || String(error)
  }
}

function createRecord(source = {}) {
  return reactive({
    id: nextId++,
    name: source.name || 'image',
    baseName: baseName(source.name || 'image'),
    size: Number(source.size) || 0,
    status: 'loading',
    dataUrl: source.dataUrl || '',
    width: 0,
    height: 0,
    imageData: null,
    thumbnail: '',
    result: null,
    error: '',
    signature: '',
    calibration: { ...state.defaultCalibration },
    calibrationLine: null,
  })
}

async function fillRecordFromDataUrl(record, dataUrl) {
  const { imageData, width, height } = await dataUrlToImageData(dataUrl)
  record.dataUrl = dataUrl
  record.imageData = markRaw(imageData)
  record.width = width
  record.height = height
  record.thumbnail = await makeThumbnail(dataUrl, 160)
  record.status = 'ready'
  record.error = ''
  if (!state.activeId) state.activeId = record.id
}

export async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter(isSupportedImageFile)
  if (!files.length) return

  for (const file of files) {
    const record = createRecord({ name: file.name, size: file.size })
    state.files.push(record)

    try {
      const dataUrl = await fileToDataUrl(file)
      await fillRecordFromDataUrl(record, dataUrl)
    } catch (error) {
      record.status = 'error'
      record.error = error?.message || String(error)
    }
  }

  await processAll()
}

export async function addRecords(records) {
  const list = Array.isArray(records) ? records : []
  if (!list.length) return

  for (const source of list) {
    const record = createRecord(source)
    state.files.push(record)

    if (source.error) {
      record.status = 'error'
      record.error = source.error
      continue
    }

    try {
      await fillRecordFromDataUrl(record, source.dataUrl)
    } catch (error) {
      record.status = 'error'
      record.error = error?.message || String(error)
    }
  }

  await processAll()
}

export async function processRecord(record) {
  if (!cvRuntime || !record?.imageData) return

  record.status = 'processing'
  record.error = ''

  // Let Vue paint the "processing" state before the synchronous OpenCV work.
  await new Promise((resolve) => setTimeout(resolve, 0))

  try {
    const calibration = record.calibration || state.defaultCalibration
    record.result = markRaw(analyzeImageData(
      cvRuntime,
      record.imageData,
      { ...state.params },
      { ...calibration },
    ))
    record.signature = processingKey(state.params, calibration)
    record.status = 'done'
  } catch (error) {
    record.result = null
    record.status = 'error'
    record.error = error?.message || String(error)
  }
}

export async function processAll() {
  if (state.processing || !cvRuntime) return

  const targets = state.files.filter((file) => file.imageData)
  if (!targets.length) return

  state.processing = true
  state.progress = { done: 0, total: targets.length }

  try {
    for (const record of targets) {
      await processRecord(record)
      state.progress.done += 1
    }
  } finally {
    state.processing = false
  }
}

export async function reprocessActive() {
  const record = activeFile.value
  if (!record?.imageData || !cvRuntime || state.processing) return

  state.processing = true
  state.progress = { done: 0, total: 1 }

  try {
    await processRecord(record)
    state.progress.done = 1
  } finally {
    state.processing = false
  }
}

export function setActive(id) {
  state.activeId = id
}

export function removeFile(id) {
  const index = state.files.findIndex((file) => file.id === id)
  if (index < 0) return

  state.files.splice(index, 1)

  if (state.activeId === id) {
    state.activeId = state.files[Math.min(index, state.files.length - 1)]?.id ?? null
  }
}

export function clearAll() {
  state.files = []
  state.activeId = null
  state.progress = { done: 0, total: 0 }
}

export function resetParams() {
  Object.assign(state.params, DEFAULT_PARAMS)
}

export async function setRecordCalibration(record, calibration, line = null) {
  if (!record) return
  record.calibration = { ...calibration }
  record.calibrationLine = line
  record.signature = ''
  await processRecord(record)
}

export async function applyCalibrationToAll(calibration, activeLine = null) {
  for (const file of state.files) {
    if (!file.imageData) continue
    file.calibration = { ...calibration }
    file.calibrationLine = file.id === state.activeId ? activeLine : null
    file.signature = ''
  }
  await processAll()
}

export async function clearActiveCalibration() {
  const record = activeFile.value

  if (!record) {
    state.defaultCalibration.unitsPerPixel = null
    return
  }

  record.calibration = { unitsPerPixel: null, unit: 'µm' }
  record.calibrationLine = null
  record.signature = ''
  await processRecord(record)
}
