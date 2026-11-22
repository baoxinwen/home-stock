<script setup lang="ts">
/**
 * 警示三角图标（lucide triangle-alert）：不可撤销操作的后果提示行用。
 * 控件图标一律 SVG（铁律 11 配套）。
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
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" x2="12" y1="9" y2="13" />
    <line x1="12" x2="12.01" y1="17" y2="17" />
  </svg>
</template>

<style scoped>
.icon-1em {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em; /* 铁律 5 */
}
</style>
