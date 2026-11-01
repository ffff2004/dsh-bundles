# Zotero 文献跳转

在已完成回复下、原生操作栏上方添加默认折叠的 **Zotero 文献（N）** 列表。正文仍由 DSH 原生 Markdown 渲染，正文中的 `zotero:` 链接不会因此变成可点击链接。

## 效果预览

正文引用使用加粗标题与 `〔Zotero〕` 标记；实际跳转入口位于回复下方的文献列表中。下图展示列表展开后的效果。

![正文引用样式与展开的 Zotero 文献列表](<docs/citation-preview.png>)

## 行为

- 仅提取真实 Markdown 链接，包括内联链接、引用式链接及 CommonMark 尖括号自动链接。
- 仅接受 `zotero://select/library/items/<8位大写字母数字key>` 和 `zotero://select/groups/<正整数groupID>/items/<key>`。拒绝 `open-pdf`、查询串、fragment、凭据、端口及百分号编码路径。
- 按首次出现顺序排列；同一消息内同目标去重，个人库与不同群组视为不同目标。使用链接文字作为纯文本标题，空标题退回 item key。
- 点击标题只打开该条目，使用原生 `<a>` 请求浏览器所在机器的 Zotero；不调用服务端应用、不自动跳转、不批量打开、不查询 Zotero 文献库。浏览器可能要求确认；未安装/未注册协议时无法打开，页面不能可靠判断是否已唤起。
- 中英文 UI 随宿主语言切换。

## System Prompt

```text
When citing a verified Zotero item, use:
**[Author, Year · Title](zotero://select/library/items/ITEMKEY)**〔Zotero〕
For group libraries, use zotero://select/groups/GROUPID/items/ITEMKEY.

Use surnames (preserve Chinese names): one author, both joined by "&",
or first author + "et al." / "等" for 3+ authors. Keep the identifying
title in its original language; omit long subtitles when helpful.
Omit missing metadata; keep labels consistent for the same item.

Replace placeholders with verified Zotero item keys and group IDs.
```

## 版本兼容性

manifest 的 `engines.dsh` 为声明加载范围，不代表逐版本实机验证。当前使用 0.2.1-rc.3 的 `sessionProjections`、`systemPrompt` 与 `conversation.chat.turnTail` 契约。
