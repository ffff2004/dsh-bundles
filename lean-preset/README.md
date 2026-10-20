# Lean agent preset

提供轻量级 `lean` agent preset（显示名称：轻量模式），使用标准系统提示拼装，保留工具指导和动态运行时上下文。

## 主要功能

- 提供一次性 Shell、文件读写、Skills、Web、后台任务、定时提醒与委派工具。
- 定时提醒提供 `schedule_create/list/update/delete`，支持一次性、周期性及 Cron 规则；依赖宿主的 `@deepseek-ai/dsh-schedule` 服务，到期向原会话投递消息，执行依赖 DSH Host 运行。委派子代理不能使用提醒工具。
- 加载用户全局及项目目录链中的 `AGENTS.md` 指令。

## 使用

通过 Harness Plugin Manager 安装本目录，然后在会话中选择“轻量模式”。包名为 `@local/dsh-lean-preset`。

此 bundle 依赖宿主提供工具注册表、Shell 执行器、文件系统及权限等服务。升级 DSH 后，应重新验证系统提示与工具装配。
