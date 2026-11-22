using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("NCM-ListenTogether Launcher")]
[assembly: AssemblyDescription("Launcher for the NCM-ListenTogether BetterNCM plugin")]
[assembly: AssemblyProduct("NCM-ListenTogether")]
[assembly: AssemblyCompany("Local build")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace NcmListenTogether.Launcher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (Mutex mutex = new Mutex(true, @"Local\NCM-ListenTogether-Launcher", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show(
                        "多人一起听启动器已经在运行。",
                        "NCM-ListenTogether",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return;
                }

                LauncherLog.Initialize();
                LauncherLog.Write("launcher started; base=" + LauncherPaths.BaseDir);
                Application.Run(new LauncherForm());
            }
        }
    }

    internal static class LauncherPaths
    {
        public static string BaseDir
        {
            get { return LauncherLog.BaseDir; }
        }

        public static string RuntimeRoot
        {
            get { return Path.Combine(BaseDir, "runtime"); }
        }

        public static string ProfileDir
        {
            get { return Path.Combine(BaseDir, "profile"); }
        }

        public static string PluginsDir
        {
            get { return Path.Combine(ProfileDir, "plugins"); }
        }
    }

    internal static class LauncherLog
    {
        public static string BaseDir = "";
        public static string LogDir = "";
        public static string LogFile = "";

        public static void Initialize()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            BaseDir = Path.Combine(local, "NCM-ListenTogether");
            LogDir = Path.Combine(BaseDir, "logs");
            LogFile = Path.Combine(LogDir, "launcher.log");

            try
            {
                Directory.CreateDirectory(LogDir);
                MarkHidden(LogDir);
                if (!File.Exists(LogFile))
                {
                    File.WriteAllText(LogFile, "", new UTF8Encoding(false));
                    MarkHidden(LogFile);
                }
            }
            catch
            {
                BaseDir = Path.Combine(Path.GetTempPath(), "NCM-ListenTogether");
                LogDir = Path.Combine(BaseDir, "logs");
                LogFile = Path.Combine(LogDir, "launcher.log");
                Directory.CreateDirectory(LogDir);
            }
        }

        public static void Write(string message)
        {
            try
            {
                if (string.IsNullOrEmpty(LogFile)) { return; }
                string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "] " + message + Environment.NewLine;
                File.AppendAllText(LogFile, line, new UTF8Encoding(false));
                MarkHidden(LogFile);
            }
            catch
            {
                // Logging must never stop the launcher.
            }
        }

        public static void MarkHidden(string path)
        {
            try
            {
                FileAttributes attributes = File.GetAttributes(path);
                File.SetAttributes(path, attributes | FileAttributes.Hidden);
            }
            catch
            {
                // Best effort only.
            }
        }
    }

    internal sealed class PayloadInfo
    {
        public string PayloadVersion;
        public string BetterNcmProject;
        public string BetterNcmVersion;
        public string BetterNcmCommit;
        public string BetterNcmAuditSha256;
        public string PluginEntry;
        public string PluginFile;
        public string PluginSlug;
        public string PluginVersion;
        public string PluginSha256;
        public string NcmFileVersion;

        private const string PayloadResourceName = "payload.zip";

        public static Stream OpenResource()
        {
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName);
            if (stream == null)
            {
                throw new InvalidOperationException("安装包损坏：找不到内嵌的 payload.zip。");
            }
            return stream;
        }

        public static PayloadInfo Load()
        {
            string json;
            using (Stream resource = OpenResource())
            using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read))
            {
                ZipArchiveEntry entry = archive.GetEntry("payload.json");
                if (entry == null)
                {
                    throw new InvalidOperationException("安装包损坏：payload.json 不存在。");
                }
                using (StreamReader reader = new StreamReader(entry.Open(), new UTF8Encoding(false), true))
                {
                    json = reader.ReadToEnd();
                }
            }

            Dictionary<string, string> values = JsonUtil.ParseFlatStrings(json);
            PayloadInfo info = new PayloadInfo();
            info.PayloadVersion = JsonUtil.Require(values, "payload_version");
            info.BetterNcmProject = JsonUtil.Get(values, "betterNcm_project");
            info.BetterNcmVersion = JsonUtil.Get(values, "betterNcm_version");
            info.BetterNcmCommit = JsonUtil.Get(values, "betterNcm_commit");
            info.BetterNcmAuditSha256 = JsonUtil.Get(values, "betterNcm_audit_sha256");
            info.PluginEntry = JsonUtil.Require(values, "plugin_entry");
            info.PluginFile = JsonUtil.Require(values, "plugin_file");
            info.PluginSlug = JsonUtil.Require(values, "plugin_slug");
            info.PluginVersion = JsonUtil.Require(values, "plugin_version");
            info.PluginSha256 = JsonUtil.Get(values, "plugin_sha256");
            info.NcmFileVersion = JsonUtil.Get(values, "ncm_file_version");

            if (info.PluginEntry != "plugin/" + info.PluginFile)
            {
                throw new InvalidOperationException("安装包损坏：插件条目路径不一致。");
            }
            if (info.PluginFile.Length == 0 ||
                info.PluginFile.IndexOf('/') >= 0 ||
                info.PluginFile.IndexOf('\\') >= 0 ||
                info.PluginFile.IndexOf(':') >= 0 ||
                info.PluginFile == "." ||
                info.PluginFile == "..")
            {
                throw new InvalidOperationException("安装包损坏：插件文件名不安全。");
            }
            if (string.IsNullOrEmpty(info.PayloadVersion))
            {
                throw new InvalidOperationException("安装包损坏：payload 版本为空。");
            }

            return info;
        }

        public void ExtractNotice()
        {
            try
            {
                byte[] bytes = null;
                using (Stream resource = OpenResource())
                using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read))
                {
                    ZipArchiveEntry entry = archive.GetEntry("NOTICE.txt");
                    if (entry == null) { return; }
                    using (Stream input = entry.Open())
                    using (MemoryStream memory = new MemoryStream())
                    {
                        CopyStream(input, memory);
                        bytes = memory.ToArray();
                    }
                }

                string target = Path.Combine(LauncherPaths.BaseDir, "NOTICE.txt");
                string temporary = target + ".tmp-" + Guid.NewGuid().ToString("N");
                File.WriteAllBytes(temporary, bytes);
                if (File.Exists(target))
                {
                    try
                    {
                        File.Replace(temporary, target, null);
                    }
                    catch
                    {
                        File.Copy(temporary, target, true);
                        File.Delete(temporary);
                    }
                }
                else
                {
                    File.Move(temporary, target);
                }
            }
            catch (Exception ex)
            {
                LauncherLog.Write("could not extract NOTICE.txt: " + ex.Message);
            }
        }

        public static void CopyStream(Stream input, Stream output)
        {
            byte[] buffer = new byte[131072];
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                output.Write(buffer, 0, read);
            }
        }
    }

    internal static class JsonUtil
    {
        private static readonly Regex FlatString = new Regex(
            "\"((?:\\\\.|[^\"\\\\])*)\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"",
            RegexOptions.CultureInvariant);

        public static Dictionary<string, string> ParseFlatStrings(string json)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match match in FlatString.Matches(json))
            {
                values[Unescape(match.Groups[1].Value)] = Unescape(match.Groups[2].Value);
            }
            return values;
        }

        public static string Get(Dictionary<string, string> values, string key)
        {
            string value;
            if (values.TryGetValue(key, out value)) { return value; }
            return "";
        }

        public static string Require(Dictionary<string, string> values, string key)
        {
            string value = Get(values, key);
            if (string.IsNullOrEmpty(value))
            {
                throw new InvalidOperationException("安装包损坏：payload.json 缺少 " + key + "。");
            }
            return value;
        }

        public static string GetString(string json, string key)
        {
            Regex regex = new Regex(
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"",
                RegexOptions.CultureInvariant);
            Match match = regex.Match(json);
            if (!match.Success) { return null; }
            return Unescape(match.Groups[1].Value);
        }

        private static string Unescape(string value)
        {
            if (value.IndexOf('\\') < 0) { return value; }
            StringBuilder builder = new StringBuilder(value.Length);
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c != '\\' || i + 1 >= value.Length)
                {
                    builder.Append(c);
                    continue;
                }

                char next = value[++i];
                switch (next)
                {
                    case '"': builder.Append('"'); break;
                    case '\\': builder.Append('\\'); break;
                    case '/': builder.Append('/'); break;
                    case 'b': builder.Append('\b'); break;
                    case 'f': builder.Append('\f'); break;
                    case 'n': builder.Append('\n'); break;
                    case 'r': builder.Append('\r'); break;
                    case 't': builder.Append('\t'); break;
                    case 'u':
                        if (i + 4 < value.Length)
                        {
                            string hex = value.Substring(i + 1, 4);
                            int code;
                            if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                            {
                                builder.Append((char)code);
                                i += 4;
                                break;
                            }
                        }
                        builder.Append('u');
                        break;
                    default:
                        builder.Append(next);
                        break;
                }
            }
            return builder.ToString();
        }
    }

    internal sealed class ValidationResult
    {
        public bool Ok;
        public string Message;
        public string FileVersion;
        public string ProductName;
        public string CompanyName;

        public static ValidationResult Pass(string fileVersion, string productName, string companyName)
        {
            ValidationResult result = new ValidationResult();
            result.Ok = true;
            result.FileVersion = fileVersion;
            result.ProductName = productName;
            result.CompanyName = companyName;
            result.Message = "已找到网易云音乐 " + fileVersion + "（x64）。";
            return result;
        }

        public static ValidationResult Fail(string message, string fileVersion, string productName, string companyName)
        {
            ValidationResult result = new ValidationResult();
            result.Ok = false;
            result.Message = message;
            result.FileVersion = fileVersion;
            result.ProductName = productName;
            result.CompanyName = companyName;
            return result;
        }
    }

    internal static class NcmClient
    {
        public const string TargetFileVersion = "3.1.43.205627";

        public static string Detect()
        {
            List<string> candidates = CollectCandidates();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string firstExisting = null;

            foreach (string candidate in candidates)
            {
                if (string.IsNullOrWhiteSpace(candidate)) { continue; }

                string full;
                try { full = Path.GetFullPath(candidate.Trim()); }
                catch { continue; }

                if (!seen.Add(full)) { continue; }
                if (!File.Exists(Path.Combine(full, "cloudmusic.exe"))) { continue; }

                if (firstExisting == null) { firstExisting = full; }
                if (Validate(full).Ok) { return full; }
            }

            return firstExisting;
        }

        public static ValidationResult Validate(string directory)
        {
            if (string.IsNullOrWhiteSpace(directory))
            {
                return ValidationResult.Fail("请选择网易云音乐安装目录。", "", "", "");
            }

            string full;
            try { full = Path.GetFullPath(directory.Trim()); }
            catch (Exception ex)
            {
                return ValidationResult.Fail("目录路径无效：" + ex.Message, "", "", "");
            }

            string exe = Path.Combine(full, "cloudmusic.exe");
            if (!File.Exists(exe))
            {
                return ValidationResult.Fail("所选目录中找不到 cloudmusic.exe。", "", "", "");
            }

            FileVersionInfo version;
            try { version = FileVersionInfo.GetVersionInfo(exe); }
            catch (Exception ex)
            {
                return ValidationResult.Fail("无法读取 cloudmusic.exe 的文件版本：" + ex.Message, "", "", "");
            }

            string fileVersion = version.FileVersion ?? "";
            string product = version.ProductName ?? "";
            string company = version.CompanyName ?? "";
            string original = version.OriginalFilename ?? "";

            bool companyOk = company.IndexOf("NetEase", StringComparison.OrdinalIgnoreCase) >= 0;
            bool productOk =
                product.IndexOf("NetEase Cloud Music", StringComparison.OrdinalIgnoreCase) >= 0 ||
                product.IndexOf("网易云音乐", StringComparison.Ordinal) >= 0;

            if (!companyOk || !productOk)
            {
                return ValidationResult.Fail(
                    "这不是预期的原版网易云音乐客户端。\n" +
                    "公司：" + company + "\n产品：" + product,
                    fileVersion, product, company);
            }

            if (original.Length > 0 && !string.Equals(original, "cloudmusic.exe", StringComparison.OrdinalIgnoreCase))
            {
                return ValidationResult.Fail(
                    "cloudmusic.exe 的原始文件名不匹配：" + original,
                    fileVersion, product, company);
            }

            if (!string.Equals(fileVersion.Trim(), TargetFileVersion, StringComparison.Ordinal))
            {
                return ValidationResult.Fail(
                    "仅支持已实测的原版 Windows x64 网易云音乐 " + TargetFileVersion + "。\n" +
                    "当前安装文件的 FileVersionInfo 为：" + (fileVersion.Length == 0 ? "(空)" : fileVersion) + "\n" +
                    "请改用受支持的客户端版本后再运行。",
                    fileVersion, product, company);
            }

            if (!IsPeX64(exe))
            {
                return ValidationResult.Fail(
                    "cloudmusic.exe 不是 Windows x64 程序，无法使用此 x64 启动器。",
                    fileVersion, product, company);
            }

            return ValidationResult.Pass(fileVersion, product, company);
        }

        public static bool IsClientRunning()
        {
            Process[] processes = null;
            try
            {
                processes = Process.GetProcessesByName("cloudmusic");
                return processes.Length > 0;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (processes != null)
                {
                    for (int i = 0; i < processes.Length; i++)
                    {
                        try { processes[i].Dispose(); } catch { }
                    }
                }
            }
        }

        private static List<string> CollectCandidates()
        {
            List<string> list = new List<string>();

            AddRegistryCandidate(list, RegistryHive.LocalMachine, RegistryView.Registry64);
            AddRegistryCandidate(list, RegistryHive.LocalMachine, RegistryView.Registry32);
            AddRegistryCandidate(list, RegistryHive.CurrentUser, RegistryView.Registry64);
            AddRegistryCandidate(list, RegistryHive.CurrentUser, RegistryView.Registry32);

            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            if (!string.IsNullOrEmpty(programFiles))
            {
                list.Add(Path.Combine(programFiles, "Netease", "CloudMusic"));
            }
            if (!string.IsNullOrEmpty(programFilesX86))
            {
                list.Add(Path.Combine(programFilesX86, "Netease", "CloudMusic"));
            }

            list.Add(@"C:\CloudMusic");
            list.Add(@"D:\CloudMusic");
            list.Add(@"E:\CloudMusic");
            list.Add(@"F:\CloudMusic");

            return list;
        }

        private static void AddRegistryCandidate(List<string> list, RegistryHive hive, RegistryView view)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                using (RegistryKey key = baseKey.OpenSubKey(@"SOFTWARE\Netease\cloudmusic"))
                {
                    if (key == null) { return; }
                    object value = key.GetValue("install_dir");
                    string text = value as string;
                    if (!string.IsNullOrWhiteSpace(text)) { list.Add(text); }
                }
            }
            catch
            {
                // Registry lookup is best effort.
            }
        }

        private static bool IsPeX64(string path)
        {
            try
            {
                using (FileStream stream = File.OpenRead(path))
                using (BinaryReader reader = new BinaryReader(stream))
                {
                    if (stream.Length < 0x100) { return false; }
                    stream.Position = 0;
                    if (reader.ReadUInt16() != 0x5A4D) { return false; }
                    stream.Position = 0x3C;
                    int peOffset = reader.ReadInt32();
                    if (peOffset <= 0 || peOffset + 6 > stream.Length) { return false; }
                    stream.Position = peOffset;
                    if (reader.ReadUInt32() != 0x00004550) { return false; }
                    ushort machine = reader.ReadUInt16();
                    return machine == 0x8664;
                }
            }
            catch
            {
                return false;
            }
        }
    }

    internal static class RuntimeInstaller
    {
        private static readonly string[] RequiredRuntimeFiles = new string[]
        {
            "bin/node.exe",
            "tools/bncm_agent.mjs",
            "tools/ncm_host.mjs",
            "tools/bncm_preload.js",
            "tools/cdp_inject.mjs",
            "tools/cdp_watch.mjs",
            "loader/framework.js",
            "loader/manager.js",
            "loader/hijacks.json",
            "loader/selectors.json"
        };

        public static string Ensure(PayloadInfo info)
        {
            string runtimeRoot = LauncherPaths.RuntimeRoot;
            Directory.CreateDirectory(runtimeRoot);

            string version = SafeSegment(info.PayloadVersion);
            string finalDir = Path.Combine(runtimeRoot, version);
            if (IsReady(finalDir, info.PayloadVersion))
            {
                EnsureOutDirectory(finalDir);
                LauncherLog.Write("runtime already ready: " + finalDir);
                return finalDir;
            }

            string staging = Path.Combine(runtimeRoot, ".staging-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(staging);
            bool installed = false;
            string oldDir = null;

            try
            {
                using (Stream resource = PayloadInfo.OpenResource())
                using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string name = entry.FullName;
                        if (!name.StartsWith("runtime/", StringComparison.Ordinal)) { continue; }
                        if (name.EndsWith("/", StringComparison.Ordinal)) { continue; }

                        string relative = name.Substring("runtime/".Length);
                        AssertSafeRelative(relative);
                        string destination = Path.Combine(staging, relative.Replace('/', Path.DirectorySeparatorChar));
                        EnsureUnder(staging, destination);

                        string parent = Path.GetDirectoryName(destination);
                        if (!string.IsNullOrEmpty(parent)) { Directory.CreateDirectory(parent); }

                        using (Stream input = entry.Open())
                        using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            PayloadInfo.CopyStream(input, output);
                            output.Flush(true);
                        }
                    }
                }

                VerifyRequired(staging);
                File.WriteAllText(
                    Path.Combine(staging, ".ready"),
                    info.PayloadVersion + Environment.NewLine + (info.BetterNcmAuditSha256 ?? ""),
                    new UTF8Encoding(false));
                EnsureOutDirectory(staging);

                if (Directory.Exists(finalDir))
                {
                    oldDir = Path.Combine(
                        runtimeRoot,
                        ".old-" + version + "-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture));
                    Directory.Move(finalDir, oldDir);
                }

                try
                {
                    Directory.Move(staging, finalDir);
                    installed = true;
                }
                catch
                {
                    if (oldDir != null && !Directory.Exists(finalDir))
                    {
                        try { Directory.Move(oldDir, finalDir); } catch { }
                    }
                    throw;
                }

                LauncherLog.Write("runtime extracted: " + finalDir);
                return finalDir;
            }
            finally
            {
                if (!installed && Directory.Exists(staging))
                {
                    TryDeleteStaging(runtimeRoot, staging);
                }
            }
        }

        private static bool IsReady(string directory, string version)
        {
            try
            {
                if (!Directory.Exists(directory)) { return false; }
                string marker = Path.Combine(directory, ".ready");
                if (!File.Exists(marker)) { return false; }
                string text = File.ReadAllText(marker);
                if (!text.StartsWith(version, StringComparison.Ordinal)) { return false; }

                for (int i = 0; i < RequiredRuntimeFiles.Length; i++)
                {
                    string file = Path.Combine(directory, RequiredRuntimeFiles[i].Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(file)) { return false; }
                }
                string node = Path.Combine(directory, "bin", "node.exe");
                return new FileInfo(node).Length > 10000000;
            }
            catch
            {
                return false;
            }
        }

        private static void VerifyRequired(string directory)
        {
            for (int i = 0; i < RequiredRuntimeFiles.Length; i++)
            {
                string file = Path.Combine(directory, RequiredRuntimeFiles[i].Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(file))
                {
                    throw new InvalidOperationException("安装包损坏：运行时缺少 " + RequiredRuntimeFiles[i] + "。");
                }
            }
        }

        private static void EnsureOutDirectory(string runtimeDir)
        {
            try
            {
                string outDir = Path.Combine(runtimeDir, "out");
                Directory.CreateDirectory(outDir);
                LauncherLog.MarkHidden(outDir);
            }
            catch
            {
                // Logs are still usable if the attribute cannot be set.
            }
        }

        private static string SafeSegment(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException("安装包损坏：运行时版本号为空。");
            }
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                bool allowed =
                    (c >= 'a' && c <= 'z') ||
                    (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') ||
                    c == '.' || c == '_' || c == '-';
                if (!allowed)
                {
                    throw new InvalidOperationException("安装包损坏：运行时版本号不安全。");
                }
            }
            return value;
        }

        private static void AssertSafeRelative(string relative)
        {
            if (string.IsNullOrEmpty(relative) ||
                relative.IndexOf('\\') >= 0 ||
                relative.IndexOf(':') >= 0 ||
                relative.StartsWith("/", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("安装包损坏：运行时路径不安全：" + relative);
            }
            string[] parts = relative.Split('/');
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i].Length == 0 || parts[i] == "." || parts[i] == "..")
                {
                    throw new InvalidOperationException("安装包损坏：运行时路径越界：" + relative);
                }
            }
        }

        private static void EnsureUnder(string root, string path)
        {
            string rootFull = Path.GetFullPath(root);
            string pathFull = Path.GetFullPath(path);
            if (pathFull.Length <= rootFull.Length ||
                !pathFull.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安装包损坏：运行时路径越界。");
            }
        }

        private static void TryDeleteStaging(string root, string path)
        {
            try
            {
                EnsureUnder(root, path);
                if (!Path.GetFileName(path).StartsWith(".staging-", StringComparison.Ordinal)) { return; }
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { return; }
                Directory.Delete(path, true);
            }
            catch { }
        }
    }

    internal static class PluginInstaller
    {
        public static void Ensure(PayloadInfo info)
        {
            string profile = LauncherPaths.ProfileDir;
            string plugins = LauncherPaths.PluginsDir;
            Directory.CreateDirectory(plugins);

            string stagingRoot = Path.Combine(profile, ".staging");
            Directory.CreateDirectory(stagingRoot);
            string stagingFile = Path.Combine(stagingRoot, info.PluginFile + "." + Guid.NewGuid().ToString("N") + ".part");

            try
            {
                ExtractPlugin(info, stagingFile);
                string stagedHash = HashFile(stagingFile);
                if (!string.IsNullOrEmpty(info.PluginSha256) &&
                    !string.Equals(stagedHash, info.PluginSha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("安装包损坏：内嵌插件 SHA-256 不匹配。");
                }

                string target = Path.Combine(plugins, info.PluginFile);
                bool targetExists = File.Exists(target) || Directory.Exists(target);
                bool targetCurrent = false;

                if (File.Exists(target))
                {
                    string targetHash = HashFile(target);
                    string targetSlug = SlugOfPluginFile(target);
                    targetCurrent =
                        string.Equals(targetHash, stagedHash, StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(targetSlug, info.PluginSlug, StringComparison.Ordinal);
                }

                List<string> collisions = FindSlugCollisions(plugins, info.PluginSlug);

                if (targetCurrent)
                {
                    RemovePath(collisions, target);
                    if (collisions.Count > 0)
                    {
                        MoveToBackup(profile, collisions);
                    }
                    LauncherLog.Write("plugin already current: " + target);
                    return;
                }

                if (targetExists && !ContainsPath(collisions, target))
                {
                    collisions.Add(target);
                }
                MoveToBackup(profile, collisions);

                if (File.Exists(target) || Directory.Exists(target))
                {
                    throw new IOException("无法替换插件文件，目标仍被占用：" + target);
                }

                File.Move(stagingFile, target);
                LauncherLog.Write("plugin installed: " + target);
            }
            finally
            {
                try { if (File.Exists(stagingFile)) { File.Delete(stagingFile); } }
                catch { }
            }
        }

        private static void ExtractPlugin(PayloadInfo info, string destination)
        {
            using (Stream resource = PayloadInfo.OpenResource())
            using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read))
            {
                ZipArchiveEntry entry = archive.GetEntry(info.PluginEntry);
                if (entry == null)
                {
                    throw new InvalidOperationException("安装包损坏：找不到内嵌插件 " + info.PluginEntry + "。");
                }
                using (Stream input = entry.Open())
                using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    PayloadInfo.CopyStream(input, output);
                    output.Flush(true);
                }
            }
        }

        private static List<string> FindSlugCollisions(string pluginsDir, string slug)
        {
            List<string> result = new List<string>();
            foreach (string entry in Directory.GetFileSystemEntries(pluginsDir))
            {
                try
                {
                    if (Directory.Exists(entry))
                    {
                        string directorySlug = SlugOfDirectory(entry);
                        if (string.Equals(directorySlug, slug, StringComparison.Ordinal)) { result.Add(entry); }
                    }
                    else if (entry.EndsWith(".plugin", StringComparison.OrdinalIgnoreCase))
                    {
                        string fileSlug = SlugOfPluginFile(entry);
                        if (string.Equals(fileSlug, slug, StringComparison.Ordinal)) { result.Add(entry); }
                    }
                }
                catch
                {
                    // An unreadable unrelated plugin is left untouched.
                }
            }
            return result;
        }

        private static string SlugOfDirectory(string directory)
        {
            try
            {
                string manifest = Path.Combine(directory, "manifest.json");
                if (!File.Exists(manifest)) { return null; }
                return JsonUtil.GetString(File.ReadAllText(manifest), "slug");
            }
            catch
            {
                return null;
            }
        }

        private static string SlugOfPluginFile(string file)
        {
            try
            {
                using (FileStream stream = File.OpenRead(file))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    ZipArchiveEntry entry = archive.GetEntry("manifest.json");
                    if (entry == null) { return null; }
                    using (StreamReader reader = new StreamReader(entry.Open(), new UTF8Encoding(false), true))
                    {
                        return JsonUtil.GetString(reader.ReadToEnd(), "slug");
                    }
                }
            }
            catch
            {
                return null;
            }
        }

        private static void MoveToBackup(string profile, List<string> paths)
        {
            if (paths.Count == 0) { return; }

            string backupDir = Path.Combine(
                profile,
                "_backup_plugins",
                DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-" +
                Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(backupDir);

            for (int i = 0; i < paths.Count; i++)
            {
                string source = paths[i];
                if (!File.Exists(source) && !Directory.Exists(source)) { continue; }

                string name = Path.GetFileName(source);
                string destination = Path.Combine(backupDir, name);
                int suffix = 1;
                while (File.Exists(destination) || Directory.Exists(destination))
                {
                    destination = Path.Combine(
                        backupDir,
                        Path.GetFileNameWithoutExtension(name) + "-" + suffix.ToString(CultureInfo.InvariantCulture) + Path.GetExtension(name));
                    suffix++;
                }

                if (Directory.Exists(source)) { Directory.Move(source, destination); }
                else { File.Move(source, destination); }

                LauncherLog.Write("duplicate plugin moved to backup: " + destination);
            }
        }

        private static bool ContainsPath(List<string> paths, string path)
        {
            for (int i = 0; i < paths.Count; i++)
            {
                if (string.Equals(Path.GetFullPath(paths[i]), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static void RemovePath(List<string> paths, string path)
        {
            for (int i = paths.Count - 1; i >= 0; i--)
            {
                if (string.Equals(Path.GetFullPath(paths[i]), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))
                {
                    paths.RemoveAt(i);
                }
            }
        }

        private static string HashFile(string path)
        {
            using (FileStream stream = File.OpenRead(path))
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder builder = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++)
                {
                    builder.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }
    }

    internal static class PortPicker
    {
        public static int GetFreeLoopbackPort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            try
            {
                IPEndPoint endpoint = (IPEndPoint)listener.LocalEndpoint;
                return endpoint.Port;
            }
            finally
            {
                listener.Stop();
            }
        }
    }

    internal static class AgentLauncher
    {
        private static string StateFile
        {
            get { return Path.Combine(LauncherPaths.BaseDir, "agent.pid"); }
        }

        public static void StopPreviousAgent()
        {
            try
            {
                if (!File.Exists(StateFile)) { return; }
                string[] lines = File.ReadAllLines(StateFile);
                if (lines.Length != 3) { return; }

                int pid;
                if (!int.TryParse(lines[0].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out pid)) { return; }
                if (pid <= 0) { return; }

                string expectedNode = Path.GetFullPath(lines[1].Trim());
                string root = Path.GetFullPath(LauncherPaths.RuntimeRoot) + Path.DirectorySeparatorChar;
                if (!expectedNode.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
                    !expectedNode.EndsWith(@"\bin\node.exe", StringComparison.OrdinalIgnoreCase)) { return; }
                Process process = null;
                try
                {
                    process = Process.GetProcessById(pid);
                    string executable = null;
                    try { executable = process.MainModule.FileName; }
                    catch { executable = null; }

                    if (executable != null && process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture) == lines[2] &&
                        string.Equals(Path.GetFullPath(executable), Path.GetFullPath(expectedNode), StringComparison.OrdinalIgnoreCase))
                    {
                        LauncherLog.Write("stopping previous background agent (pid " + pid.ToString(CultureInfo.InvariantCulture) + ")");
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
                catch (Exception ex)
                {
                    LauncherLog.Write("could not stop previous agent: " + ex.Message);
                }
                finally
                {
                    if (process != null) { process.Dispose(); }
                    try { File.Delete(StateFile); } catch { }
                }
            }
            catch (Exception ex)
            {
                LauncherLog.Write("previous-agent check failed: " + ex.Message);
            }
        }

        public static Process Start(string runtimeDir, string ncmDir, int port)
        {
            string node = Path.Combine(runtimeDir, "bin", "node.exe");
            string agent = Path.Combine(runtimeDir, "tools", "bncm_agent.mjs");
            string plugins = LauncherPaths.PluginsDir;

            if (!File.Exists(node))
            {
                throw new FileNotFoundException("运行时缺少 bin/node.exe。", node);
            }
            if (!File.Exists(agent))
            {
                throw new FileNotFoundException("运行时缺少 tools/bncm_agent.mjs。", agent);
            }
            Directory.CreateDirectory(plugins);

            string arguments =
                Quote(agent) +
                " --ncm " + Quote(ncmDir) +
                " --data " + Quote(LauncherPaths.ProfileDir) +
                " --plugins " + Quote(plugins) +
                " --port " + port.ToString(CultureInfo.InvariantCulture) +
                " --host 127.0.0.1 --no-relaunch";

            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = node;
            info.Arguments = arguments;
            info.WorkingDirectory = runtimeDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;

            LauncherLog.Write("starting agent: " + info.FileName + " " + arguments);
            Process process = Process.Start(info);
            if (process == null)
            {
                throw new InvalidOperationException("无法启动 node.exe。");
            }

            try
            {
                string temporary = StateFile + ".tmp-" + Guid.NewGuid().ToString("N");
                File.WriteAllText(
                    temporary,
                    process.Id.ToString(CultureInfo.InvariantCulture) + Environment.NewLine + node + Environment.NewLine +
                    process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture) + Environment.NewLine,
                    new UTF8Encoding(false));
                if (File.Exists(StateFile)) { File.Replace(temporary, StateFile, null); }
                else { File.Move(temporary, StateFile); }
                LauncherLog.MarkHidden(StateFile);
            }
            catch (Exception ex)
            {
                LauncherLog.Write("could not write agent.pid: " + ex.Message);
            }

            return process;
        }

        public static void StartClient(string ncmDir, int port)
        {
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(ncmDir, "cloudmusic.exe"),
                Arguments = "--remote-debugging-port=" + port.ToString(CultureInfo.InvariantCulture),
                WorkingDirectory = ncmDir,
                UseShellExecute = false
            };
            using (Process process = Process.Start(start))
            {
                if (process == null) throw new InvalidOperationException("无法启动网易云音乐。");
            }
        }

        private static string Quote(string value)
        {
            if (value == null) { return "\"\""; }
            StringBuilder builder = new StringBuilder();
            builder.Append('"');
            int backslashes = 0;

            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (c == '"')
                {
                    builder.Append('\\', backslashes * 2 + 1);
                    builder.Append('"');
                    backslashes = 0;
                    continue;
                }
                if (backslashes > 0)
                {
                    builder.Append('\\', backslashes);
                    backslashes = 0;
                }
                builder.Append(c);
            }

            if (backslashes > 0) { builder.Append('\\', backslashes); }
            builder.Append('"');
            return builder.ToString();
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly TextBox pathBox = new TextBox();
        private readonly Label status = new Label();
        private readonly Button launch = new Button();
        private readonly Button browse = new Button();
        private PayloadInfo payload;
        private bool starting;

        public LauncherForm()
        {
            Text = "网易云音乐 · 一起听";
            ClientSize = new Size(506, 180);
            AutoScaleMode = AutoScaleMode.Font;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 10F);

            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(16),
                ColumnCount = 2,
                RowCount = 4
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 33));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            var label = new Label { Text = "网易云音乐客户端", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
            layout.Controls.Add(label, 0, 0);
            layout.SetColumnSpan(label, 2);

            pathBox.ReadOnly = true;
            pathBox.AccessibleName = "网易云音乐安装目录";
            pathBox.Dock = DockStyle.Fill;
            pathBox.Margin = new Padding(0, 4, 8, 0);
            layout.Controls.Add(pathBox, 0, 1);

            browse.Text = "浏览…";
            browse.Dock = DockStyle.Fill;
            browse.Margin = new Padding(0, 2, 0, 3);
            browse.Click += OnBrowse;
            layout.Controls.Add(browse, 1, 1);

            status.Dock = DockStyle.Fill;
            status.TextAlign = ContentAlignment.MiddleLeft;
            layout.Controls.Add(status, 0, 2);
            layout.SetColumnSpan(status, 2);

            launch.Text = "启动网易云音乐";
            launch.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
            launch.Size = new Size(148, 34);
            launch.Margin = Padding.Empty;
            launch.Enabled = false;
            launch.Click += OnLaunch;
            layout.Controls.Add(launch, 0, 3);
            layout.SetColumnSpan(launch, 2);
            Controls.Add(layout);
            AcceptButton = launch;
            Shown += OnShown;
            FormClosing += delegate(object sender, FormClosingEventArgs e) { e.Cancel = starting; };
        }

        private void OnShown(object sender, EventArgs e)
        {
            try
            {
                payload = PayloadInfo.Load();
                pathBox.Text = NcmClient.Detect() ?? "";
                UpdateValidation();
                if (launch.Enabled) BeginInvoke(new Action(() => launch.PerformClick()));
            }
            catch (Exception error)
            {
                ReportFailure(error);
            }
        }

        private void OnBrowse(object sender, EventArgs e)
        {
            using (var dialog = new OpenFileDialog
            {
                Title = "选择 cloudmusic.exe",
                Filter = "网易云音乐|cloudmusic.exe",
                FileName = "cloudmusic.exe",
                InitialDirectory = pathBox.Text
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                pathBox.Text = Path.GetDirectoryName(dialog.FileName);
                UpdateValidation();
            }
        }

        private void UpdateValidation()
        {
            var result = NcmClient.Validate(pathBox.Text);
            launch.Enabled = payload != null && result.Ok;
            status.ForeColor = result.Ok ? Color.DimGray : Color.Firebrick;
            status.Text = result.Ok ? "已找到网易云音乐 " + result.FileVersion :
                string.IsNullOrEmpty(pathBox.Text) ? "请选择网易云音乐的 cloudmusic.exe。" :
                result.Message.Replace("\n", " ");
        }

        private void OnLaunch(object sender, EventArgs e)
        {
            if (payload == null || starting) return;
            if (!NcmClient.Validate(pathBox.Text).Ok) { UpdateValidation(); return; }
            if (!EnsureClientClosed()) return;

            starting = true;
            launch.Enabled = false;
            browse.Enabled = false;
            status.Text = "正在准备一起听…";
            status.ForeColor = Color.DimGray;
            status.Refresh();
            UseWaitCursor = true;
            bool opened = false;
            try
            {
                AgentLauncher.StopPreviousAgent();
                payload.ExtractNotice();
                string runtime = RuntimeInstaller.Ensure(payload);
                PluginInstaller.Ensure(payload);
                if (!EnsureClientClosed()) return;

                int port = PortPicker.GetFreeLoopbackPort();
                using (Process agent = AgentLauncher.Start(runtime, pathBox.Text, port))
                {
                    if (agent.WaitForExit(1500))
                        throw new InvalidOperationException("加载器提前退出（代码 " + agent.ExitCode + "）。");
                    AgentLauncher.StartClient(pathBox.Text, port);
                }
                opened = true;
            }
            catch (Exception error)
            {
                ReportFailure(error);
            }
            finally
            {
                starting = false;
                UseWaitCursor = false;
                browse.Enabled = true;
                launch.Enabled = true;
                if (opened) Close();
            }
        }

        private bool EnsureClientClosed()
        {
            while (NcmClient.IsClientRunning())
            {
                if (MessageBox.Show(this, "请从系统托盘退出网易云音乐，再点“重试”。",
                    "网易云音乐正在运行", MessageBoxButtons.RetryCancel, MessageBoxIcon.Information) != DialogResult.Retry)
                {
                    UpdateValidation();
                    return false;
                }
            }
            return true;
        }

        private void ReportFailure(Exception error)
        {
            LauncherLog.Write("launch failed: " + error);
            status.ForeColor = Color.Firebrick;
            status.Text = "启动失败";
            MessageBox.Show(this, error.Message + "\n\n日志\n" + LauncherLog.LogFile,
                "一起听", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
