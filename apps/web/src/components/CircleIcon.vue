<script setup lang="ts">
/**
 * 空心圆图标（评审 M-11）：清单待购行勾选钮的「未完成」态图形。
 * 评审 M-11：替代字符「○」——字符图形依赖字体渲染、基线对齐差，控件上一律废弃
 * （同 ChevronIcon/CheckIcon 原则）；形制对齐 lucide 的 circle。
 */
</script>

<template>
  <svg
    class="circle-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
  </svg>
</template>

<style scoped>
.circle-icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em; /* 铁律 5 */
}
.circle-icon circle {
  vector-effect: non-scaling-stroke; /* 同 ChevronIcon：小尺寸下不细于并排文字 */
}
</style>
