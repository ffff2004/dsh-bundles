# 插件市场自动发布

[工作流](<.github/workflows/plugin-market.yml>) 使用 DSH 官方 reference generator，自动生成索引及图标并分发到 GitHub Pages；不需要自建后端，也不向 Git 提交生成结果。
CI 根据 `GITHUB_SERVER_URL` 和 `GITHUB_REPOSITORY` 自动取得当前仓库 URL，在 runner 临时目录生成输入清单，
由生成器从远端默认分支发现各 bundle 子目录。无需在仓库中维护静态清单，临时清单也不会进入 Pages artifact。

## 首次启用

1. 将本次配置推送到 GitHub 的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Publish plugin market → Run workflow** 选择 `main` 运行。
4. 若 `github-pages` environment 有分支限制，允许 `main` 以及用于发布的 tags；有审批规则时需完成审批。
5. 确认工作流部署成功，打开 [README](<README.md>) 中的市场索引 URL，应直接得到 JSON（HTTP 200，不能重定向）；随后在 DSH 添加索引源。

触发条件为 `main` 推送、任意 tag 推送、手动运行，以及每 6 小时一次（UTC `00:23 / 06:23 / 12:23 / 18:23`，GitHub 可能延迟调度）。
Pull request 只生成和校验 artifact，不部署；手动运行也只允许 `main` 或 tag 部署。
GitHub 对公开仓库长期无活动的定时工作流可能自动停用，届时需在 Actions 中重新启用。

## 发布与失败处理

- 修改 bundle 时同步递增其 `package.json` 中的 SemVer 版本。
- 如需保留历史版本，给包含该版本 manifest 的 commit 打 tag 并推送。支持统一 `vX.Y.Z` / `X.Y.Z`，
  或单包 `<name>@X.Y.Z`，例如 `@local/dsh-shell-timeout-guidance@1.1.0`。
  统一 tag 只收录 manifest 版本与 tag 相符的包；单包 tag 更适合各 bundle 独立发布。
- 默认分支上各包的当前版本也会被收录；同一个版本已有 tag 时，tag 优先。
  只改代码而不递增版本号，不应视为一次新发布，尤其不能用它更新已打 tag 的版本。
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
