<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import DetailContent from '../components/DetailContent.vue';
import BackButton from '../components/BackButton.vue';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);
</script>

<template>
  <div class="detail-view wb-page-narrow">
    <header class="page-head">
      <BackButton />
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
</style>
