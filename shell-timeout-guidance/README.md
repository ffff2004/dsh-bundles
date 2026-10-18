# Shell timeout guidance

独立的 Host 插件，引导模型省略不必要的 shell `timeoutMs` 参数。支持 `bash` 和 `pwsh`，不自动判断模型，不改变工具 schema、默认超时或调用参数。

根据当前 agent scope 中可见的工具，只贡献一条简短的 system-prompt section。例如两个工具都可见时：

> For bash and pwsh calls, omit `timeoutMs` unless the user requests a specific timeout or the command needs a deliberate override of the configured default. Do not routinely supply a timeout.

只有 bash 或 pwsh 时，提示只提及该工具；两个都不可见时不添加提示。

## 使用与迁移

- 包名：`@local/dsh-shell-timeout-guidance`；插件 ID：`shell-timeout-guidance`。
- 通过 Harness Plugin Manager 安装本目录作为 bundle，安装后默认启用；在管理器中启用或停用“Shell 超时指导 / Shell timeout guidance”。
- 旧版本名为 `@local/dsh-bash-timeout-guidance`。迁移时先移除旧 bundle，再安装本目录，避免重复贡献提示。不要手改 profile 配置。
- 修改已加载模块后通常需要重启 Harness，不能只依赖禁用再启用清除模块缓存。
- 当前 profile 中使用可见 bash/pwsh 的所有模型都受这条提示影响，由用户决定何时启用。
- 停用后，之后的 prompt assembly 不再贡献这段文字；已经记录的会话历史不被删除。
- 生效不等于模型保证遵循。可以用新会话对比普通调用省略参数、必要时显式设置参数的表现。
- 如果 preset 使用独占完整 system prompt，该 preset 可能不包含此 section。

## 装配时的上游描述检查

激活时只注册动态提示 section，不查询全局工具。每次 prompt assembly 时，用 `ctx.tools.get(shellName, scope)` 分别查询该 agent 实际可见的 bash/pwsh，读取 `parameters.properties.timeoutMs.description`（编译后的 JSON Schema），与人工确认的两份完整快照严格比较（超时转后台／超时终止）。已核对 DSH 0.2.1-rc.2 的 bash 和 pwsh 使用相同描述。

- Web 的 shell 工具由 agent preset 按 scope 注册；全局没有工具不影响启用。
- 不可见的工具（尚未注册、被隐藏或已卸载）不添加指导、不报错；之后的装配会重新查询。
- 任一可见 shell 的描述有差异（包括空白）或字段缺失时，抛出带工具名的错误，阻止该次 prompt 装配，直到人工审查更新快照或停用插件。另一个 shell 描述正常也不会掩盖该错误。
- 不自动接受上游变化；不修改上游描述。不同 scope 的检查互不影响。
- 每次装配重新校验，覆盖 scoped 覆盖以及启用后的工具注册、替换和卸载。
- 依赖 `tools` 和 `systemPrompt` 服务；未挂载时 Cordis 会等待依赖。

## 验证

运行 `pnpm test`（或 `node --test`）执行基础测试。同时设置 `DSH_SYSTEM_PROMPT_DIR` 和 `DSH_TOOLS_DIR`，分别指向同一 DSH 版本已安装的 `@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools` 包目录，可执行真实 Cordis 工具 registry 集成测试；未设置时该项跳过。

测试覆盖 bash-only、pwsh-only、两者同时可见、两者均缺失、描述漂移、工具动态注册、多 agent 隔离、scoped 覆盖、工具限制、插件卸载及工具 schema 不变。集成测试不启动 PowerShell 进程。

插件没有运行时依赖、构建步骤或安装脚本。英文／中文展示文本和原创终端时钟 SVG 图标随包分发。
