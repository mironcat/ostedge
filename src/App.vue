<template>
  <div
    class="app-shell"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <header class="app-header">
      <div class="brand">
        <div class="brand-mark">
          <el-icon><Aim /></el-icon>
        </div>
        <div>
          <div class="brand-title">OstEdge</div>
          <div class="brand-sub">контуры и измерения остракод</div>
        </div>
      </div>

      <div class="header-actions">
        <el-tag :type="cvTagType" effect="dark" size="small">
          <el-icon class="tag-icon"><Cpu /></el-icon>{{ cvLabel }}
        </el-tag>

        <el-button size="small" @click="browse">
          <el-icon><FolderOpened /></el-icon>&nbsp;Открыть
        </el-button>

        <el-button
          size="small"
          type="primary"
          :loading="state.processing"
          :disabled="!state.files.length"
          @click="processAll"
        >
          <el-icon><Refresh /></el-icon>&nbsp;Пересчитать все
        </el-button>

        <el-button size="small" :disabled="!doneFiles.length" @click="exportCsv">
          <el-icon><Document /></el-icon>&nbsp;CSV
        </el-button>

        <el-button size="small" :disabled="!doneFiles.length" @click="exportTps">
          <el-icon><Position /></el-icon>&nbsp;TPS
        </el-button>

        <el-button size="small" :disabled="!doneFiles.length" @click="exportJson">
          <el-icon><DataLine /></el-icon>&nbsp;JSON
        </el-button>
      </div>
    </header>

    <el-alert
      v-if="state.cvStatus === 'error'"
      type="error"
      :closable="false"
      show-icon
      :title="`Не удалось загрузить OpenCV.js: ${state.cvError}`"
      style="border-radius: 0"
    />

    <el-container class="app-body">
      <el-aside width="270px" class="side-panel left-panel">
        <FileList @browse="browse" />
      </el-aside>

      <el-main class="workspace-main">
        <DropZone v-if="!state.files.length" @browse="browse" @drop="onDropFiles" />
        <Workspace v-else />
      </el-main>

      <el-aside width="380px" class="side-panel right-panel">
        <ParamsPanel @reprocess="reprocessActive" @reset="onReset" />
        <ResultsPanel />
      </el-aside>
    </el-container>

    <footer class="app-footer">
      <div class="footer-left">
        <span v-if="state.processing" class="footer-progress">
          <el-progress
            :percentage="progressPercent"
            :stroke-width="6"
            :show-text="false"
            style="width: 150px"
          />
          Обработка {{ state.progress.done }} / {{ state.progress.total }}
        </span>
        <span v-else>{{ doneFiles.length }} из {{ state.files.length }} измерено</span>
      </div>

      <div class="footer-right">
        <span v-if="state.cvStatus === 'ready'">OpenCV.js 4.12 · WASM</span>
        <span v-if="activeFile?.result">{{ Math.round(activeFile.result.elapsedMs) }} мс</span>
        <span>v0.1</span>
      </div>
    </footer>

    <div v-if="state.dragging" class="drop-overlay">
      <el-icon class="drop-overlay-icon"><UploadFilled /></el-icon>
      <div>Отпустите изображения, чтобы добавить</div>
    </div>

    <div v-if="state.cvStatus === 'loading'" class="loading-overlay">
      <el-icon class="is-loading loading-icon"><Loading /></el-icon>
      <div>Загрузка OpenCV.js…</div>
      <div class="loading-sub">Первый запуск может занять несколько секунд</div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="onFileInput"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import DropZone from './components/DropZone.vue'
import FileList from './components/FileList.vue'
import Workspace from './components/Workspace.vue'
import ParamsPanel from './components/ParamsPanel.vue'
import ResultsPanel from './components/ResultsPanel.vue'

import {
  activeFile,
  addFiles,
  addRecords,
  doneFiles,
  initOpenCV,
  isStale,
  processAll,
  processingKey,
  reprocessActive,
  resetParams,
  state,
} from './store.js'

import { buildCsv, buildJson, saveTextFile, suggestedFileName } from './core/export.js'
import { buildTps } from './core/tps.js'

const fileInput = ref(null)
let dragDepth = 0
let paramTimer = null

const cvTagType = computed(() => {
  if (state.cvStatus === 'ready') return 'success'
  if (state.cvStatus === 'error') return 'danger'
  return 'warning'
})

const cvLabel = computed(() => {
  if (state.cvStatus === 'ready') return 'OpenCV готов'
  if (state.cvStatus === 'error') return 'OpenCV ошибка'
  return 'OpenCV загружается'
})

const progressPercent = computed(() => {
  if (!state.progress.total) return 0
  return Math.round((state.progress.done / state.progress.total) * 100)
})

function onDragEnter(event) {
  event.preventDefault()
  dragDepth += 1
  state.dragging = true
}

function onDragOver(event) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event) {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) state.dragging = false
}

function onDrop(event) {
  event.preventDefault()
  dragDepth = 0
  state.dragging = false
  onDropFiles(event.dataTransfer?.files)
}

async function onDropFiles(files) {
  if (!files?.length) return
  await addFiles(files)
}

async function browse() {
  if (window.ostedge?.openImages) {
    const records = await window.ostedge.openImages()
    if (records?.length) await addRecords(records)
    return
  }
  fileInput.value?.click()
}

async function onFileInput(event) {
  const files = event.target.files
  if (files?.length) await addFiles(files)
  event.target.value = ''
}

async function exportCsv() {
  const records = doneFiles.value
  if (!records.length) return

  const content = buildCsv(records)
  const result = await saveTextFile({
    defaultPath: suggestedFileName(records, 'csv'),
    content,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    title: 'Сохранить измерения',
  })

  if (!result.canceled) ElMessage.success(`CSV сохранён: ${result.filePath}`)
}

async function exportTps() {
  const records = doneFiles.value
  if (!records.length) return

  let sampleId = ''
  try {
    const response = await ElMessageBox.prompt('Префикс образца (необязательно)', 'Экспорт TPS', {
      confirmButtonText: 'Сохранить',
      cancelButtonText: 'Отмена',
      inputPlaceholder: 'например, Sample_A',
    })
    sampleId = response.value || ''
  } catch {
    return
  }

  const content = buildTps(records, { sampleId })
  if (!content) {
    ElMessage.warning('Нет данных для TPS')
    return
  }

  const result = await saveTextFile({
    defaultPath: suggestedFileName(records, 'tps'),
    content,
    filters: [{ name: 'TPS landmarks', extensions: ['tps'] }],
    title: 'Сохранить TPS',
  })

  if (!result.canceled) ElMessage.success(`TPS сохранён: ${result.filePath}`)
}

async function exportJson() {
  const records = doneFiles.value
  if (!records.length) return

  const content = buildJson(records, state.params, state.defaultCalibration)
  const result = await saveTextFile({
    defaultPath: suggestedFileName(records, 'json'),
    content,
    filters: [{ name: 'JSON', extensions: ['json'] }],
    title: 'Сохранить результаты',
  })

  if (!result.canceled) ElMessage.success(`JSON сохранён: ${result.filePath}`)
}

function onReset() {
  resetParams()
  ElMessage.info('Параметры сброшены')
  reprocessActive()
}

function onKeydown(event) {
  const modifier = event.ctrlKey || event.metaKey
  if (!modifier) return

  if (event.key.toLowerCase() === 'o') {
    event.preventDefault()
    browse()
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    processAll()
  }
}

watch(
  () => processingKey(
    state.params,
    activeFile.value?.calibration || state.defaultCalibration,
  ),
  () => {
    const record = activeFile.value
    if (!record?.imageData || !isStale(record)) return

    window.clearTimeout(paramTimer)
    paramTimer = window.setTimeout(() => {
      reprocessActive()
    }, 350)
  },
)

onMounted(() => {
  initOpenCV()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.clearTimeout(paramTimer)
  window.removeEventListener('keydown', onKeydown)
})
</script>
