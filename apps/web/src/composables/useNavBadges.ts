/**
 * 导航徽章计数（D-10）：通知未读数 + 清单待购数。
 * 模块级单例状态：App.vue（tabbar）、AppTopNav、通知抽屉共享同一份，
 * 抽屉内标记已读后调用 refresh()，顶导航徽章即时更新。
 * 挂载时拉取，路由切换后刷新；登录态异常由 api 层统一处理。
 */
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';

// 模块级共享状态（单例）：所有调用方看到同一份数据
const unread = ref(0);
const pendingCount = ref(0);

async function fetchCounts(): Promise<void> {
  try {
    const [unreadList, shoppingList] = await Promise.all([
      api.listNotifications(true),
      api.listShoppingItems('pending'),
    ]);
    unread.value = unreadList.length;
    pendingCount.value = shoppingList.length;
  } catch {
    // 徽章失败不打断导航（登录态异常由 api 层统一处理）
  }
}

export function useNavBadges() {
  const route = useRoute();

  onMounted(fetchCounts);
  watch(
    () => route.fullPath,
    () => {
      void fetchCounts();
    },
  );

  return { unread, pendingCount, refresh: fetchCounts };
}

/** 供非组件上下文（抽屉关闭回调等）直接刷新共享计数 */
export { fetchCounts as refreshNavBadges };
