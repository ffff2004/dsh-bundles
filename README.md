# 本地 DSH Bundles

本仓库存放个人自用的 DeepSeek Harness（DSH）bundles。

## Bundle 列表

| Bundle | 简介 |
| --- | --- |
| [background-wait-guidance](<background-wait-guidance/README.md>) | 同一 bundle 内提供可独立启停的 jobs 与子代理等待指引，通过 system prompt 引导模型告知等待对象后让出 turn，等待后台完成通知。 |
| [codex-live](<codex-live/README.md>) | 注册跟随本机 Codex CLI 模型缓存的 LLM route，使用其认证信息并补充能力模板；面向 GPT-5.6+，省略请求体的缓存 key，保留会话标识。 |
| [dsh-shell-description](<dsh-shell-description/README.md>) | 从 agent 可见的 `bash` / `pwsh` 工具定义中隐藏 `description` 参数，执行时补入兼容描述，不改变命令与权限语义。 |
| [lean-preset](<lean-preset/README.md>) | 提供“轻量模式”和“轻量创造模式”；保留基础轻量工具，后者将 Cordis 检查、管理与市场工具排在共同工具之后，均使用标准系统提示拼装。 |
| [preview-download](<preview-download/README.md>) | 在 Web UI 文档预览工具栏添加下载按钮，通过浏览器下载当前预览文件。 |
| [preview-path](<preview-path/README.md>) | 把文档预览和文件树的路径行变成可编辑输入框，并新增按路径浏览的目录页；输入文件或目录后由 Host 校验并就地打开。 |
| [shell-timeout-guidance](<shell-timeout-guidance/README.md>) | 仅为可见且超时转后台的 `bash` / `pwsh` 添加提示，引导模型省略不必要的 `timeoutMs`；超时终止时不添加，不修改默认超时或工具参数。 |
| [skill-name-mapping](<skill-name-mapping/README.md>) | 自动发现本地技能，将技能名称中的 ASCII 大写字母映射为小写；不修改源文件，并检查非法名称与命名冲突。 |

## 使用

通过 Harness Plugin Manager 将对应子目录安装为 bundle。具体配置、版本兼容性及重启要求以各 bundle 的 README 为准。

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

仓库使用一个 pnpm workspace 共享安装和锁文件；每个 bundle 仍是可独立安装的包，`package.json` 中的声明才是发布后真正生效的内容。

```bash
pnpm install    # 安装所有 bundle 的依赖，含仅测试使用的 devDependencies
pnpm -r test    # 运行全部 bundle 的测试
```

只跑一个 bundle：`pnpm --filter @local/dsh-shell-description test`。

依赖声明约定（与 DSH 对 out-of-tree 插件的要求一致）：

- 需要与宿主共享实例的 `@deepseek-ai/*` 包 → `peerDependencies` + `devDependencies`（同一版本）；
- 仅测试使用的运行时包 → 只放 `devDependencies`；
- 第三方库与无状态工具包 → `dependencies`；
- 兼容范围统一由 `engines.dsh` 声明，不再用 `@deepseek-ai/dsh` peer 表达。

新增或移动 bundle 目录时同步更新 `pnpm-workspace.yaml` 的 `packages`。插件市场生成器会优先按这些 glob 发现 bundle，glob 漏掉的目录不会回退到目录扫描。

## 发布维护

首次配置、版本发布及本地生成步骤见 [插件市场发布说明](<plugin-market-publishing.md>)。
