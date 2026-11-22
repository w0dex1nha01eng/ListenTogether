# ListenTogether

Windows 网易云音乐的非官方 BetterNCM 插件，用来适配类似 wyy 手机端的多人一起听

## 功能

- 在电脑端创建多人一起听房间
- 粘贴手机端多人房邀请链接加入，也可复制邀请
- 在歌曲「…」菜单中选择「推荐此歌曲」（就那个加入歌单下一首播放那个三个点）
- 气泡和面板可以拖动
- 可开关同步播放，让本地播放器跟上房间的歌曲和进度（如果没同步自己关一下同步再勾一下就行）

## 使用

Releases 下载 `NCM-ListenTogether-Windows-x64.zip`。解压后双击里面的 EXE，启动器会配置内置的 BetterNCM v3 和插件，再打开网易云音乐。

启动包目前支持原版 Windows x64 网易云音乐 `3.1.43.205627`。如果网易云正在运行，先从系统托盘完全退出。启动后用原版账号登录，在右上角点「一起听」。播放一首歌后可以开房，也可以粘贴好友发来的多人房邀请链接。

已有兼容加载器时，也可以单独使用 `.plugin` 插件文件。

## 从源码构建

需要 Node.js 和 Python 3。在项目根目录依次运行以下命令。

```powershell
npm ci
npm test
npm run build
```

另附 [Windows 分享包构建与校验](packaging/README.md) 和 [第三方组件来源](packaging/NOTICE.txt)。
