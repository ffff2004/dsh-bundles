# 版本与插件市场发布

面向维护者。日常只需看「发布流程」「失败重试」；一次性配置和实现依据在文末。

## 发布流程

1. 功能 PR 修改源码并提交 `pnpm changeset` 生成的变更说明；普通 PR 不直接改版本，纯工具、测试或文档变更无需 changeset。升级级别与写作约定见 [Changesets](<.changeset/README.md>)。
2. 合并到 `main` 后，[发布工作流](<.github/workflows/release.yml>) 自动创建或更新 Release PR：升级受影响 bundle 的 manifest、生成 changelog、消费 changesets 并更新锁文件。包独立版本；manifest 是版本与兼容声明的唯一来源，保持 `private: true`，不做 npm 发布。
3. 审核 Release PR 及其显式触发的 CI；**合并即批准公开发布**，没有第二次人工确认。
4. 发布提交 `R` 与第一父提交的差异决定本批升级包；已消费 changeset 必须覆盖这些包。自动化创建指向 `R` 的 `<完整包名>@<版本>` tags，并原子推送完整批次。
5. 同一发布链显式调用 [CI](<.github/workflows/ci.yml>)，在 `R` 上运行全部 gates；从已发布 tags 生成一次索引，完整验证后部署 Pages。

Release PR 只准备版本与 changelog；合并前不会发布。后续由各 changeset 指定包及 SemVer 升级级别；Conventional Commits 不参与自动推断。

## 发布规则

- 发布意图由 Release PR 表达；tag 固定内容，Pages 部署成功后才对市场用户可见。普通 `main` 修改和未打 tag 的 manifest 版本均不进入市场。
- tags 只接受匹配新 scope 的 `<完整包名>@<精确 SemVer>`，不接受统一 `vX.Y.Z`。已存在且指向 `R` 的 tag 跳过，指向其它 commit 则失败，绝不移动；只处理本次升级包，不扫描全部版本补 tag。
- Release PR 更新后显式 dispatch CI（校验预期 SHA），打 tag 后显式调用可复用 CI；不依赖 `GITHUB_TOKEN` 产生的隐式事件，无需 PAT/App secret。合并前核对对应 SHA 的 CI 结果。
- 普通 PR、手动 dispatch CI 只校验和上传 artifact，不部署；发布与部署重试统一从 `main` 的发布工作流进入。完整批次 tags 创建后才生成一次索引，避免逐 tag 部署半批次。
- 不手动移动 tags 或复用版本回滚；修复应另交 changeset、发布新版本。重试旧提交重建的是当前全部有效 tags 的索引，不会把市场回滚成该提交当时的历史快照。

## 失败重试

- 发布失败优先重跑原发布 run；也可在 Actions 中手动运行 [release.yml](<.github/workflows/release.yml>) 的 `Release bundles`，传入原发布提交的完整 SHA 作为 `release-ref`。
- 只允许 `main` 祖先且含有效版本升级/changeset 消费的发布提交；同一批 tags 可幂等重试，生成或部署失败不会撤回已创建 tags。
- `release-ref` 留空则仅刷新当前 main 的 Release PR，不发布。

## 本地验证与生成

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test:lint
pnpm test:release
pnpm -r test
```

发布测试用临时 Git 仓库验证版本升级、tag 幂等与冲突、tags-only 和缓存隔离，不向远端发布。根工具不声明 `dsh.bundle`，市场按 [workspace globs](<pnpm-workspace.yaml>) 发现独立包；依赖声明边界见[依赖策略](<dependency-policy.md>)。

本地生成索引时，准备固定 `DSH_REF` 的**专用临时 checkout**，不要对日常上游源码目录运行适配器。按 [CI](<.github/workflows/ci.yml>) 的 market job 执行适配、生成和校验；Git 对象必须包含完整远端 tags，生成器读取远端 refs，不读取未推送的工作树。完整命令及固定 SHA 以 CI 为准。仅上传 `_site/`（索引和图标），不提交生成结果或发布缓存；`.dsh-source/`、`.plugin-market-cache/`、`_site/` 已忽略。

## 一次性配置（已完成）

仅在迁移或重建发布链时使用：

- 仓库 **Settings → Pages → Build and deployment → Source** 为 **GitHub Actions**；`github-pages` environment 允许 `main`，若环境另有审批规则仍需满足。
- 工作流申请最小写权限；仓库允许 Actions 创建 PR。不依赖 PAT/App secret。
- 新 scope 尚无 tag 时，首次校验允许 PR/只读模式产生空索引；部署仍要求非空索引。

## 实现依据

- 发布与 tags：`.github/workflows/release.yml`、`scripts/release.mjs` 定义本批升级包、tag 格式、原子推送与幂等重试。
- 索引校验：`scripts/market-verify.mjs` 逐版本对照 tags/commit/manifest；发布调用要求本批 tags 指向 `R`，历史版本只校验与各自 tag 自洽；部署时任一读取/引用/空索引失败均不部署。
- 适配器：`scripts/prepare-market-generator.mjs` 固定上游、去 HEAD/统一 tag、限定 scope、隔离缓存；锚点/源码变化即失败；升级上游须同步适配器和测试；不要直接升级到会过滤私有包的上游。
- CI/Pages：`.github/workflows/ci.yml` 定义 gates、生成命令、固定 SHA 与部署；完整命令以它为准。
- 上游发现：从默认分支发现包目录；历史改名、删除或搬目录需要专门迁移，tags-only 不提供跨目录的完整历史发现。
