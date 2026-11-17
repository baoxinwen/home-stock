/**
 * 弹层焦点管理 composable（评审 A-M1/A-M2）：
 * 打开移焦进面板 + 背景 inert、面板级 Escape 逐层关闭、关闭还原触发点（丢失回退 fallback）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useOverlayA11y } from './useOverlayA11y';

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useOverlayA11y', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    document.title = '';
  });

  it('open 变 true：移焦进面板、#app 置 inert；Escape 触发 close', async () => {
    const open = ref(false);
    const close = vi.fn();
    const Host = defineComponent({
      template: `<div><button id="trigger">打开</button><div v-if="open" ref="panel" tabindex="-1" role="dialog">面板</div></div>`,
      setup() {
        const panel = ref<HTMLElement | null>(null);
        useOverlayA11y({ panel, close, open });
        return { panel, open };
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    (document.querySelector('#trigger') as HTMLElement).focus();
    expect(document.activeElement?.id).toBe('trigger');

    open.value = true;
    await flush();
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(panel);
    expect(document.getElementById('app')?.inert).toBe(true);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);

    open.value = false;
    await flush();
    expect(document.getElementById('app')?.inert).toBe(false);
    expect(document.activeElement?.id).toBe('trigger');
    wrapper.unmount();
  });

  it('触发点已随行移除时回退 fallbackFocus 选择器', async () => {
    const open = ref(false);
    const Host = defineComponent({
      template: `<div><ul id="list"><li>行</li></ul><div v-if="open" ref="panel" tabindex="-1">面板</div></div>`,
      setup() {
        const panel = ref<HTMLElement | null>(null);
        useOverlayA11y({ panel, close: () => {}, open, fallbackFocus: '#list' });
        return { panel, open };
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const trigger = document.createElement('button');
    document.querySelector('#list')?.appendChild(trigger);
    trigger.focus();

    open.value = true;
    await flush();
    trigger.remove(); // 行随操作移除
    open.value = false;
    await flush();
    expect((document.activeElement as HTMLElement).id).toBe('list');
    wrapper.unmount();
  });

  it('省略 open（v-if 整组件弹层）：挂载即激活，卸载还原焦点并解除 inert', async () => {
    const close = vi.fn();
    const Panel = defineComponent({
      template: `<div ref="panel" tabindex="-1" role="dialog">恢复面板</div>`,
      setup() {
        const panel = ref<HTMLElement | null>(null);
        useOverlayA11y({ panel, close });
        return { panel };
      },
    });
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const wrapper = mount(Panel, { attachTo: document.body });
    await flush();
    expect(document.getElementById('app')?.inert).toBe(true);
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');

    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    await flush();
    expect(document.getElementById('app')?.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('open 初始 false 的实例初始化不得解除他人已设的 inert（嵌套回归）', async () => {
    document.getElementById('app')?.focus();
    // 模拟抽屉已开：先手工置 inert（引用计数 +1 的外部等价物）
    const app = document.getElementById('app') as HTMLElement;
    app.inert = true;
    const closed = ref(false);
    const open = ref(false); // DetailContent 形态：面板未开
    const Child = defineComponent({
      template: `<div><div ref="panel" tabindex="-1" v-if="open">内层</div></div>`,
      setup() {
        const panel = ref<HTMLElement | null>(null);
        useOverlayA11y({ panel, close: () => (closed.value = true), open });
        return { panel, open };
      },
    });
    const wrapper = mount(Child, { attachTo: document.body });
    await flush();
    // 初始化（immediate watch 首跑 open=false）不得解除外层 inert
    expect(app.inert).toBe(true);
    wrapper.unmount();
    await flush();
    // 卸载同样不触碰（从未激活过）
    expect(app.inert).toBe(true);
    app.inert = false;
  });

  it('Tab 在面板末尾环绕回首元素，不落 body 死区（A-M1 实测复现的回归）', async () => {
    const Panel = defineComponent({
      template: `<div ref="panel" tabindex="-1" role="dialog"><button id="a">甲</button><button id="b">乙</button></div>`,
      setup() {
        const panel = ref<HTMLElement | null>(null);
        useOverlayA11y({ panel, close: () => {} });
        return { panel };
      },
    });
    const wrapper = mount(Panel, { attachTo: document.body });
    await flush();
    const a = document.querySelector('#a') as HTMLElement;
    const b = document.querySelector('#b') as HTMLElement;
    b.focus();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(a);
    // 首元素 Shift+Tab 环绕回末元素
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(b);
    wrapper.unmount();
  });

  it('内层面板 Escape stopPropagation：外层（window 气泡）不响应', async () => {
    const innerClose = vi.fn();
    const outerClose = vi.fn();
    const open = ref(true);
    window.addEventListener('keydown', outerClose);
    const Host = defineComponent({
      template: `<div><div v-if="open" ref="panel" tabindex="-1">内层</div></div>`,
      setup() {
        const panel = ref<HTMLElement | null>(null);
        useOverlayA11y({ panel, close: innerClose, open });
        return { panel, open };
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await flush();
    const panel = wrapper.find('[tabindex="-1"]') as ReturnType<typeof wrapper.find>;
    (panel.element as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outerClose);
    wrapper.unmount();
  });
});
