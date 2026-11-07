<template>
  <div class="panel-card">
    <div class="panel-card-header">
      <span>Параметры</span>
      <el-button size="small" text @click="$emit('reset')">Сбросить</el-button>
    </div>

    <div class="panel-card-body">
      <div class="param-row">
        <div class="param-label"><span>Метод порога</span></div>
        <el-select v-model="params.thresholdMode" size="small">
          <el-option label="Оцу (авто)" value="otsu" />
          <el-option label="Адаптивный" value="adaptive" />
        </el-select>
      </div>

      <div class="param-row">
        <div class="param-label"><span>Полярность</span></div>
        <el-select v-model="params.polarity" size="small">
          <el-option label="Авто" value="auto" />
          <el-option label="Светлый объект" value="light" />
          <el-option label="Тёмный объект" value="dark" />
        </el-select>
      </div>

      <div class="param-row">
        <div class="param-label">
          <span>Автоконтраст</span>
          <el-switch v-model="params.autoContrast" size="small" />
        </div>
        <div class="param-hint">Растягивает яркость по перцентилям 0.5–99.5 %.</div>
      </div>

      <div class="param-row">
        <div class="param-label">
          <span>Сдвиг порога</span>
          <span class="param-value">{{ params.thresholdOffset > 0 ? '+' : '' }}{{ params.thresholdOffset }}</span>
        </div>
        <el-slider
          v-model="params.thresholdOffset"
          :min="-50"
          :max="50"
          :step="1"
          :show-tooltip="false"
        />
        <div class="param-hint">Плюс — контур «худеет», минус — «толстеет».</div>
      </div>

      <template v-if="params.thresholdMode === 'adaptive'">
        <div class="param-row">
          <div class="param-label">
            <span>Блок адаптивного порога</span>
            <span class="param-value">{{ params.adaptiveBlock }}</span>
          </div>
          <el-slider v-model="params.adaptiveBlock" :min="3" :max="99" :step="2" :show-tooltip="false" />
        </div>
        <div class="param-row">
          <div class="param-label">
            <span>Константа C</span>
            <span class="param-value">{{ params.adaptiveC }}</span>
          </div>
          <el-slider v-model="params.adaptiveC" :min="-20" :max="30" :step="1" :show-tooltip="false" />
        </div>
      </template>

      <el-divider style="margin: 2px 0" />

      <div class="param-row">
        <div class="param-label">
          <span>Открытие (шум)</span>
          <span class="param-value">{{ params.opening }} px</span>
        </div>
        <el-slider v-model="params.opening" :min="1" :max="31" :step="2" :show-tooltip="false" />
      </div>

      <div class="param-row">
        <div class="param-label">
          <span>Закрытие (разрывы)</span>
          <span class="param-value">{{ params.closing }} px</span>
        </div>
        <el-slider v-model="params.closing" :min="1" :max="31" :step="2" :show-tooltip="false" />
      </div>

      <div class="param-row">
        <div class="param-label">
          <span>Размытие</span>
          <span class="param-value">{{ params.blur === 0 ? 'выкл.' : params.blur + ' px' }}</span>
        </div>
        <el-slider v-model="params.blur" :min="0" :max="9" :step="2" :show-tooltip="false" />
      </div>

      <div class="param-row">
        <div class="param-label">
          <span>Сглаживание (rugosity)</span>
          <span class="param-value">{{ params.smoothing }} px</span>
        </div>
        <el-slider v-model="params.smoothing" :min="1" :max="31" :step="2" :show-tooltip="false" />
        <div class="param-hint">При 1 px Rugosity = 1. Для оценки изрезанности ставьте 5–15.</div>
      </div>

      <el-divider style="margin: 2px 0" />

      <div class="param-row">
        <div class="param-label"><span>Мин. площадь объекта, px</span></div>
        <el-input-number
          v-model="params.minObjectArea"
          size="small"
          :min="10"
          :max="100000"
          :step="10"
          :controls="false"
        />
      </div>

      <div class="param-row">
        <div class="param-label">
          <span>Игнорировать касание края</span>
          <el-switch v-model="params.ignoreBorder" size="small" />
        </div>
      </div>

      <div class="param-row">
        <div class="param-label">
          <span>Упрощение контура</span>
          <span class="param-value">{{ (params.simplify * 100).toFixed(2) }} %</span>
        </div>
        <el-slider
          v-model="params.simplify"
          :min="0"
          :max="0.01"
          :step="0.0005"
          :show-tooltip="false"
        />
      </div>

      <div class="param-row">
        <div class="param-label"><span>Точек контура (TPS)</span></div>
        <el-input-number
          v-model="params.numPoints"
          size="small"
          :min="20"
          :max="500"
          :step="10"
          :controls="false"
        />
        <div class="param-hint">В TPS будет {{ Number(params.numPoints) + 2 }} ориентиров: 2 фиксированных + {{ params.numPoints }} полуточек.</div>
      </div>

      <div class="param-row">
        <div class="param-label"><span>Створка</span></div>
        <el-select v-model="params.valve" size="small">
          <el-option label="Левая (LV)" value="LV" />
          <el-option label="Правая (RV)" value="RV" />
          <el-option label="Без ориентации" value="none" />
        </el-select>
      </div>

      <el-divider style="margin: 2px 0" />

      <div class="param-row">
        <div class="param-label"><span>Масштаб: единиц на пиксель</span></div>
        <el-input-number
          v-model="activeCalibration.unitsPerPixel"
          size="small"
          :min="0"
          :max="1000000"
          :step="0.0001"
          :precision="6"
          :controls="false"
          placeholder="например, 0.69"
        />
        <div class="param-label" style="margin-top: 4px">
          <span>Единицы</span>
          <el-select v-model="activeCalibration.unit" size="small" style="width: 110px">
            <el-option label="µm" value="µm" />
            <el-option label="mm" value="mm" />
            <el-option label="nm" value="nm" />
          </el-select>
        </div>
        <div class="param-hint">
          {{ activeFile ? 'Для активного изображения.' : 'По умолчанию для новых изображений.' }}
          Можно ввести вручную или нажать «Калибровка» на панели изображения
          и провести линию по масштабной линейке.
        </div>
        <el-button size="small" text @click="resetScale">Сбросить масштаб</el-button>
      </div>

      <el-button type="primary" size="small" @click="$emit('reprocess')">
        <el-icon><Refresh /></el-icon>&nbsp;Пересчитать активное
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { activeFile, clearActiveCalibration, state } from '../store.js'

const params = state.params
const activeCalibration = computed(
  () => activeFile.value?.calibration || state.defaultCalibration,
)

async function resetScale() {
  await clearActiveCalibration()
  ElMessage.info('Масштаб сброшен')
}

defineEmits(['reprocess', 'reset'])
</script>
