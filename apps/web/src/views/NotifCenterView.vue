<script setup lang="ts">
/**
 * 通知中心页（移动端 + 桌面直链回退）：
 * 页头 + 共享内容 NotificationContent（筛选/分组/已读/发送日志都在其中）。
 * 桌面端入口在顶栏铃铛（轻量下拉）；本页点行 = 就地处理：
 * 桌面点物品行右侧弹出物品抽屉（与库存/总览一致），移动窄屏跳详情全页。
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import ItemDrawer from '../components/ItemDrawer.vue';
import NotificationContent from '../components/NotificationContent.vue';
import BackButton from '../components/BackButton.vue';
import { refreshNavBadges } from '../composables/useNavBadges';
import { useMediaQuery } from '../composables/useMediaQuery';

const router = useRouter();
const isDesktop = useMediaQuery('(min-width: 1024px)');

// 未读数由内容组件上抛（首次加载与标记已读都会触发）
const unread = ref(0);
// 桌面行点击开的物品抽屉；物品被删后内容里 nameById 过期 → 换 key 重载
const drawerItemId = ref<number | null>(null);
const contentKey = ref(0);

function openItem(itemId: number): void {
  if (isDesktop.value) {
    drawerItemId.value = itemId;
  } else {
    void router.push(`/items/${itemId}`);
  }
}

function closeDrawer(): void {
  drawerItemId.value = null;
}

function onDrawerDeleted(): void {
  drawerItemId.value = null;
  contentKey.value += 1;
  refreshNavBadges();
}

function onReadChanged(): void {
  refreshNavBadges();
}
</script>

<template>
  <div class="notif-center wb-page">
    <header class="page-head">
      <!-- 2026-11-12 M-13 方案A：通知改由顶栏铃铛进入，补返回导航 -->
      <BackButton />
      <h1 class="page-title">通知</h1>
      <span class="head-tail">
        <!-- L2 未读二态：0 未读是好状态，不再红字 -->
        <span v-if="unread > 0" class="unread-count">{{ unread }} 条未读</span>
        <span v-else class="inbox-clear">收件箱已清空</span>
      </span>
    </header>

    <NotificationContent
      :key="contentKey"
      @open-item="openItem"
      @read-changed="onReadChanged"
      @unread-changed="(n) => (unread = n)"
    />

    <!-- 桌面：行点击右侧弹出物品详情（Teleport body，z-40） -->
    <ItemDrawer
      v-if="drawerItemId !== null"
      :item-id="drawerItemId"
      @close="closeDrawer"
      @deleted="onDrawerDeleted"
      @changed="refreshNavBadges()"
    />
  </div>
</template>

<style scoped>
/* 页面收窄：通知行内容窄，1280 全宽两侧大空白（对齐统计/设置 960） */
.notif-center {
  max-width: 960px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.head-tail {
  margin-left: auto;
}
.unread-count {
  font-size: 13px;
  color: var(--tone-red-fg);
}
.inbox-clear {
  font-size: 13px;
  color: var(--color-muted);
}
</style>
