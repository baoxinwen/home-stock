<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { findItem } from '../api/queries';
import BackButton from '../components/BackButton.vue';
import { useItemForm, emptyForm, formFromItem } from '../composables/useItemForm';
import { imageUrl } from '../lib/images';

/** 图片上传约束（与 server UPLOAD_MAX_BYTES 对齐，前端预检省一次网络往返） */
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const route = useRoute();
const router = useRouter();
const editId = route.params.id ? Number(route.params.id) : null;
/** 清单转库存（M5.2 表单确认范式）：?convert=<清单项id>，预填后保存即入库+标 converted */
const convertIdRaw = typeof route.query.convert === 'string' ? Number(route.query.convert) : NaN;
const convertId = ref<number | null>(Number.isInteger(convertIdRaw) && convertIdRaw > 0 ? convertIdRaw : null);

const {
  form,
  categories,
  history,
  historyOpen,
  historyQuery,
  saving,
  error,
  computedExpiry,
  loadCategories,
  openHistory,
  closeHistory,
  onHistorySearch,
  applyHistory,
  toPayload,
} = useItemForm(null);

/** 全局默认提醒阈值（D-13 移植：placeholder 读真实设置，失败回退 3） */
const defaultRemindDays = ref(3);

onMounted(() => {
  void loadCategories();
  void api
    .getSettings()
    .then((s) => (defaultRemindDays.value = s.default_remind_days))
    .catch(() => {
      /* 设置拉取失败不阻塞表单 */
    });
  // 编辑态：先拉详情回填（非法 id 给出错误提示而非静默空表单）
  if (editId !== null) {
    void findItem(editId)
      .then((item) => {
        // W-M8：回填统一走 formFromItem（与 useItemForm 内部同源，消双份维护）
        form.value = formFromItem(item);
      })
      .catch((e: unknown) => {
        error.value = e instanceof Error ? e.message : '物品加载失败，请返回重试';
      });
    return;
  }
  // 转库存模式：拉清单项预填（名称/数量/单位/单价/类别），购买日期默认今天（D-5 同义）
  if (convertId.value !== null) {
    const targetId = convertId.value;
    void api
      .listShoppingItems()
      .then((list) => {
        const shopping = list.find((s) => s.id === targetId);
        if (!shopping || shopping.status === 'converted') {
          // 静默降级为普通新建会让用户在不知情下重复入库——显式提示并退出转换模式
          convertId.value = null;
          error.value = '该清单项不存在或已转入库存';
          return;
        }
        form.value = {
          ...emptyForm(),
          name: shopping.name,
          quantity: shopping.quantity,
          unit: shopping.unit ?? '',
          price: shopping.price === null ? '' : String(shopping.price),
          categoryId: shopping.categoryId,
        };
      })
      .catch((e: unknown) => {
        convertId.value = null;
        error.value = e instanceof Error ? e.message : '清单项加载失败，请返回重试';
      });
  }
});

/** 图片上传（0006，选填单图）：选文件即传 → 写入 form.imagePath；移除仅清字段，文件由 server 保存时清理/孤儿兜底 */
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadError = ref('');

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 允许重复选择同一文件再次触发 change
  if (!file) return;
  if (file.size > IMAGE_MAX_BYTES) {
    uploadError.value = '图片不能超过 2MB';
    return;
  }
  uploadError.value = '';
  uploading.value = true;
  try {
    const { path } = await api.uploadImage(file);
    form.value.imagePath = path;
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : '上传失败，请重试';
  } finally {
    uploading.value = false;
  }
}

function removeImage(): void {
  form.value.imagePath = '';
  uploadError.value = '';
}

async function submit(): Promise<void> {
  const built = toPayload();
  if (!built.ok) {
    error.value = built.message;
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    if (convertId.value !== null) {
      // 表单确认转换：按表单内容入库 + 清单项 converted（server 同一事务原子完成）
      const result = await api.convertShoppingItem(convertId.value, built.payload);
      await router.replace(`/items/${result.item.id}`);
    } else {
      const saved = editId === null ? await api.createItem(built.payload) : await api.updateItem(editId, built.payload);
      await router.replace(`/items/${saved.id}`);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

/** D-12：新建态「保存并再记一笔」——停留表单连续录入，保留类别/单位，清名称与日期类字段 */
const againNotice = ref('');

async function submitAndAgain(): Promise<void> {
  const built = toPayload();
  if (!built.ok) {
    error.value = built.message;
    return;
  }
  saving.value = true;
  error.value = '';
  againNotice.value = '';
  try {
    await api.createItem(built.payload);
    const keepCategory = form.value.categoryId;
    const keepUnit = form.value.unit;
    const keepRemindDays = form.value.remindDays;
    const keepMinQuantity = form.value.minQuantity;
    form.value = { ...emptyForm(), categoryId: keepCategory, unit: keepUnit, remindDays: keepRemindDays, minQuantity: keepMinQuantity };
    againNotice.value = '已保存，可继续录入下一件';
    saving.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试';
    saving.value = false;
  }
}
</script>

<template>
  <div class="form-view">
    <header class="page-head">
      <BackButton />
      <h1 class="page-title">{{ convertId !== null ? '转入库存' : editId === null ? '记一笔' : '编辑物品' }}</h1>
      <button v-if="editId === null && convertId === null" class="link-btn head-action" type="button" @click="openHistory">从历史复制</button>
    </header>

    <form class="form" @submit.prevent="submit">
      <label class="field">
        <span class="label">名称 *</span>
        <input v-model="form.name" type="text" required placeholder="如：鲜牛奶" />
      </label>

      <div class="field-row">
        <label class="field">
          <span class="label">类别</span>
          <select v-model="form.categoryId">
            <option :value="null">未分类</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="label">数量</span>
          <input v-model.number="form.quantity" type="number" min="0" step="any" />
        </label>
        <label class="field">
          <span class="label">单位</span>
          <input v-model="form.unit" type="text" placeholder="盒" list="unit-suggestions" />
          <datalist id="unit-suggestions">
            <option v-for="u in ['盒', '瓶', '袋', '包', '个', '杯', '罐', '把', '提', '卷']" :key="u" :value="u" />
          </datalist>
        </label>
      </div>

      <div class="field-row">
        <label class="field">
          <span class="label">购买日期</span>
          <input v-model="form.purchaseDate" type="date" />
        </label>
        <label class="field">
          <span class="label">单价（元）</span>
          <input v-model="form.price" type="number" min="0" step="0.01" placeholder="选填" />
        </label>
      </div>

      <fieldset class="field expiry-group">
        <legend class="label">过期方式</legend>
        <div class="mode-switch">
          <button
            type="button"
            class="chip"
            :class="{ active: form.expiryMode === 'direct' }"
            @click="form.expiryMode = 'direct'"
          >
            直接填过期日期
          </button>
          <button
            type="button"
            class="chip"
            :class="{ active: form.expiryMode === 'shelf' }"
            @click="form.expiryMode = 'shelf'"
          >
            生产日期 + 保质期
          </button>
          <button
            type="button"
            class="chip"
            :class="{ active: form.expiryMode === 'none' }"
            @click="form.expiryMode = 'none'"
          >
            长期存储
          </button>
        </div>
        <label v-if="form.expiryMode === 'direct'" class="field">
          <span class="label">过期日期</span>
          <input v-model="form.expiryDate" type="date" />
        </label>
        <p v-else-if="form.expiryMode === 'none'" class="computed-hint">
          长期存储品（如酒、干货）不设保质期，不参与临期/过期提醒
        </p>
        <div v-else class="field-row">
          <label class="field">
            <span class="label">生产日期</span>
            <input v-model="form.productionDate" type="date" />
          </label>
          <label class="field">
            <span class="label">保质期（天）</span>
            <input v-model="form.shelfLifeDays" type="number" min="1" step="1" />
          </label>
        </div>
        <p v-if="form.expiryMode === 'shelf' && computedExpiry" class="computed-hint">
          换算结果：有效期至 {{ computedExpiry }}
        </p>
      </fieldset>

      <!-- 图片（0006，选填单图）：选文件/拍照即传，预览可移除；未保存移除的文件由孤儿清理兜底 -->
      <fieldset class="field image-group">
        <legend class="label">图片（选填）</legend>
        <div v-if="form.imagePath" class="image-preview">
          <img :src="imageUrl(form.imagePath)" alt="物品图片" class="preview-img" />
          <button class="image-remove" type="button" :disabled="uploading" @click="removeImage">移除图片</button>
        </div>
        <div v-else class="image-upload">
          <button class="image-btn" type="button" :disabled="uploading" @click="fileInput?.click()">
            {{ uploading ? '上传中…' : '添加图片' }}
          </button>
          <span class="image-hint">jpg / png / webp，不超过 2MB；移动端可直接拍照</span>
        </div>
        <input
          ref="fileInput"
          class="image-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          @change="onFileChange"
        />
        <p v-if="uploadError" class="image-error" role="alert">{{ uploadError }}</p>
      </fieldset>

      <!-- 审查 F-2：三字段横跨双列内部三等分（原挤左列右侧空白失衡） -->
      <div class="field-row row-3">
        <label class="field">
          <span class="label">开封后保质（天）</span>
          <input v-model="form.openShelfDays" type="number" min="1" step="1" placeholder="选填" />
        </label>
        <label class="field">
          <span class="label">提醒阈值（天）</span>
          <input v-model="form.remindDays" type="number" min="1" step="1" :placeholder="`默认 ${defaultRemindDays}`" />
        </label>
        <label class="field">
          <span class="label">最少库存（选填）</span>
          <input v-model="form.minQuantity" type="number" min="0" step="1" placeholder="低于此值提醒补货" />
        </label>
      </div>

      <p v-if="error" class="error-text" role="alert">{{ error }}</p>

      <label v-if="editId !== null" class="opened-field">
        <input v-model="form.opened" type="checkbox" />
        <span class="opened-text">
          <span class="opened-title">已开封</span>
          <span class="opened-hint">开启后将记录今天的开封日期，并按「开封后保质天数」重算有效期</span>
        </span>
      </label>

      <!-- 审查 F-1：主/次保存按钮并排等宽（原全宽黑条 + 半宽灰条主次失衡） -->
      <div class="form-actions">
        <button class="btn-primary" type="submit" :disabled="saving">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <!-- D-12：新建态连续录入（规格 §2.2 逐件录入场景），编辑/转库存态不出现（一次转换语义） -->
        <button v-if="editId === null && convertId === null" class="btn-secondary again-btn" type="button" :disabled="saving" @click="submitAndAgain">
          保存并再记一笔
        </button>
      </div>
      <p v-if="againNotice" class="again-notice" role="status">{{ againNotice }}</p>
    </form>

    <!-- 从历史复制 -->
    <div v-if="historyOpen" class="history-mask" @click.self="closeHistory">
      <div class="history-panel" role="dialog" aria-label="从历史复制">
        <div class="history-head">
          <h2 class="panel-title">从历史复制</h2>
          <button class="link-btn" type="button" @click="closeHistory">关闭</button>
        </div>
        <input
          class="search-box"
          type="search"
          placeholder="搜索历史物品…"
          :value="historyQuery"
          @input="onHistorySearch(($event.target as HTMLInputElement).value)"
        />
        <p v-if="history.length === 0" class="muted-text">没有匹配的历史记录。</p>
        <ul class="history-list">
          <li v-for="h in history" :key="h.id">
            <button class="history-item" type="button" @click="applyHistory(h)">
              <span class="h-name">{{ h.name }}</span>
              <span class="h-meta">{{ h.unit ?? '' }} {{ h.expiryDate ?? '长期' }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: baseline;
  gap: 12px; /* 2026-11-11 审查 G-2：二级页标题与列表页统一左对齐 */
  margin-bottom: 16px;
}
/* 「从历史复制」仍靠右：左侧返回+标题，右侧保留上下文操作位 */
.page-head .head-action {
  margin-left: auto;
}
.form {
  display: grid;
  gap: 14px;
}
/* 审查 F-1：移动纵向堆叠，桌面并排等宽（基础样式先于媒体查询，避免同特异性覆盖） */
.form-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 桌面双列栅格（task-11）：名称 | 类别/数量/单位，购买日期与过期方式并排；其余字段一行一组 */
@media (min-width: 768px) {
  .form {
    gap: 14px 24px;
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }
  .form > .error-text,
  .form > .opened-field,
  .form > .form-actions {
    grid-column: 1 / -1;
  }
  /* 审查 F-2：三字段行跨双列，内部三等分 */
  .form > .field-row.row-3 {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px 24px;
  }
  /* 审查 F-1：主/次保存并排等宽 */
  .form-actions {
    flex-direction: row;
  }
  .form-actions > button {
    flex: 1;
  }
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: none;
  padding: 0;
  margin: 0;
  flex: 1;
}
.field-row {
  display: flex;
  gap: 12px;
}
/* 2026-11-12 移动端审查 M-6：三字段行窄屏换行（2+1），placeholder 不再溢出重叠 */
@media (max-width: 767px) {
  .field-row.row-3 {
    flex-wrap: wrap;
  }
  .field-row.row-3 .field {
    flex: 1 1 42%;
    min-width: 0;
  }
}
.label {
  font-size: 13px;
  color: var(--color-muted);
}
input,
select {
  padding: 10px 12px;
  border-radius: var(--radius-m);
  font: inherit;
  color: var(--color-text);
  width: 100%;
  box-sizing: border-box;
}
input:focus,
select:focus {
  outline-offset: -1px;
}
.expiry-group {
  border: none;
  display: grid;
  gap: 8px;
}
.mode-switch {
  display: flex;
  gap: 8px;
}
.chip {
  height: var(--control-h);
  display: inline-flex;
  align-items: center;
  background: var(--color-surface);
  border-radius: var(--radius-s);
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
  transition: transform 120ms ease;
}
.chip:active {
  transform: scale(0.98);
}
.chip.active {
  background: var(--color-ink);
  border-color: var(--color-ink);
  color: var(--color-on-ink);
}
.computed-hint {
  font-size: 13px;
  color: var(--tone-green-fg);
  margin: 0;
}
/* 图片（0006，选填单图）：预览分层（铁律 1 去边框），失败文案就地显示 */
.image-group .image-input {
  display: none;
}
.image-upload {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.image-btn {
  padding: 8px 16px;
  border-radius: var(--radius-m);
  border: none;
  background: var(--color-field);
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
}
.image-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.image-hint {
  font-size: 12px;
  color: var(--color-text-secondary, var(--color-text));
  opacity: 0.72;
}
.image-preview {
  display: flex;
  align-items: center;
  gap: 12px;
}
.preview-img {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: var(--radius-m);
  background: var(--color-surface);
}
.image-remove {
  border: none;
  background: none;
  color: var(--tone-red-fg, var(--color-text));
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
}
.image-remove:disabled {
  opacity: 0.6;
  cursor: default;
}
.image-error {
  color: var(--tone-red-fg, var(--color-text));
  font-size: 13px;
  margin: 8px 0 0;
}
.opened-field {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-m);
  background: var(--color-surface);
  cursor: pointer;
}
.opened-field input[type='checkbox'] {
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: var(--color-ink);
  flex: none;
}
.opened-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.opened-title {
  font-size: 14px;
  font-weight: var(--fw-semibold);
  color: var(--color-text);
}
.opened-hint {
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.5;
}
.btn-primary {
  background: var(--color-ink);
  color: var(--color-on-ink);
  border: none;
  border-radius: var(--radius-s);
  padding: 13px 16px;
  font-size: 15px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
  transition: transform 120ms ease;
}
.btn-primary:active {
  transform: scale(0.98);
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.error-text {
  color: var(--tone-red-fg);
  font-size: 14px;
  margin: 0;
}
.history-mask {
  position: fixed;
  inset: 0;
  background: rgba(17, 17, 17, 0.35);
  display: grid;
  place-items: center;
  padding: 16px;
  z-index: 30;
}
.history-panel {
  background: var(--color-canvas);
  border-radius: var(--radius-l);
  width: 100%;
  max-width: 420px;
  max-height: 70vh;
  overflow: auto;
  padding: 16px;
}
.history-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}
.panel-title {
  font-size: 17px;
  font-weight: var(--fw-semibold);
  margin: 0;
}
.search-box {
  margin-bottom: 12px;
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.history-item {
  width: 100%;
  text-align: left;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  background: var(--color-surface);
  border-radius: var(--radius-m);
  padding: 10px 12px;
  font: inherit;
  cursor: pointer;
  transition: transform 120ms ease;
}
.history-item:active {
  transform: scale(0.98);
}
.h-name {
  font-weight: var(--fw-semibold);
  font-size: 14px;
}
.h-meta {
  font-size: 13px;
  color: var(--color-muted);
}
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
  text-align: center;
  padding: 12px 0;
}
</style>
<style scoped>
/* 体检表 P2-6：记一笔表单控件收窄，长表单更易扫视 */
.field input,
.field select {
  max-width: 560px;
}
</style>
<style scoped>
/* D-12 保存并再记一笔 */
.again-btn {
  background: var(--color-field);
  color: var(--color-text);
}
.again-notice {
  color: var(--tone-green-fg);
  font-size: 14px;
  margin: 0;
}
</style>
