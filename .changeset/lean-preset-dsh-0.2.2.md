---
"@ffff2004-dsh-packages/lean-preset": major
---

支持 DSH 0.2.2，放弃 0.2.1。0.2.1 宿主继续使用 1.1.4，市场按 `engines.dsh` 分流。

- `engines.dsh` 收紧为 `>=0.2.2-rc.1 <0.3.0-0`。
- 删除 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 行：该子路径在 0.2.2 已移除，保留会让三个 preset 全部挂载失败；`list_agents` 由主 control 行提供。
- 子代理显式模型选择改用 `modelSelection: true` 与 `modelDiscovery: true`；旧的 `modelSelectionSettings` 键在新宿主上会被静默忽略。
- 删除 `tool-order` 插件及 `./tool-order` 导出：0.2.2 的 `system-prompt/assemble` 不再携带工具列表，lean-cordis 的工具排序随之移除，工具按名称排序。
- `lean-ptc` 改挂 `@deepseek-ai/dsh-tool-executor-ptc`，替代已弃用的 `@deepseek-ai/dsh-agent-tool-presentation`。
- `agent-instructions.maxBytes` 改为每条指令链各自计算（用户全局链与项目链各 65536），最坏情况约为旧版的两倍。
