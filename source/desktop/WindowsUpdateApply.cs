using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

internal static class WindowsUpdateApply {
    const string Command = "--lychee-update-helper";
    const string JobVariable = "LYCHEE_WINDOWS_UPDATE_JOB";
    const string HelperVariable = "LYCHEE_WINDOWS_UPDATE_HELPER";
    const string RecoveryVariable = "LYCHEE_WINDOWS_UPDATE_RECOVERED";
    static int recoveryNotice;
    static readonly StringComparison IgnoreCase = StringComparison.OrdinalIgnoreCase;
    static string Jobs { get { return Path.Combine(Path.GetTempPath(), "LycheeWindowsUpdates"); } }
    static string Self { get { using (var p = Process.GetCurrentProcess()) return p.MainModule.FileName; } }

    static void Require(bool value, string message) {
        if (!value) throw new InvalidOperationException(message);
    }
    static bool Same(string left, string right) {
        return String.Equals(Path.GetFullPath(left), Path.GetFullPath(right), IgnoreCase);
    }
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    static string HashFile(string path) {
        using (var input = File.OpenRead(path))
        using (var sha = SHA256.Create()) return Hex(sha.ComputeHash(input));
    }
    static string LockName(string target) {
        using (var sha = SHA256.Create())
            return @"Local\LycheeUpdate-" + Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(target).ToUpperInvariant())));
    }
    static string EventName(string job, string phase) { return @"Local\LycheeUpdate-" + job + "-" + phase; }
    static Version ReadVersion(string path) {
        var f = FileVersionInfo.GetVersionInfo(path);
        return new Version(f.FileMajorPart, f.FileMinorPart, f.FileBuildPart, f.FilePrivatePart);
    }
    static Version TargetVersion(string version) {
        Version result;
        Require(Version.TryParse(version, out result) && result.Build >= 0 && result.Revision == -1 &&
                result.ToString() == version, "升级版本格式无效。");
        return new Version(result.Major, result.Minor, result.Build, 0);
    }
    static void CheckExe(string path, string original, Version wanted) {
        var current = FileVersionInfo.GetVersionInfo(original);
        var candidate = FileVersionInfo.GetVersionInfo(path);
        string family = "Lychee / " + WindowsInstallationIdentity.UpgradeCode;
        Require(!String.IsNullOrWhiteSpace(current.ProductName) && candidate.ProductName == current.ProductName &&
                current.CompanyName == family && candidate.CompanyName == family &&
                ReadVersion(path) == wanted, "更新程序的产品或版本不匹配。");
    }
    static void Origin(string value) {
        if (value == "") return;
        Uri uri = null;
        Require(WindowsInstallationIdentity.IsTestBuild && Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == "http" &&
                uri.Host == "127.0.0.1" && uri.AbsolutePath == "/" && uri.UserInfo.Length == 0 &&
                uri.Query.Length == 0 && uri.Fragment.Length == 0, "本地验收地址无效。");
    }
    internal static string DetectKind(string runningExe) {
        return Installer.RegisteredProduct(runningExe, false) == null ? "exe" : "msi";
    }
    static void Verify(string package, string hash, string version, string kind, string target) {
        Require(hash.Length == 64 && hash.All(Uri.IsHexDigit) && String.Equals(HashFile(package), hash, IgnoreCase),
                "更新包校验失败。");
        Version wanted = TargetVersion(version);
        Require(wanted > ReadVersion(target), "新版本必须高于当前版本。");
        Require((kind == "msi" || kind == "exe") && kind == DetectKind(target), "更新包与当前安装方式不匹配。");
        if (kind == "msi") {
            string oldProduct = Installer.RegisteredProduct(target, true);
            Installer.CheckPackage(package, version, oldProduct);
        } else CheckExe(package, target, wanted);
    }
    static void ExclusiveInstance(string target, int allowedPid) {
        foreach (var proc in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(target))) {
            using (proc) {
                if (proc.Id == allowedPid) continue;
                string path;
                try { path = proc.MainModule.FileName; }
                catch (InvalidOperationException) { continue; }
                catch (System.ComponentModel.Win32Exception) { continue; }
                Require(!Same(path, target), "请先关闭这份荔枝的其他窗口，再重新更新。");
            }
        }
    }
    static void RemoveFile(string path) {
        try { File.Delete(path); } catch (IOException) {} catch (UnauthorizedAccessException) {}
    }
    static void ClearStage(string dir) {
        foreach (string name in new[]{"package.exe","package.msi","request","helper.exe"})
            RemoveFile(Path.Combine(dir, name));
        try { Directory.Delete(dir, false); } catch (IOException) {} catch (UnauthorizedAccessException) {}
    }
    internal static void Start(string payload, string hash, string version, string kind, string runningExe,
                               bool local, string localOrigin) {
        string target = Path.GetFullPath(runningExe);
        Require(Same(target, Self), "只能更新当前运行的荔枝。");
        string origin = local ? localOrigin : "";
        Require(!local || !String.IsNullOrEmpty(origin), "本地验收地址为空。");
        Origin(origin);
        using (var parent = Process.GetCurrentProcess()) {
            ExclusiveInstance(target, parent.Id);
            Verify(payload, hash, version, kind, target);
            string job = Guid.NewGuid().ToString("N");
            string dir = Path.Combine(Jobs, job);
            Directory.CreateDirectory(dir);
            bool accepted = false;
            try {
                // Check sibling write access before asking the current window to close.
                string writeTest = Path.Combine(Path.GetDirectoryName(target), ".lychee-write-" + job);
                using (new FileStream(writeTest, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) {}
                string helper = Path.Combine(dir, "helper.exe");
                File.Copy(target, helper);
                File.Copy(payload, Path.Combine(dir, "package." + kind));
                File.WriteAllLines(Path.Combine(dir, "request"), new[]{target, kind, hash, version, origin,
                    parent.Id.ToString(CultureInfo.InvariantCulture), parent.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture)});
                using (var gate = new EventWaitHandle(false, EventResetMode.ManualReset, EventName(job, "waiting")))
                using (var helperProcess = Process.Start(new ProcessStartInfo(helper, Command) {
                    UseShellExecute = false, WorkingDirectory = dir, CreateNoWindow = true
                })) {
                    var watch = Stopwatch.StartNew();
                    while (watch.Elapsed.TotalSeconds < 25 && !helperProcess.HasExited)
                        if (gate.WaitOne(100)) { accepted = true; return; }
                    throw new IOException("更新助手未能接手，当前版本仍可使用。");
                }
            } finally { if (!accepted) ClearStage(dir); }
        }
    }
    static bool IsJob(string job) {
        Guid id;
        return Guid.TryParseExact(job, "N", out id) && job == id.ToString("N");
    }
    static bool AuthorizedRestart() {
        string job = Environment.GetEnvironmentVariable(JobVariable);
        if (!IsJob(job)) return false;
        try { using (EventWaitHandle.OpenExisting(EventName(job, "ready"))) return true; }
        catch (WaitHandleCannotBeOpenedException) { return false; }
    }
    internal static bool TryRun(string[] args, out int result) {
        result = 0;
        if (args.Length == 1 && args[0] == Command) {
            try { Apply(); }
            catch (Exception error) { Console.Error.WriteLine(error.Message); result = 1; }
            return true;
        }
        bool restart = AuthorizedRestart();
        bool recovered = Environment.GetEnvironmentVariable(RecoveryVariable) == "1";
        Environment.SetEnvironmentVariable(RecoveryVariable, null);
        if (restart) {
            if (recovered) Interlocked.Exchange(ref recoveryNotice, 1);
            return false;
        }
        try { using (Mutex.OpenExisting(LockName(Self))) return true; }
        catch (WaitHandleCannotBeOpenedException) { return false; }
    }
    internal static bool ConsumeRecoveryNotice() { return Interlocked.Exchange(ref recoveryNotice, 0) == 1; }
    internal static void ConfirmReady() {
        string job = Environment.GetEnvironmentVariable(JobVariable);
        if (!IsJob(job)) return;
        int helperId;
        if (!Int32.TryParse(Environment.GetEnvironmentVariable(HelperVariable), out helperId)) return;
        Environment.SetEnvironmentVariable(JobVariable, null);
        Environment.SetEnvironmentVariable(HelperVariable, null);
        string dir = Path.Combine(Jobs, job);
        try {
            using (var ready = EventWaitHandle.OpenExisting(EventName(job, "ready"))) ready.Set();
            ThreadPool.QueueUserWorkItem(delegate {
                try {
                    using (var proc = Process.GetProcessById(helperId)) {
                        if (Same(proc.MainModule.FileName, Path.Combine(dir, "helper.exe")) && proc.WaitForExit(90000))
                            ClearStage(dir);
                    }
                } catch (ArgumentException) { ClearStage(dir); }
                catch (InvalidOperationException) { ClearStage(dir); }
                catch (System.ComponentModel.Win32Exception) {}
            });
        } catch (WaitHandleCannotBeOpenedException) {}
    }
    static Process OpenApp(string target, string origin, string job, bool recovered) {
        var info = new ProcessStartInfo(target, origin == "" ? "" : "--test-local " + new Uri(origin).AbsoluteUri) {
            UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(target)
        };
        info.EnvironmentVariables[JobVariable] = job;
        if (recovered) info.EnvironmentVariables[RecoveryVariable] = "1";
        else info.EnvironmentVariables.Remove(RecoveryVariable);
        using (var proc = Process.GetCurrentProcess()) info.EnvironmentVariables[HelperVariable] = proc.Id.ToString();
        return Process.Start(info);
    }
    static void AwaitReady(Process proc, EventWaitHandle ready) {
        var clock = Stopwatch.StartNew();
        while (clock.Elapsed.TotalMinutes < 2 && !proc.HasExited)
            if (ready.WaitOne(100)) return;
        throw new IOException("新版荔枝启动失败。");
    }
    static void CloseCandidate(Process proc) {
        if (proc == null || proc.HasExited) return;
        proc.CloseMainWindow();
        if (!proc.WaitForExit(6000)) {
            // This is the child created for this update, before it confirmed startup.
            proc.Kill();
            Require(proc.WaitForExit(10000), "新版进程未退出，已保留恢复副本。");
        }
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct ProcessEntry {
        public uint size, usage, id;
        public UIntPtr heap;
        public uint module, threads, parent;
        public int basePriority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name;
    }
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint id);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static bool LaunchedBy(int parentId) {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) return false;
        try {
            var item = new ProcessEntry { size=(uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            using (var self = Process.GetCurrentProcess()) {
                if (Process32First(snapshot, ref item)) do {
                    if (item.id == self.Id) return item.parent == parentId;
                } while (Process32Next(snapshot, ref item));
            }
            return false;
        } finally { CloseHandle(snapshot); }
    }
    static void Apply() {
        string helper = Self, dir = Path.GetDirectoryName(helper), job = Path.GetFileName(dir);
        Require(IsJob(job) && Same(dir, Path.Combine(Jobs, job)) && Same(helper, Path.Combine(dir, "helper.exe")),
                "更新助手位置不正确。");
        string[] request = File.ReadAllLines(Path.Combine(dir, "request"));
        Require(request.Length == 7, "更新请求不完整。");
        string target = request[0], kind = request[1], hash = request[2], version = request[3], origin = request[4];
        Require(kind == "exe" || kind == "msi", "未知更新方式。");
        Origin(origin);
        string package = Path.Combine(dir, "package." + kind);
        bool first;
        using (var guard = new Mutex(false, LockName(target), out first)) {
            Require(first, "此程序有更新正在进行。");
            using (var parent = Process.GetProcessById(Int32.Parse(request[5], CultureInfo.InvariantCulture))) {
                Require(LaunchedBy(parent.Id) && parent.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture) == request[6] &&
                        Same(parent.MainModule.FileName, target) && HashFile(helper) == HashFile(target),
                        "原程序身份不符。");
                Verify(package, hash, version, kind, target);
                ExclusiveInstance(target, parent.Id);
                using (var gate = EventWaitHandle.OpenExisting(EventName(job, "waiting"))) gate.Set();
                Require(parent.WaitForExit(60000), "原程序未退出，更新已取消。");
            }
            using (var ready = new EventWaitHandle(false, EventResetMode.ManualReset, EventName(job, "ready"))) {
                string temp = target + "." + job + ".new", backup = target + "." + job + ".bak";
                bool replaced = false;
                Installer.Transaction tx = null;
                Process child = null;
                try {
                    ExclusiveInstance(target, -1);
                    Require(HashFile(target) == HashFile(helper), "原程序已变化，请重新检查更新。");
                    // Keep the verified package read-locked through installation.
                    using (File.Open(package, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                        Verify(package, hash, version, kind, target);
                        if (kind == "exe") {
                            File.Copy(package, temp);
                            Require(String.Equals(HashFile(temp), hash, IgnoreCase), "写入文件校验失败。");
                            File.Replace(temp, target, backup);
                            replaced = true;
                        } else {
                            tx = new Installer.Transaction(job);
                            tx.Install(package, Path.GetDirectoryName(target));
                        }
                        CheckExe(target, helper, TargetVersion(version));
                        child = OpenApp(target, origin, job, false);
                        AwaitReady(child, ready);
                        if (tx != null) tx.Commit();
                        if (replaced) RemoveFile(backup);
                    }
                } catch {
                    CloseCandidate(child);
                    if (tx != null) tx.Rollback();
                    if (replaced) File.Replace(backup, target, null);
                    // Never launch a partially restored installation or a duplicate window.
                    if (File.Exists(target) && HashFile(target) == HashFile(helper)) {
                        ExclusiveInstance(target, -1);
                        ready.Reset();
                        using (var restored = OpenApp(target, origin, job, true)) AwaitReady(restored, ready);
                    }
                    throw;
                } finally {
                    if (tx != null) tx.Dispose();
                    if (child != null) child.Dispose();
                    RemoveFile(temp);
                    RemoveFile(package);
                }
            }
        }
    }

    internal static class Installer {
        [DllImport("msi.dll", CharSet=CharSet.Unicode)] static extern uint MsiEnumRelatedProducts(string upgrade, uint reserved, uint index, StringBuilder product);
        [DllImport("msi.dll", CharSet=CharSet.Unicode)] static extern int MsiGetComponentPathEx(string product, string component, string sid, uint context, StringBuilder path, ref uint length);
        [DllImport("msi.dll", CharSet=CharSet.Unicode)] static extern uint MsiOpenDatabase(string path, IntPtr mode, out uint db);
        [DllImport("msi.dll", CharSet=CharSet.Unicode)] static extern uint MsiDatabaseOpenView(uint db, string query, out uint view);
        [DllImport("msi.dll")] static extern uint MsiViewExecute(uint view, uint paramsRecord);
        [DllImport("msi.dll")] static extern uint MsiViewFetch(uint view, out uint record);
        [DllImport("msi.dll", CharSet=CharSet.Unicode)] static extern uint MsiRecordGetString(uint record, uint field, StringBuilder text, ref uint size);
        [DllImport("msi.dll")] static extern uint MsiCloseHandle(uint handle);
        [DllImport("msi.dll", CharSet=CharSet.Unicode)] static extern uint MsiBeginTransaction(string name, uint flags, out uint transaction, out IntPtr eventHandle);
        [DllImport("msi.dll")] static extern uint MsiEndTransaction(uint state);
        [DllImport("msi.dll", CharSet=CharSet.Unicode)] static extern uint MsiInstallProduct(string package, string properties);
        [DllImport("msi.dll")] static extern uint MsiSetInternalUI(uint level, IntPtr hwnd);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        static void Check(uint code) {
            if (code != 0) throw new IOException("Windows Installer 错误 " + code);
        }
        internal static string RegisteredProduct(string target, bool exclusive) {
            var products = new List<string>();
            string match = null;
            for (uint i = 0; ; ++i) {
                var name = new StringBuilder(39);
                uint code = MsiEnumRelatedProducts(WindowsInstallationIdentity.UpgradeCode, 0, i, name);
                if (code == 259) break;
                Check(code);
                products.Add(name.ToString());
                foreach (uint context in new uint[]{1, 2}) { // current-user managed / unmanaged
                    uint length = 32767; var path = new StringBuilder((int)length);
                    int state = MsiGetComponentPathEx(name.ToString(), WindowsInstallationIdentity.ComponentId, null,
                                                      context, path, ref length);
                    if (state == 3 && path.Length > 0 && Same(target, path.ToString())) match = name.ToString();
                }
            }
            if (exclusive) Require(match != null && products.Count == 1, "存在其他荔枝安装记录，无法安全升级此安装。");
            return match;
        }
        static string Field(uint db, string query) {
            uint view = 0, record = 0;
            try {
                Check(MsiDatabaseOpenView(db, query, out view)); Check(MsiViewExecute(view, 0)); Check(MsiViewFetch(view, out record));
                uint length = 512; var text = new StringBuilder((int)length);
                Check(MsiRecordGetString(record, 1, text, ref length));
                return text.ToString();
            } finally { if (record != 0) MsiCloseHandle(record); if (view != 0) MsiCloseHandle(view); }
        }
        internal static void CheckPackage(string path, string version, string oldProduct) {
            uint db;
            Check(MsiOpenDatabase(path, IntPtr.Zero, out db));
            try {
                Func<string,string> property = key => Field(db, "SELECT `Value` FROM `Property` WHERE `Property`='" + key + "'");
                Guid productCode;
                Require(property("ProductName") == WindowsInstallationIdentity.ProductName && property("Manufacturer") == "Lychee" &&
                        property("ProductVersion") == version && String.Equals(property("UpgradeCode"), WindowsInstallationIdentity.UpgradeCode, IgnoreCase) &&
                        Guid.TryParse(property("ProductCode"), out productCode) && productCode != Guid.Parse(oldProduct) &&
                        String.Equals(Field(db, "SELECT `ComponentId` FROM `Component` WHERE `Component`='DesktopClient' AND `Directory_`='INSTALLDIR' AND `KeyPath`='LycheeExe'"),
                                      WindowsInstallationIdentity.ComponentId, IgnoreCase), "MSI 的产品、版本或升级组件不匹配。");
            } finally { MsiCloseHandle(db); }
        }
        internal sealed class Transaction : IDisposable {
            uint transaction;
            IntPtr ownerEvent;
            public Transaction(string job) {
                MsiSetInternalUI(2, IntPtr.Zero); // INSTALLUILEVEL_NONE in this isolated helper
                Check(MsiBeginTransaction("Lychee-" + job, 0, out transaction, out ownerEvent));
            }
            public void Install(string package, string directory) {
                Check(MsiInstallProduct(package, "REBOOT=ReallySuppress MSIRESTARTMANAGERCONTROL=Disable INSTALLDIR=\"" + directory + "\""));
            }
            public void Commit() { Check(MsiEndTransaction(1)); Release(); }
            public void Rollback() { if (transaction != 0) { Check(MsiEndTransaction(0)); Release(); } }
            void Release() {
                if (transaction != 0) { MsiCloseHandle(transaction); transaction = 0; }
                if (ownerEvent != IntPtr.Zero) { CloseHandle(ownerEvent); ownerEvent = IntPtr.Zero; }
            }
            public void Dispose() { try { Rollback(); } finally { Release(); } }
        }
    }
}
