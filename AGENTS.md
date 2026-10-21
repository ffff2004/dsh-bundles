place local DSH (DeepSeek Harness) bundles here.

当文档（包括 `AGENTS.md` 、根/子 `README.md` 等）过时时，及时更新

如有需要，可以参考本地 DSH 源码 checkout。

use conventional commit `<type>[(<bundle-name>)]: ...`

插件市场发布、CI/Pages 维护或本地生成索引时，先读 [发布说明](<plugin-market-publishing.md>)。

## 本地开发

仓库使用一个 pnpm workspace 共享安装和锁文件；每个 bundle 仍是可独立安装的包，`package.json` 中的声明才是发布后真正生效的内容。

```bash
pnpm install    # 安装所有 bundle 的依赖，含仅测试使用的 devDependencies
pnpm -r test    # 运行全部 bundle 的测试
```

只跑一个 bundle：`pnpm --filter @local/dsh-shell-description test`。

依赖声明约定（与 DSH 对 out-of-tree 插件的要求一致）：

- 需要与宿主共享实例的 `@deepseek-ai/*` 包 → `peerDependencies` + `devDependencies`（同一版本）；
- 仅测试使用的运行时包 → 只放 `devDependencies`；
- 第三方库与无状态工具包 → `dependencies`；
- 兼容范围统一由 `engines.dsh` 声明，不再用 `@deepseek-ai/dsh` peer 表达。

新增或移动 bundle 目录时同步更新 `pnpm-workspace.yaml` 的 `packages`。插件市场生成器会优先按这些 glob 发现 bundle，glob 漏掉的目录不会回退到目录扫描。
