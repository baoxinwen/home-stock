# Changelog

所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/cn/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/cn/)。

## [1.0.0] - 2026-11-11

首个正式版本。

### Added

- 物品库存：CRUD、开封/归档/恢复（恢复去向面板）、低库存阈值与待补过期日、桌面同名聚合、移动端聚合、行内步进与开封切换（含 in-flight 守卫）
- 购物清单：增改勾选、转库存（含批量）、低库存建议（数量 ≤ 阈值）、添加防重复提交
- 统计仪表盘：浪费/入库双柱对比、库存健康（保质期分布 + 状态环形）、价值 Top 排行、损耗率、按类别分布（环形图）、KPI 环比
- 通知三态收件箱（unread → read → done）：临期/过期提醒、应用内/邮件/企业微信三渠道、铃铛轻量下拉、行内快捷归档按类型分流、终身一次去重
- 设置页分组标签化：主题切换（浅/深/跟随系统）、提醒阈值、渠道配置与测试发送、类别管理（创建排序排末尾、占用计数含归档）
- 安全：访问口令门控（fail-closed + 常量时间比较）、秘密脱敏、备份/恢复（安全备份与回滚、并发锁）、每日定时提醒扫描与错过补扫
- 部署：单容器 Docker 镜像、docker-compose、Caddy HTTPS 示例、健康检查
- 测试：三端单测（shared/server/web）+ 双视口 Playwright 系统测试

[1.0.0]: https://github.com/baoxinwen/home-stock/releases/tag/v1.0.0
