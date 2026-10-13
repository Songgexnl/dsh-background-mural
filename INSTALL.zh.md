# 三分钟上手

这个文件是给「先在本地看效果」准备的最短路径，完整说明见 [README.zh.md](README.zh.md)。

## 一、装上去

在 **任意目录** 打开终端，把 `<包目录>` 换成这个包的真实路径（例如 `D:\dss\dsh-code\demo1\dsh-background-mural`）：

```sh
dsh plugin --profile web add link:<包目录>
```

如果你想同时给桌面版用，再执行一次（指向同一个目录）：

```sh
dsh plugin --profile desktop add link:<包目录>
```

## 二、重启

完全退出 DSH 再启动（`dsh web`，或直接双击桌面版）。启动日志里应该出现这一行：

```
[background-mural] media library ready at <DSH_HOME>/background-mural (0 item(s))
```

没看到这行说明插件没被加载，先看下面第四节。

## 三、用起来

1. 打开 **设置 → 背景壁画**。
2. 点「上传图片 / 视频」，选一张图或一段视频（也可以直接拖进去）。
3. 上传完最后一个文件会自动成为背景；点卡片上的按钮可以切换或清除。
4. 下面四组滑杆调外观：填充方式、焦点、压暗、模糊、不透明度、视频播放方式。

## 四、出问题先看这里

| 现象 | 先检查 |
| --- | --- |
| 设置里没有「背景壁画」 | 启动日志有没有 `[background-mural]` 那一行；`dsh plugin --profile web list` 里有没有这个包 |
| 有设置页但素材库一直转圈 | 打开诊断面板看「接口连通性」；浏览器控制台里搜 `background-mural` |
| 传上去不显示 | 诊断面板的「视频编码支持」；PNG/JPG 应该一定能显示，如果图片都不显示，多半是被皮肤类插件的背景图层盖住了 |
| 控制台报 `Failed to fetch` | 刷新一次页面；确认没有反向代理把 `/api/background-mural/` 挡掉 |

## 五、想跑自检

```sh
cd <包目录>
node --test test/
```

全部通过说明 host 半区的解析、限流、素材库这些纯逻辑是好的。
