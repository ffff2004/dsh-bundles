# 浏览器 client bundle 的约束

本仓库里带 browser half 的 bundle（`client.js` + `package.json` 的 `dsh.client`）由宿主拼进同一张启动图：同一 combo 的源文件**首尾直接拼接**，没有 IIFE、函数包装或模块作用域；哪个 bundle 和谁同批由宿主切分决定，**不可预期**。一个文件顶层声明就会进入共享作用域；同名 `let` / `const` / `class` 会让整批脚本直接 `SyntaxError`，Host 日志也可能没有对应记录。

适用范围：本仓库的 `client.js`，以及与它们可能同批的其它 client bundle。

两个文件各写一个 `const NS`，拼起来就是 `Uncaught SyntaxError: Identifier 'NS' has already been declared`。

## 规则

1. **顶层不做任何声明。** 唯一允许的顶层语句是 `window.__ModuleLoader__.load({ id, factory })`；整段主体包进 IIFE（`;(function () { … })()`），`const` / `let` / `var` / `function` / `class` 全部进函数作用域。
2. **只 `require` 平台模块表里的 specifier。** 以 DSH 源码 `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 为准；例如 `react`、`@deepseek-ai/dsh-client-ui-primitives`。本仓库的 client 只使用这张表；其它 specifier 会报 `client-modules: require("…") missed the module table`。
3. **manifest 三件事齐备。** `exports["./client"]` 指向浏览器产物、`dsh.client.platform` 为 `"web"`、`load({ id })` 的 `id` 等于包名；缺 `./client` 会直接失败。
4. **browser half 的形态。** factory 返回 `{ inject, apply }`；样式随组件渲染 `<style>`，或用 `ctx.effect` 注入并清理；插槽用 `ctx.slots.inject` 注册，不要直接读别的插件的 DOM/样式。

## 症状

| 环节 | 表现 |
|---|---|
| 页面 | `web boot: … entries did not activate` + `import failed` |
| Host 日志 | **没有**对应记录：解析阶段的 SyntaxError 不经过 `importError` 记录路径 |
| 浏览器 DevTools | `SyntaxError: Identifier 'X' has already been declared`；`source:` 后就是 combo URL，可直接看出同批 bundle |

## 实现依据

升级 DSH 时按文件与符号复核，不记录行号；需要定位时直接 `rg` 符号名。

- 拼接与切分：`packages/client/modules/src/index.ts` 的 `buildComboScript`、`prepareSource`、`partitionComboRecords`
- 平台模块表：`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`
- 注册与行校验：`packages/client/modules/src/client/manifest.ts` 的 `ClientBundleRegistration`；`packages/client/modules/src/index.ts` 的 `resolveMeta`
- 模块表错误与 `importError`：`packages/client/modules/src/client/system.ts` 的 `missed the module table`、`recordingImportError`、`importError`
- 页面报错：`packages/client/web/src/boot-client.ts` 的 `assertEntriesActive`
- 上游说明：DSH 源码 `packages/client/AGENTS.md` 的 “Shared modules and the module graph”

## 核对记录

按新到旧记录实现依据所对应的 DSH 源码版本，不代表 bundle 的兼容范围；兼容范围见各 bundle 的 manifest/README。

- `dsh-v0.2.2-rc.5` @ `9c2670d3bce5275e0d1610272958121af87787bb`：按源码核对拼接、切分、平台模块表、注册与错误路径；未逐项实机复测。
- `dsh-v0.2.1-rc.3` @ `1f81c047fc48fa190a683e469daa699857e9afe8`：初版记录为实测运行版本。
