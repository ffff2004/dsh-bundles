# Lean agent presets

提供三个轻量级 agent preset，使用标准系统提示拼装，保留工具指导和动态运行时上下文。

| ID | 显示名称 | 能力 |
| --- | --- | --- |
| `lean` | 轻量模式 | 基础轻量工具集 |
| `lean-cordis` | 轻量创造模式 | 与 lean 相同的基础能力，外加 Cordis 插件开发与管理 |
| `lean-ptc` | 轻量 PTC 模式 | 与 lean 相同的基础能力，通过 `run_code` 与工具 SDK 进行程序化工具调用 |

## 共同能力

- 提供一次性 Shell、文件读写、Skills、Web、后台任务、定时提醒与委派工具。
- 定时提醒提供 `schedule_create/list/update/delete`，支持一次性、周期性及 Cron 规则；依赖宿主的 `@deepseek-ai/dsh-schedule` 服务，到期向原会话投递消息，执行依赖 DSH Host 运行。委派子代理不能使用提醒工具。
- 加载用户全局及项目目录链中的 `AGENTS.md` 指令。
- 三者使用相同 Persona 和上下文压缩配置；均不挂载 Todo、Goal、Plan mode、`subagent_fork`、`workflow` 或结构化问答工具。

## 轻量创造模式的增量

- `@deepseek-ai/dsh-tool-cordis`：提供 `cordis_inspect_list/query`，只读发现 Host／Client 接口、配置、工具和 UI Slots，不能直接调用业务服务或修改运行环境。
- 在现有 `skill-filesystem` 中追加安装包内的 `@deepseek-ai/dsh-agent-preset/skills` 目录，加载官方插件开发、preset 编辑及 composition reference 等技能；保留默认项目和用户技能目录。
- `@deepseek-ai/dsh-plugin-manager/tools`：安装、启停和移除插件／bundle。
- `@deepseek-ai/dsh-plugin-market/tools`：发现和安装市场插件。

管理和市场工具仅在存在 `profileContext` 时启用，仍受宿主权限与审批策略约束。Inspect providers、插件管理器和市场等服务由宿主提供，本 bundle 不重复创建 Host 服务。

三个 preset 是独立的完整声明，不存在 `extends` 继承。维护时应同步基础插件清单，避免基础能力漂移。

## 轻量 PTC 模式

`lean-ptc` 的基础插件配置与 `lean` 完全相同，仅增加 `@deepseek-ai/dsh-agent-tool-presentation`，显式设置 `mode: ptc`。这与内置 `ptc` 相对 `standard` 的 presentation 增量一致；内置 PTC 还禁用了两个 workflow 插件，但 lean 本来就不挂载它们，无需添加。

- 模型仅看到 `run_code` 工具 schema 和生成的工具 SDK，通过代码中的 `await tools.read(...)` 等绑定调用工具，不能直接调用 SDK 工具名。保留官方 PTC 调用指导，不覆盖 Persona 或系统提示。
- 宿主必须已挂载 `@deepseek-ai/dsh-ptc-runtime-node`，提供 `ptcRuntime`。工具注册表和运行时仍由 Host 提供；本 preset 不重复创建，也不隔离它们。缺少运行时时 preset 挂载会失败。
- PTC 不是工具白名单沙箱：程序也可直接使用 Node 文件、网络和子进程 API，实际约束来自宿主 sandbox；通过 SDK 的工具调用仍经过原有权限、审批和日志路径。
- 保留后台任务和子代理能力。spawn 子代理默认继承父代理的 preset revision；显式选择其他 preset 时以宿主策略为准。委派子代理仍不能使用提醒工具。
- 不承诺减少 token 或提高缓存命中率：SDK 仍包含可见工具的契约。此模式不挂载 `lean-cordis` 的工具排序插件。
- 新增该 preset 不更改默认 preset，也不改动现有 `lean`、`lean-cordis` 声明；后两者继续继承宿主的工具呈现默认值。

安装后，在新会话中选择“轻量 PTC 模式”，确认模型只收到 `run_code` schema，再通过 `tools.read` 读取一个现有文件；按需检查后台任务和子代理调用。已有会话不会切换到新的 preset revision。

## 工具排序

仅 `lean-cordis` 挂载本 bundle 的 `@local/dsh-lean-preset/tool-order` 插件，通过 scope-filtered 的 `system-prompt/assemble` waterfall，在 `await next()` 返回后将以下四个额外工具移到尾部：

- `cordis_inspect_list`
- `cordis_inspect_query`
- `plugin_manager`
- `plugin_market`

这是稳定分区：基础工具和额外工具各自保留传入的相对顺序；未注册或不可见的工具不会被添加，也不会因此报错。插件不修改 schema、prompt sections、runtime context 或权限，不发布服务，不覆盖宿主 `toolOrder`，不影响 `lean` 或其他 preset。注册随 preset scope 卸载；后续外层 waterfall 仍可能重新排序。

### 为什么可能改善缓存复用

默认按工具名称排序时，`cordis_inspect_*` 会插在基础工具之间，提前打断 `lean` 与 `lean-cordis` 的共同工具前缀。将独有工具后置后，工具序列变为 `lean = [共同工具]`、`lean-cordis = [共同工具][额外工具]`。如果服务端渲染保留这种顺序，且前面没有其他差异，就可能增加跨 preset、跨 session 的公共输入前缀长度。同一 preset 的排序本来就稳定，不能据此推断其跨 session 命中率会额外提高。

- **DeepSeek API：**[上下文硬盘缓存文档](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)说明，系统会检测多次请求的公共前缀并将其独立落盘，也会在长输入/输出中按固定 token 间隔落盘。因此更长的共同工具前缀有机会成为可复用的缓存前缀单元；新检测的公共前缀不一定立即命中，构建为秒级，缓存仍是尽力而为。
- **GPT-5.6+：**[OpenAI 缓存文档](https://developers.openai.com/api/docs/guides/prompt-caching.md#how-prefix-matching-works)说明，查找依赖合格消息结束位置或显式 breakpoint，而非任意 token 位置。工具列表中的共同前缀末尾不一定是可用断点，因此仅对齐 schema 顺序不足以保证收益；ChatGPT 后端也不保证与该 API 文档完全一致。

此排序只改变工具 schema 的顺序，不同步重排系统提示中的工具指导、Skills catalog 或其他消息；这些内容及服务端隐藏渲染也可能提前打断公共前缀。尚未通过真实请求验证缓存收益。DeepSeek 可比较多次预热后交替使用两个 preset 的 `usage.prompt_cache_hit_tokens` / (`prompt_cache_hit_tokens` + `prompt_cache_miss_tokens`)；OpenAI API 可比较 `usage.input_tokens_details.cached_tokens`、`cache_write_tokens` 和实际成本，并保持模型、设置及其余输入条件一致。

在仓库根目录运行 `pnpm --filter @local/dsh-lean-preset test`，验证 YAML（含惰性 `!!js`）、PTC 与 lean 的基础配置一致性、隔离组、稳定排序、waterfall 兼容和挂载范围，以及每个带 `config` 的插件行都被对应上游包导出的 schemastery `Config` 接受（含嵌套键；含 Loader 表达式的行只校验键名，表达式值不求值；`dsh-compaction-tool-result-pruner` 用其 `resolveConfig`，未知键会抛错）。

## 使用

通过 Harness Plugin Manager 安装本目录，然后在新会话中选择“轻量模式”“轻量创造模式”或“轻量 PTC 模式”。包名为 `@local/dsh-lean-preset`。更新 bundle 后，已有会话保留原 preset 版本，新建会话使用新版本。

此 bundle 依赖宿主提供工具注册表、Shell 执行器、文件系统及权限等服务。升级 DSH 后，应重新验证系统提示与工具装配。
