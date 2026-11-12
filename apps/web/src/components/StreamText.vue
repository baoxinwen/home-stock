<script setup lang="ts">
/**
 * 流式打字文本（铁律 4）：逐字从 blur(6px) 晕开到清晰。
 * 单字 90ms、缓动 cubic-bezier(.215,.61,.355,1)、相邻字错开 30ms。
 * 用于登录页等"文字首次出现"的时刻；系统减弱动态时直接显示（main.css 全局兜底）。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    text: string;
    /** 相邻字符错开间隔 ms */
    staggerMs?: number;
    /** 单字动画时长 ms */
    durationMs?: number;
    /** 整体起始延迟 ms（副标滞后于标题用） */
    baseDelayMs?: number;
  }>(),
  { staggerMs: 30, durationMs: 90, baseDelayMs: 0 },
);

const chars = computed(() => Array.from(props.text));
</script>

<template>
  <span class="stream-text" :aria-label="text">
    <span
      v-for="(ch, i) in chars"
      :key="i"
      aria-hidden="true"
      class="stream-char"
      :style="{ animationDelay: `${baseDelayMs + i * staggerMs}ms`, animationDuration: `${durationMs}ms` }"
    >{{ ch }}</span>
  </span>
</template>

<style scoped>
.stream-text {
  white-space: pre-wrap;
}
.stream-char {
  display: inline-block;
  opacity: 0;
  filter: blur(6px);
  animation-name: stream-in;
  animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  animation-fill-mode: forwards;
}
@keyframes stream-in {
  to {
    opacity: 1;
    filter: blur(0);
  }
}
</style>
