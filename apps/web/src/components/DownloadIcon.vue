<script setup lang="ts">
/**
 * 下载图标（lucide download）：备份卡「立即备份」按钮用。
 * 控件图标一律 SVG（铁律 11 配套：字符图形依赖字体渲染、基线对齐差，控件上一律废弃）。
 */
</script>

<template>
  <svg
    class="icon-1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </svg>
</template>

<style scoped>
.icon-1em {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em; /* 铁律 5 */
}
</style>
