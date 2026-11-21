# 隐藏 Shell 描述参数

Host 挂载的 Cordis bundle，适配 DSH 的一次性 `bash` / `pwsh`。

## 动机

我想直接看到执行的命令，不需要描述，顺便省点 token。

## 行为

- 从各 agent 可见工具 schema 的 `properties`、`required` 中隐藏 `description`。
- 删除工具说明中的 `Provide description before command` 指令
- 无 `command: string` 参数的 persistent shell，以及本身不声明 description 且无残留说明的工具不受影响。

## 兼容性

实现和单元测试面向 `0.2.1-rc.3`，已在 `0.2.1-rc.2` , `0.2.1-rc.3`, `0.2.2-rc.3` 上实测可用。

## 限制

这是对工具定义的可逆适配，不是 DSH 原生配置接口。升级 DSH 应重新测试；加载范围以 [manifest](<package.json>) 的 `engines.dsh` 为准，保留 `0.2.1-rc.2` 下界并允许后续 0.2 版本，不代表全部 0.2.x 均已逐版验证（见[依赖策略](<../docs/dependency-policy.md>)）。后装插件若包装了本插件的回调，需按相反顺序卸载以免残留包装；本插件不会覆盖别人的后续字段替换。

旧 lean 版本已原地删除的 schema 无法由新插件凭空还原；停用新插件后需要使用不含旧适配的新 preset revision 验证恢复。

隐藏的是模型参数定义，不是删除旧会话中的 description，也不保证模型永不生成额外参数。原 lean 适配已记录：Web 若依赖调用参数里的 description 判断 shell 类型，可能失去终态 terminal card；本插件不修改 Web renderer。

图标为本插件原创 SVG。
