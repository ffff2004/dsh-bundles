place local DSH (DeepSeek Harness) bundles here.

当文档（包括 `AGENTS.md` 、根/子 `README.md` 等）过时时，及时更新

如有需要，可以参考本地 DSH 源码 checkout。

use conventional commit `<type>[(<bundle-name>)]: ...`

插件市场发布、CI/Pages 维护或本地生成索引时，先读 [发布说明](<plugin-market-publishing.md>)。

## 本地开发

仓库使用一个 pnpm workspace 共享安装和锁文件；每个 bundle 仍是可独立安装的包，`package.json` 中的声明才是发布后真正生效的内容。

```bash
pnpm install --frozen-lockfile
pnpm lint       # 只读：版本一致性、源码声明与兼容策略
pnpm test:lint  # 根检查器的真实 CLI 正反例
pnpm -r test    # 全部 bundle 行为测试（不会运行根 scripts）
```

只跑一个 bundle：`pnpm --filter @local/dsh-shell-description test`。

依赖声明约定（与 DSH 对 out-of-tree 插件的要求一致）：

- 运行时需要与宿主共享实例的包 → `peerDependencies` 兼容范围 + `devDependencies` 精确版本；dev 必须满足 peer（`includePrerelease: true`），同类宿主 dev 跨 bundle 一致。分类按[显式策略](<scripts/dependency-policy.mjs>)，不按 npm scope 一刀切。
- 仅测试使用的运行时包 → 只放 `devDependencies`，不为了统一格式新增 peer。
- 第三方库与无状态工具包（如 schemastery）→ `dependencies`；生产 import 必须由本 bundle 自己声明，根依赖与 dev-only 声明不能兜底。
- `engines.dsh` 声明宿主加载范围；DSH peer 保留自己的最低版本，不用 `@deepseek-ai/dsh` peer 代替 engines。放宽加载范围不是逐版本兼容保证。

修改依赖、源码加载方式或新增 bundle 时，先读[依赖检查策略与边界](<dependency-policy.md>)。新增共享实例包或 unused peer 例外时，在显式策略中记录分类或宿主契约原因，并补 CLI 正反例。

新增或移动 bundle 目录时检查 [workspace globs](<pnpm-workspace.yaml>) 覆盖情况；lint 会拒绝未覆盖的 bundle。根包仅承载开发工具，保持 private 且不声明 `dsh.bundle`，以免改变市场发现优先级。
