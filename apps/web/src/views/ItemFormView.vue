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

    <!-- 2026-11-14 融合布局（分区卡片 × 主辅两栏）：左主栏必填动线，右辅栏「更多选项」
         收纳选填项；920px 居中（分区卡片单列贴左撑不起宽屏，用户反馈融合） -->
    <form class="form" @submit.prevent="submit">
      <div class="form-main">
        <section class="form-card">
          <h3 class="card-title">基础信息</h3>
          <label class="field">
            <span class="label">名称 *</span>
            <input v-model="form.name" type="text" required placeholder="如：鲜牛奶" />
          </label>
          <div class="field-row row-basic">
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
              <input v-model="form.unit" class="input-unit" type="text" placeholder="盒" list="unit-suggestions" />
              <datalist id="unit-suggestions">
                <option v-for="u in ['盒', '瓶', '袋', '包', '个', '杯', '罐', '把', '提', '卷']" :key="u" :value="u" />
              </datalist>
            </label>
          </div>
        <div class="field-row row-date">
          <label class="field">
            <span class="label">购买日期</span>
            <input v-model="form.purchaseDate" type="date" />
          </label>
          <label class="field">
            <span class="label">单价（元）</span>
            <input v-model="form.price" type="number" min="0" step="0.01" placeholder="选填" />
          </label>
        </div>
        </section>

        <section class="form-card">
          <h3 class="card-title">保质期</h3>
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
        </section>

        <p v-if="error" class="error-text" role="alert">{{ error }}</p>

        <!-- 审查 F-1：主/次保存按钮并排（原全宽黑条 + 半宽灰条主次失衡） -->
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
      </div>

      <aside class="form-side">
        <section class="form-card">
          <h3 class="card-title">更多选项</h3>
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
          <div class="side-fields">
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
          <label v-if="editId !== null" class="opened-field">
            <input v-model="form.opened" type="checkbox" />
            <span class="opened-text">
              <span class="opened-title">已开封</span>
              <span class="opened-hint">开启后将记录今天的开封日期，并按「开封后保质天数」重算有效期</span>
            </span>
          </label>
        </section>
      </aside>
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
/* 融合布局：页头与 920 表单容器同宽居中（页头孤悬在 1200 容器上会与表单错位） */
.form-view {
  max-width: 920px;
  margin: 0 auto;
}
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
/* 2026-11-14 融合布局（分区卡片 × 主辅两栏）：左主栏必填动线（基础信息/保质期/保存）
   + 右辅栏「更多选项」收纳选填项（图片/三项策略/已开封）；920px 居中——
   分区卡片单列贴左撑不起宽屏（用户反馈融合） */
.form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
  max-width: 920px;
  margin: 0 auto;
  align-items: start;
}
.form-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.form-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 18px 20px;
}
.card-title {
  font-family: 'SF Pro Display', -apple-system, 'PingFang SC', 'Segoe UI', sans-serif;
  font-size: 13px;
  color: var(--color-muted);
  font-weight: var(--fw-semibold);
  margin: 0 0 14px;
}
.form-main .form-card .field + .field-row,
.form-main .form-card .field-row + .field-row,
.form-main .form-card .field-row + .field {
  margin-top: 14px;
}
/* 辅卡窄列：内容纵向流 */
.form-side .form-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.side-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-actions {
  display: flex;
  flex-direction: row;
  gap: 10px;
}
.form-actions > button {
  flex: 0 1 320px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: none;
  padding: 0;
  margin: 0;
  flex: 1;
  min-width: 0;
}
.field-row {
  display: flex;
  gap: 12px;
}
/* 2026-11-14 对齐修复：宽度控制从 input 限宽移到 field-row 的 grid 轨道——
   input 一律填满轨道，行右端与名称框平齐（限宽 input 左对齐导致的参差是根因） */
.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
/* 类别 | 数量 | 单位：类别吃剩余，数量/单位窄轨固定 */
.row-basic {
  grid-template-columns: minmax(0, 1fr) 110px 110px;
}
/* 购买日期 | 单价：日期窄轨，单价吃剩余 */
.row-date {
  grid-template-columns: 200px minmax(0, 1fr);
}
/* 2026-11-14 融合布局：窄屏单列（主栏→辅栏顺序流），三窄字段在辅卡纵排，
   M-6 的换行诉求由纵排天然满足 */
@media (max-width: 767px) {
  .form {
    grid-template-columns: minmax(0, 1fr);
  }
  /* 窄屏字段行单列纵排（大厂移动表单惯例），固定窄轨随之放开 */
  .field-row,
  .row-basic,
  .row-date {
    grid-template-columns: minmax(0, 1fr);
  }
  .form-actions {
    flex-direction: column;
  }
  .form-actions > button {
    flex: 1;
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
  gap: 14px; /* 细节轮：卡内纵向节奏统一 14px（原 8px 偏紧） */
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
