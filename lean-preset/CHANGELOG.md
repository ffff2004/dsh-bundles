# @ffff2004-dsh-packages/lean-preset

## 2.0.0

### Major Changes

- a52948e: 支持 DSH 0.2.2，放弃 0.2.1。0.2.1 宿主继续使用 1.1.4，市场按 `engines.dsh` 分流。
  
  - `engines.dsh` 收紧为 `>=0.2.2-rc.1 <0.3.0-0`。
  - 删除 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 行：该子路径在 0.2.2 已移除，保留会让三个 preset 全部挂载失败；`list_agents` 由主 control 行提供。
  - 子代理显式模型选择改用 `modelSelection: true` 与 `modelDiscovery: true`；旧的 `modelSelectionSettings` 键在新宿主上会被静默忽略。
  - 删除 `tool-order` 插件及 `./tool-order` 导出：0.2.2 的 `system-prompt/assemble` 不再携带工具列表，lean-cordis 的工具排序随之移除，工具按名称排序。
  - `lean-ptc` 改挂 `@deepseek-ai/dsh-tool-executor-ptc`，替代已弃用的 `@deepseek-ai/dsh-agent-tool-presentation`。
  - `agent-instructions.maxBytes` 改为每条指令链各自计算（用户全局链与项目链各 65536），最坏情况约为旧版的两倍。

## 1.1.4

### Patch Changes

- dfde0e5: 以 `@ffff2004-dsh-packages/` scope 和不含 `dsh-` 前缀的新包名首次发布，纳入当前尚未发布的改进。新名称是独立包身份，不提供旧 `@local/dsh-*` 名称的兼容入口或自动迁移；旧用户需移除旧包及配置引用，再安装并配置新包，避免重复加载。原有版本历史不转移至新身份，后续版本独立递增。
- c1ab742: 补充主页与源码仓库元数据，便于从插件市场详情直接访问对应 bundle 的 GitHub 说明目录及源码仓库；安装来源仍固定到发布 commit。
