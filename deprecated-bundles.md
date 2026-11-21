# 已弃用的 Bundle

本页列出已停止维护的 bundle，以及弃用与恢复维护的操作流程。弃用是软弃用：源码、历史版本和 release tags 保留，现有安装继续可用；不再计划兼容性修复或功能更新。

## 清单

- [background-wait-guidance](<background-wait-guidance/README.md>)
- [zotero-select](<zotero-select/README.md>)
- [shell-timeout-guidance](<shell-timeout-guidance/README.md>)

这些 bundle 仍会出现在插件市场，历史版本仍可安装。市场条目和已安装列表中的标题以 `【已弃用】` / `[Deprecated]` 开头；标题前缀只随新版本发布进入市场和已安装副本，旧版本仍显示旧标题，也不会收到运行时警告。

## 弃用流程

1. 在 bundle 的 `locale` 中给 bundle 标题及所有子条目标题加 `【已弃用】` / `[Deprecated]` 前缀；`meta.description` 不变。子条目读取各自目录下的 locale，不会继承 bundle 级标题。
2. 在 bundle README 的 H1 下加弃用说明：停止维护、最后验证的 DSH 版本、替代 bundle（没有则明确写“无”）、历史版本与 tags 保留，并链接本页。
3. 从根 [README](<README.md>) 的 Bundle 列表移除该 bundle，同时在本页清单新增一行。
4. 提交 patch changeset：插件市场元数据更新需要发布新版本。合并后由 Release PR 发布最后一个版本。
5. 此后不再为该 bundle 提交 changeset 或发版；不删除源码目录，不移动或复用历史 tags。
6. 弃用 bundle 继续参与 `pnpm lint` 与 `pnpm -r test`；若因工具链升级失败，再单独决定是否移除。
7. 只有安全或数据损坏问题时才考虑运行时停用、市场过滤等硬弃用；先单独评审。
8. 恢复维护时反向执行：移除标题前缀与 README 说明、回到根 Bundle 列表、从本页删除，并发布新版本。
