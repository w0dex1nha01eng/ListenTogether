启动器以当前用户权限运行。运行时保存在 `%LOCALAPPDATA%/NCM-ListenTogether/runtime`，插件和配置保存在同级 `profile`。网络连接使用本机回环端口。网易云安装目录保持原样。第三方来源见 [NOTICE.txt](NOTICE.txt)。

## 构建

在 Windows x64 上构建。需要 Node.js、Python 3、Windows PowerShell 和系统 .NET Framework C# 编译器。先创建 `packaging/vendor/`，把上游 ZIP 保存到这个目录，文件名为 `BetterNCM-v3-Portable-x64.zip`。[BetterNCM v3.0.0 Portable x64](https://github.com/Leafmy/BetterNCM-v3/releases/download/v3.0.0/BetterNCM-v3-Portable-x64.zip)

在项目根目录运行以下命令。

```powershell
npm ci
.\packaging\build.ps1
.\packaging\verify.ps1
```

构建脚本会校验上游 ZIP 的 SHA-256目。如果上游 ZIP 放在其他位置，构建和验证命令都可加 `-AuditZip <路径>`。`-SkipPluginBuild` 可复用当前版本已构建的插件。

构建成功后，`packaging/dist/` 中的 ZIP 和 `SHA256SUMS.txt` 可作为 GitHub Release 附件。
