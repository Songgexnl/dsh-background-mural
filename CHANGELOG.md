# 变更记录

遵循 [语义化版本](https://semver.org/lang/zh-CN/)。**每次改动都必须升版本号**：DSH 的「检查更新」是拿已安装版本和最新版本做比对的，版本号不动就等于告诉它"已经是最新的"，界面不会给更新按钮。

## 0.1.4

**新增：整套界面表面处理（侧边栏、输入栏、气泡、弹出面板）。**

背景透出来之后，外壳自己的面板就悬在照片上了。这次把各区域的底色统一接管，参考了 [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) 的处理范围（它做的是左右侧栏、输入栏、logo、新会话按钮），但实现是从官方样式表里读出来的 token，没有参考它的代码：

| 区域 | 官方 token（我读出来的） |
| --- | --- |
| 侧边栏 | `.BynINW_sidebarCol{background:var(--dsw-specific-sidebar-fill)}` |
| 输入栏 | `.RlGAzG_card{background:var(--dsw-specific-input-major)}` |
| 消息气泡 | `.cJsG2q_bubble{background:var(--dsw-specific-bubble)}` |
| 弹出面板 | `--dsw-specific-menu` + `backdrop-filter:var(--dsw-menu-backdrop-filter)` |

做法是：读回每个 token 在当前配色下的真实值，用同样的颜色以更低透明度写回去，于是浅色/深色都自动正确，不用硬编码任何颜色。新增两个滑杆——「界面底色」「界面磨砂」——同时作用于上述所有区域。悬停态（`--dsw-alias-interactive-bg-hover*`、`bg-layer-2/3`）也按官方做法从自身基色重新混出来，否则鼠标一移上去半透明的面板会突然变回不透明。

**修复一个会导致底色越来越透的缺陷。**

`applySurface` 每重绘一次都会重新读 token，而读回的是**我自己写进去的值**，于是 alpha 被反复相乘、界面会逐次变淡。现在每个 token 的原值只在首次重绘前快照一次。

**新增：运行时版本声明与自动降级。**

`package.json` 现在声明 `dsh.engines.dsh: ">=0.1.1-rc.1 <0.3.0-0"`。host 半区读取真实 DSH 版本并与该范围比对：不在范围内时**不再重绘任何 token**，改为在面板上说明原因，保住原生界面。这个思路来自参考项目的经验——DSH 升级后皮肤挡住输入框一类的控件是真实风险，而这个插件已经因为一次类似原因让窗口拖不动了。

## 0.1.3

**修复：设置背景后窗口拖不动（严重回归，由 0.1.1 引入）。**

0.1.1 里为了防误拖，我在根节点上写了一条：

```css
body[data-dsh-mural],body[data-dsh-mural] #root{--dsw-alias-bg-base:transparent;-webkit-app-region:no-drag}
```

`-webkit-app-region` 是**会继承**的 Electron 窗口拖拽属性。官方外壳的拖拽区是这样划的：

```css
[data-windows-titlebar] .BynINW_frame:before{-webkit-app-region:drag;position:absolute;inset:0 0 auto}
```

我在 `body` 上加 `no-drag`，等于把整棵子树的拖拽能力全部关掉——顶部标题栏因此按住拖不动。已删除该声明；Mural 的图层本来就是 `pointer-events:none` 且 `z-index:0`，位于外壳内容之下，根本不需要这条。

**新增：面板内的「检查更新」。**

DSH 自带的检查更新走 npm registry 解析最新版本，而本插件是 git spec 安装（未发布时 registry 里也没有它），所以它看不到新提交——这正是 0.1.1 装上后检测不到 0.1.2 的原因。现在面板自己读仓库里的 `package.json`：

- 标题旁显示当前版本号；
- 底部常驻「版本 x.y.z · 状态」+「检查更新」按钮，结果显示在面板内；
- 发现新版时给出**可复制的重装命令**（`dsh plugin --profile desktop add github:Songgexnl/dsh-background-mural`）；
- 结果缓存 6 小时，避免反复请求；版本号无法比较时（如预发布格式）如实报「无法比较」，不会假装已是最新。

它**不会**自己重装——客户端没有权限跑 pnpm，假装能装只会更糟。

## 0.1.2

**修复：面板在新版设置页里没有背景，文字直接压在壁纸上。**

0.1.1 把画面透出来了，但我的设置卡片本身**没有设背景**，于是文字落在任意壁纸上，暗色主题下尤其看不清；上传按钮还因为 `color:inherit` 加一个未注册 token，落到浏览器默认的「白底白字」，变成一块空白方块。

根因是**用了一个不在官方 token 注册表里的 token**：官方设置卡片用 `--dsw-alias-settings-card-fill`，而这个名字不在 278 个注册 token 中，会解析为空；`--dsw-alias-bg-layer-2/3` 虽然注册了，但在这个构建里也解析不出可见底色。

改动：

- 面板自建一层`--dsh-mural-*`变量，全部由**静态色板**（`--dsw-static-neutral-100/200/800/850`，均已在注册表中按主题定义）搭建，且每个后备值都是已解析的实色——token 万一未定义也不会让控件消失。
- 暗色主题通过 `data-ds-dark-theme` 切换，同时支持该属性在 `<html>` 或 `<body>` 上（外壳用 MutationObserver 监听这个属性，两种落点都覆盖）。
- 各个面（标题块、开关块、每个 section、卡片、缩略图框、拖放区、下拉框、按钮）都补上不透明底。
- 主按钮改用官方写法：`button-primary-fill` + `label-primary-foreground`，后备值也从「白底」改成实色主题色，彻底消除白底白字。
- 新增 `option` 显式配色（原生下拉在暗色下会继承系统配色）。

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
