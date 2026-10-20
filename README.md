# 本地 DSH Bundles

本仓库存放 DeepSeek Harness（DSH）的本地 bundle。各 bundle 的功能、配置与使用限制见下方子 README。

## Bundle 列表

| Bundle | 简介 |
| --- | --- |
| [background-wait-guidance](<background-wait-guidance/README.md>) | 通过 system prompt 引导模型在无独立工作时告知等待对象、让出 turn 等待后台完成通知；jobs 可配置简短的阻塞等待提醒。 |
| [codex-live](<codex-live/README.md>) | 注册跟随本机 Codex CLI 模型缓存的 LLM route，使用其认证信息，并为 catalog 尚未收录的模型补充能力模板。 |
| [dsh-shell-description](<dsh-shell-description/README.md>) | 从 agent 可见的 `bash` / `pwsh` 工具定义中隐藏 `description` 参数，执行时补入兼容描述，不改变命令与权限语义。 |
| [lean-preset](<lean-preset/README.md>) | 提供轻量级 agent preset，保留文件、Shell、Skills、Web、后台任务与委派工具，精简部分 Harness 系统提示。 |
| [preview-download](<preview-download/README.md>) | 在 Web UI 文档预览工具栏添加下载按钮，通过浏览器下载当前预览文件。 |
| [shell-timeout-guidance](<shell-timeout-guidance/README.md>) | 仅为可见且超时转后台的 `bash` / `pwsh` 添加提示，引导模型省略不必要的 `timeoutMs`；超时终止时不添加，不修改默认超时或工具参数。 |
| [skill-name-mapping](<skill-name-mapping/README.md>) | 自动发现本地技能，将技能名称中的 ASCII 大写字母映射为小写；不修改源文件，并检查非法名称与命名冲突。 |

## 使用

通过 Harness Plugin Manager 将对应子目录安装为 bundle。具体配置、版本兼容性及重启要求以各 bundle 的 README 为准。

### 从 GitHub 安装（GUI）

以 [shell-timeout-guidance](<shell-timeout-guidance/README.md>) 为例，仓库发布到 GitHub 后：

1. 在 Web GUI 侧栏打开 **插件 → 添加插件**。
2. 在“包名或地址”中输入以下 Git 地址：
   ```text
   git+https://github.com/ffff2004/dsh-bundles.git#HEAD&path:/shell-timeout-guidance
   ```
3. 点击 **安装**，按界面提示完成启用。

### 从 GitHub 安装（命令行）

在 `web` profile 中安装同一个 bundle：

```bash
dsh plugin --profile web add 'git+https://github.com/ffff2004/dsh-bundles.git#HEAD&path:/shell-timeout-guidance'
```

如使用其他 profile，将 `web` 替换为对应名称。整段地址需加引号，避免 shell 将 `&` 解释为后台运行符。

本仓库包含多个 bundle，必须通过 `path:/子目录` 指定要安装的那个，不能直接安装仓库根目录。`HEAD` 跟随仓库默认分支；如需固定版本，可替换为 tag 或 commit。
