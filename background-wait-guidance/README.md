# 后台等待指引

当没有其他独立工作时，引导模型先告知用户等待对象，再让出当前 turn 等待后台完成通知，避免通过工具反复查询进度。一个 bundle 内包含两个独立 plugin，不修改 DSH 内置代码。

## 启用与禁用

安装后，在 Plugin Manager 中分别启停，无须修改配置文件：

| Plugin | 条目 ID | 模块名 | 作用 |
| --- | --- | --- | --- |
| Jobs 等待指引 | `background-wait-jobs` | `@local/dsh-background-wait-guidance/jobs` | 建议告知用户等待哪些 jobs 后结束 turn，等待完成通知。 |
| 子代理等待指引 | `background-wait-subagents` | `@local/dsh-background-wait-guidance/subagents` | 建议告知用户等待哪些子代理后结束 turn，等待完成或消息通知。 |

两个插件默认均启用，无配置项；也可禁用整个 bundle。禁用任一插件只移除其提示，不影响另一个插件，不改变工具执行或通知策略，也不会强制模型阻塞等待。

`tool-jobs` 使用默认 `completionDelivery: wakeup` 且未限制连续唤醒次数时，可以启用 jobs 指引。使用 `completionDelivery: quiet` 或可能耗尽的连续唤醒次数上限时，建议禁用 Jobs 等待指引，保留模型默认等待行为。插件不读取或复制内部唤醒计数；通知策略改变时，应同步调整插件启停状态。

## 行为

- jobs plugin 在 `jobs` 服务挂载时注册 system prompt section，subagents plugin 在 `subagents` 服务挂载时注册 section，两者互不依赖；不注入 user-role runtime-context 快照。
- 每次组装请求时检查当前 agent 可见的工具：仅对可见 `job_output` 的 agent 显示 jobs 提示，仅对可见 `send_message` 的 agent 显示子代理提示。
- 服务或插件卸载时，对应注册自动清理；恢复挂载时重新注册。
- jobs section 的顺序为 `getSectionOrder('TOOL_JOBS') + 1`，子代理 section 为 `getSectionOrder('TOOL_SUBAGENT') + 1`，分别排在对应工具 section 之后；其他插件仍可能插入同一区间，不保证严格相邻。均按字面文本渲染，不做模板插值。
- 等待消息不表示任务已经完成。提示正文与拆分前保持一致，两个插件同时启用不会增加提示正文长度。

## 从 1.x 迁移

2.0 移除了旧条目 `background-wait-guidance`、包根 plugin 导出及 `jobsWaitMode` 配置，改为以上两个独立条目。

- 之前使用 `jobsWaitMode: yield`（默认）：保持两个新插件启用。
- 之前使用 `jobsWaitMode: blocking`：禁用新的 Jobs 等待指引，保留子代理等待指引。
- 之前禁用旧插件：按需禁用两个新插件。整个 bundle 的禁用状态仍由 Plugin Manager 管理。
- 若 profile 有针对旧条目 ID 的手写覆盖，需移除旧覆盖，并改为管理新条目；旧配置和逐插件开关不会自动迁移。无需再为新插件填写 `config`。

## 安装

通过 Plugin Manager 安装本目录。安装会影响当前 profile 中的所有 session。是否实时生效以安装结果的 `application` 字段为准；替换已安装包可能需要重启 DSH。支持 DSH `0.2.1-rc.2`。

## 验证

```bash
pnpm install --ignore-scripts --config.auto-install-peers=false
pnpm test
```

测试使用开发依赖中的真实 Cordis 和 systemPrompt 服务，验证两个插件独立启停、恢复、可选服务挂载与卸载、注册清理、按 agent scope 的工具可见性；同时验证指令仅渲染到 system prompt、关闭可选运行时上下文后仍然存在，以及 complete system prompt 的替换行为。不调用模型 API。

## 限制与模型影响

仅注入提示，不改变工具、通知交付、后台工作或主 agent 生命周期，不保证模型一定遵循。指令位于 system prompt，关闭可选运行时上下文（如 persona 的 `includeRuntimeContext: false`）不会移除它们；但使用 `complete: true` 完整替换 system prompt 的 section 会替换掉本插件的 section。system 指令比 user 消息优先级更高，临时用户要求可能无法覆盖固定的等待策略。不自动检测通知策略或剩余唤醒额度，也不处理 goals、schedule 或 session 恢复后的后台任务恢复。已有内置等待提示保持不变；本插件补充“发送等待消息后结束 turn”的行为说明。

每个启用且可见的能力最多增加一个短 system prompt section，无额外工具调用；插件禁用、服务未挂载或工具不可见时不产生对应提示正文。不主动纠正历史中残留的旧提示，也不删除或重写旧 runtime-context 快照。启停插件或变更工具可见性会改变 system prompt，可能影响 prompt cache 复用。

bundle 及两个插件共享本 bundle 原创 SVG 图标，各自导出独立的中英文显示元数据，不依赖客户端代码。
