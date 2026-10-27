# 插件市场自动发布

[CI 工作流](<.github/workflows/ci.yml>) 使用 DSH 官方 reference generator，自动生成索引及图标并分发到 GitHub Pages；不需要自建后端，也不向 Git 提交生成结果。
CI 根据 `GITHUB_SERVER_URL` 和 `GITHUB_REPOSITORY` 自动取得当前仓库 URL，在 runner 临时目录生成输入清单，
由生成器从远端默认分支发现各 bundle 子目录。无需在仓库中维护静态清单，临时清单也不会进入 Pages artifact。
同一工作流的 `test` job 在 PR、tag 和手动运行时使用 Node 24，依次执行 `pnpm install --frozen-lockfile`、`pnpm lint`（只读）、`pnpm test:lint`（根检查器真实 CLI 正反例）和 `pnpm -r test`（bundle 行为测试）；根 scripts 不会被递归测试自动执行，必须显式运行。部署仍要求 `market` 与 `test` 都通过。

根 [工具 manifest](<package.json>) 只承载精确固定的开发工具，不声明 `dsh.bundle`；市场继续通过 [workspace globs](<pnpm-workspace.yaml>) 发现 bundle 子目录，根工具不会变成市场包。lint 同时拒绝未被 workspace 覆盖的 bundle，避免新增目录绕过本地检查。兼容范围、共享实例分类与静态检查边界见[依赖策略](<dependency-policy.md>)。

## 首次启用

1. 将本次配置推送到 GitHub 的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Test bundles and publish plugin market → Run workflow** 选择 `main` 运行。
4. 若 `github-pages` environment 有分支限制，允许 `main` 以及用于发布的 tags；有审批规则时需完成审批。
5. 确认工作流部署成功，打开 [README](<README.md>) 中的市场索引 URL，应直接得到 JSON（HTTP 200，不能重定向）；随后在 DSH 添加索引源。

自动发布仅由 `<完整包名>@<version>` 格式的 tag 推送触发，例如 `@local/dsh-shell-timeout-guidance@1.2.0`。
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
  git tag '@local/dsh-shell-timeout-guidance@1.2.0' <release-commit>
  git push origin 'refs/tags/@local/dsh-shell-timeout-guidance@1.2.0'
  ```
- 生成器也识别统一 `vX.Y.Z` / `X.Y.Z` tag，但本工作流不会因这类 tag 自动发布；手动生成时仍会收录它们。
- 索引收录范围沿用原生生成器：默认分支上各包的当前版本也会被收录；同一个版本已有 tag 时，tag 优先。
  限制发布触发条件不等于“仅收录已打 tag 的版本”，给一个包打 tag 也可能同时更新其他包的默认分支版本。
- 生成器读取的是远端 refs，不是本地工作树；未推送的修改不会进入索引。
  PR 校验因此只验证生成流程，不保证尚未合并的 bundle 修改可被正确收录。
- 生成器已做索引格式校验；任一源读取失败（非零退出码）或最终索引为空时，工作流失败，不部署，保留线上上次成功版本。
  单个版本因无效 manifest / 兼容范围被跳过可能仅产生 warning，应检查生成日志。
- 仅上传 `_site/`（`index.json` 及所需 `icons/`）。`.plugin-market-cache/` 通过 Actions cache 保存，不对外发布。
- 上游生成器固定到工作流中的 `DSH_REF` commit。升级时先更新该 SHA，再通过 PR 生成校验，避免定时任务自动执行未知的新版本。

## 本地生成

需有 DSH 源码 checkout，并按其开发说明安装生成器依赖；本地示例还使用 GitHub CLI（`gh`）从 Git remote 识别仓库。
设置实际路径，在本仓库执行；临时清单在命令结束时清理：

```bash
(
  set -e
  DSH_SOURCE="$HOME/repos/deepseek-harness"
  BUNDLE_ROOT="$PWD"
  SOURCE_LIST="$(mktemp)"
  trap 'rm -f -- "$SOURCE_LIST"' EXIT
  gh repo view --json url --jq .url > "$SOURCE_LIST"
  pnpm --dir "$DSH_SOURCE" --filter @deepseek-ai/dsh-plugin-market-generator start \
    --input "$SOURCE_LIST" \
    --output "$BUNDLE_ROOT/_site/index.json" \
    --cache "$BUNDLE_ROOT/.plugin-market-cache" \
    --title 'ffff2004 DSH Bundles' \
    --description 'Personal DeepSeek Harness bundles by ffff2004'
)
```

`_site/`、`.plugin-market-cache/` 与 CI 使用的 `.dsh-source/` 均已忽略；不要将仓库根目录或缓存目录作为 Pages artifact 发布。
