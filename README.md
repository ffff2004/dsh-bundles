# 本地 DSH Bundles

本仓库存放 DeepSeek Harness（DSH）的本地 bundle。各 bundle 的功能、配置与使用限制见下方子 README。

## Bundle 列表

| Bundle | 简介 |
| --- | --- |
| [codex-live](<codex-live/README.md>) | 注册跟随本机 Codex CLI 模型缓存的 LLM route，使用其认证信息，并为 catalog 尚未收录的模型补充能力模板。 |
| [dsh-shell-description](<dsh-shell-description/README.md>) | 从 agent 可见的 `bash` / `pwsh` 工具定义中隐藏 `description` 参数，执行时补入兼容描述，不改变命令与权限语义。 |
| [lean-preset](<lean-preset/README.md>) | 提供轻量级 agent preset，保留文件、Shell、Skills、Web、后台任务与委派工具，精简部分 Harness 系统提示。 |
| [preview-download](<preview-download/README.md>) | 在 Web UI 文档预览工具栏添加下载按钮，通过浏览器下载当前预览文件。 |
| [shell-timeout-guidance](<shell-timeout-guidance/README.md>) | 为可见的 `bash` / `pwsh` 工具添加提示，引导模型省略不必要的 `timeoutMs`，不修改默认超时或工具参数。 |
| [skill-name-mapping](<skill-name-mapping/README.md>) | 自动发现本地技能，将技能名称中的 ASCII 大写字母映射为小写；不修改源文件，并检查非法名称与命名冲突。 |

## 使用

通过 Harness Plugin Manager 将对应子目录安装为 bundle。具体配置、版本兼容性及重启要求以各 bundle 的 README 为准。
