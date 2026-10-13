# Mural · DSH 背景壁画

[English](README.md) | 中文

给你的 DSH 界面换一张自己的背景：**上传图片或视频**，它就铺在整个 GUI 后面。桌面版和 Web 版用的是同一套东西，不需要分别配置。

- **图片与视频都支持。** JPG / PNG / GIF / WebP / AVIF / BMP / SVG，以及 MP4 / WebM / OGV / MOV。
- **上传而不是「填路径」。** 素材存在 DSH 自己的目录里，不依赖 Wallpaper Engine，也不要求你把文件先放进某个文件夹。
- **视频真的能播。** host 半区实现了 HTTP Range（206）流式响应，所以视频能循环播放、能拖进度、不用整段下载。
- **桌面版 + Web 版同一份代码。** 两个半区都只走同源 HTTP，不碰 Node API，也不依赖 Electron 专有能力。
- **关了就是关了。** 关掉总开关会立刻停止绘制并且不再请求任何媒体；插件卸载后界面对 DOM 的改动全部还原。

---

## 名字

**Mural（壁画）** —— *mural* 就是墙上那幅大画：整面墙、你自己选的图、你自己决定怎么摆。中文叫「背景壁画」。

选这个名字的理由：读起来简单（中英文都顺口），包名 `dsh-background-mural` 自解释，而且和现有插件不撞名——`dsh-skin-center` 管的是主题配色与 Wallpaper Engine 桥，Mural 管的是「把我自己的图片/视频传上来铺满」。

---

## 安装

### 0. 前置条件

| 项目 | 要求 |
| --- | --- |
| DSH | `>= 0.1.1-rc.1` |
| Node | `^22.19.0 \|\| >= 24.0.0`（跑测试时需要） |
| 依赖 | **无**。零第三方依赖、免构建，`lib/` 里的文件就是最终产物 |

### 1. 从本地目录安装（推荐先这样试）

`dsh plugin add` 的 `link:` 形式会把你的工作目录直接挂进 profile，改代码立刻生效，不用重新安装：

```sh
# 假设这个包在 D:\dss\dsh-code\demo1\dsh-background-mural

# Web 版
dsh plugin --profile web add link:D:\dss\dsh-code\demo1\dsh-background-mural

# 桌面版（如果你用独立的 desktop profile）
dsh plugin --profile desktop add link:D:\dss\dsh-code\demo1\dsh-background-mural
```

macOS / Linux 上路径换成 `/path/to/dsh-background-mural` 即可。若你的 `dsh` 不在 PATH 里，用完整的可执行文件路径，或用 `npx @deepseek-ai/dsh`。

### 2. 从 npm 安装（发布之后）

```sh
dsh plugin --profile web add dsh-background-mural
```

### 3. 从 git 安装

```sh
dsh plugin --profile web add github:<你的账号>/dsh-background-mural
```

这个包没有 `prepare` 构建步骤，git 安装不需要额外授权 `allowBuilds`。

### 4. 重启并确认已加载

```sh
dsh web          # 或者直接启动桌面版
```

启动日志里应该出现：

```
[background-mural] media library ready at <DSH_HOME>/background-mural (0 item(s))
```

然后打开 **设置 → 背景壁画**。

### 为什么桌面版和 Web 版是同一份包

DSH 桌面版和 Web 版渲染的都是同一套 Web GUI，插件清单里 `dsh.client.platform` 填 `"web"` 就是这套 GUI 的标识（现存社区插件无一例外都这样声明）。Mural 的浏览器半区因此对两端都是同一份产物；host 半区也只走 `ctx.webServer` 注册路由，没有平台分支。换句话说：装一次，两种入口都能用，不需要准备两份配置。

> 如果你把插件装进的是独立的 `desktop` profile，用 `--profile desktop` 装同一个包即可，源码完全一致。

### 手动安装（不用 CLI）

把 `cordis.patch.yml` 里的那段 `insert` 复制进 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，再把包放进该 profile 的 `node_modules/`。

### 5. 卸载

```sh
dsh plugin --profile web remove dsh-background-mural
```

卸载只会移除插件行；**你上传的素材不会被删**，留在 `<DSH_HOME>/background-mural/` 里，重装即恢复。

---

## 数据放在哪

```
<DSH_HOME>/background-mural/
  index.json            素材库索引（只存元数据，不存字节）
  settings.json         设置（当官方 settings 服务可用时会同时写入设置存储）
  media/<id>.<ext>      你上传的原文件
  tmp/                  上传中间文件，成功后原子改名移入 media/
```

`<DSH_HOME>` 的解析顺序：`$DSH_HOME` → 用户主目录下的 `.dsh`。

---

## 用法

1. 打开 **设置 → 背景壁画**。
2. 点「上传图片 / 视频」，或把文件直接拖进虚线框。多选可以一次传多个。
3. 上传完成后最后一个文件会自动生效；点任意卡片上的「设为背景」可以随时切换，「使用中」的卡片再点一次即清除背景。
4. 用下面的滑杆调外观。

### 设置项

| 设置 | 说明 |
| --- | --- |
| 启用背景 | 总开关。关闭后立刻停止绘制，并且不再发任何媒体请求 |
| 填充方式 | 裁切铺满 / 完整显示 / 拉伸铺满 / 平铺 |
| 水平、垂直焦点 | 只对「裁切铺满 / 完整显示」生效，决定裁切时保住哪一块 |
| 压暗程度 | 0–90，在画面上盖一层黑纱，保证上层文字看得清 |
| 背景模糊 | 0–60 px，作用在画面上而不是界面上 |
| 不透明度 | 0–100，画面整体的透明度 |
| 边缘暗角 | 上下边缘淡淡压暗，让顶部工具条和底部输入框更清楚 |
| 侧栏底色 | 侧边栏那层底色还剩多少，0 = 完全透明（见下方「背景是怎么透出来的」） |
| 播放方式 | 循环播放 / 播放一次（停在最后一帧）/ 只显示首帧 |
| 开启声音 | 默认静音。浏览器可能要求先点过页面才允许有声播放 |
| 音量 | 0–100 |
| 窗口隐藏时暂停 | 切到后台或最小化时暂停视频，省电 |

### 诊断面板

设置页最下面可以展开「诊断」，它会告诉你：接口是否连通、素材库的绝对路径、Range 是否可用、以及当前浏览器支持哪些视频编码（H.264 / VP9 / AV1 / WebP / AVIF）。视频播不出来的时候先看这里。

---

## 工作原理

```
lib/index.js       host 半区入口：注册路由、加载素材库、持久化设置
lib/routes.js      /api/background-mural/* 的六个路由
lib/store.js       磁盘素材库（索引、原子写入、路径逃逸围栏）
lib/media-types.js MIME/扩展名白名单 + 文件头签名嗅探
lib/http-utils.js  同源围栏、有界 JSON 读取、Range 解析与流式响应
lib/client.js      浏览器半区：背景图层 + 设置面板（单文件，无构建）
```

- **host 半区**只依赖 Node 内置模块。它注册 6 条路由，`content-length` 与累计字节双重限流的上传，写盘走「临时文件 + 原子改名」，任何路由注册失败都只记日志、绝不抛异常——插件坏掉不能把整个 GUI 拖下水。
- **浏览器半区**是纯 DOM 渲染层 + 一个 React 设置卡片。图层在 `<body>` 的第一个子节点，`z-index:0`、`pointer-events:none`，只加一条让外壳背景透明的样式，并且这条样式绑定在 `data-dsh-mural` 属性上——卸载即完全还原。
- **两侧通过同源 HTTP 说话**，所以桌面版和 Web 版行为一致：没有 `file://` 特例，没有 Electron IPC。

### 背景是怎么透出来的（关键实现）

这一条是踩过坑才写下来的，也是最容易做错的地方。

官方外壳**自己就在画不透明背景**。它的 CSS 是这样的：

```css
.BynINW_frame      { background: var(--dsw-alias-bg-base); ... }
.BynINW_sidebarCol { background: var(--dsw-specific-sidebar-fill); ... }
[data-windows-titlebar] .BynINW_centerCol { background: var(--dsw-alias-bg-base); ... }
```

也就是说，不管你往 body 后面塞什么图层，只要这两个 token 还是实色，画面就永远被外壳盖住——**看上去就是"插件完全没生效"**。而且 `--dsw-alias-bg-base` 是声明在 `body` 上的，只写元素选择器会被 body 上的声明压回去。

所以 Mural 走的是**设计 token 级**的做法，和社区皮肤同一套路数：把 `--dsw-alias-bg-base` 置为透明让画面透出来，再把 `--dsw-specific-sidebar-fill` 按主题色重绘成一个低透明度的面板色（滑杆「侧栏底色」控制，0 = 全透明）。这两个 token 都在官方 `--dsw-*` token 注册表里（共 278 个，来源就是官方前端 dist CSS），所以这算走受支持的接口，而不是去猜内部 class 名。

三个配套细节：

- **body 的 `background` 必须用内联样式覆盖**，因为它是外壳启动时内联写上去的；卸载时按原值还原。
- 图层是 `<body>` 的第一个子节点，`position: fixed` + `z-index: 0` + `pointer-events: none`。已经定位的外壳 frame（`z-index: auto`）按绘制顺序排在它上面，所以界面内容不会被挡住；同时它又高于 html/body 的底层背景，因此透明之后画面正好从中间露出来。
- 关掉总开关会**把两个 token 原样还回去**，"关闭"是真的回到出厂外观，不是"停画但仍透明"。

### 为什么上传用裸 body 而不是 multipart

浏览器直接把原文件字节 POST 过来，文件名放在 `x-mural-name` 头里，尺寸/时长放在 `x-mural-meta` 头里（base64url 的 JSON）。这样大视频是可流式的、进度条是准的，而且 host 半区不需要引入任何 multipart 解析器。

### 视频首帧是怎么来的

「只显示首帧」模式不需要服务端转码：浏览器把视频解码一帧、画到 canvas、导出 WebP 作为海报图。如果 4 秒内拿不到可解码的帧，就自动退回到播放视频，而不是留一块空白。

### HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/background-mural/overview` | 设置 + 能力 + 素材库 + 列表，一次拿全 |
| `GET` `PATCH` | `/api/background-mural/config` | 读 / 增量写设置 |
| `POST` | `/api/background-mural/upload` | 上传（裸 body） |
| `GET` `HEAD` | `/api/background-mural/media/<id>` | 取媒体，支持 Range 206 |
| `DELETE` | `/api/background-mural/item/<id>` | 删除一个素材 |
| `POST` | `/api/background-mural/orphans` | 重扫素材库并清掉失效条目 |

所有路由都过同源围栏：带 `Sec-Fetch-Site: cross-site` 的请求直接 403，`Origin` 与 `Host` 不匹配也 403。

---

## 测试与验收

```sh
cd dsh-background-mural
node --test test/
```

覆盖：MIME/扩展名白名单与冲突拒绝、文件头签名嗅探、Range 解析（含后缀区间与不可满足区间）、同源围栏、有界 body 读取、设置归一化与键白名单、磁盘素材库的增删查、超标与类型不符的上传拒绝、索引损坏后的自愈、索引行指向丢失文件时的清理、路径逃逸围栏。

手工验收清单：

- [ ] 设置里出现「背景壁画」，控制台无报错
- [ ] 上传一张 PNG → 立即铺满界面，上层文字仍可读
- [ ] 上传一个 MP4 → 自动循环播放；拖动进度条能跳（说明 Range 生效）
- [ ] 切到「只显示首帧」→ 变成静止画面，且不转码
- [ ] 关闭总开关 → 画面消失，Network 里不再有 `/media/` 请求
- [ ] 刷新页面 → 背景自动恢复，无闪白
- [ ] 删除正在使用的素材 → 背景被清空而不是留一块黑
- [ ] 桌面版与 Web 版表现一致

---

## 安全与边界

- 上传类型走**双重白名单**：声明的 MIME 与文件扩展名必须同时命中，且两者对「图片还是视频」的判断必须一致，最后再核对文件头签名。不确定就拒绝，不猜。
- 单文件大小上限默认 512 MiB，素材库总容量默认 8 GiB，都可以在设置里改大；`content-length` 和实际累计字节都会被检查。
- 文件名只用来显示：目录部分、控制字符会被剥掉，写盘用的是服务端生成的 UUID。
- 媒体读取经过路径逃逸围栏，解析后的绝对路径必须落在 `media/` 目录内，否则返回 404。
- 上传没有做「来源审核」，因为这是本机单人工具：能访问到你 DSH 端口的人本来就能操作你的会话。跨站浏览器向量由同源围栏挡住。

## 已知限制

- 不识别 GIF 之外的动图格式做背景动画；GIF 由浏览器自行播放。
- 没有服务端转码：浏览器不能解码的编码（例如部分 HEVC/ProRes）无法作为视频背景，诊断面板会显示支持情况。
- 传超大视频受内存影响不大（流式写盘），但总容量上限仍然是硬限制。
- 与皮肤类插件的背景共用同一块屏幕空间时，后挂载的图层在上层；Mural 只负责自己那一层，不接管皮肤的配色。

## 路线图

- [ ] 从 URL 拉取素材（含时长/尺寸探测）
- [ ] 为每个素材单独保存一组外观参数（换素材不丢调好的数值）
- [ ] 多显示器 / 按会话切换背景
- [ ] 视频封面帧缓存，避免每次切换重新解码

## 许可

MIT。上传的素材属于你自己，本插件不上传、不分发任何文件到本机之外。
