/**
 * 录入/编辑表单 composable：类别加载、生产日期+保质期→过期日换算、历史复制。
 */
import { computed, ref } from 'vue';
import type { CategoryDto, ItemCreateDto, ItemDto, ItemHistoryDto } from '@home-stock/shared';
import { api } from '../api';
import { computeExpiryFromShelfLife } from '../lib/expiry-input';
import { todayISO } from '../lib/dates';
import { useDebounced } from '../lib/debounce';

/** 过期方式：direct=直接填日期 / shelf=生产日期+保质期天数 / none=长期存储品（显式声明，不参与提醒） */
export type ExpiryMode = 'direct' | 'shelf' | 'none';

export interface ItemFormModel {
  name: string;
  categoryId: number | null;
  quantity: number;
  unit: string;
  purchaseDate: string;
  price: string;
  expiryMode: ExpiryMode;
  expiryDate: string;
  productionDate: string;
  shelfLifeDays: string;
  openShelfDays: string;
  remindDays: string;
  /** 最少库存（选填，D-1）：低于此值时库存页/清单页给低库存提示 */
  minQuantity: string;
  /** 编辑态：是否已开封（保存时 opened=1，server 记录开封日为当日） */
  opened: boolean;
}

export function emptyForm(): ItemFormModel {
  return {
    name: '',
    categoryId: null,
    quantity: 1,
    unit: '',
    purchaseDate: todayISO(),
    price: '',
    expiryMode: 'direct',
    expiryDate: '',
    productionDate: '',
    shelfLifeDays: '',
    openShelfDays: '',
    remindDays: '',
    minQuantity: '',
    opened: false,
  };
}

/** 编辑态：用 ItemDto 回填表单。 */
export function formFromItem(item: ItemDto): ItemFormModel {
  return {
    name: item.name,
    categoryId: item.categoryId,
    quantity: item.quantity,
    unit: item.unit ?? '',
    purchaseDate: item.purchaseDate ?? '',
    price: item.price === null ? '' : String(item.price),
    // 无过期日 → 初始落在「长期存储」档（显式声明语义；想补日期切回日期档）
    expiryMode: item.expiryDate ? 'direct' : 'none',
    expiryDate: item.expiryDate ?? '',
    productionDate: '',
    shelfLifeDays: '',
    openShelfDays: item.openShelfDays === null ? '' : String(item.openShelfDays),
    remindDays: item.remindDays === null ? '' : String(item.remindDays),
    minQuantity: item.minQuantity === null ? '' : String(item.minQuantity),
    opened: Boolean(item.opened),
  };
}

export function useItemForm(existing: ItemDto | null = null) {
  const form = ref<ItemFormModel>(existing ? formFromItem(existing) : emptyForm());
  const categories = ref<CategoryDto[]>([]);
  const history = ref<ItemHistoryDto[]>([]);
  const historyOpen = ref(false);
  const historyQuery = ref('');
  const saving = ref(false);
  const error = ref('');

  const computedExpiry = computed<string>(() =>
    form.value.expiryMode === 'shelf'
      ? (computeExpiryFromShelfLife(
          form.value.productionDate || null,
          form.value.shelfLifeDays === '' ? null : Number(form.value.shelfLifeDays),
        ) ?? '')
      : form.value.expiryDate,
  );

  async function loadCategories(): Promise<void> {
    try {
      categories.value = await api.listCategories();
    } catch {
      /* 不阻塞表单 */
    }
  }

  const debouncedHistory = useDebounced((q: string) => {
    void loadHistory(q);
  }, 300);

  async function loadHistory(q = ''): Promise<void> {
    try {
      history.value = await api.listHistory(q);
    } catch {
      history.value = [];
    }
  }

  function openHistory(): void {
    historyOpen.value = true;
    if (history.value.length === 0) void loadHistory();
  }

  function closeHistory(): void {
    historyOpen.value = false;
  }

  function onHistorySearch(v: string): void {
    historyQuery.value = v;
    debouncedHistory(v);
  }

  /** 选中历史物品 → 带入模板字段（不含数量/日期）。 */
  function applyHistory(h: ItemHistoryDto): void {
    form.value.name = h.name;
    form.value.categoryId = h.categoryId;
    form.value.unit = h.unit ?? '';
    form.value.price = h.price === null ? '' : String(h.price);
    if (h.expiryDate) {
      form.value.expiryMode = 'direct';
      form.value.expiryDate = h.expiryDate;
    } else {
      // 历史模板无过期日（长期存储品）→ 落「长期存储」档
      form.value.expiryMode = 'none';
      form.value.expiryDate = '';
    }
    form.value.openShelfDays = h.openShelfDays === null ? '' : String(h.openShelfDays);
    form.value.remindDays = h.remindDays === null ? '' : String(h.remindDays);
    historyOpen.value = false;
  }

  /** 校验并组装 create/update 请求体。 */
  function toPayload(): { ok: true; payload: ItemCreateDto } | { ok: false; message: string } {
    const f = form.value;
    if (!f.name.trim()) return { ok: false, message: '名称必填' };
    // 过期方式三档：none 显式声明长期存储（null）；direct/shelf 档算不出有效日期一律拦截，
    // 杜绝「漏填静默降级为长期品」——null 只能来自用户显式选择
    const expiry =
      f.expiryMode === 'none'
        ? null
        : f.expiryMode === 'shelf'
          ? computeExpiryFromShelfLife(f.productionDate || null, f.shelfLifeDays === '' ? null : Number(f.shelfLifeDays))
          : f.expiryDate || null;
    if (f.expiryMode === 'shelf' && !expiry) {
      return { ok: false, message: '请填写生产日期和保质期时长' };
    }
    if (f.expiryMode === 'direct' && !expiry) {
      return { ok: false, message: '请填写过期日期，或改选长期存储' };
    }
    const numOrNull = (v: string): number | null => (v === '' ? null : Number(v));
    // 数量：空串默认 1，0 合法保留，非数字报校验错误（不许 || 1 吞掉 0）
    const quantityRaw = String(f.quantity ?? '').trim();
    const quantity = quantityRaw === '' ? 1 : Number(quantityRaw);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return { ok: false, message: '数量必须为非负数字' };
    }
    const payload: ItemCreateDto & { opened?: number } = {
      name: f.name.trim(),
      categoryId: f.categoryId,
      purchaseDate: f.purchaseDate || null,
      quantity,
      unit: f.unit.trim() || null,
      price: numOrNull(f.price),
      expiryDate: expiry,
      openShelfDays: numOrNull(f.openShelfDays),
      remindDays: numOrNull(f.remindDays),
      minQuantity: numOrNull(f.minQuantity),
    };
    // 开封开关仅编辑态出现：勾选 → opened:1（server 记当日开封日），取消 → opened:0（server 清空开封日）
    if (f.opened) payload.opened = 1;
    else payload.opened = 0;
    return { ok: true, payload };
  }

  return {
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
  };
}
