# 后台等待指引

当没有其他独立工作时，引导模型先告知用户等待对象，再让出当前 turn 等待后台完成通知，避免通过工具反复查询进度。独立 bundle，不修改 DSH 内置代码。

## 行为

- `jobs` 服务挂载时注册 jobs system prompt section，`subagents` 服务挂载时注册子代理 section，两者互不依赖；不再注入 user-role runtime-context 快照。jobs section 的顺序为 `getSectionOrder('TOOL_JOBS') + 1`，子代理 section 为 `getSectionOrder('TOOL_SUBAGENT') + 1`，分别排在对应工具 section 之后；其他插件仍可能插入同一区间，不保证严格相邻。均按字面文本渲染，不做模板插值。
- 每次组装请求时检查当前 agent 可见的工具：仅对可见 `job_output` 的 agent 显示 jobs 提示，仅对可见 `send_message` 的 agent 显示子代理提示。
- 服务或插件卸载时，对应注册自动清理；恢复挂载时重新注册。
- 默认 jobs 和子代理都建议告知用户等待对象后结束当前 turn，由完成通知触发后续处理；等待消息不表示任务已经完成。
- `jobsWaitMode: blocking` 不注入 jobs 指引，保留模型默认等待行为；子代理指引不受影响。不保证模型一定阻塞等待。

## 配置

插件条目 ID：`background-wait-guidance`；包名：`@local/dsh-background-wait-guidance`。

```yaml
config:
  jobsWaitMode: yield
```

| `jobsWaitMode` | 指令 | 适用场景 |
| --- | --- | --- |
| `yield`（默认） | 告知用户等待哪些 jobs，然后结束 turn；收到通知后读取结果。 | `tool-jobs` 使用默认 `completionDelivery: wakeup` 且未限制连续唤醒次数。 |
| `blocking` | 不注入 jobs 指令，保留模型默认等待行为；保留此配置值以兼容现有配置。 | `completionDelivery: quiet`，或配置了可能耗尽的连续唤醒次数上限。 |

此配置只控制是否注入 jobs 提示，不修改 `tool-jobs` 的通知配置，不读取或复制其内部唤醒计数。修改内置通知策略时，应同步调整本插件配置。配置变更通过 Loader 重新激活插件，工具可见性在每次请求组装时重新读取。

## 安装

通过 Plugin Manager 安装本目录

安装会影响当前 profile 中的所有 session。是否实时生效以安装结果的 `application` 字段为准。支持 DSH `0.2.1-rc.2`。

## 验证

```bash
pnpm install --ignore-scripts --config.auto-install-peers=false
pnpm test
```

测试使用开发依赖中的真实 Cordis 和 systemPrompt 服务，验证可选服务挂载、卸载、恢复、插件清理、两种 jobs 策略和按 agent scope 的工具可见性；同时验证指令仅渲染到 system prompt、关闭可选运行时上下文后仍然存在，以及 complete system prompt 的替换行为。不调用模型 API。

## 限制与模型影响

仅注入提示，不改变工具、通知交付、后台工作或主 agent 生命周期，不保证模型一定遵循。指令位于 system prompt，关闭可选运行时上下文（如 persona 的 `includeRuntimeContext: false`）不会移除它们；但使用 `complete: true` 完整替换 system prompt 的 section 会替换掉本插件的 section。system 指令比 user 消息优先级更高，临时用户要求可能无法覆盖固定的等待策略。不自动检测通知策略或剩余唤醒额度，也不处理 goals、schedule 或 session 恢复后的后台任务恢复。已有内置等待提示保持不变；本插件补充“发送等待消息后结束 turn”的行为说明。

每个启用且可见的能力最多增加一个短 system prompt section，无额外工具调用；jobs 使用 `blocking`、未挂载服务或工具不可见时不产生对应提示正文。不再注入用于抵消旧 `jobsYield` 的反向指令，也不主动纠正历史中残留的旧提示。通常同一 session 内配置保持不变，但工具可见性仍会逐次检查；变化会改变 system prompt，可能影响 prompt cache 复用。迁移不主动删除或重写已有历史中的旧 runtime-context 快照。

图标为本 bundle 原创 SVG，不依赖客户端代码。
