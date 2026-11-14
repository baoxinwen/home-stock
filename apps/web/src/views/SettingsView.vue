<script setup lang="ts">
/**
 * 设置页（M6/M7）：提醒时刻、全局默认阈值、自动归档开关、邮件/企微渠道配置与测试发送。
 * 秘密字段：GET 返回 *** 占位；未改动时原样回传（server 识别为“保持原值”）。
 * 分组标签页：顶部 chips 即 tab，点哪个只显示哪个区块（v-show 保持 DOM 常驻，
 * 未保存的表单修改切 tab 不丢）；选中项记入 sessionStorage，回页/刷新后还原。
 */
import { computed, onMounted, reactive, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import type { BackupFileDto, NotifyChannel, SettingsDto } from '@home-stock/shared';
import { api } from '../api';
import { clearStoredToken } from '../auth/token';
import BackButton from '../components/BackButton.vue';
import { useTheme, type ThemePreference } from '../composables/useTheme';

const router = useRouter();

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const loading = ref(true);
const saving = ref(false);
const formError = ref('');
const saveOk = ref('');
/** 加载失败态（I-3 移植）：表单停留默认值，此时保存会用全量默认值覆盖线上配置 → 禁止保存 */
const loadFailed = ref(false);
/** 备份下载中（I-7 移植：blob 下载按钮） */
const downloading = ref(false);

const form = reactive({
  reminder_hour: 8,
  default_remind_days: 3,
  auto_archive_expired: 1,
  email: {
    enabled: 0,
    smtp_host: '',
    smtp_port: '' as string | number | null,
    secure: 0,
    user: '',
    pass: '',
    from: '',
    to: '',
  },
  wecom: {
    enabled: 0,
    corp_id: '',
    agent_id: '',
    secret: '',
    to_user: '',
  },
});

const emailPassMasked = ref(true);
const wecomSecretMasked = ref(true);

const testing = ref<NotifyChannel | null>(null);
/** 测试发送结果带渠道归属：只渲染在对应渠道的 tab 里，不串显 */
const testResult = ref<{ channel: NotifyChannel; ok: boolean; text: string } | null>(null);
const logs = ref<{ id: number; channel: string | null; level?: string | null; message: string | null; createdAt: string | null }[]>([]);

// 备份与恢复（M8）
const backups = ref<BackupFileDto[]>([]);
const backupError = ref('');
const backupOk = ref('');
const restoring = ref(false);
const restoreFile = ref<HTMLInputElement | null>(null);
/** 已选备份文件名回显（原生 input 隐藏后取代 UA「未选择文件」文案） */
const restoreFileName = ref('');

function onRestoreFileChange(e: Event): void {
  restoreFileName.value = (e.target as HTMLInputElement).files?.[0]?.name ?? '';
}

/** I-7 移植：blob + header 认证下载（口令不再进 URL），失败行内提示 */
async function downloadBackupAction(): Promise<void> {
  backupError.value = '';
  downloading.value = true;
  try {
    await api.downloadBackup();
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : '备份下载失败';
  } finally {
    downloading.value = false;
  }
}

// 铁律 10 反馈自熄：复制成功的对勾 2.5s 后自动淡出恢复（重复点击重置计时）
const copiedName = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyBackupName(name: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(name);
    copiedName.value = name;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedName.value = null;
      copiedTimer = null;
    }, 2500);
  } catch {
    // 剪贴板不可用（权限/非安全上下文）：不显示成功反馈
  }
}

// ---------- 数据概览（PC 充实化）：物品/类别/备份状态，与表单加载解耦 ----------
const stockCount = ref(0);
const categoryCount = ref(0);
// I-8：占用计数与 server 删除保护同口径——归档物品仍引用类别，一并计入
// （否则会出现「显示 0 件」却删除 409 的矛盾）
const overviewItems = ref<{ id: number; categoryId: number | null }[]>([]);
const archivedItems = ref<{ id: number; categoryId: number | null }[]>([]);
const categoryUsage = computed(() => {
  const map = new Map<number, number>();
  for (const it of [...overviewItems.value, ...archivedItems.value]) {
    if (it.categoryId == null) continue;
    map.set(it.categoryId, (map.get(it.categoryId) ?? 0) + 1);
  }
  return map;
});

function usageOf(categoryId: number): number {
  return categoryUsage.value.get(categoryId) ?? 0;
}

async function loadOverview(): Promise<void> {
  try {
    const [items, archived, categories] = await Promise.all([
      api.listItems(),
      api.listItems({ status: 'archived' }),
      api.listCategories(),
    ]);
    overviewItems.value = items;
    archivedItems.value = archived;
    stockCount.value = items.length;
    categoryCount.value = categories.length;
  } catch {
    /* 概览失败不阻塞设置表单 */
  }
}

const lastBackupTime = computed(() => {
  const times = backups.value.map((b) => new Date(b.createdAt).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  return formatTime(new Date(Math.max(...times)).toISOString());
});

const anchors = [
  { id: 'appearance', label: '外观' },
  { id: 'categories', label: '类别管理' },
  { id: 'remind', label: '提醒' },
  { id: 'notify', label: '通知' },
  { id: 'backup', label: '备份与恢复' },
] as const;

type SettingsTab = (typeof anchors)[number]['id'];

/** 含可保存表单字段的 tab（保存按钮只在这些 tab 显示；通知 tab 含邮件/企微渠道字段） */
const SAVABLE_TABS: ReadonlySet<SettingsTab> = new Set(['remind', 'notify']);

// tab 选中态记 sessionStorage：回页/刷新后还原，不进 URL（避免每次切 tab 触发路由级徽章重拉）
const TAB_STORAGE_KEY = 'home-stock-settings-tab';

function initialTab(): SettingsTab {
  try {
    const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (saved && anchors.some((a) => a.id === saved)) return saved as SettingsTab;
  } catch {
    /* 存储不可用时回默认 */
  }
  return 'appearance';
}

const activeTab = ref<SettingsTab>(initialTab());
const showSave = computed(() => SAVABLE_TABS.has(activeTab.value));

function switchTab(id: SettingsTab): void {
  activeTab.value = id;
  try {
    sessionStorage.setItem(TAB_STORAGE_KEY, id);
  } catch {
    /* 存储不可用时仅本会话内生效 */
  }
}

// ---------- 类别管理（D-2）：列表 + 增改删；删除受占用保护（409 → 行内提示） ----------
interface CategoryRow {
  id: number;
  name: string;
  sortOrder: number | null;
}

const categoryRows = ref<CategoryRow[]>([]);
const newCategoryName = ref('');
const categoryError = ref('');
const categoryNotice = ref('');
const renamingId = ref<number | null>(null);
const renamingName = ref('');

async function loadCategories(): Promise<void> {
  try {
    categoryRows.value = await api.listCategories();
  } catch (e) {
    categoryError.value = e instanceof Error ? e.message : '类别加载失败';
  }
}

async function createCategory(): Promise<void> {
  const name = newCategoryName.value.trim();
  if (!name) {
    categoryError.value = '请输入类别名称';
    return;
  }
  try {
    const created = await api.createCategory({ name });
    categoryRows.value = [...categoryRows.value, created].sort((a, b) => a.id - b.id);
    newCategoryName.value = '';
    categoryError.value = '';
    categoryNotice.value = `已添加「${created.name}」`;
  } catch (e) {
    categoryError.value = e instanceof Error ? e.message : '添加失败';
  }
}

function startRename(cat: CategoryRow): void {
  renamingId.value = cat.id;
  renamingName.value = cat.name;
}

async function submitRename(): Promise<void> {
  if (renamingId.value === null) return;
  const name = renamingName.value.trim();
  if (!name) {
    categoryError.value = '类别名称不能为空';
    return;
  }
  try {
    const updated = await api.updateCategory(renamingId.value, { name });
    categoryRows.value = categoryRows.value.map((c) => (c.id === updated.id ? updated : c));
    categoryNotice.value = `已改名「${updated.name}」`;
    renamingId.value = null;
    categoryError.value = '';
  } catch (e) {
    categoryError.value = e instanceof Error ? e.message : '改名失败';
  }
}

async function deleteCategory(cat: CategoryRow): Promise<void> {
  try {
    await api.deleteCategory(cat.id);
    categoryRows.value = categoryRows.value.filter((c) => c.id !== cat.id);
    categoryNotice.value = `已删除「${cat.name}」`;
    categoryError.value = '';
  } catch (e) {
    // 服务端 409：类别下仍有物品
    categoryError.value = e instanceof Error ? e.message : '删除失败';
  }
}



// ---------- 外观（主题切换）：system/light/dark，令牌翻转见 styles/main.css ----------
const { preference: themePreference, resolved: themeResolved, setPreference: setThemePreference } =
  useTheme();

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

function fill(s: SettingsDto): void {
  form.reminder_hour = s.reminder_hour;
  form.default_remind_days = s.default_remind_days;
  form.auto_archive_expired = s.auto_archive_expired;
  form.email = {
    enabled: s.email.enabled,
    smtp_host: s.email.smtp_host ?? '',
    smtp_port: s.email.smtp_port ?? '',
    secure: s.email.secure ? 1 : 0,
    user: s.email.user ?? '',
    pass: s.email.pass ?? '',
    from: s.email.from ?? '',
    to: s.email.to ?? '',
  };
  form.wecom = {
    enabled: s.wecom.enabled,
    corp_id: s.wecom.corp_id ?? '',
    agent_id: s.wecom.agent_id ?? '',
    secret: s.wecom.secret ?? '',
    to_user: s.wecom.to_user ?? '',
  };
  emailPassMasked.value = s.email.pass === '***' || s.email.pass === null;
  wecomSecretMasked.value = s.wecom.secret === '***' || s.wecom.secret === null;
}

async function load(): Promise<void> {
  loading.value = true;
  formError.value = '';
  try {
    fill(await api.getSettings());
    logs.value = await api.listNotificationLogs();
    loadFailed.value = false; // 重试成功清除（I-3 移植）
  } catch (e) {
    loadFailed.value = true;
    formError.value = e instanceof Error ? e.message : '加载设置失败';
  } finally {
    loading.value = false;
  }
  await loadBackups();
}

async function loadBackups(): Promise<void> {
  backupError.value = '';
  try {
    backups.value = await api.listBackups();
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : '加载备份列表失败';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

// 体检表 P2-11：恢复二次确认改为应用内面板（与物品删除一致，弃用原生 window.confirm）
const confirmingRestore = ref(false);
const pendingRestoreFile = shallowRef<File | null>(null);

async function restore(): Promise<void> {
  backupError.value = '';
  backupOk.value = '';
  const file = restoreFile.value?.files?.[0] ?? null;
  if (!file) {
    backupError.value = '请选择要恢复的备份文件';
    return;
  }
  pendingRestoreFile.value = file;
  confirmingRestore.value = true;
}

function cancelRestore(): void {
  confirmingRestore.value = false;
  pendingRestoreFile.value = null;
}

async function confirmRestore(): Promise<void> {
  const file = pendingRestoreFile.value;
  if (!file) return;
  confirmingRestore.value = false;
  pendingRestoreFile.value = null;
  restoring.value = true;
  try {
    const result = await api.restoreBackup(file);
    backupOk.value = `恢复完成：物品 ${result.restored.items} 条，安全备份 ${result.safetyBackup}`;
    if (restoreFile.value) restoreFile.value.value = '';
    restoreFileName.value = '';
    // I-4 移植：库已被备份整体覆盖，重新拉设置回填表单；否则表单停留恢复前旧值，
    // 随后的保存会用旧值覆盖新库（load 末尾自带 loadBackups）
    await load();
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : '恢复失败';
  } finally {
    restoring.value = false;
  }
}

async function logout(): Promise<void> {
  clearStoredToken();
  await router.push('/login');
}

function validate(): string {
  const days = Number(form.default_remind_days);
  if (!Number.isInteger(days) || days <= 0) return '默认提前天数必须为正整数';
  const port = form.email.smtp_port;
  if (port !== '' && port !== null) {
    const p = Number(port);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) return 'SMTP 端口必须为 1-65535 的整数';
  }
  return '';
}

function buildPayload() {
  return {
    reminder_hour: Number(form.reminder_hour),
    default_remind_days: Number(form.default_remind_days),
    auto_archive_expired: form.auto_archive_expired ? 1 : 0,
    email: {
      enabled: form.email.enabled ? 1 : 0,
      smtp_host: form.email.smtp_host || null,
      smtp_port: form.email.smtp_port === '' ? null : Number(form.email.smtp_port),
      secure: form.email.secure ? 1 : 0,
      user: form.email.user || null,
      // 密码/Secret 语义：留空或未改动 = 不修改（提交 *** 占位，服务端保持原值）
      pass: emailPassMasked.value || form.email.pass === '' || form.email.pass === '***' ? '***' : form.email.pass,
      from: form.email.from || null,
      to: form.email.to || null,
    },
    wecom: {
      enabled: form.wecom.enabled ? 1 : 0,
      corp_id: form.wecom.corp_id || null,
      agent_id: form.wecom.agent_id || null,
      secret: wecomSecretMasked.value || form.wecom.secret === '' || form.wecom.secret === '***' ? '***' : form.wecom.secret,
      to_user: form.wecom.to_user || null,
    },
  };
}

async function save(): Promise<void> {
  // 加载失败时表单是默认值，保存会把 reminder_hour 重置 8、渠道清空（I-3 移植）→ 直接拒绝
  if (loadFailed.value) {
    formError.value = '设置加载失败，请刷新页面重试后再保存';
    return;
  }
  formError.value = validate();
  saveOk.value = '';
  if (formError.value) return;
  saving.value = true;
  try {
    fill(await api.updateSettings(buildPayload()));
    saveOk.value = '已保存';
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

async function testSend(channel: NotifyChannel): Promise<void> {
  testing.value = channel;
  testResult.value = null;
  try {
    const res = await api.notifyTest(channel);
    const r = res.results[channel];
    testResult.value = r?.ok
      ? { channel, ok: true, text: `${channel} 渠道测试发送成功` }
      : { channel, ok: false, text: `${channel} 渠道测试失败：${r?.error ?? '未知错误'}` };
  } catch (e) {
    testResult.value = { channel, ok: false, text: `测试失败：${e instanceof Error ? e.message : String(e)}` };
  } finally {
    testing.value = null;
  }
}

onMounted(() => {
  void load();
  void loadOverview();
  void loadCategories();
});
</script>

<template>
  <div class="settings">
    <header class="page-head">
      <!-- 2026-11-13 设置移出一级导航（顶栏齿轮进入），补返回导航 -->
      <BackButton />
      <h1 class="page-title">设置</h1>
      <span class="head-tail">
      <!-- 访问口令不设独立 tab（口令由部署环境变量控制，应用内无修改入口）：退出登录降级为页头动作 -->
      <button
        class="ghost-btn danger logout-btn"
        type="button"
        title="口令由部署环境变量 ACCESS_TOKEN 控制；如需更换请更新部署配置并重启服务"
        @click="logout"
      >
        退出登录
      </button>
      </span>
    </header>

    <!-- 数据概览（审查 ST-1）：备份两项仅备份 tab 显示，其他 tab 只留常驻两项 -->
    <section class="data-overview" :class="{ 'has-backup': activeTab === 'backup' }" aria-label="数据概览">
      <div class="dv-card">
        <span class="dv-label">在库物品</span>
        <span class="dv-value num">{{ stockCount }}<span class="dv-unit">件</span></span>
      </div>
      <div class="dv-card">
        <span class="dv-label">类别</span>
        <span class="dv-value num">{{ categoryCount }}<span class="dv-unit">个</span></span>
      </div>
      <div v-show="activeTab === 'backup'" class="dv-card">
        <span class="dv-label">备份文件</span>
        <span class="dv-value num">{{ backups.length }}<span class="dv-unit">份</span></span>
      </div>
      <div v-show="activeTab === 'backup'" class="dv-card">
        <span class="dv-label">最近备份</span>
        <span class="dv-value dv-time num">{{ lastBackupTime ?? '—' }}</span>
      </div>
    </section>

    <nav class="tab-nav" aria-label="设置分组导航">
      <button
        v-for="a in anchors"
        :key="a.id"
        class="tab-chip"
        :class="{ active: activeTab === a.id }"
        type="button"
        :aria-pressed="activeTab === a.id"
        @click="switchTab(a.id)"
      >
        {{ a.label }}
      </button>
    </nav>

    <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
    <p v-else-if="saveOk" class="form-ok" role="status">{{ saveOk }}</p>

    <form class="settings-form" @submit.prevent="save">
      <section id="sec-appearance" v-show="activeTab === 'appearance'" class="card">
        <h2 class="section-title">外观</h2>
        <div class="field theme-field">
          <span class="label">主题</span>
          <!-- B1：三选升级 mini 预览卡；预览用字面色不随主题翻转（预览的意义就是展示目标主题的样子） -->
          <div class="theme-cards" role="group" aria-label="主题选择">
            <button
              v-for="opt in THEME_OPTIONS"
              :key="opt.value"
              class="theme-card"
              :class="{ active: themePreference === opt.value }"
              type="button"
              :aria-pressed="themePreference === opt.value"
              @click="setThemePreference(opt.value)"
            >
              <span class="theme-preview" :class="`preview-${opt.value}`" aria-hidden="true">
                <span class="pv-title" />
                <span class="pv-line" />
                <span class="pv-line short" />
              </span>
              <span class="theme-card-label">{{ opt.label }}</span>
            </button>
          </div>
          <p class="theme-hint">
            当前生效：{{ themeResolved === 'dark' ? '深色' : '浅色' }}；跟随系统时随设备外观自动切换。
          </p>
        </div>
      </section>

      <section id="sec-remind" v-show="activeTab === 'remind'" class="card">
        <h2 class="section-title">提醒</h2>
        <label class="field">
          <span class="label">每日提醒时刻</span>
          <select id="reminder-hour" v-model.number="form.reminder_hour">
            <option v-for="h in HOURS" :key="h" :value="h">{{ String(h).padStart(2, '0') }}:00</option>
          </select>
        </label>
        <label class="field">
          <span class="label">全局默认提前天数</span>
          <input id="default-remind-days" v-model.number="form.default_remind_days" type="number" min="1" max="3650" />
        </label>
        <label class="field switch">
          <span class="label">过期物品自动归档</span>
          <input id="auto-archive" v-model="form.auto_archive_expired" type="checkbox" :true-value="1" :false-value="0" />
        </label>
      </section>

      <!-- 通知设置：应用内/邮件/企微三渠道 + 发送日志合并为一个 tab（IA 调整：渠道属性相同） -->
      <section id="sec-notify" v-show="activeTab === 'notify'" class="card">
        <h2 class="section-title">通知设置</h2>

        <!-- 应用内：固有渠道不可关闭，徽章表达状态而非像缺了开关 -->
        <div id="sec-inapp" class="channel-block">
          <div class="channel-block-head">
            <h3 class="sub-title">应用内通知</h3>
            <span class="badge tone-green">始终开启</span>
          </div>
          <p class="muted-text">提醒扫描产生的站内提醒直接出现在「通知」页，无需配置。</p>
          <button class="ghost-btn" type="button" data-channel="inapp" :disabled="testing === 'inapp'" @click="testSend('inapp')">
            发送站内测试通知
          </button>
          <p v-if="testResult?.channel === 'inapp'" class="test-result" :class="{ 'is-error': !testResult.ok }" role="status">
            {{ testResult.text }}
          </p>
        </div>

        <div id="sec-email" class="channel-block">
          <div class="channel-block-head">
            <h3 class="sub-title">邮件渠道</h3>
            <input
              id="email-enabled"
              v-model="form.email.enabled"
              class="head-toggle"
              type="checkbox"
              aria-label="启用邮件提醒"
              :true-value="1"
              :false-value="0"
            />
          </div>
        <!-- B4：未启用时配置区丝滑折叠（Grid 0fr→1fr，DOM 常驻——测试仍可直接查询字段） -->
        <div class="channel-collapse" :class="{ open: form.email.enabled === 1 }">
          <div class="channel-collapse-inner">
            <div class="channel-config">
              <h3 class="sub-title">SMTP 连接</h3>
              <label class="field">
                <span class="label">SMTP 服务器</span>
                <input id="email-smtp-host" v-model="form.email.smtp_host" type="text" placeholder="smtp.qq.com" />
              </label>
              <label class="field">
                <span class="label">端口</span>
                <input id="email-smtp-port" v-model="form.email.smtp_port" type="number" min="1" max="65535" placeholder="465" />
              </label>
              <label class="field switch">
                <span class="label">SSL/TLS</span>
                <input id="email-secure" v-model="form.email.secure" type="checkbox" :true-value="1" :false-value="0" />
              </label>
              <label class="field">
                <span class="label">账号</span>
                <input id="email-user" v-model="form.email.user" type="text" />
              </label>
              <label class="field">
                <span class="label">授权码 / 密码</span>
                <input
                  id="email-pass"
                  v-model="form.email.pass"
                  type="password"
                  placeholder="已保存，留空或 *** 表示不修改"
                  @input="emailPassMasked = false"
                />
              </label>
              <h3 class="sub-title">收发件人</h3>
              <label class="field">
                <span class="label">发件人</span>
                <input id="email-from" v-model="form.email.from" type="text" />
              </label>
              <label class="field">
                <span class="label">收件人</span>
                <input id="email-to" v-model="form.email.to" type="text" />
              </label>
              <button class="ghost-btn" type="button" data-channel="email" :disabled="testing === 'email'" @click="testSend('email')">
                发送测试邮件
              </button>
              <p v-if="testResult?.channel === 'email'" class="test-result" :class="{ 'is-error': !testResult.ok }" role="status">
                {{ testResult.text }}
              </p>
            </div>
          </div>
        </div>
      </div>

        <div id="sec-wecom" class="channel-block">
          <div class="channel-block-head">
            <h3 class="sub-title">企业微信渠道</h3>
            <input
              id="wecom-enabled"
              v-model="form.wecom.enabled"
              class="head-toggle"
              type="checkbox"
              aria-label="启用企业微信提醒"
              :true-value="1"
              :false-value="0"
            />
          </div>
        <div class="channel-collapse" :class="{ open: form.wecom.enabled === 1 }">
          <div class="channel-collapse-inner">
            <div class="channel-config">
              <label class="field">
                <span class="label">企业 ID (corpid)</span>
                <input id="wecom-corp-id" v-model="form.wecom.corp_id" type="text" />
              </label>
              <label class="field">
                <span class="label">应用 AgentId</span>
                <input id="wecom-agent-id" v-model="form.wecom.agent_id" type="text" />
              </label>
              <label class="field">
                <span class="label">应用 Secret</span>
                <input
                  id="wecom-secret"
                  v-model="form.wecom.secret"
                  type="password"
                  placeholder="已保存，留空或 *** 表示不修改"
                  @input="wecomSecretMasked = false"
                />
              </label>
              <label class="field">
                <span class="label">接收人</span>
                <input id="wecom-to-user" v-model="form.wecom.to_user" type="text" placeholder="@all" />
              </label>
              <button class="ghost-btn" type="button" data-channel="wecom" :disabled="testing === 'wecom'" @click="testSend('wecom')">
                发送测试消息
              </button>
              <p v-if="testResult?.channel === 'wecom'" class="test-result" :class="{ 'is-error': !testResult.ok }" role="status">
                {{ testResult.text }}
              </p>
            </div>
          </div>
        </div>
      </div>

        <!-- 发送日志固定显示（空数据时给空态，而非整卡消失功能不可见） -->
        <div class="channel-block">
          <h3 class="sub-title">发送日志</h3>
          <p v-if="!logs.length" class="muted-text">暂无发送记录；触发提醒扫描或发送渠道测试后，记录会出现在这里。</p>
          <ul v-else class="log-list">
            <li v-for="l in logs.slice(0, 5)" :key="l.id" class="log-item" :class="{ 'is-error': l.level === 'error' }">
              <span class="log-channel">{{ l.channel }}</span>
              <span class="log-message">{{ l.message }}</span>
            </li>
          </ul>
        </div>
      </section>

      <section id="sec-backup" v-show="activeTab === 'backup'" class="card">
        <h2 class="section-title">备份与恢复</h2>
        <!-- 左右两栏块（GitHub/Vercel settings 语言）：左列标题+说明，右列操作区；选择器保持不变 -->
        <div class="backup-block">
          <div class="block-info">
            <h3 class="block-title">创建备份</h3>
            <p class="muted-text">下载当前数据库的完整快照（SQLite 单文件）。</p>
          </div>
          <div class="block-main">
            <button
              class="ghost-btn backup-download"
              type="button"
              :disabled="downloading"
              @click="downloadBackupAction"
            >
              {{ downloading ? '下载中…' : '备份下载' }}
            </button>
          </div>
        </div>
        <div class="backup-block">
          <div class="block-info">
            <h3 class="block-title">从备份恢复</h3>
            <p class="muted-text">恢复会用所选文件覆盖当前全部数据，操作前自动生成安全备份。</p>
          </div>
          <div class="block-main">
            <!-- 用户反馈（2026-11-11）：自定义按钮与原生「选择文件」按钮重复——
                 只保留一个按钮，原生 input 视觉隐藏，选中后回显文件名 -->
            <div class="restore-field">
              <label class="ghost-btn file-pick">
                选择备份文件
                <input
                  ref="restoreFile"
                  class="restore-file"
                  type="file"
                  accept=".db,application/x-sqlite3"
                  @change="onRestoreFileChange"
                />
              </label>
              <span v-if="restoreFileName" class="file-picked num">{{ restoreFileName }}</span>
            </div>
            <button class="ghost-btn danger restore-btn" type="button" :disabled="restoring" @click="restore">
              {{ restoring ? '恢复中…' : '上传恢复' }}
            </button>
          </div>
        </div>
        <p v-if="backupError" class="backup-error form-error" role="alert">{{ backupError }}</p>
        <p v-if="backupOk" class="backup-ok form-ok" role="status">{{ backupOk }}</p>
        <div class="backup-block backup-list-wrap">
          <div class="block-info">
            <h3 class="block-title">备份文件</h3>
            <p class="muted-text">保留在服务器备份目录中，可随时用于恢复。</p>
          </div>
          <div class="block-main">
            <p v-if="!backups.length" class="muted-text">尚未创建备份；点上方「备份下载」生成第一份快照。</p>
            <ul v-else class="backup-list">
              <li v-for="b in backups" :key="b.name" class="backup-item">
                <span class="backup-name">{{ b.name }}</span>
                <span class="backup-meta">{{ formatSize(b.size) }} · {{ formatTime(b.createdAt) }}</span>
                <button
                  class="copy-btn"
                  type="button"
                  :class="{ copied: copiedName === b.name }"
                  :aria-label="`复制文件名 ${b.name}`"
                  @click="copyBackupName(b.name)"
                >
                  <!-- 铁律 10 反馈自熄：复制成功对勾 2.5s 后自动淡出恢复 -->
                  <span v-if="copiedName === b.name" class="copy-done">✓</span>
                  <span v-else>复制</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 保存只作用于提醒/邮件/企微字段；外观/类别/备份无需保存，不显示按钮 -->
      <button v-show="showSave" class="primary-btn" type="submit" :disabled="saving || loading || loadFailed">
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
    </form>

    <!-- 体检表 D-2：类别管理（列表+增改删；删除受占用保护，非保存表单一部分） -->
    <section id="sec-categories" v-show="activeTab === 'categories'" class="card">
      <h2 class="section-title">类别管理</h2>
      <p class="muted-text">用于库存分类筛选与统计分组；类别下仍有物品时不可删除。</p>
      <p v-if="categoryError" class="form-error" role="alert">{{ categoryError }}</p>
      <p v-if="categoryNotice" class="form-ok" role="status">{{ categoryNotice }}</p>

      <form class="category-add" @submit.prevent="createCategory">
        <input
          v-model="newCategoryName"
          type="text"
          aria-label="新类别名称"
          placeholder="新类别名称，如：清洁用品"
          maxlength="20"
        />
        <button class="ghost-btn" type="submit">添加</button>
      </form>

      <ul class="category-list">
        <li v-for="cat in categoryRows" :key="cat.id" class="category-item">
          <template v-if="renamingId === cat.id">
            <input
              v-model="renamingName"
              class="rename-input"
              type="text"
              aria-label="修改类别名称"
              maxlength="20"
              @keyup.enter="submitRename"
            />
            <button class="ghost-btn" type="button" @click="submitRename">保存</button>
            <button class="link-btn" type="button" @click="renamingId = null">取消</button>
          </template>
          <template v-else>
            <span class="category-name">{{ cat.name }}</span>
            <span class="category-count num" aria-label="占用物品数（含归档）">{{ usageOf(cat.id) }} 件</span>
            <button class="ghost-btn" type="button" @click="startRename(cat)">改名</button>
            <button class="ghost-btn danger" type="button" @click="deleteCategory(cat)">删除</button>
          </template>
        </li>
      </ul>
      <p v-if="categoryRows.length === 0 && !categoryError" class="muted-text">还没有类别，添加第一个吧。</p>
    </section>

    <!-- 体检表 P2-11：恢复确认面板（与物品删除同款交互语言） -->
    <div v-if="confirmingRestore" class="mask" @click.self="cancelRestore">
      <div class="panel" role="dialog" aria-label="确认恢复备份">
        <h2 class="panel-title">确认恢复备份？</h2>
        <p class="confirm-text">
          将用「{{ pendingRestoreFile?.name }}」覆盖当前全部数据（恢复前会自动生成安全备份）。
        </p>
        <div class="confirm-actions">
          <button class="ghost-btn" type="button" @click="cancelRestore">取消</button>
          <button class="ghost-btn danger-btn" type="button" @click="confirmRestore">确认恢复</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 页面收窄：矮卡 tab（外观/应用内/备份/口令）在 1280 全宽下右侧大片留白，960 居中收敛 */
.settings {
  max-width: 960px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: baseline;
  gap: 12px; /* 2026-11-13 设置移出一级导航：返回+标题左对齐（同归档/通知页语言） */
  margin-bottom: 16px;
}
.head-tail {
  margin-left: auto;
}
.card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 14px;
  margin-bottom: 14px;
  display: grid;
  gap: 10px;
}
.section-title {
  font-size: 14px;
  font-weight: var(--fw-semibold);
  color: var(--color-text);
  margin: 0 0 2px;
}
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}
.field .label {
  color: var(--color-muted);
  flex: none;
}
.field input[type='text'],
.field input[type='number'],
.field input[type='password'],
.field select {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--radius-m);
  font: inherit;
  color: var(--color-text);
}
/* Toggle 开关（A2）：appearance:none 自绘药丸滑块，保持 input 语义。
   滑块用 --color-on-ink 而非白：暗色下 checked 轨道是亮色（--color-ink 反白），白滑块会没进底色 */
.field.switch input[type='checkbox'] {
  appearance: none;
  flex: none;
  width: 40px;
  height: 22px;
  margin: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-track);
  position: relative;
  cursor: pointer;
  transition: background 180ms ease-out;
}
.field.switch input[type='checkbox']::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 180ms ease-out;
}
.field.switch input[type='checkbox']:checked {
  background: var(--color-ink);
}
.field.switch input[type='checkbox']:checked::after {
  transform: translateX(18px);
  background: var(--color-on-ink);
}
.field.switch input[type='checkbox']:disabled {
  opacity: 0.45;
  cursor: default;
}
/* 全局双环 focus 只覆盖 button/a，checkbox 需自带（铁律 2） */
.field.switch input[type='checkbox']:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 1.2px var(--color-ink),
    0 0 0 4.5px var(--ring-outer);
}
.ghost-btn {
  background: var(--color-field);
  border-radius: var(--radius-m);
  padding: 8px 14px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  transition: background 150ms ease-out;
}
.ghost-btn:hover {
  background: var(--color-hover);
}
.ghost-btn:active {
  transform: scale(0.98);
}
/* 卡片 grid 内的操作按钮：右对齐固定宽（选择器限定直接子元素，
   不误伤类别行/添加行等 flex 容器里的小按钮；渠道配置区按钮在 .channel-config 内单独列出） */
.card > .ghost-btn,
.channel-config > .ghost-btn {
  justify-self: end;
  min-width: 128px;
  text-align: center;
}
.primary-btn {
  display: block;
  margin-left: auto;
  width: auto;
  min-width: 160px;
  background: var(--color-ink);
  color: var(--color-on-ink);
  border: none;
  border-radius: var(--radius-m);
  padding: 10px 20px;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
}
.primary-btn:active {
  transform: scale(0.98);
}
@media (max-width: 767px) {
  .primary-btn {
    width: 100%;
    margin-left: 0;
  }
}
.form-error {
  color: var(--tone-red-fg);
  font-size: 14px;
  padding: 8px 0;
}
.form-ok {
  color: var(--tone-green-fg);
  font-size: 14px;
  padding: 8px 0;
}
.test-result {
  font-size: 13px;
  padding: 8px 0;
  color: var(--tone-green-fg);
}
.test-result.is-error {
  color: var(--tone-red-fg);
}
.muted-text {
  color: var(--color-muted);
  font-size: 13px;
  margin: 0;
}
/* 渠道状态徽章（应用内通知 head 右侧） */
.channel-block-head .badge {
  flex: none;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
}
.badge.tone-green {
  background: var(--tone-green-bg);
  color: var(--tone-green-fg);
}
.sub-title {
  font-size: 13px;
  font-weight: var(--fw-semibold);
  color: var(--color-muted);
  margin: 4px 0 0;
}
.backup-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
/* 子块底座：备份与通知渠道共用（canvas 色在 surface 卡片上的明度分层，铁律 1 不加边框） */
.backup-block,
.channel-block {
  padding: 14px 16px;
  background: var(--color-canvas);
  border-radius: var(--radius-l);
}
.channel-block {
  display: grid;
  gap: 8px;
}
.channel-block .sub-title {
  margin: 0;
}
.channel-block > .ghost-btn {
  justify-self: end;
  min-width: 128px;
  text-align: center;
}
/* 备份块：左右两栏——左列标题+说明（语义组），右列操作区，横向填满不留空 */
.backup-block {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 4px 24px;
}
.block-info {
  display: grid;
  gap: 4px;
  align-content: start;
}
.block-title {
  font-size: 14px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
  margin: 0;
}
.block-main {
  display: grid;
  gap: 10px;
  align-content: start;
}
.block-main .ghost-btn {
  justify-self: start;
  min-width: 128px;
  text-align: center;
}
.restore-field {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
/* 选择备份文件按钮（原生 file input 视觉隐藏，label 触发点击） */
.file-pick {
  justify-self: start;
  min-width: 128px;
  text-align: center;
  cursor: pointer;
}
/* sr-only：保留可聚焦/可访问，仅视觉隐藏（不再渲染 UA「选择文件」按钮） */
.restore-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  clip-path: inset(50%);
}
.file-picked {
  font-size: 13px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
@media (max-width: 767px) {
  .backup-block {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
/* 渠道子块标题行：渠道名左，启用开关/状态徽章右 */
.channel-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
/* head-toggle：渠道标题行右侧的开关（与 .field.switch 内的 toggle 同视觉） */
.head-toggle {
  appearance: none;
  flex: none;
  width: 40px;
  height: 22px;
  margin: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-track);
  position: relative;
  cursor: pointer;
  transition: background 180ms ease-out;
}
.head-toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 180ms ease-out;
}
.head-toggle:checked {
  background: var(--color-ink);
}
.head-toggle:checked::after {
  transform: translateX(18px);
  background: var(--color-on-ink);
}
.head-toggle:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 1.2px var(--color-ink),
    0 0 0 4.5px var(--ring-outer);
}
/* B4/B5 渠道折叠：铁律 7 Grid 0fr→1fr。裁剪层独立（inner 带 overflow），
   内层 .channel-config 的 padding 在裁剪层之内，0fr 时整体收起不漏 */
.channel-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 260ms cubic-bezier(0.215, 0.61, 0.355, 1);
}
.channel-collapse > .channel-collapse-inner {
  overflow: hidden;
  min-height: 0;
}
.channel-collapse.open {
  grid-template-rows: 1fr;
}
.channel-config {
  display: grid;
  gap: 10px;
  padding-top: 12px;
}
.backup-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-m);
  background: var(--color-canvas);
}
.backup-name {
  font-size: 13px;
  color: var(--color-text);
  word-break: break-all;
}
.backup-meta {
  font-size: 12px;
  color: var(--color-muted);
}
/* file input：padding 撑高容器（否则 UA 按钮上下裁边）；::file-selector-button
   接管「选择文件」为全站按钮语言（Chrome/Edge/Firefox 均支持），暗色随令牌翻转 */
.restore-file {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  padding: 4px 8px;
  color: var(--color-muted);
  cursor: pointer;
}
.restore-file::file-selector-button {
  border: none;
  background: var(--color-hover);
  border-radius: var(--radius-s);
  padding: 6px 12px;
  margin-right: 10px;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  transition: background 150ms ease-out;
}
.restore-file::file-selector-button:hover {
  background: var(--color-track);
}
.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.log-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--color-muted);
}
.log-channel {
  flex: none;
  font-weight: var(--fw-semibold);
  color: var(--color-muted);
}
.log-item.is-error .log-channel {
  color: var(--tone-red-fg);
}
.log-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
<style scoped>
/* 数据概览条 + 锚点导航（PC 充实化） */
.data-overview {
  display: grid;
  /* 审查 ST-1：非备份 tab 只有 2 常驻卡，备份 tab 4 卡 */
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.data-overview.has-backup {
  grid-template-columns: repeat(4, 1fr);
}
/* 审查 ST-2：提醒字段内容短（时刻/天数），收窄至可读比例 */
#sec-remind .field input,
#sec-remind .field select {
  max-width: 280px;
}
.dv-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dv-label {
  font-size: 12px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dv-value {
  font-size: 20px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
}
.dv-unit {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
  margin-left: 2px;
}
.dv-time {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.tab-chip {
  background: var(--color-field);
  border-radius: var(--radius-pill);
  padding: 5px 14px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
}
.tab-chip:hover {
  background: var(--color-hover);
  color: var(--color-text);
}
.tab-chip.active {
  background: var(--color-ink);
  color: var(--color-on-ink);
}
.tab-chip.active:hover {
  background: var(--color-ink-hover);
}
@media (max-width: 767px) {
  .data-overview {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
<style scoped>
/* 铁律 10 复制反馈自熄：对勾淡出恢复 */
.copy-btn {
  flex: none;
  border: none;
  background: var(--color-field);
  border-radius: var(--radius-s);
  padding: 3px 9px;
  font-size: 12px;
  color: var(--color-muted);
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
}
.copy-btn:hover {
  background: var(--color-hover);
  color: var(--color-text);
}
.copy-btn.copied {
  background: var(--tone-green-bg);
  color: var(--tone-green-fg);
}
.copy-done {
  display: inline-block;
  animation: copy-fade-in 160ms cubic-bezier(0.215, 0.61, 0.355, 1);
}
/* 对勾在 2.5s 定时器触发前 400ms 开始淡出，恢复为"复制" */
.copy-btn.copied .copy-done {
  animation:
    copy-fade-in 160ms cubic-bezier(0.215, 0.61, 0.355, 1),
    copy-fade-out 400ms ease-in 2100ms forwards;
}
@keyframes copy-fade-in {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes copy-fade-out {
  to {
    opacity: 0;
  }
}
</style>
<style scoped>
/* 外观卡片：主题三选 mini 预览卡 + 生效提示 */
.theme-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.theme-card {
  display: grid;
  gap: 6px;
  padding: 6px;
  background: none;
  border: none;
  border-radius: var(--radius-m);
  cursor: pointer;
  justify-items: start;
}
.theme-card-label {
  font-size: 13px;
  color: var(--color-muted);
}
.theme-card:hover .theme-card-label {
  color: var(--color-text);
}
.theme-card.active .theme-card-label {
  color: var(--color-ink);
  font-weight: var(--fw-semibold);
}
/* active 描边落在预览块上，比整卡描边更聚焦 */
.theme-card.active .theme-preview {
  box-shadow: 0 0 0 2px var(--color-ink);
}
/* 预览块：字面色固定，不随当前主题翻转 */
.theme-preview {
  display: grid;
  gap: 4px;
  align-content: start;
  width: 96px;
  height: 64px;
  padding: 8px;
  box-sizing: border-box;
  border-radius: var(--radius-s);
  transition: box-shadow 150ms ease-out;
}
.pv-title {
  width: 60%;
  height: 8px;
  border-radius: 2px;
}
.pv-line {
  width: 85%;
  height: 5px;
  border-radius: 2px;
}
.pv-line.short {
  width: 55%;
}
.preview-light {
  background: #fcfcfb;
  box-shadow: inset 0 0 0 1px #e2e1dd;
}
.preview-light .pv-title {
  background: #111110;
}
.preview-light .pv-line {
  background: #e2e1dd;
}
.preview-dark {
  background: #151515;
  box-shadow: inset 0 0 0 1px #2a2a28;
}
.preview-dark .pv-title {
  background: #fcfcfb;
}
.preview-dark .pv-line {
  background: #2a2a28;
}
.preview-system {
  background: linear-gradient(90deg, #fcfcfb 50%, #151515 50%);
  box-shadow: inset 0 0 0 1px #e2e1dd;
}
.preview-system .pv-title {
  background: linear-gradient(90deg, #111110 50%, #fcfcfb 50%);
}
.preview-system .pv-line {
  background: linear-gradient(90deg, #e2e1dd 50%, #2a2a28 50%);
}
.theme-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-muted);
}
.field .label {
  display: block;
  margin-bottom: 6px;
}
/* 体检表 P1-3：主题行 label 左 / 预览卡右，hint 收到下一行整行；B1 后并入栅格 */
.theme-field {
  flex-wrap: wrap;
  justify-content: flex-start;
}
.theme-field .label {
  margin-bottom: 0;
  flex: 0 0 150px;
}
.theme-field .theme-hint {
  flex-basis: 100%;
  margin-top: 2px;
}
@media (max-width: 767px) {
  .theme-field .label {
    flex-basis: auto;
  }
}
</style>
<style scoped>
/* 体检表 P2-6：设置表单控件收窄（卡片保持全宽；开关类保持右置惯例） */
.settings-form .field:not(.switch):not(.theme-field) {
  justify-content: flex-start;
}
.settings-form .field:not(.switch) input,
.settings-form .field:not(.switch) select {
  flex: 0 1 560px;
  margin-left: var(--space-3);
}
/* 输入框栅格对齐：label 定宽列，控件起点统一——左缘右缘双对齐，消除长短锯齿 */
.settings-form .field:not(.switch):not(.theme-field) .label {
  flex: 0 0 150px;
}
/* A4 开关行并入栅格：toggle 紧随 label，不再 space-between 贴卡片右缘 */
.settings-form .field.switch {
  justify-content: flex-start;
}
.settings-form .field.switch .label {
  flex: 0 0 150px;
}
@media (max-width: 767px) {
  .settings-form .field:not(.switch):not(.theme-field) .label,
  .settings-form .field.switch .label {
    flex-basis: auto; /* 窄屏回落自然宽，避免挤压控件 */
  }
}
</style>
<style scoped>
/* 体检表 P2-11：恢复确认面板（与 ItemDetailView 同款语言） */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
  z-index: 50;
}
.panel {
  width: min(420px, calc(100vw - 32px));
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 18px;
  display: grid;
  gap: 10px;
}
.panel-title {
  font-size: 16px;
  margin: 0;
}
.confirm-text {
  margin: 0;
  font-size: 13px;
  color: var(--color-muted);
  overflow-wrap: anywhere;
}
.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.confirm-actions .ghost-btn {
  border-radius: var(--radius-s);
  padding: 8px 14px;
  font-size: 14px;
}
.danger-btn {
  background: var(--tone-red-bg);
  color: var(--tone-red-fg);
}
.danger-btn:hover {
  background: var(--tone-red-fg);
  color: var(--tone-red-bg);
}
</style>
<style scoped>
/* 类别管理卡（D-2） */
.category-add {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.category-add input {
  flex: 0 1 560px;
  min-width: 0;
  padding: 8px 12px;
}
@media (max-width: 767px) {
  .category-add input {
    flex: 1;
  }
}
.category-add .ghost-btn {
  flex: none;
  padding: 8px 14px;
}
.category-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.category-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-field);
  border-radius: var(--radius-m);
  font-size: 14px;
}
.category-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.category-count {
  flex: none;
  font-size: 12px;
  color: var(--color-muted);
}
.category-item .ghost-btn {
  flex: none;
  padding: 4px 10px;
  font-size: 12px;
}
/* 危险操作通用（类别删除 / 备份恢复 / 退出登录共用） */
.ghost-btn.danger {
  color: var(--tone-red-fg);
}
.rename-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
}
.ghost-btn.danger:hover {
  background: var(--tone-red-bg);
}
</style>
