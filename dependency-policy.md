# 兼容与依赖检查

## 兼容声明与测试基线

8 个 bundle 的 `engines.dsh` 保留最低版本 `>=0.2.1-rc.2`，上界为 `<0.3.0-0`。
[codex-live manifest](<codex-live/package.json>) 的 DSH peers 保留自己的最低版本 `>=0.2.1-rc.3`，上界相同；开发依赖精确固定 `0.2.1-rc.3`。Cordis 是非 DSH 版本线，peer/dev 仍为 `4.0.5`。

检查 peer/dev 满足关系使用 `semver.satisfies(dev, peer, { includePrerelease: true })`，与 DSH 的 prerelease 判定一致；Syncpack 的 `sameRange` 只检查相交，不能替代此包含检查。`<0.3.0-0` 同时排除 `0.3.0-rc.1` 与 `0.3.0`，而不是只排除稳定版。

| 版本 | engines | DSH peers |
| --- | --- | --- |
| 0.2.1-rc.1 | 拒绝 | 拒绝 |
| 0.2.1-rc.2 | 接受 | 拒绝 |
| 0.2.1-rc.3、rc.4、0.2.1 | 接受 | 接受 |
| 0.2.2-rc.1、0.2.2、0.2.9 | 接受 | 接受 |
| 0.3.0-0、alpha.1、rc.1、0.3.0 | 拒绝 | 拒绝 |

这些是加载/声明策略，不代表已在全部 0.2.x 上逐版或实机验证。行为测试仍使用精确固定的开发依赖；已知不兼容应另行收紧相应声明与策略。

## 工具分工

统一入口为根 `pnpm lint`，只读、不自动修复：

1. [Syncpack 配置](<.syncpackrc.json>)：使用 v15 的 `syncpack lint`，从 workspace 自动发现包；peers 与 dev/prod 分组检查一致性，避免把兼容范围改回精确版本。根工具依赖单独忽略，不约束 bundle 的独立声明。
2. [ESLint 配置](<eslint.config.mjs>)：按每个 bundle 自己的 manifest 配置现成 `no-extraneous-dependencies`；仅适配局部 `require` 遮蔽。补充声明检查，防止现成规则因包尚未安装/无法解析而漏报，禁止根依赖或生产 dev-only 兜底。
3. [薄语义检查器](<scripts/check-dependencies.mjs>)：显式共享实例分类、peer/dev 配对、精确 dev 与满足关系、宿主 dev 跨 bundle 一致、unused peer、兼容声明与发现保护。使用 ESLint 的 AST/scopes 收集源码 import，不自行解析 JavaScript。

[策略定义](<scripts/dependency-policy.mjs>) 是分类和例外的单一来源。schemastery 属于无状态自有依赖，不因 `@deepseek-ai/` scope 被升级为 peer。Cordis 的唯一 unused peer 例外限定在 codex-live：宿主通过 `apply(ctx)` 提供 Cordis 契约；其它 bundle 同名 peer 或仅测试 import 不享受例外。陈旧例外也报错。

新增 bundle 被 workspace globs 自动纳入；独立扫描发现未被 workspace 覆盖的 bundle 时失败。根 [工具 manifest](<package.json>) 不含 `dsh.bundle`，所以市场不会把根当作 bundle，也不会优先选择根而遮蔽子目录；[CLI 测试](<scripts/dependencies.test.mjs>) 验证这一保护。

## 源码检查边界

- 检查 bundle 下全部 `.js` / `.mjs` / `.cjs`，包括裸 import、跨行 import、named/star re-export、字面量动态 `import('pkg/subpath')`，以及未被局部绑定遮蔽的 `require('pkg')`。scoped/unscoped 子路径归一化到包名；Node builtins、相对路径、URL、`#imports` 和包自引用不视为外部 npm 依赖。
- `test/`、`tests/`、`__tests__/`、`*.test.js/mjs/cjs` 和 bundle 根的 `check.mjs` 可使用 devDependencies；其它文件按生产源码处理。peer 使用量只计生产 import；仅测试的宿主模块保持 dev-only。
- 浏览器 `factory(require)` 的局部 loader 不是 Node require。现有 client 中的 React 由宿主 ModuleLoader 提供，不因此追加 npm runtime peer。
- 非字面量动态加载、`createRequire`/`require.resolve` 的别名或包装、模板字面量、YAML 内嵌 JavaScript、客户端 loader/服务名注入不做依赖推导；修改这些加载路径时需人工核查。检查不验证 exports 子路径存在性、相对文件可达性、传递依赖或打包产物，也不分析 TypeScript/JSX。
- 本轮不实施 composition/schema 或文档契约 lint；现有行为测试及 lean-preset 的 schema 测试依赖保持不变。

## 验证

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test:lint
pnpm -r test
```

`pnpm test:lint` 通过真实 Syncpack、ESLint 和语义 CLI 运行临时正反例，覆盖缺声明、根兜底、dev-only、共享实例字段/配对/版本、unused peer 与契约例外、新 bundle 发现，并验证 prerelease 上下界。`pnpm -r test` 不执行根检查器测试，CI 显式运行以上全部 gates；CI 使用 Node 24，本地实施验证使用 Node 26。市场 PR job 仍只读取远端 refs，不能代替本地工作树检查。
