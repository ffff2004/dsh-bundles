# @ffff2004-dsh-packages/shell-description

## 1.0.4

### Patch Changes

- dfde0e5: 以 `@ffff2004-dsh-packages/` scope 和不含 `dsh-` 前缀的新包名首次发布，纳入当前尚未发布的改进。新名称是独立包身份，不提供旧 `@local/dsh-*` 名称的兼容入口或自动迁移；旧用户需移除旧包及配置引用，再安装并配置新包，避免重复加载。原有版本历史不转移至新身份，后续版本独立递增。
- c1ab742: 补充主页与源码仓库元数据，便于从插件市场详情直接访问对应 bundle 的 GitHub 说明目录及源码仓库；安装来源仍固定到发布 commit。
