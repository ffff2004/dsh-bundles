place local DSH (DeepSeek Harness) bundles here.

当 README 过时时，及时更新（包括根 README 和各 bundle 的子 README）。

依赖声明遵循根 README「本地开发」中的约定（peer + dev 共享宿主实例、engines.dsh 声明兼容范围）；新增或移动 bundle 目录时同步更新 `pnpm-workspace.yaml` 的 `packages`，市场生成器依赖这些 glob 发现 bundle。

如有需要，可以参考本地 DSH 源码 checkout。

use conventional commit `<type>[(<bundle-name>)]: ...`

插件市场发布、CI/Pages 维护或本地生成索引时，先读 [发布说明](<plugin-market-publishing.md>)。
