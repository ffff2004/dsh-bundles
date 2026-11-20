# GitHub 仓库链接

点击 DSH Web 会话右上角的 GitHub 图标，打开当前 workspace 的 GitHub 仓库。

- 没有 `github.com` remote 时不显示入口；只有一个不同的 GitHub 仓库时直接打开。
- 有多个仓库时显示下拉菜单，按 `owner/repo` 列出，并附上 remote 名。指向同一仓库的 remote 合并，`origin` 指向的仓库排在最前。
- 链接在浏览器新标签页打开。插件只读取本地 Git 配置，不访问 GitHub API，也不读取 GitHub 登录凭据。

## 兼容性

实现和单元测试面向 DSH Web `0.2.2-rc.3`，已在该版本上手工实测可用。Host 需要可执行 `git`，浏览器需支持 HTML Popover API 才能展开下拉菜单。
