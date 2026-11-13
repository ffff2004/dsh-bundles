# Changesets

用户可见的 bundle 改动随 PR 提交 changeset：运行 `pnpm changeset`，选择包、升级级别并描述用户影响；普通功能 PR 不直接改版本。纯测试、文档或工具改动无需空 changeset。

包独立使用 SemVer。提示词、默认行为、权限和宿主兼容要求也属于用户契约；破坏性变化使用 major 并写迁移方式。不要从 Conventional Commits 自动推断版本。

版本、changelog 与发布由 Release PR 驱动，流程及失败重试见[发布说明](<../plugin-market-publishing.md>)。
