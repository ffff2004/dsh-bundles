# 插件市场自动发布

[CI 工作流](<.github/workflows/ci.yml>) 使用 DSH 官方 reference generator，自动生成索引及图标并分发到 GitHub Pages；不需要自建后端，也不向 Git 提交生成结果。
CI 根据 `GITHUB_SERVER_URL` 和 `GITHUB_REPOSITORY` 自动取得当前仓库 URL，在 runner 临时目录生成输入清单，
由生成器从远端默认分支发现各 bundle 子目录。无需在仓库中维护静态清单，临时清单也不会进入 Pages artifact。
同一工作流的 `test` job 在 PR、tag 和手动运行时使用 Node 24，依次执行 `pnpm install --frozen-lockfile`、`pnpm lint`（只读）、`pnpm test:lint`（根检查器真实 CLI 正反例）和 `pnpm -r test`（bundle 行为测试）；根 scripts 不会被递归测试自动执行，必须显式运行。部署仍要求 `market` 与 `test` 都通过。

根 [工具 manifest](<package.json>) 只承载精确固定的开发工具，不声明 `dsh.bundle`；市场继续通过 [workspace globs](<pnpm-workspace.yaml>) 发现 bundle 子目录，根工具不会变成市场包。lint 同时拒绝未被 workspace 覆盖的 bundle，避免新增目录绕过本地检查。兼容范围、共享实例分类与静态检查边界见[依赖策略](<dependency-policy.md>)。

## Namespace 与 Changesets 迁移

九包改用 `@ffff2004-dsh-bundles/<name>`；这是新安装身份，先卸载历史 `@local/dsh-<name>` 再安装新包，目录和 patch 行稳定 ID 不变。未来新市场不保留旧 `@local` 条目，旧 Git tags 不删除、不补打。

根工具精确固定 `@changesets/cli` **3.0.3**（实际 registry：`https://registry.npmmirror.com/`）；CLI 要求 Node `^22.11 || ^24 || >=26`、pnpm `>=10.0.0`（npm `>=10.9.0` / Yarn `>=4.5.2`）。仓库 CI 的 Node 24 与 pnpm 11.25.0 匹配；本地验证使用 Node 26.10.0。

用 `pnpm changeset` 记录变化，`pnpm changeset status` 只读查看计划；`pnpm version-packages` 留给未来 Release PR 更新版本与 changelog，本次迁移不提前执行。各包独立 SemVer，沿用既有版本线；九包 namespace 迁移记 patch，codex-live 额度页与缓存修复另记 minor（1.1.2 → 1.2.0）。私有包参与版本计算但不由 Changesets 打 tag；配置 restricted，不做 npm 发布。以下仍为现行市场机制，Release PR 与批量发布编排后续单独更新。

## 首次启用

1. 将本次配置推送到 GitHub 的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Test bundles and publish plugin market → Run workflow** 选择 `main` 运行。
4. 若 `github-pages` environment 有分支限制，允许 `main` 以及用于发布的 tags；有审批规则时需完成审批。
5. 确认工作流部署成功，打开 [README](<README.md>) 中的市场索引 URL，应直接得到 JSON（HTTP 200，不能重定向）；随后在 DSH 添加索引源。

自动发布仅由 `<完整包名>@<version>` 格式的 tag 推送触发，例如 `@ffff2004-dsh-bundles/shell-timeout-guidance@1.2.0`。
工作流先匹配含 `@` 的 tag，再确认生成索引确实收录了对应包、版本及该 tag 的 commit；不匹配则失败，不部署。
一次 push 超过三个 tag 时 GitHub 不产生 push 事件，工作流不会运行；批量发布应逐个推送，或每次最多三个。
普通 `main` 推送不触发工作流；仍可手动运行，并仅允许在 `main` 或 tag 上部署。
Pull request 只生成和校验 artifact，不部署。

## 发布与失败处理

- 版本递增只由维护者发起，且只在发布时进行；已打 tag 不可移动，修复须递增版本后打新 tag。
- 发布单个 bundle 时，先将包含该版本 manifest 的 commit 合并并推送到默认分支，再给该 commit 打 `<完整包名>@<version>` tag 并推送。
  包名必须等于该 bundle 的 `package.json` 中的 `name`，版本必须等于其中的 `version`（精确 SemVer）。
  例如发布 `shell-timeout-guidance` 的 `1.2.0`：
  ```bash
  git tag '@ffff2004-dsh-bundles/shell-timeout-guidance@1.2.0' <release-commit>
  git push origin 'refs/tags/@ffff2004-dsh-bundles/shell-timeout-guidance@1.2.0'
  ```
- 本仓库[生成入口](<scripts/market.mjs>)强制仅收录当前九个 `@ffff2004-dsh-bundles/<name>` 身份的包专用精确 SemVer tags，排除统一 `vX.Y.Z` / `X.Y.Z`、未打 tag 的 main 版本和旧 `@local` 身份；不保留旧条目、不补旧 tags 或映射。`private: true` 仅禁止 npm 发布，不禁止市场收录。
- 仍从默认分支发现当前包目录，tag 上 manifest 的 name/version 必须精确匹配，输出固定到该 tag peeled commit；因此新增/改名目录须先进入默认分支。
- 生成器读取的是远端 refs，不是本地工作树；未推送的修改不会进入索引。
  PR 校验因此只验证生成流程，不保证尚未合并的 bundle 修改可被正确收录。
- 生成器已做索引格式校验；任一源读取失败（非零退出码）或最终索引为空时，工作流失败，不部署，保留线上上次成功版本。
  单个版本因无效 manifest / 兼容范围被跳过可能仅产生 warning，应检查生成日志。
- 仅上传 `_site/`（`index.json` 及所需 `icons/`）。`.plugin-market-cache/` 通过 Actions cache 保存，不对外发布。
- 上游生成器固定到工作流中的 `DSH_REF` commit。升级时先更新该 SHA，再通过 PR 生成校验，避免定时任务自动执行未知的新版本。

## 本地生成

准备单独的 DSH checkout（不要把已有新版 checkout 降级），固定在 **687f282e8625c6b8d11ff58211a90524be2e4317**；CI 可继续用 checkout action 的 `ref`。进入该 checkout，使用其 packageManager 安装依赖：

```bash
pnpm --filter '@deepseek-ai/dsh-plugin-market-generator...' install --frozen-lockfile --ignore-scripts
```

在本仓库执行（参数均为显式路径，不依赖用户的本地上游目录）：

```bash
pnpm install --frozen-lockfile
pnpm test:market
pnpm test:market:integration --upstream /absolute/path/to/pinned-dsh
printf '%s\n' 'https://github.com/ffff2004/dsh-bundles' > /tmp/bundle-sources.txt
pnpm market:generate --upstream /absolute/path/to/pinned-dsh \
  --input /tmp/bundle-sources.txt --output _site/index.json --cache .plugin-market-cache
# 独立重验同一输出（同样需要读取远端 refs）：
pnpm market:validate --upstream /absolute/path/to/pinned-dsh \
  --input /tmp/bundle-sources.txt --output _site/index.json --cache .plugin-market-cache
```

生成和校验可加 `--release-tag '<完整包名>@<version>' --release-commit '<peeled commit>'` 检查触发版本。默认拒绝空市场；新 namespace 首次发布前，**非部署** PR 校验可显式加 `--allow-empty`，部署不得传入。读取源失败即非零退出，即使存在 fallback 也不可部署。

[补丁](<scripts/patches/market-package-tags-only.patch>)仅修改固定版本的 CLI 与 GenerateOptions：`--package-tags-only <逗号分隔完整包名>` / `packageTagsOnly?: readonly string[]`，未提供时维持上游默认行为。[准备器](<scripts/market-source.mjs>)核实 HEAD 和相关 tracked 源码/锁文件无漂移，以 `git archive` 导出固定 revision，在独立临时目录 `git apply --check` 后应用；原 checkout 不修改，依赖复用其安装，shared format-1 validator 从固定源码加载，不要求 build。

缓存：保持上游 `CACHE_VERSION=7`，但 strict 正常结果及 last-success key 均加入 `package-tags-only-v1` 和排序去重 allowlist；不可复用旧模式结果。不可变的 commit/path manifest、display 缓存仍可安全共享。入口再强制写入 `<cache>/package-tags-only-v1`；CI cache key/restore-prefix 应包含该策略、上游 SHA 和补丁 hash，不能退回无策略的 restore-prefix。

真实 fixture gate 完全离线：核心测试仅允许 file transport；生产 CLI/校验 worker 测试用本地 upload-pack 脚本替代 SSH，无网络客户端。覆盖 named/annotated tags、精确 prerelease/build metadata、private 可见、未 tag main/统一 tags/旧身份/manifest 不匹配排除、同版本 commit、旧模式→strict 缓存和失败 fallback，以及原 validator/图标；缺上游参数或依赖时硬失败，**CI 必须显式运行，不得只跑静态 gate**。入口会清理自己的已验证临时目录，不 checkout/fetch/改动提供的上游源码。

`_site/`、`.plugin-market-cache/` 与 CI 使用的 `.dsh-source/` 均已忽略；不要将仓库根目录或缓存目录作为 Pages artifact 发布。
