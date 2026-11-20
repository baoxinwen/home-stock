<script setup lang="ts">
/**
 * 新版本更新提示（vite-plugin-pwa prompt 模式，用户决策 2026-11-19）：
 * SW 检测到新版本后显示轻 toast，点「刷新」换新重载（封死旧代码配新接口的窗口期），
 * 「忽略」关掉本次提示——回前台/定时检查时若新版本仍在排队则重现（24h 频率上限防打扰）。
 * 评审 I-4：registration.update() 不会重放 waiting 事件，重现靠显式检查 registration.waiting。
 * 注册在组件内（injectRegister: null 已关插件自动注入）；无 SW 环境静默不注册。
 * 更新检查时机：注册即查 + 回前台 + 每小时（PWA 常驻标签页场景，autoUpdate 时代的盲区）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { registerSW } from 'virtual:pwa-register';

/** 忽略后的重现间隔：24h 内不再打扰，到期后回前台/定时检查时重新提示 */
const DISMISS_RETRY_MS = 24 * 60 * 60 * 1000;

const needRefresh = ref(false);
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | null = null;
let checkTimer: ReturnType<typeof setInterval> | null = null;
let dismissedAt = 0;

async function checkUpdate(): Promise<void> {
  if (!registration || document.visibilityState !== 'visible' || !navigator.onLine) return;
  await registration.update().catch(() => {});
  if (
    registration.waiting &&
    !needRefresh.value &&
    Date.now() - dismissedAt >= DISMISS_RETRY_MS
  ) {
    needRefresh.value = true;
  }
}

function dismiss(): void {
  needRefresh.value = false;
  dismissedAt = Date.now();
}

function onVisibilityChange(): void {
  void checkUpdate();
}

onMounted(() => {
  if (!('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      needRefresh.value = true;
    },
    onRegisteredSW: (_url, reg) => {
      registration = reg ?? null;
      checkTimer = setInterval(() => void checkUpdate(), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', onVisibilityChange);
      // 请求持久存储（reno 同款）：防浏览器存储压力静默清掉预缓存/快照（iOS 可能拒绝，静默）
      navigator.storage?.persist?.().catch(() => {});
    },
    onRegisterError: () => {},
  });
});

onBeforeUnmount(() => {
  if (checkTimer) clearInterval(checkTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

function refresh(): void {
  void updateSW?.(true);
}
</script>

<template>
  <Transition name="update-toast">
    <div v-if="needRefresh" class="update-toast" role="status">
      <span class="update-text">新版本已就绪</span>
      <span class="update-actions">
        <button class="update-refresh" type="button" @click="refresh">刷新</button>
        <button class="update-dismiss" type="button" @click="dismiss">忽略</button>
      </span>
    </div>
  </Transition>
</template>

<style scoped>
.update-toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 16px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-surface);
  border-radius: var(--radius-l);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); /* 浮动元素允许中性软阴影 */
  font-size: 14px;
  color: var(--color-text);
}
/* 移动端抬到 tabbar 上方（tabbar 高 ~60px） */
@media (max-width: 1023px) {
  .update-toast {
    bottom: 72px;
  }
}
.update-text {
  white-space: nowrap;
}
.update-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.update-refresh {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-s);
  background: var(--color-ink);
  color: var(--color-on-ink);
  font: inherit;
  font-size: 13px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
  transition: background 150ms ease-out;
}
.update-refresh:hover {
  background: var(--color-ink-hover);
}
.update-dismiss {
  height: 28px;
  padding: 0 8px;
  border: none;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: color 150ms ease-out;
}
.update-dismiss:hover {
  color: var(--color-text);
}
.update-refresh:active,
.update-dismiss:active {
  transform: scale(0.98);
}
.update-toast-enter-active,
.update-toast-leave-active {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}
.update-toast-enter-from {
  opacity: 0;
  transform: translate(-50%, 8px);
}
.update-toast-leave-to {
  opacity: 0;
}
</style>
