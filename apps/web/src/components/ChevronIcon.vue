<script setup lang="ts">
/**
 * Chevron 方向图标（2026-11-13 细节轮 E3 控件箭头 SVG 化）：
 * 基础形朝右，rotate 旋出四向；折叠指示用 rotate 0（收起）/90（展开）表达。
 * 字符箭头（‹ › ▸ ▾）依赖字体渲染、基线对齐差，控件上一律废弃。
 */
const props = defineProps<{ rotate?: 0 | 90 | 180 | 270 }>();

const CLS: Record<number, string> = { 0: '', 90: 'chev-90', 180: 'chev-180', 270: 'chev-270' };
const cls = CLS[props.rotate ?? 0];
</script>

<template>
  <svg
    class="chev-icon"
    :class="cls"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
</template>

<style scoped>
.chev-icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em; /* 铁律 5 */
  transition: transform 200ms ease;
}
.chev-90 {
  transform: rotate(90deg);
}
.chev-180 {
  transform: rotate(180deg);
}
.chev-270 {
  transform: rotate(270deg);
}
</style>
