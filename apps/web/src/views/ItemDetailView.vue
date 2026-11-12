<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import DetailContent from '../components/DetailContent.vue';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

/** 返回：有历史可退则 back，否则回首页（深链/新标签直开无历史，M17 移植） */
function goBack(): void {
  const state = router.options.history.state as { back?: string | null } | null;
  if (state && state.back != null) router.back();
  else void router.push('/');
}
</script>

<template>
  <div class="detail-view wb-page-narrow">
    <header class="page-head">
      <button class="back-btn" type="button" @click="goBack">‹ 返回</button>
      <h1 class="page-title">物品详情</h1>
    </header>
    <DetailContent :item-id="id" @deleted="router.replace('/')" />
  </div>
</template>

<style scoped>
.detail-view {
  max-width: 640px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: baseline;
  gap: 12px; /* 2026-11-11 审查 G-2：二级页标题与列表页统一左对齐 */
  margin-bottom: 16px;
}
.back-btn {
  background: none;
  border: none;
  font: inherit;
  font-size: 14px;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
  border-bottom: 1px solid var(--color-border);
}
</style>
