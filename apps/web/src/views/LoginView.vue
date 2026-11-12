<script setup lang="ts">
/**
 * 登录页（M9.2）：输入访问口令 → 用一次受保护请求验证 → 存 localStorage 后进入应用。
 * 口令错误时清空本地口令并停留在本页。
 */
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { ApiError } from '../api/api';
import { clearStoredToken, setStoredToken } from '../auth/token';
import StreamText from '../components/StreamText.vue';

const route = useRoute();
const router = useRouter();

const token = ref('');
const error = ref('');
const submitting = ref(false);

function redirectTarget(): string {
  const raw = route.query.redirect;
  return typeof raw === 'string' && raw.startsWith('/') ? raw : '/';
}

async function submit(): Promise<void> {
  const value = token.value.trim();
  if (!value) {
    error.value = '请输入访问口令';
    return;
  }
  submitting.value = true;
  error.value = '';
  setStoredToken(value);
  try {
    // 用受保护接口验证口令；成功即说明口令有效
    await api.getSettings();
    await router.replace(redirectTarget());
  } catch (e) {
    clearStoredToken();
    error.value =
      e instanceof ApiError && e.code === 'UNAUTHORIZED'
        ? '访问口令错误，请重试'
        : e instanceof Error
          ? e.message
          : '登录失败，请重试';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <header class="page-head">
      <h1 class="page-title"><StreamText text="家庭库存" /></h1>
      <p class="muted-text"><StreamText text="请输入访问口令后继续" :base-delay-ms="150" /></p>
    </header>

    <form class="login-form" @submit.prevent="submit">
      <label class="field">
        <span class="label">访问口令</span>
        <input
          id="access-token"
          v-model="token"
          type="password"
          autocomplete="current-password"
          placeholder="部署时设置的 ACCESS_TOKEN"
        />
      </label>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>

      <button class="primary-btn" type="submit" :disabled="submitting">
        {{ submitting ? '验证中…' : '进入' }}
      </button>
    </form>

    <p class="hint">访问口令由部署者设置，仅保存在本机浏览器，不会上传。</p>
  </div>
</template>

<style scoped>
.login {
  max-width: 360px;
  margin: 12vh auto 0;
}
.page-head {
  margin-bottom: 20px;
}
.page-title {
  font-size: 28px;
  margin: 0 0 4px;
}
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
  margin: 0;
}
.login-form {
  display: grid;
  gap: 14px;
}
.field {
  display: grid;
  gap: 6px;
  font-size: 14px;
}
.field .label {
  color: var(--color-muted);
}
.field input {
  padding: 10px 12px;
  border-radius: var(--radius-m);
  font: inherit;
  color: var(--color-text);
}
.primary-btn {
  width: 100%;
  background: var(--color-ink);
  color: var(--color-on-ink);
  border: none;
  border-radius: var(--radius-m);
  padding: 12px;
  font-size: 15px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.form-error {
  color: var(--tone-red-fg);
  font-size: 14px;
  margin: 0;
}
.hint {
  margin-top: 18px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.7;
}
</style>
