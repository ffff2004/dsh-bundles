# Lean agent preset

提供轻量级 `lean` agent preset（显示名称：轻量模式），使用标准系统提示拼装，保留工具指导和动态运行时上下文。

## 主要功能

- 提供一次性 Shell、文件读写、Skills、Web、后台任务与委派工具。
- 加载用户全局及项目目录链中的 `AGENTS.md` 指令。
- 仅在此 preset 内屏蔽 Harness 身份、实现源码位置与 Web 界面说明三段系统提示，不影响其他 preset。
- 装配时检查被屏蔽的提示是否泄漏；检测到泄漏则报错，避免上游变化后静默失效。

## 使用

通过 Harness Plugin Manager 安装本目录，然后在会话中选择“轻量模式”。包名为 `@local/dsh-lean-preset`。

此 bundle 依赖宿主提供工具注册表、Shell 执行器、文件系统及权限等服务。升级 DSH 后，应重新验证提示屏蔽逻辑与工具装配。
