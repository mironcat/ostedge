<template>
  <div v-if="!record" class="empty-workspace">
    <div>
      <el-icon style="font-size: 42px; color: var(--muted-2)"><Picture /></el-icon>
      <div style="margin-top: 10px">Выберите изображение слева или перетащите новое</div>
    </div>
  </div>

  <div v-else class="workspace">
    <div class="workspace-toolbar">
      <div class="toolbar-group">
        <strong style="color: var(--text)">{{ record.name }}</strong>
        <span>{{ record.width }}×{{ record.height }}</span>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-group">
        <span>Маска</span>
        <el-switch v-model="state.params.showMask" size="small" />
        <span style="margin-left: 6px">Точки</span>
        <el-switch v-model="state.params.showPoints" size="small" />
        <span style="margin-left: 6px">Рамка</span>
        <el-switch v-model="state.params.showRect" size="small" />
      </div>

      <div class="toolbar-group" style="width: 190px">
        <span>Масштаб</span>
        <el-slider
          v-model="zoom"
          :min="0.25"
          :max="4"
          :step="0.05"
          :show-tooltip="false"
          style="width: 110px"
        />
      </div>

      <el-tag
        v-if="record.calibration?.unitsPerPixel"
        size="small"
        type="success"
        effect="plain"
      >
        {{ formatNumber(record.calibration.unitsPerPixel, 4) }}
        {{ record.calibration.unit }}/px
      </el-tag>

      <el-button
        size="small"
        :type="calibrationMode ? 'warning' : 'default'"
        @click="startCalibration"
      >
        <el-icon><Aim /></el-icon>&nbsp;Калибровка
      </el-button>

      <el-button size="small" text @click="resetZoom">Вписать</el-button>
    </div>

    <div v-if="calibrationMode" class="calibration-hint">
      <el-icon><Aim /></el-icon>
      <span>Кликните начало и конец масштабной линейки. Затем введите её длину.</span>
      <el-button size="small" text @click="cancelCalibration">Отмена (Esc)</el-button>
    </div>

    <div v-if="record.result?.warnings?.length" class="workspace-alerts">
      <el-alert
        v-for="(warning, index) in record.result.warnings"
        :key="index"
        :title="warning"
        type="warning"
        :closable="false"
        show-icon
      />
    </div>

    <div ref="scrollRef" class="canvas-scroll">
      <div class="canvas-stage" :style="stageStyle">
        <div class="canvas-inner" :style="innerStyle">
          <canvas
            ref="canvasRef"
            :class="{ 'calibration-cursor': calibrationMode }"
            @click="onCanvasClick"
            @mousemove="onCanvasMove"
          />
          <div ref="svgHostRef" class="svg-overlay" />
        </div>
        <div v-if="record.status === 'processing'" class="processing-cover">
          <el-icon class="is-loading"><Loading /></el-icon>&nbsp;Обработка…
        </div>
      </div>
    </div>

    <div class="workspace-status">
      <span v-if="record.result">
        {{ record.result.processedWidth }}×{{ record.result.processedHeight }} обр. ·
        порог {{ formatNumber(record.result.threshold, 1) }} ·
        {{ record.result.polarity === 'dark' ? 'тёмный объект' : 'светлый объект' }} ·
        компонентов {{ record.result.componentCount }} ·
        {{ record.result.tpsCount }} точек TPS
      </span>
      <span v-else-if="record.status === 'error'" style="color: var(--red)">
        {{ record.error }}
      </span>
      <span v-else>Ожидание обработки…</span>

      <div class="toolbar-spacer" />

      <el-tag v-if="stale" size="small" type="warning" effect="plain">
        параметры изменены — нажмите «Пересчитать»
      </el-tag>
      <el-tag v-else-if="!record.calibration?.unitsPerPixel" size="small" type="info" effect="plain">
        масштаб не задан — значения в px
      </el-tag>
    </div>

    <el-dialog
      v-model="calibrationDialogVisible"
      title="Калибровка масштаба"
      width="440px"
      @closed="closeCalibrationDialog"
    >
      <div class="param-row">
        <div class="param-label">
          <span>Длина линии</span>
          <span class="param-value">{{ formatNumber(calibrationPixelLength, 2) }} px</span>
        </div>
      </div>

      <div class="param-row">
        <div class="param-label"><span>Известная длина масштабной линейки</span></div>
        <el-input-number
          v-model="calibrationKnownLength"
          :min="0.0001"
          :max="1000000"
          :step="1"
          :precision="4"
          :controls="false"
          style="width: 100%"
        />
      </div>

      <div class="param-row">
        <div class="param-label"><span>Единицы</span></div>
        <el-select v-model="calibrationUnit" style="width: 140px">
          <el-option label="µm" value="µm" />
          <el-option label="mm" value="mm" />
          <el-option label="nm" value="nm" />
        </el-select>
      </div>

      <div class="calibration-result">
        Масштаб:
        <strong>{{ formatNumber(calibrationUnitsPerPixel, 6) }} {{ calibrationUnit }}/px</strong>
      </div>

      <template #footer>
        <el-button @click="closeCalibrationDialog">Отмена</el-button>
        <el-button @click="applyCalibration(false)">Только этот файл</el-button>
        <el-button type="primary" @click="applyCalibration(true)">Ко всем файлам</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { SVG } from '@svgdotjs/svg.js'
import {
  activeFile,
  applyCalibrationToAll,
  isStale,
  setRecordCalibration,
  state,
} from '../store.js'
import { clamp, formatNumber, polygonPath } from '../core/math.js'

const record = activeFile

const scrollRef = ref(null)
const canvasRef = ref(null)
const svgHostRef = ref(null)

const fitScale = ref(1)
const zoom = ref(1)
const imageEl = ref(null)

const calibrationMode = ref(false)
const calibrationStart = ref(null)
const calibrationHover = ref(null)
const calibrationEnd = ref(null)
const calibrationDialogVisible = ref(false)
const calibrationPixelLength = ref(0)
const calibrationKnownLength = ref(100)
const calibrationUnit = ref('µm')

let svgDraw = null
let resizeObserver = null

const width = computed(() => record.value?.width || 0)
const height = computed(() => record.value?.height || 0)
const displayScale = computed(() => Math.max(0.02, fitScale.value * zoom.value))
const stale = computed(() => (record.value ? isStale(record.value) : false))

const calibrationUnitsPerPixel = computed(() => {
  const pixels = calibrationPixelLength.value
  const known = Number(calibrationKnownLength.value)
  if (!pixels || !Number.isFinite(known) || known <= 0) return 0
  return known / pixels
})

const stageStyle = computed(() => ({
  width: `${Math.max(1, width.value * displayScale.value)}px`,
  height: `${Math.max(1, height.value * displayScale.value)}px`,
}))

const innerStyle = computed(() => ({
  width: `${width.value}px`,
  height: `${height.value}px`,
  transform: `scale(${displayScale.value})`,
}))

function recomputeFit() {
  const element = scrollRef.value
  if (!element || !width.value || !height.value) return

  const availableWidth = Math.max(200, element.clientWidth - 36)
  const availableHeight = Math.max(160, element.clientHeight - 36)
  const scale = Math.min(availableWidth / width.value, availableHeight / height.value, 1)

  fitScale.value = Number.isFinite(scale) && scale > 0 ? scale : 1
}

function resetZoom() {
  zoom.value = 1
  recomputeFit()
  nextTick(render)
}

function renderSvg() {
  drawSvg(record.value?.result, width.value, height.value)
}

function eventToImagePoint(event) {
  const canvas = canvasRef.value
  if (!canvas) return null

  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return null

  const x = ((event.clientX - rect.left) / rect.width) * width.value
  const y = ((event.clientY - rect.top) / rect.height) * height.value

  return {
    x: clamp(x, 0, width.value),
    y: clamp(y, 0, height.value),
  }
}

function startCalibration() {
  calibrationMode.value = true
  calibrationStart.value = null
  calibrationHover.value = null
  calibrationEnd.value = null
  ElMessage.info('Кликните начало и конец масштабной линейки')
  nextTick(renderSvg)
}

function cancelCalibration() {
  calibrationMode.value = false
  calibrationStart.value = null
  calibrationHover.value = null
  calibrationEnd.value = null
  nextTick(renderSvg)
}

function onCanvasClick(event) {
  if (!calibrationMode.value) return

  const point = eventToImagePoint(event)
  if (!point) return

  if (!calibrationStart.value) {
    calibrationStart.value = point
    calibrationHover.value = point
    nextTick(renderSvg)
    return
  }

  const length = Math.hypot(
    point.x - calibrationStart.value.x,
    point.y - calibrationStart.value.y,
  )

  if (length < 2) {
    ElMessage.warning('Линия слишком короткая — выберите точки точнее')
    return
  }

  calibrationEnd.value = point
  calibrationHover.value = null
  calibrationPixelLength.value = length
  calibrationDialogVisible.value = true
  calibrationMode.value = false
  nextTick(renderSvg)
}

function onCanvasMove(event) {
  if (!calibrationMode.value || !calibrationStart.value) return

  const point = eventToImagePoint(event)
  if (!point) return

  calibrationHover.value = point
  nextTick(renderSvg)
}

async function applyCalibration(all) {
  const current = record.value
  if (!current) return

  const units = calibrationUnitsPerPixel.value
  if (!Number.isFinite(units) || units <= 0) {
    ElMessage.error('Введите корректную длину масштабной линейки')
    return
  }

  const calibration = {
    unitsPerPixel: units,
    unit: calibrationUnit.value,
  }

  const line = {
    x1: calibrationStart.value.x,
    y1: calibrationStart.value.y,
    x2: calibrationEnd.value.x,
    y2: calibrationEnd.value.y,
    lengthPx: calibrationPixelLength.value,
    knownLength: Number(calibrationKnownLength.value),
    unit: calibrationUnit.value,
  }

  calibrationDialogVisible.value = false

  if (all) {
    await applyCalibrationToAll(calibration, line)
    ElMessage.success(
      `Масштаб ${formatNumber(units, 4)} ${calibration.unit}/px применён ко всем файлам`,
    )
  } else {
    await setRecordCalibration(current, calibration, line)
    ElMessage.success(
      `Масштаб ${formatNumber(units, 4)} ${calibration.unit}/px применён`,
    )
  }

  calibrationStart.value = null
  calibrationEnd.value = null
  calibrationHover.value = null
  nextTick(render)
}

function closeCalibrationDialog() {
  calibrationDialogVisible.value = false
  calibrationStart.value = null
  calibrationEnd.value = null
  calibrationHover.value = null
  nextTick(renderSvg)
}

function onCalibrationKeydown(event) {
  if (event.key !== 'Escape') return

  if (calibrationDialogVisible.value) {
    closeCalibrationDialog()
  } else if (calibrationMode.value) {
    cancelCalibration()
  }
}

function loadImage(dataUrl) {
  imageEl.value = null

  if (!dataUrl) return

  const image = new Image()
  image.onload = () => {
    imageEl.value = image
    nextTick(() => {
      recomputeFit()
      render()
    })
  }
  image.onerror = () => {
    imageEl.value = null
  }
  image.src = dataUrl
}

function drawMask(context, result, imageWidth, imageHeight) {
  const mask = result.mask
  if (!mask?.data?.length || !mask.width || !mask.height) return

  const offscreen = document.createElement('canvas')
  offscreen.width = mask.width
  offscreen.height = mask.height

  const offscreenContext = offscreen.getContext('2d')
  const pixels = offscreenContext.createImageData(mask.width, mask.height)
  const maskData = mask.data

  for (let index = 0; index < maskData.length; index += 1) {
    if (maskData[index] > 0) {
      const offset = index * 4
      pixels.data[offset] = 34
      pixels.data[offset + 1] = 211
      pixels.data[offset + 2] = 238
      pixels.data[offset + 3] = 72
    }
  }

  offscreenContext.putImageData(pixels, 0, 0)

  context.save()
  context.imageSmoothingEnabled = true
  context.drawImage(offscreen, 0, 0, imageWidth, imageHeight)
  context.restore()
}

function drawCalibrationLine(line, color, inverse, applied) {
  if (!line) return

  const { x1, y1, x2, y2 } = line

  svgDraw
    .line(x1, y1, x2, y2)
    .stroke({ color, width: 2 * inverse })
    .attr('stroke-dasharray', applied
      ? `${6 * inverse} ${4 * inverse}`
      : `${4 * inverse} ${3 * inverse}`)

  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    svgDraw
      .circle(5 * inverse)
      .center(x, y)
      .fill(color)
      .stroke({ color: '#041016', width: inverse })
  }

  const middleX = (x1 + x2) / 2
  const middleY = (y1 + y2) / 2
  const length = Math.hypot(x2 - x1, y2 - y1)
  const label = applied && line.knownLength
    ? `${formatNumber(line.knownLength, 4)} ${line.unit}`
    : `${formatNumber(length, 1)} px`

  svgDraw
    .text(label)
    .font({ size: 12 * inverse, fill: color, weight: 700 })
    .move(middleX + 8 * inverse, middleY - 18 * inverse)
}

function drawSvg(result, imageWidth, imageHeight) {
  if (!svgHostRef.value) return

  if (!svgDraw) svgDraw = SVG().addTo(svgHostRef.value)
  svgDraw.clear()
  svgDraw.size(imageWidth, imageHeight).viewbox(0, 0, imageWidth, imageHeight)

  if (!result) return

  const inverse = 1 / Math.max(displayScale.value, 0.0001)

  if (result.displayContour?.length >= 3) {
    svgDraw
      .path(polygonPath(result.displayContour, true))
      .fill('none')
      .stroke({ color: '#22d3ee', width: 2 * inverse, linejoin: 'round', linecap: 'round' })
      .attr('vector-effect', 'non-scaling-stroke')
  }

  if (result.smoothedContour?.length >= 3) {
    svgDraw
      .path(polygonPath(result.smoothedContour, true))
      .fill('none')
      .stroke({ color: 'rgba(251, 191, 36, 0.55)', width: 1.2 * inverse })
      .attr('stroke-dasharray', `${4 * inverse} ${3 * inverse}`)
  }

  if (state.params.showRect && result.rectPoints?.length === 4) {
    svgDraw
      .polygon(result.rectPoints.map((point) => [point.x, point.y]))
      .fill('none')
      .stroke({ color: '#fbbf24', width: 1.5 * inverse })
      .attr('stroke-dasharray', `${7 * inverse} ${5 * inverse}`)
  }

  if (state.params.showPoints && result.semilandmarks?.length) {
    for (const point of result.semilandmarks) {
      svgDraw
        .circle(3.2 * inverse)
        .center(point.x, point.y)
        .fill('rgba(34, 211, 238, 0.9)')
        .stroke({ color: 'rgba(4, 16, 22, 0.9)', width: 0.6 * inverse })
    }
  }

  if (result.fixedLandmarks?.length >= 2) {
    result.fixedLandmarks.forEach((point, index) => {
      svgDraw
        .circle(6.5 * inverse)
        .center(point.x, point.y)
        .fill('#fbbf24')
        .stroke({ color: 'rgba(4, 16, 22, 0.9)', width: 1.2 * inverse })

      svgDraw
        .text(`${index + 1}`)
        .font({ size: 13 * inverse, fill: '#fbbf24', weight: 700 })
        .move(point.x + 8 * inverse, point.y - 18 * inverse)
    })
  }

  if (result.centroid) {
    const { x, y } = result.centroid
    const arm = 5 * inverse
    svgDraw.line(x - arm, y, x + arm, y).stroke({ color: 'rgba(255, 255, 255, 0.55)', width: inverse })
    svgDraw.line(x, y - arm, x, y + arm).stroke({ color: 'rgba(255, 255, 255, 0.55)', width: inverse })
  }

  if (state.params.showRect && result.measurements) {
    svgDraw
      .text(`AR ${formatNumber(result.measurements.aspectRatio, 2)}`)
      .font({ size: 12 * inverse, fill: '#fbbf24', weight: 600 })
      .move(10 * inverse, 18 * inverse)
  }

  if (record.value?.calibrationLine) {
    drawCalibrationLine(record.value.calibrationLine, '#f472b6', inverse, true)
  }

  if (calibrationMode.value && calibrationStart.value) {
    const end = calibrationHover.value || calibrationEnd.value
    if (end) {
      drawCalibrationLine({
        x1: calibrationStart.value.x,
        y1: calibrationStart.value.y,
        x2: end.x,
        y2: end.y,
      }, '#fb7185', inverse, false)
    }
  }
}

function render() {
  const current = record.value
  const canvas = canvasRef.value
  if (!current || !canvas || !current.width || !current.height) return

  const imageWidth = current.width
  const imageHeight = current.height

  if (canvas.width !== imageWidth) canvas.width = imageWidth
  if (canvas.height !== imageHeight) canvas.height = imageHeight

  const context = canvas.getContext('2d')
  context.clearRect(0, 0, imageWidth, imageHeight)
  context.fillStyle = '#000'
  context.fillRect(0, 0, imageWidth, imageHeight)

  if (imageEl.value) {
    context.drawImage(imageEl.value, 0, 0, imageWidth, imageHeight)
  }

  if (current.result && state.params.showMask) {
    drawMask(context, current.result, imageWidth, imageHeight)
  }

  drawSvg(current.result, imageWidth, imageHeight)
}

watch(
  () => record.value?.dataUrl,
  (dataUrl) => {
    loadImage(dataUrl)
  },
  { immediate: true },
)

watch(
  () => record.value?.result,
  () => nextTick(render),
)

watch(
  () => [state.params.showMask, state.params.showPoints, state.params.showRect, displayScale.value],
  () => nextTick(render),
)

watch(
  () => [width.value, height.value],
  () => nextTick(() => {
    recomputeFit()
    render()
  }),
)

watch(
  () => record.value?.calibrationLine,
  () => nextTick(renderSvg),
)

onMounted(() => {
  if (scrollRef.value) {
    resizeObserver = new ResizeObserver(() => {
      recomputeFit()
      render()
    })
    resizeObserver.observe(scrollRef.value)
  }

  window.addEventListener('keydown', onCalibrationKeydown)

  nextTick(() => {
    recomputeFit()
    render()
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('keydown', onCalibrationKeydown)
  svgDraw?.remove()
  svgDraw = null
})
</script>
