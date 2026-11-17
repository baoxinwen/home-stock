<script setup lang="ts">
/**
 * 恢复去向选择面板（D-9/I-4 共享）：过期物品恢复前说明后果并给选项。
 * 归档页与物品详情/抽屉（DetailContent）共用，执行由宿主监听事件完成。
 * 选项语义：
 * - postpone：顺延过期日 7 天并恢复（宿主需同时清开封——C-1，见 useItemRestore）
 * - force：仍恢复，接受再次被自动归档
 * 评审 A-M1/A-M2：焦点管理走 useOverlayA11y（移焦/inert/Escape/还原）；
 * Teleport 到 body——宿主在 #app（归档页）时背景 inert 才不误伤面板自身。
 */
import { ref } from 'vue';
import type { ItemDto } from '@home-stock/shared';
import { useOverlayA11y } from '../composables/useOverlayA11y';

defineProps<{
  item: ItemDto;
  /** 有效过期日已过天数（≥1） */
  overdueDays: number;
  restoring?: boolean;
}>();

const emit = defineEmits<{ close: []; postpone: []; force: [] }>();

const panelEl = ref<HTMLElement | null>(null);
useOverlayA11y({ panel: panelEl, close: () => emit('close') });
</script>

<template>
  <Teleport to="body">
    <div class="rcp-mask" @click.self="emit('close')">
      <div ref="panelEl" class="rcp-panel" role="dialog" aria-modal="true" aria-label="恢复过期物品确认" tabindex="-1">
      <h2 class="rcp-title">「{{ item.name }}」已过期 {{ overdueDays }} 天</h2>
      <p class="rcp-text">
        恢复后若有效过期日仍是过去，下次提醒扫描会把它再次自动归档，且不会再收到提醒。
      </p>
      <button class="rcp-option" type="button" :disabled="restoring" @click="emit('postpone')">
        顺延过期日 7 天并恢复 <span class="rcp-hint">还能吃/用一段时间</span>
      </button>
      <button class="rcp-option" type="button" :disabled="restoring" @click="emit('force')">
        仍要恢复 <span class="rcp-hint">接受再次被自动归档</span>
      </button>
      <button class="rcp-cancel" type="button" @click="emit('close')">取消</button>
      </div>
  </div>
  </Teleport>
</template>

<style scoped>
.rcp-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
  z-index: 50;
}
.rcp-panel {
  width: min(420px, calc(100vw - 32px));
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 18px;
  display: grid;
  gap: 10px;
  justify-items: start;
}
.rcp-title {
  font-size: 16px;
  margin: 0;
  color: var(--color-ink);
}
.rcp-text {
  margin: 0;
  font-size: 13px;
  color: var(--color-muted);
}
.rcp-option {
  width: 100%;
  text-align: left;
  background: var(--color-field);
  border: none;
  border-radius: var(--radius-m);
  padding: 10px 12px;
  font: inherit;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 8px;
  transition: background 150ms ease-out;
}
.rcp-option:hover:not(:disabled) {
  background: var(--color-hover);
}
.rcp-option:disabled {
  opacity: 0.6;
  cursor: default;
}
.rcp-hint {
  font-size: 12px;
  color: var(--color-muted);
}
.rcp-cancel {
  background: none;
  border: none;
  font: inherit;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
  justify-self: end;
}
.rcp-cancel:hover {
  color: var(--color-text);
}
</style>
