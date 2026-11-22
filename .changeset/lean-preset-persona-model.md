---
"@ffff2004-dsh-packages/lean-preset": minor
---

三个 preset 的系统提示开场白改为 `You are a helpful assistant powered by the {{model}} model.`：`{{model}}` 由宿主的系统提示模板解析为当前会话选择的模型 ID，模型能在提示中看到自己正在使用的模型。占位符语法要求 DSH 提供 `model` 模板变量，`0.2.2-rc.1` 起已提供，与 `engines.dsh` 一致。
