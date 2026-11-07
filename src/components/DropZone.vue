<template>
  <div
    class="drop-zone"
    @click="$emit('browse')"
    @dragover.prevent.stop
    @drop.prevent.stop="$emit('drop', $event.dataTransfer.files)"
  >
    <el-icon class="drop-icon"><UploadFilled /></el-icon>
    <h2>Перетащите изображения остракод</h2>
    <p>
      Одна раковина на файл. Поддерживаются PNG, JPG, WebP и BMP.
      Можно перетащить сразу несколько изображений — они обработаются по очереди.
    </p>
    <el-button type="primary" size="large" @click.stop="$emit('browse')">
      <el-icon><FolderOpened /></el-icon>&nbsp;Выбрать файлы
    </el-button>
  </div>
</template>

<script setup>
defineEmits(['browse', 'drop'])
</script>
