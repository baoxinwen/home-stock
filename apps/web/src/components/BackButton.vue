<script setup lang="ts">
/**
 * 返回按钮（2026-11-13 细节轮 D-1）：全站统一的页头返回——
 * SVG chevron + 文字的 ghost 钮（无下划线，与去边框语言一致），
 * goBack 逻辑内聚（有历史则 back，深链/新标签直开无历史回总览）。
 * 此前 5 页各自 scoped 重复「‹ 字符 + border-bottom 下划线」模式，已废弃。
 */
import { useRouter } from 'vue-router';

const router = useRouter();

function goBack(): void {
  const state = router.options.history.state as { back?: string | null } | null;
  if (state && state.back != null) router.back();
  else void router.push('/');
}
</script>

<template>
  <button class="back-btn" type="button" @click="goBack">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
    <span>返回</span>
  </button>
</template>

<style scoped>
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 32px;
  padding: 3px 10px 3px 6px;
  border-radius: var(--radius-s);
  background: none;
  border: none;
  font: inherit;
  font-size: 14px;
  color: var(--color-muted);
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out, transform 120ms ease;
}
.back-btn svg {
  width: 14px;
  height: 14px;
}
.back-btn:hover {
  background: var(--color-field);
  color: var(--color-ink);
}
.back-btn:active {
  transform: scale(0.97);
}
</style>
