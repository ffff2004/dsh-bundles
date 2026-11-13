# 版本与插件市场发布

## 日常工作流

1. 功能 PR 修改源码并提交 `pnpm changeset` 生成的变更说明；普通 PR 不直接改版本。纯工具、测试或文档变更无需 changeset。升级级别与写作约定见 [Changesets](<.changeset/README.md>)。
2. 合并到 `main` 后，[发布工作流](<.github/workflows/release.yml>) 自动创建或更新 Release PR：升级受影响 bundle 的 manifest、生成各包 changelog、消费 changesets 并更新锁文件。包独立版本，manifest 是版本与兼容声明的唯一来源；保持 `private: true`，不做 npm 发布。
3. 审核 Release PR 及其显式触发的 CI；**合并即批准公开发布**，没有第二次人工确认。
4. 自动化从发布提交 `R` 与第一父提交的差异确定本批升级包，要求已消费 changeset 覆盖这些包；创建 `<完整包名>@<版本>` tags，全部指向 `R`，原子推送完整批次。
5. 同一发布链显式调用 [CI](<.github/workflows/ci.yml>)，在 `R` 上运行 lint、根检查器、发布测试和全部 bundle 测试；生成仅收录已发布 tags 的市场索引，完整验证后部署 Pages。

配置 PR 合并只准备 Release PR，不直接发布。首次 Release PR 发布新身份下全部 9 个包并纳入已有未发布内容；后续由各 changeset 指定包及 SemVer 升级级别。Conventional Commits 不参与自动推断版本。

### Scope 迁移

包名为 `@ffff2004-dsh-packages/<名称>`，省略原 `dsh-` 前缀；源码目录不必同名。旧 `@local/dsh-*` 身份及历史不会迁移进新索引，也没有兼容入口。旧用户需移除旧包及配置引用，再安装和配置新包，避免重复加载；旧安装不会自动卸载或原地升级。

## 发布边界与校验

- 发布意图由 Release PR 表达，tag 固定内容，Pages 部署成功后才对市场用户可见；普通 `main` 修改和未打 tag 的 manifest 版本均不进入市场。
- tags 仅接受匹配新 scope 的 `<完整包名>@<精确 SemVer>`；不接受统一 `vX.Y.Z` 标签。已存在且指向 `R` 的 tag 跳过，指向其它 commit 则失败，绝不移动。只处理本次升级包，不扫描全部版本补 tag。
- `GITHUB_TOKEN` 产生的 PR/tag 不会自动触发常规 PR/push 工作流。因此 Release PR 更新后显式 dispatch CI（校验预期 SHA），打 tag 后显式调用可复用 CI；不依赖隐式事件，无需 PAT/App secret。Release PR 的检查运行在 Actions 中，合并前应核对对应 SHA 的结果。
- 普通 PR、手动 dispatch CI 只校验和上传 artifact，不部署；发布与部署重试统一从 `main` 的发布工作流进入。完整批次 tags 创建之后才生成一次索引，避免逐 tag 部署半批次。
- [适配器](<scripts/prepare-market-generator.mjs>) 仅在临时 checkout 上调整固定上游版本：去掉 HEAD 与统一 tag 候选、限定新 scope，并隔离正常及失败回退缓存。锚点/源码变化即失败；升级上游必须同时更新适配器和测试。保留官方格式、图标和兼容声明校验，不直接升级至会过滤私有包的新上游。
- [独立校验器](<scripts/market-verify.mjs>) 对照 Git tags、commit 及对应 manifest 验证每个索引版本和本批所有 tags；发布调用还要求本批 tags 全部指向发布提交 `R`，历史版本只校验与各自 tag 自洽。任一源读取失败、版本缺失、错误引用或发布索引为空时均不部署，保留线上旧版本。首次尚无新 scope tag 时，仅允许 PR/只读校验产生空索引。
- 上游仍从默认分支发现包目录；历史包改名、删除或搬目录需要专门迁移，tags-only 不提供跨目录的完整历史发现。

## 首次启用与失败重试

- 仓库 **Settings → Pages → Build and deployment → Source** 应为 **GitHub Actions**；`github-pages` environment 允许 `main`，若环境另有审批规则仍需满足。
- 工作流显式申请最小写权限。仓库必须允许 Actions 创建 PR；当前仓库已开启，无需新增 secret。
- 配置 PR 合并后，确认 Release PR 覆盖全部 9 个新身份、changelog 含迁移说明，且其 CI 成功；合并后确认 tags 均指向该发布提交，Pages 的索引 URL（见 [README](<README.md>)）返回 HTTP 200 JSON，且只包含对应 tags 的版本。
- 发布失败优先重跑原发布 run；也可在 **Actions → Release bundles → Run workflow** 选择 `main`，传入原发布提交的完整 SHA 作为 `release-ref`。只允许 `main` 祖先且含有效版本升级/changeset 消费的发布提交；同一批 tags 可幂等重试，生成或部署失败不会撤回已创建 tags。`release-ref` 留空则仅刷新当前 main 的 Release PR，不发布。
- 不手动移动 tags 或复用版本来回滚内容；修复应另交 changeset，发布新版本。重试旧提交重建的是当前全部有效 tags 的索引，不会把市场回滚成该提交当时的历史快照。

## 本地验证与生成

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test:lint
pnpm test:release
pnpm -r test
```

根工具不声明 `dsh.bundle`，市场仍按 [workspace globs](<pnpm-workspace.yaml>) 发现独立包；依赖声明边界见[依赖策略](<dependency-policy.md>)。发布测试使用临时 Git 仓库验证版本升级、tag 幂等与冲突、tags-only 和缓存隔离；不向远端发布。

本地生成时准备固定 `DSH_REF` 的**专用临时 checkout**，不要对日常上游源码目录运行适配器。安装生成器依赖后，用 `node scripts/prepare-market-generator.mjs --checkout <临时目录>` 应用适配；随后调用上游 CLI 的 `--input <仓库URL清单> --output <绝对路径> --cache <绝对路径> --title <标题>`，最后运行 `node scripts/market-verify.mjs --index <索引路径> --repo . --source-url https://github.com/ffff2004/dsh-bundles --mode deploy`。Git 对象必须包含完整远端 tags；生成器读取远端 refs，而非未推送的本地工作树。完整命令及固定 SHA 以 [CI](<.github/workflows/ci.yml>) 为准。

仅上传 `_site/`（索引和图标），不提交生成结果或发布缓存。`.dsh-source/`、`.plugin-market-cache/`、`_site/` 已忽略；适配缓存与原生缓存分开保存。
