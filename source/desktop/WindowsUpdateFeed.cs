using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.Serialization.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Xml;

internal static class WindowsUpdateFeed {
    const string Repository = "z1807767180-pixel/Lychee";
    const string RepositoryId = "1471636015";
    const int ManifestLimit = 16 * 1024;
    const long PackageLimit = 256L * 1024 * 1024;
    const int ReleasesPerPage = 20;
    sealed class MissingManifest : IOException {}
    sealed class HttpFailure : IOException {
        internal readonly int Status;
        internal HttpFailure(int status) : base("更新服务返回 HTTP " + status + "。") { Status = status; }
    }

    internal sealed class Asset {
        public string Kind { get; private set; }
        public string Name { get; private set; }
        public long Length { get; private set; }
        public string Sha256 { get; private set; }
        internal Asset(string kind, long length, string hash) {
            Kind = kind; Name = "Lychee." + kind; Length = length; Sha256 = hash;
        }
    }
    internal sealed class Release {
        public Version Version { get; private set; }
        public IList<Asset> Assets { get; private set; }
        internal Uri Origin { get; private set; }
        internal string QaInstance { get; private set; }
        internal Release(Version version, List<Asset> assets, Uri origin, string qaInstance) {
            Version = version; Assets = assets.AsReadOnly(); Origin = origin; QaInstance = qaInstance;
        }
    }
    internal sealed class DownloadedPackage {
        public string Path { get; private set; }
        public Version Version { get; private set; }
        public string Kind { get; private set; }
        public long Length { get; private set; }
        public string Sha256 { get; private set; }
        internal DownloadedPackage(string path, Version version, Asset asset) {
            Path = path; Version = version; Kind = asset.Kind; Length = asset.Length; Sha256 = asset.Sha256;
        }
    }

    static void ValidateOrigin(Uri local) {
        if (local == null) return;
        string[] args = Environment.GetCommandLineArgs();
        Uri commandOrigin;
        if (args.Length != 3 || args[1] != "--test-local" ||
            !Uri.TryCreate(args[2], UriKind.Absolute, out commandOrigin) || commandOrigin != local ||
            !local.IsAbsoluteUri || local.Scheme != "http" || local.Host != "127.0.0.1" ||
            local.AbsolutePath != "/" || local.UserInfo.Length != 0 || local.Query.Length != 0 ||
            local.Fragment.Length != 0) throw new InvalidDataException("本机更新地址无效。");
    }
    static HttpClient Client(Uri local) {
        var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false,
            UseDefaultCredentials = false, UseProxy = local == null, AutomaticDecompression = DecompressionMethods.None };
        if (local == null) {
            handler.SslProtocols = System.Security.Authentication.SslProtocols.Tls12;
            handler.CheckCertificateRevocationList = true;
        }
        var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Lychee-Windows-Updater/1");
        client.DefaultRequestHeaders.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
        return client;
    }
    static Uri Feed(Uri local) {
        return local == null ? new Uri("https://raw.githubusercontent.com/" + Repository + "/main/distribution/windows/stable.json")
            : new Uri(local, "windows-update/stable.json");
    }
    static Uri Package(Uri local, Version version, Asset asset) {
        string path = "windows-v" + version + "/" + asset.Name;
        return local == null ? new Uri("https://github.com/" + Repository + "/releases/download/" + path)
            : new Uri(local, "windows-update/" + path);
    }
    static bool RedirectAllowed(Uri initial, Uri target, Uri local) {
        if (!target.IsAbsoluteUri || target.UserInfo.Length != 0 || target.Fragment.Length != 0) return false;
        if (local != null) return target.Scheme == local.Scheme && target.Authority == local.Authority &&
            target.AbsolutePath == initial.AbsolutePath;
        return target.Scheme == "https" && target.IsDefaultPort &&
            target.Host.Equals("release-assets.githubusercontent.com", StringComparison.OrdinalIgnoreCase) &&
            Regex.IsMatch(target.AbsolutePath, @"\A/github-production-release-asset/" + RepositoryId + @"/[a-fA-F0-9-]{36}\z");
    }
    static async Task<string> Copy(HttpClient client, Uri initial, bool asset, Uri local, Stream dest, long limit,
                           CancellationToken token) {
        Uri uri = initial;
        for (int hop = 0; hop <= 3; hop++) {
            using (var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false)) {
                int status = (int)response.StatusCode;
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    Uri next;
                    if (!asset || response.Headers.Location == null || !Uri.TryCreate(uri, response.Headers.Location, out next) ||
                        !RedirectAllowed(initial,next,local)) throw new InvalidDataException("更新地址跳转异常。");
                    uri = next;
                    continue;
                }
                if (status == 404 && initial == Feed(local)) throw new MissingManifest();
                if (status != 200) throw new HttpFailure(status);
                var headers = response.Content.Headers;
                if (headers.ContentEncoding.Any(x => !x.Equals("identity",StringComparison.OrdinalIgnoreCase)) ||
                    headers.ContentLength > limit || (asset && headers.ContentLength.HasValue && headers.ContentLength != limit))
                    throw new InvalidDataException("更新数据长度或编码异常。");
                using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (token.Register(() => input.Dispose())) {
                    byte[] buffer = new byte[65536];
                    long total = 0;
                    int n;
                    while ((n = await input.ReadAsync(buffer,0,buffer.Length,token).ConfigureAwait(false)) != 0) {
                        total += n;
                        if (total > limit) throw new InvalidDataException("更新数据超出限定大小。");
                        await dest.WriteAsync(buffer,0,n,token).ConfigureAwait(false);
                    }
                    if ((asset && total != limit) || (headers.ContentLength.HasValue && total != headers.ContentLength.Value))
                        throw new InvalidDataException("更新数据未下载完整。");
                }
                IEnumerable<string> links;
                return response.Headers.TryGetValues("Link",out links) ? string.Join(",",links) : "";
            }
        }
        throw new InvalidDataException("更新地址跳转次数异常。");
    }

    static XmlElement Member(XmlElement parent, string name, string type) {
        var child = parent.ChildNodes.OfType<XmlElement>().SingleOrDefault(e => e.Name == name);
        if (child == null || child.GetAttribute("type") != type) throw new InvalidDataException("更新清单字段无效。");
        return child;
    }
    static Version StableVersion(string text) {
        Version version;
        return Version.TryParse(text,out version) && version.Build >= 0 && version.Revision == -1 &&
            version.Major <= 255 && version.Minor <= 255 && version.Build <= 65535 && text == version.ToString(3) ? version : null;
    }
    static Release Parse(byte[] data, Uri local) {
        var doc = new XmlDocument { XmlResolver = null };
        using (var reader = JsonReaderWriterFactory.CreateJsonReader(data, new XmlDictionaryReaderQuotas { MaxDepth = 8,
            MaxStringContentLength = 256, MaxArrayLength = 8, MaxBytesPerRead = 4096, MaxNameTableCharCount = 1024 }))
            doc.Load(reader);
        var root = doc.DocumentElement;
        bool qa = local != null && root != null && root.ChildNodes.Count == 4;
        Guid instance;
        string marker = qa ? Member(root,"qaInstance","string").InnerText : null;
        if (qa && !Guid.TryParseExact(marker,"D",out instance))
            throw new InvalidDataException("本机更新清单的测试标识无效。");
        if (root == null || root.GetAttribute("type") != "object" || root.ChildNodes.Count != (qa ? 4 : 3) ||
            Member(root,"schema","number").InnerText != "1") throw new InvalidDataException("不支持这份更新清单。");
        string text = Member(root,"version","string").InnerText;
        Version version = StableVersion(text);
        if (version == null)
            throw new InvalidDataException("更新版本格式无效。");
        var entries = Member(root,"assets","array");
        var assets = new List<Asset>();
        if (entries.ChildNodes.Count != 2) throw new InvalidDataException("更新清单须含 EXE 和 MSI 两个包。");
        foreach (XmlElement entry in entries.ChildNodes) {
            if (entry.GetAttribute("type") != "object" || entry.ChildNodes.Count != 4) throw new InvalidDataException("更新条目无效。");
            string kind = Member(entry,"kind","string").InnerText;
            string hash = Member(entry,"sha256","string").InnerText;
            string size = Member(entry,"length","number").InnerText;
            long length;
            if ((kind != "exe" && kind != "msi") || assets.Any(a => a.Kind == kind) ||
                Member(entry,"name","string").InnerText != "Lychee." + kind ||
                !Regex.IsMatch(hash,@"\A[a-f0-9]{64}\z") ||
                !long.TryParse(size,NumberStyles.None,CultureInfo.InvariantCulture,out length) || length <= 0 || length > PackageLimit)
                throw new InvalidDataException("更新包名称、大小或摘要无效。");
            assets.Add(new Asset(kind,length,hash));
        }
        return new Release(version,assets,local,marker);
    }
    // Only GitHub's fixed public repository and Releases endpoints can attest an absent channel.
    // The API's response URLs and asset links are never used for navigation or downloads.
    static Uri Api(Uri local, string suffix) {
        return local == null ? new Uri("https://api.github.com/repos/"+Repository+suffix) :
            new Uri(local,"windows-update/repository"+suffix);
    }
    static XmlElement ApiJson(MemoryStream bytes) {
        var doc = new XmlDocument { XmlResolver = null };
        using (var reader = JsonReaderWriterFactory.CreateJsonReader(bytes.ToArray(),new XmlDictionaryReaderQuotas {
            MaxDepth = 24, MaxStringContentLength = 1024*1024, MaxArrayLength = 65536, MaxBytesPerRead = 8192,
            MaxNameTableCharCount = 16384 })) doc.Load(reader);
        return doc.DocumentElement;
    }
    static Version WindowsReleaseVersion(XmlElement entry) {
        if (entry.Name != "item" || entry.GetAttribute("type") != "object")
            throw new InvalidDataException("官方发行记录格式异常。");
        if (Member(entry,"draft","boolean").InnerText == "true" || Member(entry,"prerelease","boolean").InnerText == "true") return null;
        string tag = Member(entry,"tag_name","string").InnerText;
        if (tag.Length == 0) throw new InvalidDataException("发行版本标记缺失。");
        bool windowsTag = Regex.IsMatch(tag,@"\A(?:windows|win|desktop)[-_]",RegexOptions.IgnoreCase);
        var assets = Member(entry,"assets","array").ChildNodes.OfType<XmlElement>();
        bool windowsAsset = assets.Any(a => Regex.IsMatch(Member(a,"name","string").InnerText,@"\.(?:exe|msi)\z",RegexOptions.IgnoreCase));
        if (!windowsTag && !windowsAsset) return null;
        string number = Regex.Replace(tag,@"\A(?:(?:windows|win|desktop)[-_])?v?", "",RegexOptions.IgnoreCase);
        var version = StableVersion(number);
        if (version == null) throw new InvalidDataException("官方 Windows 发行版本尚无法核对。");
        return version;
    }
    static async Task ConfirmNoNewRelease(HttpClient client, Uri local, CancellationToken token) {
        var file = FileVersionInfo.GetVersionInfo(typeof(WindowsUpdateFeed).Assembly.Location);
        if (string.IsNullOrEmpty(file.FileVersion)) throw new InvalidDataException("当前 Windows 版本无法核对。");
        var installed = new Version(file.FileMajorPart,file.FileMinorPart,file.FileBuildPart);
        client.DefaultRequestHeaders.Add("X-GitHub-Api-Version","2022-11-28");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        using (var bytes = new MemoryStream()) {
            await Copy(client,Api(local,""),false,local,bytes,128*1024,token).ConfigureAwait(false);
            var repo = ApiJson(bytes);
            if (repo.GetAttribute("type") != "object" || Member(repo,"id","number").InnerText != RepositoryId ||
                !Member(repo,"full_name","string").InnerText.Equals(Repository,StringComparison.OrdinalIgnoreCase) ||
                Member(repo,"default_branch","string").InnerText != "main" || Member(repo,"private","boolean").InnerText != "false")
                throw new InvalidDataException("Windows 更新仓库身份无法核对。");
        }
        var observed = new HashSet<string>();
        for (int page = 1; page <= 25; page++) {
            using (var bytes = new MemoryStream()) {
                string suffix = "/releases?per_page="+ReleasesPerPage+"&page="+page;
                string links = await Copy(client,Api(local,suffix),false,local,bytes,2*1024*1024,token).ConfigureAwait(false);
                var root = ApiJson(bytes);
                if (root.GetAttribute("type") != "array" || root.ChildNodes.Count > ReleasesPerPage)
                    throw new InvalidDataException("官方发行列表不完整。");
                foreach (XmlElement row in root.ChildNodes) {
                    string id = Member(row,"id","number").InnerText;
                    if (!observed.Add(id)) throw new InvalidDataException("官方发行列表发生变动，请重新检查。");
                    Version v = WindowsReleaseVersion(row);
                    if (v != null && v > installed)
                        throw new InvalidDataException("已发现 Windows "+v+"，但官方更新清单尚未就绪，请稍后重试。");
                }
                bool more = Regex.IsMatch(links,@"\brel\s*=\s*[""']?next\b",RegexOptions.IgnoreCase);
                if (!more && root.ChildNodes.Count < ReleasesPerPage) return;
                if (more && root.ChildNodes.Count == 0) throw new InvalidDataException("官方发行分页异常。");
            }
        }
        throw new InvalidDataException("官方发行记录尚未核查完整。");
    }
    static async Task<Release> ReadManifest(HttpClient client, Uri address, Uri local) {
        using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20)))
        using (var bytes = new MemoryStream()) {
            try { await Copy(client,address,false,local,bytes,ManifestLimit,timeout.Token).ConfigureAwait(false); }
            catch (Exception) {
                timeout.Token.ThrowIfCancellationRequested();
                throw;
            }
            return Parse(bytes.ToArray(),local);
        }
    }
    static bool TransportFailed(Exception ex) {
        return !(ex is InvalidDataException) && (ex is HttpRequestException || ex is IOException || ex is OperationCanceledException);
    }
    public static async Task<Release> CheckAsync(Uri localOriginOrNull) {
        ValidateOrigin(localOriginOrNull);
        using (var client = Client(localOriginOrNull)) {
            bool missing=false;
            try { return await ReadManifest(client,Feed(localOriginOrNull),localOriginOrNull).ConfigureAwait(false); }
            catch (MissingManifest) { missing=true; }
            catch (Exception ex) {
                if (!TransportFailed(ex)) throw;
            }
            if (missing) {
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20)))
                    await ConfirmNoNewRelease(client,localOriginOrNull,timeout.Token).ConfigureAwait(false);
                return null;
            }
            // Same repository, branch and file via GitHub's Contents service; same manifest validation.
            client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github.raw+json");
            return await ReadManifest(client,Api(localOriginOrNull,"/contents/distribution/windows/stable.json?ref=main"),
                localOriginOrNull).ConfigureAwait(false);
        }
    }
    public static string CheckErrorMessage(Exception error) {
        for (Exception e=error; e!=null; e=e.InnerException) {
            var http=e as HttpFailure;
            if (http!=null) {
                if (http.Status==403 || http.Status==429) return "官方更新服务暂时限制访问（HTTP "+http.Status+"）。请稍后重试，或切换网络。";
                return "官方更新服务返回 HTTP "+http.Status+"。请稍后重试。";
            }
            if (e is OperationCanceledException) return "连接官方更新服务超时。请切换网络后重试。";
            var network=e as WebException;
            if (network!=null) {
                if (network.Status==WebExceptionStatus.NameResolutionFailure || network.Status==WebExceptionStatus.ProxyNameResolutionFailure)
                    return "无法解析更新服务或代理地址。请检查网络或代理设置。";
                if (network.Status==WebExceptionStatus.TrustFailure || network.Status==WebExceptionStatus.SecureChannelFailure)
                    return "无法建立安全连接。请检查系统时间，或切换网络后重试。";
            }
            if (e is System.Security.Authentication.AuthenticationException)
                return "无法建立安全连接。请检查系统时间，或切换网络后重试。";
            if (e is InvalidDataException || e is XmlException)
                return "官方更新信息未通过校验。请稍后重试。";
        }
        return "无法连接官方更新服务。请切换网络或稍后重试。";
    }
    static string Hash(string path) {
        using (var stream = File.OpenRead(path))
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
    }
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] static extern uint MsiOpenDatabaseW(string path, IntPtr mode, out uint database);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] static extern uint MsiDatabaseOpenViewW(uint database, string sql, out uint view);
    [DllImport("msi.dll")] static extern uint MsiViewExecute(uint view, uint record);
    [DllImport("msi.dll")] static extern uint MsiViewFetch(uint view, out uint record);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] static extern uint MsiRecordGetStringW(uint record, uint field, StringBuilder buffer, ref uint chars);
    [DllImport("msi.dll")] static extern uint MsiCloseHandle(uint handle);
    static bool MatchesVersion(string path, string kind, Version version) {
        if (kind == "exe") {
            var info = FileVersionInfo.GetVersionInfo(path);
            return info.FileVersion != null && info.FileMajorPart == version.Major && info.FileMinorPart == version.Minor &&
                info.FileBuildPart == version.Build && info.FilePrivatePart == 0;
        }
        uint database = 0, view = 0, record = 0, count = 80;
        try {
            var value = new StringBuilder((int)count);
            return MsiOpenDatabaseW(path,IntPtr.Zero,out database) == 0 &&
                MsiDatabaseOpenViewW(database,"SELECT `Value` FROM `Property` WHERE `Property` = 'ProductVersion'",out view) == 0 &&
                MsiViewExecute(view,0) == 0 && MsiViewFetch(view,out record) == 0 &&
                MsiRecordGetStringW(record,1,value,ref count) == 0 && value.ToString() == version.ToString();
        } finally {
            if (record != 0) MsiCloseHandle(record);
            if (view != 0) MsiCloseHandle(view);
            if (database != 0) MsiCloseHandle(database);
        }
    }
    public static bool VerifyDownloaded(DownloadedPackage package) {
        if (package == null || !File.Exists(package.Path) || new FileInfo(package.Path).Length != package.Length) return false;
        return Hash(package.Path) == package.Sha256;
    }
    public static async Task<DownloadedPackage> DownloadAsync(Release release, string kind, Uri localOriginOrNull) {
        ValidateOrigin(localOriginOrNull);
        if (release == null || release.Origin != localOriginOrNull || (kind != "exe" && kind != "msi"))
            throw new InvalidDataException("更新来源或包类型无效。");
        var latest = await CheckAsync(localOriginOrNull).ConfigureAwait(false);
        if (latest == null || latest.Version != release.Version || latest.QaInstance != release.QaInstance || latest.Assets.Any(a => !release.Assets.Any(previous =>
            a.Kind == previous.Kind && a.Length == previous.Length && a.Sha256 == previous.Sha256)))
            throw new InvalidDataException("更新清单已变化，请重新检查。");
        var asset = latest.Assets.Single(a => a.Kind == kind);
        string root = localOriginOrNull == null ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LycheeGardenDesktop") :
            Path.Combine(Path.GetTempPath(),"Lychee-Windows-QA");
        string dir = Path.Combine(root,"Updates",Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        string pending = Path.Combine(dir,"download.partial");
        try {
            using (var client = Client(localOriginOrNull))
            using (var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(5)))
            using (var output = new FileStream(pending,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
                await Copy(client,Package(localOriginOrNull,latest.Version,asset),true,localOriginOrNull,output,asset.Length,timeout.Token).ConfigureAwait(false);
            }
            if (Hash(pending) != asset.Sha256) throw new InvalidDataException("更新包摘要校验失败，请重新检查。");
            if (!MatchesVersion(pending,kind,latest.Version)) throw new InvalidDataException("更新包内部版本与清单不符。");
            string verified = Path.Combine(dir,asset.Name);
            File.Move(pending,verified);
            return new DownloadedPackage(verified,latest.Version,asset);
        } catch {
            if (File.Exists(pending)) File.Delete(pending);
            if (!Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
            throw;
        }
    }
}
