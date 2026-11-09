---
"@ffff2004-dsh-bundles/background-wait-guidance": patch
"@ffff2004-dsh-bundles/codex-live": patch
"@ffff2004-dsh-bundles/shell-description": patch
"@ffff2004-dsh-bundles/lean-preset": patch
"@ffff2004-dsh-bundles/preview-download": patch
"@ffff2004-dsh-bundles/preview-path": patch
"@ffff2004-dsh-bundles/shell-timeout-guidance": patch
"@ffff2004-dsh-bundles/skill-name-mapping": patch
"@ffff2004-dsh-bundles/zotero-select": patch
---

将九个 bundle 从历史 `@local/dsh-<name>` 身份迁移到 `@ffff2004-dsh-bundles/<name>`，同步模块注册与自引用；目录与插件行稳定 ID 不变。改名视为新身份，沿用各包独立版本线，不重置版本或强制 major。

升级时先卸载旧 bundle，再安装新身份，避免重复加载。未来新市场不保留旧 `@local` 条目；旧 Git tags 不删除也不补打。
