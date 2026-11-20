<script setup lang="ts">
/**
 * 离线标识条（reno 同款思路）：断网时出现在顶栏下方的细条，说明当前渲染的是
 * 离线快照且记录暂不可用，附数据截至时间（api/index.ts 快照 GET 成功时写 localStorage）。
 * 恢复在线自动消失；在线态零占位。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { SNAPSHOT_AT_KEY } from '../api';

const online = ref(navigator.onLine);
// setup 期即读时间戳：断网冷启动首帧就带「数据截至」，不等 mounted 补帧
const snapshotAt = ref<number | null>(null);

function readSnapshotAt(): void {
  try {
    const raw = localStorage.getItem(SNAPSHOT_AT_KEY);
    const n = raw == null ? Number.NaN : Number(raw);
    snapshotAt.value = Number.isFinite(n) ? n : null;
  } catch {
    snapshotAt.value = null;
  }
}
readSnapshotAt();

function onOnline(): void {
  online.value = true;
}
function onOffline(): void {
  online.value = false;
  readSnapshotAt();
}
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
const subText = computed(() => (snapshotAt.value != null ? `数据截至 ${formatTime(snapshotAt.value)}` : ''));

onMounted(() => {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
});
</script>

<template>
  <div v-if="!online" class="offline-bar" role="status">
    离线快照 · 记录暂不可用<span v-if="subText" class="offline-bar-sub num">{{ subText }}</span>
  </div>
</template>

<style scoped>
.offline-bar {
  padding: 5px 16px;
  background: var(--tone-yellow-bg);
  color: var(--tone-yellow-fg);
  font-size: 13px;
  text-align: center;
}
.offline-bar-sub {
  margin-left: 8px;
}
</style>
