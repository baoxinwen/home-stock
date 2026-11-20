<script setup lang="ts">
/**
 * X 关闭图标（unslop 打磨轮）：替换抽屉关闭「✕」字符叉。
 * 字符图形依赖字体渲染、基线对齐差，控件上一律废弃（同 ChevronIcon 原则）。
 */
</script>

<template>
  <svg
    class="x-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
</template>

<style scoped>
.x-icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em; /* 铁律 5 */
}
.x-icon path {
  vector-effect: non-scaling-stroke;
}
</style>
