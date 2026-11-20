<script setup lang="ts">
/**
 * Check 勾选图标（unslop 打磨轮）：替换「完成 ✓」「复制 ✓」等字符勾。
 * 字符图形依赖字体渲染、基线对齐差，控件上一律废弃（同 ChevronIcon 原则）。
 */
</script>

<template>
  <svg
    class="check-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
</template>

<style scoped>
.check-icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em; /* 铁律 5 */
}
.check-icon path {
  vector-effect: non-scaling-stroke;
}
</style>
