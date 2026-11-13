place local DSH (DeepSeek Harness) bundles here.

如有需要，可以参考本地 DSH 源码 checkout。

use conventional commit `<type>[(<bundle-name>)]: ...`.

## 包名 scope

bundle 的 `package.json` `name` 使用 `@ffff2004-dsh-packages/<名称>`；源码目录不必同名。`pnpm lint` 会拒绝 scope 不符的名称，发布脚本在创建 tag 前也会校验。

## 本地开发

仓库使用一个 pnpm workspace 共享安装和锁文件；每个 bundle 仍是可独立安装的包，`package.json` 中的声明才是发布后真正生效的内容。

```bash
pnpm install --frozen-lockfile
pnpm lint       # 只读：版本一致性、bundle 名 scope、源码声明与兼容策略
pnpm test:lint  # 根检查器的真实 CLI 正反例
pnpm test:release # 版本、tag 与市场发布边界
pnpm -r test    # 全部 bundle 行为测试（不会运行根 scripts）
```

所有 bundle 的测试入口统一为 `node --test`；只跑一个 bundle：`pnpm --filter @ffff2004-dsh-packages/shell-description test`。

## 文档

当文档（包括 `AGENTS.md` 、根/子 `README.md` 等）过时时，及时更新。

修改 bundle 用户可见行为或编写 changeset/changelog 时，先读[Changesets 约定](<.changeset/README.md>)。

维护版本发布、CI/Pages 或本地生成市场索引时，先读[发布说明](<plugin-market-publishing.md>)。

新增或修改 browser half（`client.js`、`dsh.client` 声明）时，先读[client bundle 约束](<client-bundle-constraints.md>)。

新增 bundle 及测试，或修改依赖、兼容声明（如 `engines.dsh`）、源码加载方式时，先读[依赖检查策略与边界](<dependency-policy.md>)。
