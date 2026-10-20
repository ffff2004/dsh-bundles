# Lean agent presets

提供两个轻量级 agent preset，使用标准系统提示拼装，保留工具指导和动态运行时上下文。

| ID | 显示名称 | 能力 |
| --- | --- | --- |
| `lean` | 轻量模式 | 基础轻量工具集 |
| `lean-cordis` | 轻量创造模式 | 与 lean 相同的基础能力，外加 Cordis 插件开发与管理 |

## 共同能力

- 提供一次性 Shell、文件读写、Skills、Web、后台任务、定时提醒与委派工具。
- 定时提醒提供 `schedule_create/list/update/delete`，支持一次性、周期性及 Cron 规则；依赖宿主的 `@deepseek-ai/dsh-schedule` 服务，到期向原会话投递消息，执行依赖 DSH Host 运行。委派子代理不能使用提醒工具。
- 加载用户全局及项目目录链中的 `AGENTS.md` 指令。
- 两者使用相同 Persona 和上下文压缩配置；均不挂载 Todo、Goal、Plan mode、`subagent_fork`、`workflow` 或结构化问答工具。

## 轻量创造模式的增量

- `@deepseek-ai/dsh-tool-cordis`：提供 `cordis_inspect_list/query`，只读发现 Host／Client 接口、配置、工具和 UI Slots，不能直接调用业务服务或修改运行环境。
- 在现有 `skill-filesystem` 中追加安装包内的 `@deepseek-ai/dsh-agent-preset/skills` 目录，加载官方插件开发、preset 编辑及 composition reference 等技能；保留默认项目和用户技能目录。
- `@deepseek-ai/dsh-plugin-manager/tools`：安装、启停和移除插件／bundle。
- `@deepseek-ai/dsh-plugin-market/tools`：发现和安装市场插件。

管理和市场工具仅在存在 `profileContext` 时启用，仍受宿主权限与审批策略约束。Inspect providers、插件管理器和市场等服务由宿主提供，本 bundle 不重复创建 Host 服务。

两个 preset 是独立的完整声明，不存在 `extends` 继承。维护时应同步基础插件清单，避免基础能力漂移。

## 工具排序

仅 `lean-cordis` 挂载本 bundle 的 `@local/dsh-lean-preset/tool-order` 插件，通过 scope-filtered 的 `system-prompt/assemble` waterfall，在 `await next()` 返回后将以下四个额外工具移到尾部：

- `cordis_inspect_list`
- `cordis_inspect_query`
- `plugin_manager`
- `plugin_market`

这是稳定分区：基础工具和额外工具各自保留传入的相对顺序；未注册或不可见的工具不会被添加，也不会因此报错。插件不修改 schema、prompt sections、runtime context 或权限，不发布服务，不覆盖宿主 `toolOrder`，不影响 `lean` 或其他 preset。注册随 preset scope 卸载；后续外层 waterfall 仍可能重新排序。

此策略仅用于对齐两个 preset 的共同工具前缀，不保证 GPT-5.6+ 的 prefix cache 命中率提高；服务端缓存还依赖匹配断点、完整渲染前缀和后端行为。

在仓库根目录运行 `node --test lean-preset/tool-order.test.js` 验证稳定排序、waterfall 兼容和挂载范围。

## 使用

通过 Harness Plugin Manager 安装本目录，然后在新会话中选择“轻量模式”或“轻量创造模式”。包名为 `@local/dsh-lean-preset`。更新 bundle 后，已有会话保留原 preset 版本，新建会话使用新版本。

此 bundle 依赖宿主提供工具注册表、Shell 执行器、文件系统及权限等服务。升级 DSH 后，应重新验证系统提示与工具装配。
