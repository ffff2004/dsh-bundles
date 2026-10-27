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

所有 bundle 的测试入口统一为 `node --test`；只跑一个 bundle：`pnpm --filter @local/dsh-shell-description test`。

测试源码放在 bundle 根 `test/`、`tests/`、`__tests__/`（含其中子目录）或根 `*.test.js/mjs/cjs`。只有这些位置可使用 dev-only 依赖；其它位置（包括 `src/tests/`、`src/*.test.*`）按生产源码检查。

新增 bundle，或修改依赖、兼容声明（如 `engines.dsh`）、源码加载方式时，先读[依赖检查策略与边界](<dependency-policy.md>)。新增共享实例包或 unused peer 例外时，在显式策略中记录分类或宿主契约原因，并补 CLI 正反例。

新增或移动 bundle 目录时检查 [workspace globs](<pnpm-workspace.yaml>) 覆盖情况；lint 会拒绝未覆盖的 bundle。根包仅承载开发工具，保持 private 且不声明 `dsh.bundle`，以免改变市场发现优先级。
