# 技能名称映射 / Skill Name Mapping

v2 自动发现本地技能，将 YAML frontmatter `name` 中的 ASCII `A–Z` 转为 `a–z`。不修改源文件，不替换核心校验，无需逐个配置文件或映射。

例如 `Zotero` → `zotero`、`MY-Skill2` → `my-skill2`。只改英文字母大小写：不做 Unicode case folding、空格替换、下划线替换或连字符修复。转换后仍须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，否则跳过并警告。原本合法的小写技能仍由原生 provider 提供，不重复注册。

## 默认发现范围

和原生 filesystem provider 一样浅扫描以下技能根，而非递归搜索全部磁盘：

1. 当前会话最近 Git 项目根下的 `.dsh/skills`、`.agents/skills`；找不到 `.git` 则使用会话 cwd。没有 cwd 的调用不扫描项目根。
2. `customSkillDirs`（如果配置）。
3. `<dshHome>/skills`，默认 `$DSH_HOME/skills` 或 `~/.dsh/skills`；跳过这里直属的 `.system` 项。
4. `<agentsHome>/skills`，默认 `$DSH_AGENTS_HOME/skills` 或 `~/.agents/skills`。
5. 显式 `bundledSkillDir`，或启用默认根时的 `$DSH_BUNDLED_SKILL_DIR`。

每个根只接受直属 `<目录>/SKILL.md` 和直属 `*.md`（大小写精确），跟随符号链接；技能名称来自文件 frontmatter，而非目录名。不会递归任意深度，也不自动读取其他插件私有配置中的自定义根；若原生 provider 有额外 custom roots，请在这里配置同样的路径。

## 配置

默认 `config: {}` 即可，已经能自动发现 `Zotero`。可选设置：

```yaml
includeDefaultRoots: true
customSkillDirs:
  - /absolute/path/to/extra-skills
# dshHome: ~/.dsh
# agentsHome: ~/.agents
# bundledSkillDir: /absolute/path/to/bundled-skills
```

目录配置接受绝对路径或 `~/` 开头路径。`includeDefaultRoots: false` 只保留 custom roots 和显式 bundled root，适合隔离测试。各会话项目发现独立，所有根均为当前 Host 的本地路径；不提供远程 filesystem 适配。

v1 的 `mappings`、`originalName`、别名 `name` 配置已移除；升级时 bundle 默认配置改为 `{}`。若曾在 profile 中单独覆盖配置，请在插件设置中移除旧的 `mappings`。

## 冲突、安全与刷新

- 转小写后的名称与扫描范围内已有合法小写名称相同：保留原生小写技能，跳过转换项并警告。
- 多个不同真实文件的大写名称转换为同一名称：全部转换项跳过并警告，不静默挑选。相同真实文件通过多个符号链接或根重复发现则去重。
- 这是比原生 rank 合并更保守的碰撞策略。没有本 provider 内部冲突时，以对应原生根的 rank + 1 发布；跨 provider 和 scope 仍遵循 Harness 原有优先级规则。
- 保留 description、whenToUse、metadata、调用权限和正文，metadata 附加 `originalName`、`mappedBy`。非法 YAML/未知 tag/重复键/不合法权限字段跳过，旧 camelCase 权限键拒绝。
- `path` 和 `resourceBase` 使用解析符号链接后的真实文件及父目录；每次加载重读正文，名称变更不会把旧调用偷偷绑定到新名称。
- 每秒通过 `watchFile` 观察根目录、候选技能文件和符号链接，支持新增、改名、删除、恢复与重定向；只在变更后使目录缓存失效，不定时全盘扫描。缺失目录和缺失 `SKILL.md` 也会被观察。深层资源正文的变化不更新目录。
- 保留根 watcher 数量通常最多 32（大量显式 custom roots 时上限随配置增大），LRU 淘汰时清空目录缓存；卸载时清理全部 watcher 与 provider。
- 不执行技能脚本，不访问或修改 Zotero 配置。

## 开发与安装

```sh
# 在仓库根目录
pnpm install
pnpm --filter @local/dsh-skill-name-mapping test
node --check index.js
node --check discovery.js
```

使用 Harness `plugin_manager` 安装本目录；更新已安装包时先 remove 再 install，以结果和 live Config 验证新代码已应用。加载范围以 [manifest](<package.json>) 的 `engines.dsh` 为准，保留 `0.2.1-rc.2` 下界并允许后续 0.2 版本；这不是全部 0.2.x 的逐版兼容保证，验证基线与边界见[依赖策略](<../dependency-policy.md>)。无 install/build scripts，图标为本插件原创 SVG。
