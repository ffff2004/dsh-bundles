# 插件市场发布

## 发布边界与首次启用

本次实现 PR 保留九包当前 manifest 版本和待消费 changesets。**合并实现 PR 不打包专用 tags、不生成部署用索引、不替换线上市场**。首次运行只创建独立 Release PR；维护者可一直保持它打开。

唯一授权是：Actions 创建、维护者人工审核并合并的 Release PR。普通 PR/main commit、Release PR 创建或更新、手动指定任意 main commit、tag push 都不授权发布。没有 tag 事件发布路径；不依赖 `GITHUB_TOKEN` 递归触发工作流。

首次启用由维护者检查（本实现不修改设置）：

1. 仓库 Actions 权限允许 **GitHub Actions 创建 pull requests**，优先使用内置 `GITHUB_TOKEN`，无需 PAT。
2. Pages Source 选择 **GitHub Actions**；`github-pages` environment 允许 `main`，按仓库规则人工审批。
3. 合并实现 PR 后，查看自动 Release PR 的版本、changelog、显式 `dsh-release/checks` 状态与对应 Actions 日志。保持 PR 打开不会发布。
4. 后续真实端到端验证：人工审核、保持 Release PR 与 main 同步，再合并；确认整批 tags 与 Pages 成功后检查 [README 市场地址](<README.md#从插件市场安装推荐>)。本地 fixtures 不代表已完成这一步。

九包身份为 `@ffff2004-dsh-bundles/<name>`（包括 zotero-select）。先卸载历史 `@local/dsh-<name>` 再安装新身份；目录和 patch 行 ID 不变。新索引不保留旧身份，旧 Git tags 不删除、不移动、不补打。`private: true` 只禁止 npm 发布，**不禁止市场收录**；整个流程不执行 npm publish。

## 日常开发 → Release PR

根工具固定 Changesets **3.0.3**、pnpm **11.25.0**；CI 使用 Node **24**。Changesets CLI 要求 Node `^22.11 || ^24 || >=26`。各包独立 SemVer，manifest 为版本/兼容要求唯一来源，根 private 工具不声明 `dsh.bundle`。

```bash
pnpm changeset                 # 功能 PR 记录发布意图；不要提前改版本
pnpm changeset status          # 只读查看计划
```

当前初始计划是八包 patch，加 codex-live 独立 minor（1.1.2 → 1.2.0）；实现 PR 不消费这些计划。`pnpm version-packages` 留给 Release PR 自动化。

[主分支工作流](<.github/workflows/release.yml>) 在 main push 后创建/更新唯一 `changeset-release/main` Release PR。脚本在隔离 worktree 对不可变 base 运行 Changesets，消费 changesets、更新 manifest 与 changelog；原 main 工作树不修改。重复运行复用相同 head；main 前进时生成新 tree，以保留旧 head 为第二 parent 的提交 **fast-forward** 更新分支，不 force push。只更新机器人拥有的 PR，从不批准或自动合并。

`GITHUB_TOKEN` 创建的 PR 不触发新的 `pull_request` 工作流。因此主工作流**显式调用同一只读 CI**，checkout 生成 head SHA，运行完整检查并将 `dsh-release/checks` commit status 写到该 head。维护者须查看此状态和日志，不能以“PR 没触发 CI”为由绕过检查；未通过的 head 不能发布。

### 授权校验

[Git 校验器](<scripts/release-git.mjs>) 和 [GitHub 编排](<scripts/release-github.mjs>) 重新读取已合并 PR 与 Git 对象，不使用 PR 上传的可写 artifact。要求：

- PR 由真实 `github-actions[bot]`（GitHub.com ID 41898282）创建，head 为本仓库固定 release 分支，base 为本仓库 main；由人类账号合并。
- release commit **R** 是 main 祖先，PR head 的第一个 parent 与 R 的 main parent 相同；**PR 必须基于合并前最新 main**。过期 PR 先等自动更新再合并；不要用网页 Update branch/手改生成分支代替自动更新。
- 从这个可信 main parent 重新运行 Changesets，生成 tree 必须精确等于 PR head 与 R 的 tree。不能夹带任意源码/配置提交或手改版本计划。
- 从实际 before/after manifest 差异只选真正升级的包，并与 Changesets 计划精确一致；新增、改名、移动、降级不能夹在 Release PR 中。
- 支持 merge commit、squash 和 **single-commit rebase**；多提交 Release PR 应用 merge/squash。多提交 rebase 或过期合并会安全失败，不猜测授权。

## 整批发布与恢复

每次 main 工作流扫描**全部已合并机器人 Release PR**（分页），它们是持久授权记录，不依赖会丢弃 pending runs 的 Actions concurrency 队列。所有候选 PR 都通过上述校验后，才处理 tags：

1. 从远端实时读取完整 tags（annotated tag 使用 peeled commit），预检所有批次所有 `<完整包名>@<精确版本>` tags；任何不同目标的冲突使整次运行在首次写入前失败。
2. 对不可变 R 创建全部缺失 tags；已存在且 peeled 到同一 R 则跳过，绝不 force/移动 tag。部分失败后，重试仍使用原 R；不基于后来的 main 重新算发布提交。
3. 全部 tags 成功并重读验证后，才生成一次完整市场并部署一次。生成走 [严格入口](<scripts/market.mjs>)；部署不允许 `--allow-empty`。再次核对远端完整 tags 未变化及每个批次版本均已收录到正确 R。
4. Pages 成功后，在每个 R 写 `dsh-market/batch=success` commit status，作为完成记录。记录只用于去重，不是授权。生成、部署或写完成记录失败均可重试；部署前失败不会覆盖线上成功索引。部署成功但完成记录失败可能重建同一完整快照，安全但不是“恰好一次”交付。

无未完成授权批次时，**整个 Pages job 被跳过**，不会生成部署 artifact，也不会申请 environment 部署。实现 PR 首次合并和普通 main push 不发布；普通 push 仅可能恢复先前已授权但未完成的批次。PR CI 可生成 allow-empty 校验输出，但从不上传部署 artifact。

手动恢复：在 **Release PR and authorized market batches → Run workflow**，选 `main` 并填写已合并 Release PR 的 `release_pr` 编号；任意普通 PR、未合并 PR、任意 commit 不被接受。恢复仍协调所有持久授权批次，不只填写的一个。也可 rerun 失败工作流。代码、checkout 和索引始终取当前可信 main/远端完整 tags，tag 目标始终取各自不可变 R；重放旧运行不会用旧 R 的工作树/旧 tag 列表覆盖较新市场。

如果误合并了不符合授权规则的机器人 Release PR（例如过期 base、多提交 rebase 或手改生成内容），自动化会 fail closed，并阻塞后续全部批次。当前没有“忽略这个 PR”的输入、标签或人工 tag 绕过；需要维护者调查后通过单独审核的实现修复/策略迁移恢复。不要合并明知会失败的 Release PR，不能声称另开普通 PR 即可解除该阻塞。

历史校验使用当前安装的 Changesets 3.0.3 和受信 base 的配置。**升级 Changesets、格式化器或 changelog 配置前，必须验证全部历史 Release PR 仍可精确重建**；不兼容升级会安全阻塞恢复/发布，需要另行设计、审核历史工具链兼容方案，不能跳过授权校验。

全工作流共用 `market-release-main` 串行锁，覆盖预检、写 tags、生成、部署和完成记录。恢复 job 与 Pages job 各自重新验证授权/当前 refs，不在 jobs 之间传递 PR 可控 artifacts。若 refs 在生成期间变化，安全失败，重试当前完整快照。外部手动改 tags/Pages 不在自动化协调边界内；tag 冲突必须人工调查，不能通过删/移 tag 掩盖。

## CI、权限与安全边界

[只读 CI](<.github/workflows/ci.yml>) 在普通 PR 和显式 Release PR head 上运行 Node24，依次执行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test:lint
pnpm test:release
pnpm test:market
pnpm -r test
pnpm test:market:integration --upstream /absolute/path/to/pinned-dsh
```

根 scripts 不被 `pnpm -r test` 自动覆盖，必须显式运行。CI 另通过严格入口验证远端市场，首次无新身份 tags 时可 `--allow-empty`；此输出永不部署。fixture tests 全离线，不缺依赖跳过 integration。

- 默认/PR/reusable checks：`contents: read`，不持久化 checkout credentials。
- prepare：`contents: write`（仅 release 分支）、`pull-requests: write`。只运行可信 main 代码，安装忽略 lifecycle scripts。
- report：仅 `statuses: write`，为生成 head 报告显式检查结果。
- recover：`contents: write`（创建缺失 tags）、PR/status 只读；没有 Pages/OIDC 权限。
- publish：contents/status write、PR read、`pages: write`、`id-token: write`；仅有未完成的已授权批次才进入 `github-pages` environment。

写入 token 只传给需要的脚本步骤，生成器不获得 token；无 `pull_request_target`、无 PAT、无 PR writable artifact、无自动批准/合并。信任 main 上的工作流、工具/Changesets 配置、具有写权限的维护者与 GitHub.com bot 身份；维护者仍须审查 main 工具变化。branch protection 可要求 `dsh-release/checks`；仓库设置由维护者管理，本实现不修改。

## 固定 generator 与本地验证

上游固定 **687f282e8625c6b8d11ff58211a90524be2e4317**。准备独立 checkout（不要降级正在使用的 DSH checkout），进入其中按其 packageManager 安装：

```bash
pnpm --filter '@deepseek-ai/dsh-plugin-market-generator...' install --frozen-lockfile --ignore-scripts
```

在本仓库执行：

```bash
pnpm install --frozen-lockfile
pnpm test:release
pnpm test:market
pnpm test:market:integration --upstream /absolute/path/to/pinned-dsh
printf '%s\n' 'https://github.com/ffff2004/dsh-bundles' > /tmp/bundle-sources.txt
pnpm market:generate --upstream /absolute/path/to/pinned-dsh \
  --input /tmp/bundle-sources.txt --output _site/index.json --cache .plugin-market-cache
pnpm market:validate --upstream /absolute/path/to/pinned-dsh \
  --input /tmp/bundle-sources.txt --output _site/index.json --cache .plugin-market-cache
```

可加 `--release-tag '<完整包名>@<version>' --release-commit '<peeled commit>'` 检查单个版本；默认拒绝空市场。PR 的远端生成仅验证生成流程，不等价于收录尚未合并的 bundle 修改。生成器读取远端默认分支目录与 refs，不读取未推送的工作树。

[补丁](<scripts/patches/market-package-tags-only.patch>)只为固定 CLI/GenerateOptions 添加 `--package-tags-only` allowlist，排除统一版本 tags、未打 tag 的 main、旧身份和 manifest name/version 不匹配的 tags；private 包仍可见。[准备器](<scripts/market-source.mjs>)核实 HEAD/相关 tracked 文件无漂移，`git archive` 到独立临时目录后 `git apply --check`/apply，原 checkout 不改动；依赖复用安装，shared format-1 validator 从固定源码加载。不要改成直接调用上游未打补丁的 CLI。

保持上游 CACHE_VERSION=7；strict 正常和 last-success 缓存 key 带 `package-tags-only-v1` 与排序 allowlist，入口缓存子目录同名。CI cache key/restore-prefix 同时带策略、固定 SHA、补丁 hash，不能 fallback 到旧模式。升级 SHA/补丁须通过真实离线 integration fixtures：named/annotated tags、精确 prerelease/build metadata、private、排除规则、缓存/失败 fallback、原 validator 与图标。入口会清理已验证的临时目录，不 fetch/修改传入的上游源码。

只上传 `_site/` 中的 index/icons；`.plugin-market-cache/`、`.dsh-source/` 和临时授权状态都不是 Pages 内容，已忽略生成目录，禁止上传仓库根目录。
