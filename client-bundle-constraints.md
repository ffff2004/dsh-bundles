# 浏览器 client bundle 的约束

本仓库里每个带 browser half 的 bundle（`client.js` + `package.json` 的 `dsh.client`）都会由宿主拼进同一张启动图。拼装方式决定了下面这些**硬约束**：违反其中任何一条，症状都不是编译错误，而是页面起不来、Host 日志一片空白。

适用范围：`client.js`（手写的 browser half），以及与它们可能同批的其它 client bundle。

## 机制：同一批的 bundle 是直接拼接的

宿主启动时：

1. 扫描已挂载 Loader 行里声明了 `dsh.client` 的包，得到 client 模块行；
2. 按启动阶段（`bootstrap` / `application`）和 combo URL 字节预算（`MAX_COMBO_URL_BYTES = 3 * 1024`）把行切成若干 **combo**；
3. 一次 combo 请求返回的是这些 bundle 源文件**首尾直接拼接**的结果 —— `buildComboScript` 的实现就是 `source += prepareSource(resource).source + ';\n'`，**没有 IIFE、没有函数包装、没有模块作用域**。

因此同一 combo 内的所有 bundle 共享一个全局词法作用域。两个文件各写一个 `const NS`，拼起来就是：

```
Uncaught SyntaxError: Identifier 'NS' has already been declared
```

整批脚本一行都不执行 → 这一批里**每一个** bundle 的 factory 都不会注册。哪个 bundle 和谁同批由预算切分和排序决定，**不可预期**，所以不要假设"我的 bundle 不会和别人同批"。

## 规则

1. **顶层不做任何声明。** 唯一允许的顶层语句是那一行 `window.__ModuleLoader__.load({ id, factory })`；整段主体包进 IIFE（`;(function () { … })()`），`const` / `let` / `var` / `function` / `class` 全部进函数作用域。
2. **只 `require` 平台模块表里的 specifier。** 即 `PLATFORM_MODULES`：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。其它 specifier 会命中 `client-modules: require("…") missed the module table`（除非它已通过 `dsh.client.inject` 到达并 materialize，本仓库不用这种写法）；`ui-primitives` 这类**平台单例**不需要在 manifest 里声明依赖，也不需要 `external`。
3. **manifest 三件事齐备：** `exports["./client"]` 指向浏览器产物、`dsh.client.platform` 为 `"web"`、`load({ id })` 的 `id` **等于包名**。缺 `./client` 时宿主组合阶段直接抛错（`declares dsh.client but exports no "./client" bundle`）。
4. **browser half 的形态：** factory 返回 `{ inject, apply }`；样式要么随组件渲染一个 `<style>`（卸载即消失），要么用 `ctx.effect` 注入带 `data-plugin-css` 的 `<style>` 并在清理时移除；插槽用 `ctx.slots.inject(key, …)` 注册，不要直接读别的插件的 DOM/样式。

## 症状与定位

| 环节 | 表现 |
|---|---|
| 页面 | `web boot: N entries did not activate` + `<id>: import failed (see console for the import error)` |
| Host 日志 | **没有**对应记录：`assertEntriesActive` 只查模块系统记下的 `importError`，解析阶段（SyntaxError）不经过那条记录路径 |
| 浏览器 DevTools | `SyntaxError: Identifier 'X' has already been declared`，`source:` 后面就是那个 combo URL，从 URL 里能直接读出同批有哪些 bundle |

## 参考版本与关键文件

- 实测运行版本：`@deepseek-ai/dsh 0.2.1-rc.3`；页面注入的 `window.__DSH_BOOT__.release` 为 `{ "version": "0.2.1-rc.3", "commit": "be72761" }`。
- 源码参照 tag：`dsh-v0.2.1-rc.3`（commit `1f81c047fc48fa190a683e469daa699857e9afe8`）。

| 事实 | 位置 |
|---|---|
| 拼接发生处（无包装） | `packages/client/modules/src/index.ts:408` `buildComboScript` |
| 源文件按原样取用 | 同文件 `:306` `prepareSource` |
| combo 切分与 URL 预算 | 同文件 `:273` `partitionComboRecords`、`:184` `MAX_COMBO_URL_BYTES = 3 * 1024` |
| 客户端行扫描与校验（`platform`、`./client`） | 同文件 `:844` `resolveMeta` |
| 平台模块表（seed words） | `packages/client/web/src/platform.ts:8` `PLATFORM_MODULES` |
| 注册契约 `{ id, factory }` | `packages/client/modules/src/client/manifest.ts:357` `ClientBundleRegistration`、`:367` `factory` |
| `require` 未命中模块表的报错 | `packages/client/modules/src/client/system.ts:334` |
| `importError` 的记录边界 | 同文件 `:417` `recordingImportError`、`:407` `importError` |
| 页面上那句 `import failed (see console …)` | `packages/client/web/src/boot-client.ts:73` |
