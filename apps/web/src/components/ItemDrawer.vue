<script setup lang="ts">
/**
 * 物品详情抽屉（桌面端）：右侧 440px 滑出，遮罩/Esc 关闭，不丢列表上下文。
 * 内容复用 DetailContent；删除/变更通过事件上抛给宿主刷新列表。
 * 仅桌面渲染（移动端窄屏走 /items/:id 全页）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import DetailContent from './DetailContent.vue';

const props = defineProps<{ itemId: number }>();
const emit = defineEmits<{ close: []; deleted: []; changed: [] }>();

const panelEl = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

watch(
  () => props.itemId,
  () => {
    window.addEventListener('keydown', onKeydown);
    void nextTick(() => panelEl.value?.focus());
  },
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div class="drawer-root">
        <div class="drawer-mask" @click="emit('close')" />
        <aside
          ref="panelEl"
          class="drawer-panel"
          role="dialog"
          aria-modal="true"
          aria-label="物品详情"
          tabindex="-1"
        >
          <header class="drawer-head">
            <h2 class="drawer-title">物品详情</h2>
            <button class="drawer-close" type="button" aria-label="关闭详情" @click="emit('close')">
              ✕
            </button>
          </header>
          <div class="drawer-body">
            <DetailContent :key="props.itemId" :item-id="props.itemId" @deleted="emit('deleted')" @changed="emit('changed')" />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.drawer-mask {
  position: absolute;
  inset: 0;
  background: rgba(17, 17, 17, 0.4);
}
.drawer-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(440px, 94vw);
  background: var(--color-canvas);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.14);
  overflow-y: auto;
  padding: 16px;
  box-sizing: border-box;
  outline: none;
}
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.drawer-title {
  font-family: Georgia, 'Songti SC', 'Noto Serif SC', serif;
  font-size: 18px;
  font-weight: var(--fw-semibold);
  margin: 0;
  color: var(--color-ink);
}
.drawer-close {
  width: 32px;
  height: 32px;
  background: var(--color-field);
  border: none;
  border-radius: var(--radius-m);
  font-size: 14px;
  color: var(--color-muted);
  cursor: pointer;
}
.drawer-close:hover {
  background: var(--color-hover);
  color: var(--color-text);
}
.drawer-body :deep(.actions) {
  grid-template-columns: 1fr 1fr;
}

/* 滑入/滑出（transform + opacity，铁律 9 相邻参数） */
.drawer-enter-active .drawer-mask,
.drawer-leave-active .drawer-mask {
  transition: opacity 200ms ease-out;
}
.drawer-enter-from .drawer-mask,
.drawer-leave-to .drawer-mask {
  opacity: 0;
}
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1);
}
.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active .drawer-mask,
  .drawer-leave-active .drawer-mask,
  .drawer-enter-active .drawer-panel,
  .drawer-leave-active .drawer-panel {
    transition: none;
  }
}
</style>
