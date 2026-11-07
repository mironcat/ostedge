<template>
  <div class="file-panel">
    <div class="panel-title">
      <span>Изображения</span>
      <el-tag size="small" effect="dark" type="info">{{ state.files.length }}</el-tag>
    </div>

    <el-scrollbar class="file-scroll">
      <div v-if="!state.files.length" class="empty-list">
        Пока нет изображений.<br />Перетащите файлы в окно или нажмите «Добавить».
      </div>

      <div
        v-for="file in state.files"
        :key="file.id"
        class="file-item"
        :class="{ active: file.id === state.activeId }"
        @click="setActive(file.id)"
      >
        <img v-if="file.thumbnail" :src="file.thumbnail" class="file-thumb" alt="" />
        <div v-else class="file-thumb placeholder">
          <el-icon><Picture /></el-icon>
        </div>

        <div class="file-info">
          <div class="file-name" :title="file.name">{{ file.name }}</div>
          <div class="file-meta">
            <span>{{ file.width }}×{{ file.height }}</span>
            <span v-if="file.result">
              S = {{ formatNumber(file.result.measurements.area.value, 0) }}
              {{ file.result.measurements.unit }}²
            </span>
          </div>
          <div class="file-tags">
            <el-tag v-if="file.status === 'loading'" size="small" type="info">загрузка</el-tag>
            <el-tag v-else-if="file.status === 'ready'" size="small" type="info">готово</el-tag>
            <el-tag v-else-if="file.status === 'processing'" size="small" type="warning">обработка</el-tag>
            <el-tag v-else-if="file.status === 'error'" size="small" type="danger">ошибка</el-tag>
            <el-tag v-else-if="file.status === 'done'" size="small" type="success">измерено</el-tag>
            <el-tag v-if="isStale(file)" size="small" type="warning" effect="plain">устарело</el-tag>
          </div>
        </div>

        <el-button class="file-remove" text circle size="small" @click.stop="removeFile(file.id)">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </el-scrollbar>

    <div class="file-actions">
      <el-button size="small" type="primary" plain @click="$emit('browse')">
        <el-icon><Plus /></el-icon>&nbsp;Добавить
      </el-button>
      <el-button size="small" text :disabled="!state.files.length" @click="clearAll">
        Очистить
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { formatNumber } from '../core/math.js'
import { clearAll, isStale, removeFile, setActive, state } from '../store.js'

defineEmits(['browse'])
</script>
