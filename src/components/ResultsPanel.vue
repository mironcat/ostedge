<template>
  <div class="panel-card">
    <div class="panel-card-header">
      <span>Результаты</span>
      <el-tag v-if="record?.result" size="small" effect="dark" type="success">
        {{ record.result.measurements.unit }}
      </el-tag>
    </div>

    <div class="panel-card-body">
      <el-empty v-if="!record" description="Выберите изображение" :image-size="70" />

      <template v-else-if="record.status === 'error'">
        <el-alert
          type="error"
          :closable="false"
          show-icon
          title="Не удалось обработать изображение"
          :description="record.error"
        />
        <div class="param-hint">
          Попробуйте изменить порог, полярность или размер открытия.
          Если объект касается края — добавьте поля вокруг него.
        </div>
      </template>

      <el-skeleton v-else-if="!record.result" :rows="6" animated />

      <template v-else>
        <div class="metric-grid">
          <div
            v-for="metric in metrics"
            :key="metric.label"
            class="metric"
            :class="{ 'metric-wide': metric.wide }"
          >
            <div class="metric-label">{{ metric.label }}</div>
            <div class="metric-value">{{ metric.value }}</div>
            <div v-if="metric.sub" class="metric-sub">{{ metric.sub }}</div>
          </div>
        </div>

        <el-alert
          v-for="(warning, index) in record.result.warnings"
          :key="index"
          type="warning"
          :closable="false"
          show-icon
          :title="warning"
        />

        <div class="debug-row">
          <el-tag size="small" effect="plain">
            {{ record.result.thresholdMode === 'adaptive' ? 'C' : 'порог' }}:
            {{ formatNumber(record.result.threshold, 1) }}
          </el-tag>
          <el-tag size="small" effect="plain">
            {{ record.result.polarity === 'dark' ? 'тёмный объект' : 'светлый объект' }}
          </el-tag>
          <el-tag size="small" effect="plain">компонентов: {{ record.result.componentCount }}</el-tag>
          <el-tag size="small" effect="plain">TPS: {{ record.result.tpsCount }}</el-tag>
          <el-tag size="small" effect="plain">{{ Math.round(record.result.elapsedMs) }} мс</el-tag>
          <el-tag v-if="record.result.scaleFactor < 1" size="small" effect="plain" type="warning">
            обработка {{ Math.round(record.result.scaleFactor * 100) }} %
          </el-tag>
        </div>

        <el-button size="small" plain @click="exportActiveTps">
          <el-icon><Position /></el-icon>&nbsp;TPS этого файла
        </el-button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { activeFile } from '../store.js'
import { formatNumber } from '../core/math.js'
import { buildTps } from '../core/tps.js'
import { saveTextFile } from '../core/export.js'
import { baseName } from '../core/image.js'

const record = activeFile

const metrics = computed(() => {
  const result = record.value?.result
  if (!result) return []

  const m = result.measurements
  const unit = m.unit
  const length = (value, px) => ({
    value: `${formatNumber(value, 1)} ${unit}`,
    sub: unit === 'px' ? '' : `${formatNumber(px, 1)} px`,
  })

  return [
    {
      label: 'Площадь',
      value: `${formatNumber(m.area.value, 1)} ${unit}²`,
      sub: unit === 'px' ? '' : `${formatNumber(m.area.px, 0)} px²`,
      wide: true,
    },
    { label: 'Периметр', ...length(m.perimeter.value, m.perimeter.px) },
    { label: 'Большая ось', ...length(m.majorAxis.value, m.majorAxis.px) },
    { label: 'Малая ось', ...length(m.minorAxis.value, m.minorAxis.px) },
    { label: 'Высота (MBB)', ...length(m.height.value, m.height.px) },
    { label: 'Ширина (MBB)', ...length(m.width.value, m.width.px) },
    { label: 'Аспект', value: formatNumber(m.aspectRatio, 3), sub: 'height / width' },
    { label: 'Эксцентриситет', value: formatNumber(m.eccentricity, 3), sub: '0 — круг' },
    { label: 'Rugosity', value: formatNumber(m.rugosity, 3), sub: 'P / P сглаж.' },
    { label: 'Solidity', value: formatNumber(m.solidity, 3), sub: 'A / A выпукл.' },
    { label: 'Circularity', value: formatNumber(m.circularity, 3), sub: '4πA / P²' },
    {
      label: 'Эквив. диаметр',
      ...length(m.equivalentDiameter.value, m.equivalentDiameter.px),
    },
    { label: 'Ориентация', value: `${formatNumber(m.orientationDeg, 1)}°`, sub: 'от горизонтали' },
  ]
})

async function exportActiveTps() {
  const current = record.value
  if (!current?.result) return

  const content = buildTps([current])
  const result = await saveTextFile({
    defaultPath: `${baseName(current.name)}.tps`,
    content,
    filters: [{ name: 'TPS landmarks', extensions: ['tps'] }],
    title: 'Сохранить TPS',
  })

  if (!result.canceled) ElMessage.success('TPS сохранён')
}
</script>
