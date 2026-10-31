# 本地 DSH Bundles

本仓库存放个人自用的 DeepSeek Harness（DSH）bundles。

## Bundle 列表

| Bundle | 简介 |
| --- | --- |
| [background-wait-guidance](<background-wait-guidance/README.md>) | 同一 bundle 内提供可独立启停的 jobs 与子代理等待指引，通过 system prompt 引导模型告知等待对象后让出 turn，等待后台完成通知。 |
| [codex-live](<codex-live/README.md>) | 注册跟随本机 Codex CLI 模型缓存的 LLM route，使用其认证信息并补充能力模板；面向 GPT-5.6+，省略请求体的缓存 key，保留会话标识。另带一个 Web 半边的「设置 → Codex 额度」页，展示同一账号的窗口与重置券，并通过两条 `/api` 路由读取和兑换。 |
| [dsh-shell-description](<dsh-shell-description/README.md>) | 从 agent 可见的 `bash` / `pwsh` 工具定义中隐藏 `description` 参数，执行时补入兼容描述，不改变命令与权限语义。 |
| [lean-preset](<lean-preset/README.md>) | 提供“轻量模式”“轻量创造模式”和“轻量 PTC 模式”；创造模式增加 Cordis 开发工具，PTC 模式通过 `run_code` 与工具 SDK 调用基础轻量工具，均保留标准系统提示拼装。 |
| [preview-download](<preview-download/README.md>) | 在 Web UI 文档预览工具栏添加下载按钮，通过浏览器下载当前预览文件。 |
| [preview-path](<preview-path/README.md>) | 把文档预览和文件树的路径行变成可编辑输入框，新增可多开的目录页；输入路径、点击条目或返回父目录均默认在来源标签位置导航，不跳转到其他已打开的页。 |
| [shell-timeout-guidance](<shell-timeout-guidance/README.md>) | 仅为可见且超时转后台的 `bash` / `pwsh` 添加提示，引导模型省略不必要的 `timeoutMs`；超时终止时不添加，不修改默认超时或工具参数。 |
| [skill-name-mapping](<skill-name-mapping/README.md>) | 自动发现本地技能，将技能名称中的 ASCII 大写字母映射为小写；不修改源文件，并检查非法名称与命名冲突。 |

具体配置及重启要求以各 bundle 的 README 为准；各自 manifest 是加载范围与开发测试版本的唯一来源。工具验证依赖语义关系，不固定 DSH 发布基线；范围是否合理由 manifest diff/review 判断，合法声明与测试通过不代表未来版本的运行时兼容保证。详情见[兼容与依赖策略](<dependency-policy.md>)。

## 使用

DSH Agent 可通过 Harness Plugin Manager 工具将对应子目录安装为 bundle，人工安装方法如下：

### 从插件市场安装（推荐）

启用实验性插件 **Custom plugin markets**，进入 **插件 → Discover**，添加索引源：

```text
https://ffff2004.github.io/dsh-bundles/index.json
```

选择 bundle 和版本，确认来源后安装。索引中的 Git 来源固定到 commit，不会在安装时漂移到新的 `HEAD`。
该地址需要维护者完成 [Pages 首次配置](<plugin-market-publishing.md#首次启用>) 并成功部署后才可用。

### 从 GitHub 安装（GUI）

以 [shell-timeout-guidance](<shell-timeout-guidance/README.md>) 为例，仓库发布到 GitHub 后：

1. 在 Web GUI 侧栏打开 **插件 → 添加插件**。
2. 在“包名或地址”中输入以下 Git 地址：
   ```text
   git+https://github.com/ffff2004/dsh-bundles.git#HEAD&path:/shell-timeout-guidance
   ```
3. 点击 **安装**，按界面提示完成启用。

### 从 GitHub 安装（命令行）

在 `web` profile 中安装同一个 bundle：

```bash
dsh plugin --profile web add 'git+https://github.com/ffff2004/dsh-bundles.git#HEAD&path:/shell-timeout-guidance'
```

如使用其他 profile，将 `web` 替换为对应名称。整段地址需加引号，避免 shell 将 `&` 解释为后台运行符。

本仓库包含多个 bundle，必须通过 `path:/子目录` 指定要安装的那个，不能直接安装仓库根目录。`HEAD` 跟随仓库默认分支；如需固定版本，可替换为 tag 或 commit。

## 本地开发

安装与统一 gates 见 [AGENTS.md](<AGENTS.md>)；`pnpm lint` 是独立只读检查，`pnpm test:lint` 验证检查器正反例，`pnpm -r test` 保留各 bundle 行为测试。

## 发布维护

首次配置、版本发布及本地生成步骤见 [插件市场发布说明](<plugin-market-publishing.md>)。
