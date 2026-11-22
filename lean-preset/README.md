# Lean agent presets

提供三个轻量级 agent preset，使用标准系统提示拼装，保留工具指导和动态运行时上下文。

| ID | 显示名称 | 能力 |
| --- | --- | --- |
| `lean` | 轻量模式 | 基础轻量工具集 |
| `lean-cordis` | 轻量创造模式 | 与 lean 相同的基础能力，外加 Cordis 插件开发与管理 |
| `lean-ptc` | 轻量 PTC 模式 | 与 lean 相同的基础能力，通过 `run_code` 与工具 SDK 进行程序化工具调用 |

## 共同能力

- 提供一次性 Shell、文件读写（含多文件 `apply_patch`）、结构化提问（`ask_user_question`）、Skills、Web、后台任务、定时任务与 subagent 工具。
- 加载用户全局及项目目录链中的 `AGENTS.md` 指令。

## 轻量创造模式的增量

- `@deepseek-ai/dsh-tool-cordis`：提供 `cordis_inspect_list/query`，只读发现 Host／Client 接口、配置、工具和 UI Slots，不能直接调用业务服务或修改运行环境。
- 在现有 `skill-filesystem` 中追加 `@deepseek-ai/dsh-agent-preset/skills` 目录；保留默认项目和用户技能目录。
- `@deepseek-ai/dsh-plugin-manager/tools`：安装、启停和移除插件／bundle。
- `@deepseek-ai/dsh-plugin-market/tools`：发现和安装市场插件。

三个 preset 是独立的完整声明，不存在继承。维护时应同步基础插件清单，避免基础能力漂移。

## 轻量 PTC 模式

`lean-ptc` 的基础插件配置与 `lean` 完全相同，仅增加 `@deepseek-ai/dsh-tool-executor-ptc`。

- 模型仅看到 `run_code` 工具 schema 和生成的工具 SDK，通过代码中的 `await tools.read(...)` 等绑定调用工具，不能直接调用 SDK 工具名。保留官方 PTC 调用指导，不覆盖 Persona 或系统提示。
- 宿主必须已挂载 `@deepseek-ai/dsh-ptc-runtime-node` 提供 `ptcRuntime`；缺失时不会进入 PTC 模式。工具注册表和运行时仍由 Host 提供。

## 使用

通过 Harness Plugin Manager 安装本目录，然后在新会话中选择“轻量模式”“轻量创造模式”或“轻量 PTC 模式”。包名为 `@ffff2004-dsh-packages/lean-preset`。更新 bundle 后，已有会话保留原 preset 版本，新建会话使用新版本。

此 bundle 依赖宿主提供工具注册表、Shell 执行器、文件系统及权限等服务。升级 DSH 后，应重新验证系统提示与工具装配。

## 兼容性

实现和单元测试面向 `0.2.2-rc.3`，已在 `0.2.2-rc.1`, `0.2.2-rc.3` 上实测可用。
