# 隐藏 Shell 描述参数

Host 挂载的 Cordis bundle，适配 DSH 0.2.1-rc.2 与 rc.3 的一次性 `bash` / `pwsh`。

## 行为

- 从各 agent 可见工具 schema 的 `properties`、`required` 中隐藏 `description`。
- 删除工具说明中的 `Provide description before command` 指令（源码中为带反引号的完整句子）。不添加“禁止生成参数”的额外提示。
- 在原执行/展示回调前补入命令首行（最多 80 字符）作为兼容描述；保留调用者已有的非空描述。不改调用日志、命令、权限、审批、超时或后台任务语义。
- 扫描已存在 agent 和全局工具，监听新 agent、agent 销毁、preset 切换、工具注册变更。不使用轮询、私有 scope Symbol 或系统提示组装拦截。
- 同一个 preset 定义可供多个 agent 共享，按定义对象去重。定义不再可见时释放修改，卸载插件时恢复仍由本插件拥有的字段。
- 无 `command: string` 参数的 persistent shell，以及本身不声明 description 且无残留说明的工具不受影响。

## 安装与验证

通过 Harness 的 `plugin_manager install_bundle` 安装此目录。作用于当前 profile 的所有 preset。lean 中的旧 `shell-args.js` 入口已移除；旧 preset revision 如仍引用它，应迁移到新 revision。

新建 lean / cordis 会话，检查实际工具 schema：无 `description` 参数，无要求填写它的句子；不传该参数的 shell 调用仍成功。现有模型历史可能仍含旧参数说明，不重写历史记录。

运行 `pnpm install`（安装仅用于测试的 devDependencies）后执行 `pnpm test`。真实 runtime 测试从本目录的 devDependencies 加载 DSH 0.2.1-rc.3，不依赖开发机已安装的 DSH；要验证其它 DSH 版本，把 `DSH_RUNTIME_NODE_MODULES` 指向该安装的 node_modules。测试仅模拟底层 shell，不执行命令。

本次安装器返回 `restart-required` / `unmanaged-plugin`：当前会话的 schema 隐藏及不传 description 的真实调用已验证成功，但完整迁移（尤其旧 preset revision 的退出）仍应在方便时重启 DSH 后确认。安装过程未重启服务。中英文显示资源和原创 SVG 已校验，Plugin Manager 中的实际渲染尚未做浏览器验收。

## 限制

这是对工具定义的可逆适配，不是 DSH 原生配置接口。升级 DSH 应重新测试；加载范围以 [manifest](<package.json>) 的 `engines.dsh` 为准，保留 `0.2.1-rc.2` 下界并允许后续 0.2 版本，不代表全部 0.2.x 均已逐版验证（见[依赖策略](<../dependency-policy.md>)）。后装插件若包装了本插件的回调，需按相反顺序卸载以免残留包装；本插件不会覆盖别人的后续字段替换。

旧 lean 版本已原地删除的 schema 无法由新插件凭空还原；停用新插件后需要使用不含旧适配的新 preset revision 验证恢复。

隐藏的是模型参数定义，不是删除旧会话中的 description，也不保证模型永不生成额外参数。原 lean 适配已记录：Web 若依赖调用参数里的 description 判断 shell 类型，可能失去终态 terminal card；本插件不修改 Web renderer。

图标为本插件原创 SVG。
