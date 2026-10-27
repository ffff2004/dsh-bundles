# 兼容与依赖检查

## 依赖声明约定

与 DSH 对 out-of-tree 插件的要求一致：

- 运行时需要与宿主共享实例的包 → `peerDependencies` + `devDependencies`；分类按[显式策略](<scripts/dependency-policy.mjs>)，不按 npm scope 一刀切。
- 仅测试使用的运行时包 → 只放 `devDependencies`，不为了统一格式新增 peer。
- 第三方库与无状态工具包（如 schemastery）→ `dependencies`；生产 import 必须由本 bundle 自己声明，根依赖与 dev-only 声明不能兜底。

## 版本声明与语义关系

每个 bundle 的 manifest 是版本、`engines.dsh`、peer/dev 声明的唯一来源。宿主加载范围由 `engines.dsh` 声明，不用 `@deepseek-ai/dsh` peer 代替。检查器不另存 DSH 发布基线或中央版本配置；升级精确 dev、提高最低版本或单包收紧范围时，只需更新相应 manifest 并完成 review、统一 gates 和必要的运行时验证。

`engines.dsh` 必须存在且为非空合法 SemVer 范围；共享实例包的 dev 必须为精确 SemVer，peer 必须为非空合法范围。满足关系使用 `semver.satisfies(dev, peer, { includePrerelease: true })`，与 DSH 的 prerelease 判定一致；Syncpack 的 `sameRange` 只检查相交，不能替代此满足检查。engines 与 peer 各自声明范围，不要求下界相同，非 DSH 包也按自己的版本线验证。

范围的语法合法性不等于合理性。检查器允许 `*` 和跨 0.3 的合法声明，不自动限制上界；范围是否过宽、收紧或放宽的影响由 manifest diff/review 判断。使用 prerelease 时尤其需要复核上界：例如 `<2.0.0-0` 同时排除 `2.0.0-rc.1` 和稳定版，而 `<2.0.0` 在 `includePrerelease: true` 下允许该 rc。

合法声明与测试通过不是未来版本的运行时兼容保证；行为测试使用各 manifest 中的精确开发依赖，不代表已逐版或实机验证整个兼容范围。

## 工具分工

统一入口为根 `pnpm lint`，只读、不自动修复：

1. [Syncpack 配置](<.syncpackrc.json>)：使用 v15 的 `syncpack lint`，从 workspace 自动发现包；独立负责跨 bundle 版本一致性，peers 与 dev/prod 分组，避免把兼容范围改回精确版本。根工具依赖单独忽略，不约束 bundle 的独立声明。
2. [ESLint 配置](<eslint.config.mjs>)：按每个 bundle 自己的 manifest 配置现成 `no-extraneous-dependencies`；适配局部 `require` 遮蔽，并复用语义检查器的测试位置分类。补充声明检查，防止现成规则因包尚未安装/无法解析而漏报，禁止根依赖或生产 dev-only 兜底。
3. [薄语义检查器](<scripts/check-dependencies.mjs>)：有效 engines 范围、显式共享实例分类、peer/dev 配对、精确 dev 与满足关系、unused peer/宿主契约例外、发现保护及禁止 `@deepseek-ai/dsh` peer。仅验证每个 bundle 的语义关系，不重复 Syncpack 的跨包一致性检查；使用 ESLint 的 AST/scopes 收集源码 import，不自行解析 JavaScript。

[策略定义](<scripts/dependency-policy.mjs>) 是分类和例外的单一来源。schemastery 属于无状态自有依赖，不因 `@deepseek-ai/` scope 被升级为 peer。Cordis 的唯一 unused peer 例外限定在 codex-live：宿主通过 `apply(ctx)` 提供 Cordis 契约；其它 bundle 同名 peer 或仅测试 import 不享受例外。陈旧例外也报错。

新增 bundle 被 workspace globs 自动纳入；独立扫描发现未被 workspace 覆盖的 bundle 时失败。根 [工具 manifest](<package.json>) 不含 `dsh.bundle`，所以市场不会把根当作 bundle，也不会优先选择根而遮蔽子目录；[CLI 测试](<scripts/dependencies.test.mjs>) 验证这一保护。

## 源码检查边界

- 检查 bundle 下全部 `.js` / `.mjs` / `.cjs`，包括裸 import、跨行 import、named/star re-export、字面量动态 `import('pkg/subpath')`，以及未被局部绑定遮蔽的 `require('pkg')`。scoped/unscoped 子路径归一化到包名；Node builtins、相对路径、URL、`#imports` 和包自引用不视为外部 npm 依赖。
- 仅 bundle 根 `test/`、`tests/`、`__tests__/`（含其中子目录）及根 `*.test.js/mjs/cjs` 可使用 devDependencies。其它位置（包括 `src/tests/`、`src/__tests__/`、`src/*.test.*` 与非测试名自检脚本）按生产源码处理。现成 ESLint 规则、声明补洞与语义 import collector 共用 `isTestFile` 分类，不各自维护 glob。peer 使用量只计生产 import；仅测试的宿主模块保持 dev-only。
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

8 个 bundle 的 `test` script 统一为 `node --test`，按 Node 默认发现运行测试文件；现有测试位置保持不变。两个 preview bundle 的[下载路由测试](<preview-download/contract.test.mjs>)与[客户端契约测试](<preview-path/contract.test.mjs>)均注册显式 `node:test` 场景组，保留原自检的逐标签聚合断言；浏览器 mock 在测试结束时还原，下载临时文件在 finally 中清理。

`pnpm test:lint` 通过真实 Syncpack、ESLint 和语义 CLI 运行临时正反例，覆盖缺声明、根兜底、dev-only、共享实例字段/配对/版本、unused peer 与契约例外、新 bundle 发现，并验证不同合法范围/新精确 dev 可通过、prerelease 满足关系及跨包漂移仅由 Syncpack 拒绝。`pnpm -r test` 不执行根检查器测试，CI 显式运行以上全部 gates；CI 使用 Node 24，本地实施验证使用 Node 26。市场 PR job 仍只读取远端 refs，不能代替本地工作树检查。
