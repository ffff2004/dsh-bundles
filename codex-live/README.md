# @local/dsh-codex-live

一个 Host 插件 bundle：注册一条新的 LLM route（默认 `codex-live`），它的模型表跟随本机 codex CLI 的状态，而不是构建时生成的 pi-ai catalog；请求用它自己的 ChatGPT token。

## 为什么不是改 `llm-pi-ai` 配置

`llm-pi-ai` 的 profile 可以新增 catalog 尚未收录的模型，但该协议的能力开关（`supportsToolSearch`、`supportsAdditionalTools`、`supportsOpenAIGrammarTools`、`supportsMidConvoSystemMessages`）在配置层是 **withhold** 的——写了会被 `assertOfferedCompatFields` 直接拒绝，因为它们只由已安装的 catalog 提供。本插件把 `Model` 对象本身交给 pi-ai，因此：

- catalog 已收录的 id → 原样透传（只改 `provider`），compat / cost / 容量 / inputLimits 全部继承；
- catalog 未收录的 id → 从同族兄弟模型模板合成，compat 与 inputLimits 来自模板，name / contextWindow / modalities / reasoning levels 来自 codex 条目。

（对照：同一件事走配置写入路线时，新模型只能落到 `?? false` 的四个开关上。）

## 事实来源

| 事实 | 来源 |
|---|---|
| 模型清单 | `<codexHome>/models_cache.json`（codex CLI 每次运行时刷新） |
| 名称、上下文窗口、模态、reasoning 档位 | 上面的 codex 条目 |
| compat、inputLimits、maxTokens 模板 | 已安装 pi-ai catalog 的同族兄弟（默认最长公共前缀 + codex priority 择优） |
| Bearer token | `<codexHome>/auth.json` 的 `tokens.access_token`（回退 `OPENAI_API_KEY`） |

两个文件都**只读不写**，插件也不主动调用 codex：它的新鲜度等于你上次运行 codex 的时刻。token 每次请求重新读取，所以 codex 的刷新会自动生效；过期时给出指明文件与刷新方式的错误，而不是一个 401。

## 配置（`cordis.patch.yml` 里该行的 `config`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `route` | `codex-live` | route key；不能与其它 adapter 冲突（`openai-codex` 属于 `llm-pi-ai`） |
| `displayName` | `OpenAI Codex (live)` | 选择器与 Models 页显示名 |
| `codexHome` | `$CODEX_HOME` → `~/.codex` | codex 状态目录 |
| `baseUrl` | `https://chatgpt.com/backend-api` | codex 后端 |
| `includeHidden` | `false` | 是否也提供 codex 自己隐藏的模型（`gpt-reserve`、`gpt-5.5`、`codex-auto-review`） |
| `include` / `exclude` | `[]` | 按 id 强制纳入 / 排除 |
| `template` | `''` | 指定合成模板；空则自动择优 |
| `maxTokens` | `128000` | 合成模型的输出能力（codex 缓存不提供该字段） |
| `offEffort` | `''` | "未指定 effort" 时的 wire 拼写；空 = 不发 reasoning 块（= 模型默认）。只有确认该模型接受某个值（如 `none`）时才填 |
| `useEffectiveContextPercent` | `true` | 用条目的 `effective_context_window_percent` 折算上下文窗口（codex CLI 自己的算法） |
| `contextWindow` | `{}` | 按 id 覆盖上下文窗口 |
| `tokenRef` | `''` | codex home 里没有 token 时回退的 credentials 引用 |
| `watch` | `true` | codex 重写状态后自动重建（1.5s 合并窗口，内容未变不重注册） |

## 行为

- 挂载时读一次缓存并注册 route；`llm/adapters-updated` 会让已打开的模型选择器刷新，无需重启。
- codex 刷新缓存或 token 后，插件重建 catalog；**只有** id/名称/窗口/模态/reasoning 这一组签名变化时才重新注册，避免无谓 reload。
- 日志（`codex-live:` 前缀）会逐条说明哪些模型是合成的、用了哪个模板、窗口与档位是什么，以及 token 是否临近过期。
- 两条请求路径（`stream` / `streamSimple`）都通过 `onPayload` 在原回调执行后删除最终请求体的 `prompt_cache_key`；保留 `sessionId` 的传输层用途和原有 retention 设置，不关闭自动缓存。此策略面向仅使用 GPT-5.6+、无需按用户或会话隔离缓存核算的场景，对所有模型统一生效。[OpenAI API 文档](https://developers.openai.com/api/docs/guides/prompt-caching.md#prompt-cache-keys)说明这些模型无需 key 来优化路由；ChatGPT 后端的实际行为仍需以观测为准。

## 缓存复用动机与限制

pi-ai 原本将请求的 `sessionId` 用作 `prompt_cache_key`，相当于按会话分组。根据上述 OpenAI API 文档，GPT-5.6+ 自动处理缓存路由，key 主要用于分开缓存核算；本部署没有这种隔离需求，因此省略 key，避免不必要的会话级分组，可能有利于跨 session 复用相同前缀。它不是缓存开关，也不会让不同内容共享 KV 状态。

这不是已验证的命中率提升：仍需满足完整渲染前缀匹配、可用的缓存断点、缓存存续及模型设置一致等条件。此 route 使用 ChatGPT 后端，而非文档中的 OpenAI API，实际缓存语义与收益需通过真实请求观测；单元测试只验证请求改写。该策略只影响 `codex-live`，不影响 DeepSeek API route。

## 验证

在仓库根目录运行 `pnpm --filter @local/dsh-codex-live test`（或 `pnpm -r test`），验证请求体 key 删除、原回调兼容及会话/retention 设置保留；这些测试不发送真实请求。

## 已知取舍

- **capability 保真靠模板。** catalog 未收录的模型从同族兄弟继承 compat；若未来某个新模型真的需要不同开关，把 `template` 指到该家族的其它 id，或升级 `@earendil-works/pi-ai`（升级后这些 id 进入 catalog，插件会自动改为原样透传）。
- **上下文窗口取 codex 的数字。** 例如 `gpt-6.1-sol` 用 373000×95% = 354350，而 pi-ai 1.3.0 的 catalog 写 272000。想保守就设 `useEffectiveContextPercent: false` 并按上游改 `contextWindow`。
- **`ultra` 档不可达。** pi-ai 的 thinking level 只有 off/minimal/low/medium/high/xhigh/max，codex 的 `ultra` 没有对应档位，按上游做法 `max` → `max`。
- **合成模型不显示 "off" 档。** pi-ai 的 codex 请求构造器在未指定 effort 时发送 `thinkingLevelMap.off ?? "none"`，而只接受 `low`..`max` 的模型（如 `gpt-6.1-sol`）会拒绝 `"none"`；因此 `off` 必须显式写成 `null`（不发 reasoning 块），代价是 DSH 的档位选择器把 null 视为不支持、隐藏该档。上游 catalog 对同一模型也是这么写的。
- **绑定依赖版本。** `engines.dsh` 为 `>=0.2.1-rc.2 <0.2.2-0`，覆盖 0.2.1-rc.2 起的 0.2.1 系列的有意兼容范围；`peerDependencies` / `devDependencies` 固定在本次验证的 `0.2.1-rc.3`（`@deepseek-ai/cordis` 除外，仍为 `4.0.5`）—— 宿主按 `engines` 判定能否加载，peer 只表达「与宿主共享同一实例、并按该版本验证过」（rc.2 宿主上这些 peer 声明并不满足，pnpm 只告警、不拦截加载）；rc.2 宿主同样会加载（已在 rc.2 上用 `dsh --profile <p> --dump-config` 组合验证），但本 bundle 的测试只在 rc.3 上跑过。跨 minor 升级时仍需复核 `PiAiAdapter` 契约（它是按契约鸭子类型使用的，跨版本可能失配）。需要与宿主共享实例的 dsh 包声明在 `peerDependencies` + `devDependencies`，由 profile 的 `autoInstallPeers: false` 使用宿主副本；`@deepseek-ai/schemastery` 与 `@earendil-works/pi-ai` 保持 `dependencies`。
- **错误码与宿主一致。** 插件不再自带 `@deepseek-ai/dsh-llm` 副本，`LlmError` 就是宿主使用的同一个类实例，`HarnessError` 判定正常；此前的 UNKNOWN 降级不再出现。
