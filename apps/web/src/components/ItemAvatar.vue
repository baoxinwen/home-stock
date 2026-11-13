<script setup lang="ts">
/**
 * 物品头像（0006）：有图显示图片（列表内 lazy 加载），无图回落首字母色块。
 * 尺寸/圆角由宿主页面的 .avatar 系列样式控制（scoped 后代选择器对子组件根元素生效）。
 */
import { imageUrl } from '../lib/images';

defineProps<{
  name: string;
  imagePath?: string | null;
  /** 首字母色块色调（无图时）；有图时忽略 */
  tone?: string;
}>();
</script>

<template>
  <img
    v-if="imagePath"
    class="avatar avatar-img"
    :src="imageUrl(imagePath)"
    alt=""
    loading="lazy"
  />
  <span v-else class="avatar" :class="tone ? `tone-${tone}` : undefined" aria-hidden="true">{{
    name.slice(0, 1)
  }}</span>
</template>

<style scoped>
.avatar-img {
  object-fit: cover;
  flex: none;
  display: block;
}
</style>
