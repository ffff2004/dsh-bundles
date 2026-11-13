---
"@ffff2004-dsh-packages/background-wait-guidance": patch
"@ffff2004-dsh-packages/codex-live": patch
"@ffff2004-dsh-packages/shell-description": patch
"@ffff2004-dsh-packages/lean-preset": patch
"@ffff2004-dsh-packages/preview-download": patch
"@ffff2004-dsh-packages/preview-path": patch
"@ffff2004-dsh-packages/shell-timeout-guidance": patch
"@ffff2004-dsh-packages/skill-name-mapping": patch
"@ffff2004-dsh-packages/zotero-select": patch
---

以 `@ffff2004-dsh-packages/` scope 和不含 `dsh-` 前缀的新包名首次发布，纳入当前尚未发布的改进。新名称是独立包身份，不提供旧 `@local/dsh-*` 名称的兼容入口或自动迁移；旧用户需移除旧包及配置引用，再安装并配置新包，避免重复加载。原有版本历史不转移至新身份，后续版本独立递增。
