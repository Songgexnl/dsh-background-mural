# 变更记录

遵循 [语义化版本](https://semver.org/lang/zh-CN/)。**每次改动都必须升版本号**：DSH 的「检查更新」是拿已安装版本和最新版本做比对的，版本号不动就等于告诉它"已经是最新的"，界面不会给更新按钮。

## 0.1.1

**修复：背景完全看不到（用户报告的"插件没生效"）。**

根因是结构性的，不是配置问题。官方外壳自己就在画不透明背景：

```css
.BynINW_frame      { background: var(--dsw-alias-bg-base); ... }
.BynINW_sidebarCol { background: var(--dsw-specific-sidebar-fill); ... }
[data-windows-titlebar] .BynINW_centerCol { background: var(--dsw-alias-bg-base); ... }
```

外层 frame、侧边栏、中列各自都有一层实色，所以无论往 `body` 后面挂什么图层，画面都会被盖住。

改动：

- 改为**设计 token 级**实现（与社区皮肤同套路数）：`--dsw-alias-bg-base` 置为透明，`--dsw-specific-sidebar-fill` 按当前主题色重绘为低透明度面板色。两个 token 都在官方 `--dsw-*` 注册表（278 个 token，来源为官方前端 dist CSS）内。
- 修复失效的选择器：`#root` 并不是 `body` 的直接子元素，原先的 `body[...]>#root` 从未匹配。
- `body` 的 `background` 改为**内联**覆盖（外壳在启动时内联写入），卸载时按原值还原。
- 关闭总开关时把两个 token **原样还回**，"关闭"即出厂外观。
- 新增设置项「侧栏底色」（0–100，默认 42，0 = 完全透明）。
- 新增 `withAlpha()`、`applySurface()` 与其幂等缓存 `surfaceKey`。

## 0.1.0

首个版本。

- host 半区：6 条同源围栏路由，裸 body 流式上传（临时文件 + 原子改名），HTTP Range / 206 媒体服务，磁盘素材库（索引自愈、路径逃逸围栏）。
- 浏览器半区：纯 DOM 背景图层（图片 / 视频 / 首帧静态）+ React 设置卡片。
- 上传三重校验：MIME 与扩展名双白名单、两者对图片/视频的判断必须一致、文件头签名核对。
- 桌面版与 Web 版共用同一份产物（同源 HTTP，无平台分支）。
