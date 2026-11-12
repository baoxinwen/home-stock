"""四屏渲染验证脚本（Playwright）：无 console 错误 + 截图证据。

用法（先起 server :3000 与 vite dev :5173）：
    python apps/web/scripts/verify-four-screens.py
截图输出到 .superpowers-shots/。
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = 'http://localhost:5173'
OUT = pathlib.Path(__file__).resolve().parents[3] / '.superpowers-shots'
OUT.mkdir(exist_ok=True)

errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 420, 'height': 860})
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))

    # 库存主屏
    page.goto(BASE + '/', wait_until='networkidle')
    page.wait_for_timeout(800)
    page.screenshot(path=str(OUT / 'inventory.png'), full_page=True)

    # 录入屏（含生产日期+保质期换算、历史复制弹层）
    page.goto(BASE + '/items/new', wait_until='networkidle')
    page.wait_for_timeout(500)
    page.fill('input[type="text"]', '挂面')
    page.locator('button.chip', has_text='生产日期 + 保质期').click()
    dates = page.locator('input[type="date"]')
    dates.nth(1).fill('2026-10-01')
    page.locator('input[type="number"][min="1"]').first.fill('90')
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / 'form.png'), full_page=True)
    page.locator('button', has_text='从历史复制').click()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / 'form-history.png'))
    page.locator('button', has_text='关闭').first.click()

    # 详情屏 + 归档弹层 + 删除确认
    page.goto(BASE + '/', wait_until='networkidle')
    page.wait_for_timeout(600)
    cards = page.locator('.item-card-btn')
    if cards.count():
        cards.first.click()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / 'detail.png'), full_page=True)
        page.locator('button', has_text='归档').click()
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / 'detail-archive.png'))
        page.locator('button', has_text='取消').first.click()
        page.locator('button', has_text='删除').click()
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / 'detail-delete.png'))
        page.locator('button', has_text='取消').first.click()

    # 归档屏
    page.goto(BASE + '/archive', wait_until='networkidle')
    page.wait_for_timeout(600)
    page.screenshot(path=str(OUT / 'archive.png'), full_page=True)

    # 占位屏
    page.goto(BASE + '/stats', wait_until='networkidle')
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / 'placeholder.png'))

    browser.close()

print('CONSOLE_ERRORS:', len(errors))
for e in errors:
    print('ERR:', e)
sys.exit(0)
