using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Automation;
using System.Windows.Shell;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Threading;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

[assembly: AssemblyProduct("荔枝 Windows")]
[assembly: AssemblyVersion("6.4.0.0")]

internal static class Program {
    [STAThread] public static int Main(string[] args) {
        int helperResult;
        if(WindowsUpdateApply.TryRun(args,out helperResult))return helperResult;
        Uri origin = new Uri("https://lychee-link-check.onrender.com/");
        bool local = args.Length == 2 && args[0] == "--test-local";
        if (local && (!Uri.TryCreate(args[1], UriKind.Absolute, out origin) || origin.Scheme != "http" ||
            origin.Host != "127.0.0.1" || origin.AbsolutePath != "/" || origin.UserInfo.Length != 0 ||
            origin.Query.Length != 0 || origin.Fragment.Length != 0)) return 2;
        if(WindowsInstallationIdentity.IsTestBuild && !local)return 2;
        try {
            string sdk=PrepareRuntime(local);
            AppDomain.CurrentDomain.AssemblyResolve+=delegate(object sender,ResolveEventArgs e) {
                string name=new AssemblyName(e.Name).Name;
                if(name!="Microsoft.Web.WebView2.Core" && name!="Microsoft.Web.WebView2.Wpf")return null;
                return Assembly.LoadFrom(Path.Combine(sdk,name+".dll"));
            };
            return Run(origin,local,sdk);
        } catch(Exception err) {
            if(local) Console.Error.WriteLine(err); else MessageBox.Show(err.Message,"荔枝启动失败");return 1;
        }
    }
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int Run(Uri origin,bool local,string sdk) {
        CoreWebView2Environment.SetLoaderDllFolderPath(sdk);
        return new Application {ShutdownMode=ShutdownMode.OnMainWindowClose}.Run(new GardenWindow(origin,local));
    }
    private static string PrepareRuntime(bool local) {
        string dir=Path.Combine(local? Path.GetTempPath():Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                local?"Lychee-Windows-QA":"LycheeGardenDesktop","Runtime",typeof(Program).Assembly.ManifestModule.ModuleVersionId.ToString("N"));
        Directory.CreateDirectory(dir);
        foreach(string dll in new[]{"Microsoft.Web.WebView2.Core.dll","Microsoft.Web.WebView2.Wpf.dll","WebView2Loader.dll"}) {
            string dest=Path.Combine(dir,dll);
            using(var input=typeof(Program).Assembly.GetManifestResourceStream(dll))
            using(var sha=SHA256.Create()) {
                var expected=sha.ComputeHash(input);input.Position=0;
                if(!File.Exists(dest)) {
                    string tmp=dest+"."+Guid.NewGuid().ToString("N")+".tmp";
                    try {
                        using(var file=new FileStream(tmp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){input.CopyTo(file);}
                        try {File.Move(tmp,dest);} catch(IOException){if(!File.Exists(dest))throw;}
                    } finally {if(File.Exists(tmp))File.Delete(tmp);}
                }
                using(var read=File.OpenRead(dest))if(!sha.ComputeHash(read).SequenceEqual(expected))
                    throw new IOException("荔枝运行组件校验失败，请重新安装。");
            }
        }
        return dir;
    }
}

internal sealed class GardenWindow : Window {
    readonly Uri origin;
    readonly string profile;
    readonly WebView2 web = new WebView2();
    readonly DockPanel caption = new DockPanel { Height=34, Background=new SolidColorBrush(Color.FromRgb(248,241,222)) };
    readonly WindowChrome chrome = new WindowChrome { CaptionHeight=34, GlassFrameThickness=new Thickness(0), ResizeBorderThickness=new Thickness(8), CornerRadius=new CornerRadius(0), UseAeroCaptionButtons=false };
    readonly StackPanel startup = new StackPanel {VerticalAlignment=VerticalAlignment.Center, HorizontalAlignment=HorizontalAlignment.Center};
    readonly TextBlock message = new TextBlock {Text="正在打开荔枝…",HorizontalAlignment=HorizontalAlignment.Center,Margin=new Thickness(0,10,0,10)};
    readonly Button retry = new Button {Content="重试",Visibility=Visibility.Collapsed};
    readonly ZipArchive archive;
    readonly Dictionary<string,ZipArchiveEntry> assets;
    bool connected, closing;
    readonly bool updatesEnabled;
    readonly Uri testFeed;
    bool updateChecked, checking, installing, updateView;
    WindowsUpdateFeed.Release offered;
    readonly DispatcherTimer notifications = new DispatcherTimer {Interval=TimeSpan.FromSeconds(8)};
    readonly DispatcherTimer dismissNotification = new DispatcherTimer {Interval=TimeSpan.FromSeconds(8)};
    Window popup;
    WindowState restoreState=WindowState.Normal;
    [StructLayout(LayoutKind.Sequential)] struct FlashInfo {
        public uint size; public IntPtr hwnd; public uint flags, count, timeout;
    }
    [DllImport("user32.dll")] static extern bool FlashWindowEx(ref FlashInfo info);
    static readonly Dictionary<string,string> types = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase) {
        {".html","text/html; charset=utf-8"},{".css","text/css; charset=utf-8"},{".js","text/javascript; charset=utf-8"},
        {".mjs","text/javascript; charset=utf-8"},{".json","application/json"},{".webmanifest","application/manifest+json"},
        {".svg","image/svg+xml"},{".jpg","image/jpeg"},{".jpeg","image/jpeg"},{".png","image/png"},{".webp","image/webp"},
        {".ico","image/x-icon"},{".woff","font/woff"},{".woff2","font/woff2"}
    };
    public GardenWindow(Uri server,bool local) {
        origin=server;
        updatesEnabled=!local||WindowsInstallationIdentity.IsTestBuild;
        testFeed=local&&WindowsInstallationIdentity.IsTestBuild?server:null;
        profile=local ? Path.Combine(Path.GetTempPath(),"Lychee-Windows-QA",origin.Port.ToString())
                      : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LycheeGardenDesktop","WebView2");
        Title="荔枝"; Width=1000; Height=760; MinWidth=320; MinHeight=280;
        WindowStartupLocation=WindowStartupLocation.CenterScreen;
        WindowChrome.SetWindowChrome(this,chrome);
        ResizeMode=ResizeMode.CanResize;
        var paper=new SolidColorBrush(Color.FromRgb(252,247,233));
        var layout=new Grid {Background=paper};
        // WebView2 owns a child HWND. Keep it entirely inside the native sizing rim
        // so Windows receives the hit test and runs its usual move/size loop.
        var frame=new Border {Child=layout,Background=paper,Padding=chrome.ResizeBorderThickness,UseLayoutRounding=true};
        Content=frame;
        layout.RowDefinitions.Add(new RowDefinition {Height=GridLength.Auto});
        layout.RowDefinitions.Add(new RowDefinition());
        var controls=new StackPanel {Orientation=Orientation.Horizontal};
        DockPanel.SetDock(controls,Dock.Right);caption.Children.Add(controls);
        var minimize=AddCaptionButton(controls,"─","最小化",MinimizeWindow);
        minimize.ToolTip="最小化（Ctrl+Q）";
        AutomationProperties.SetAcceleratorKey(minimize,"Ctrl+Q");
        PreviewKeyDown+=OnWindowShortcut;
        var maximize=AddCaptionButton(controls,"□","最大化",ToggleMaximize);
        AddCaptionButton(controls,"×","关闭",Close);
        StateChanged+=delegate {
            if(WindowState!=WindowState.Minimized)restoreState=WindowState;
            frame.Padding=WindowState==WindowState.Normal?chrome.ResizeBorderThickness:new Thickness(0);
            string label=WindowState==WindowState.Maximized?"还原":"最大化";
            maximize.Content=WindowState==WindowState.Maximized?"❐":"□";
            maximize.ToolTip=label;AutomationProperties.SetName(maximize,label);
        };
        var brand=new StackPanel {Orientation=Orientation.Horizontal,Margin=new Thickness(12,0,0,0),VerticalAlignment=VerticalAlignment.Center};
        caption.Children.Add(brand);layout.Children.Add(caption);
        Grid.SetRow(web,1);Grid.SetRow(startup,1);
        archive=new ZipArchive(Assembly.GetExecutingAssembly().GetManifestResourceStream("Lychee.Site"),ZipArchiveMode.Read);
        assets=archive.Entries.ToDictionary(x=>"/"+x.FullName,StringComparer.Ordinal);
        using (var iconStream=Assembly.GetExecutingAssembly().GetManifestResourceStream("Lychee.WindowIcon")) {
            var frames=new IconBitmapDecoder(iconStream,BitmapCreateOptions.PreservePixelFormat,BitmapCacheOption.OnLoad).Frames;
            var b=frames.OrderByDescending(bitmap=>bitmap.PixelWidth).First();
            Icon=b;startup.Children.Add(new Image {Source=b,Width=76,Height=76});
            brand.Children.Add(new Image {Source=b,Width=19,Height=19});
            brand.Children.Add(new TextBlock {Text="荔枝",Margin=new Thickness(7,0,0,0),FontWeight=FontWeights.SemiBold,Foreground=Brushes.DarkGreen});
        }
        startup.Children.Add(new TextBlock{Text="荔枝",FontSize=27,HorizontalAlignment=HorizontalAlignment.Center,Margin=new Thickness(0,9,0,0)});
        startup.Children.Add(message);startup.Children.Add(retry);
        web.Visibility=Visibility.Hidden;layout.Children.Add(web);layout.Children.Add(startup);
        retry.Click+=async delegate {await Open();};
        Loaded+=async delegate {await Open();};
        notifications.Tick+=delegate {
            if(!closing && (WindowState==WindowState.Minimized || !IsActive) && web.CoreWebView2!=null)
                web.CoreWebView2.PostWebMessageAsString("notify:poll");
        };
        dismissNotification.Tick+=delegate {HideNotification();};
        Closed+=delegate {closing=true;notifications.Stop();HideNotification();web.Dispose();archive.Dispose();};
    }
    void HideNotification() {
        dismissNotification.Stop();
        if(popup!=null){var old=popup;popup=null;old.Close();}
    }
    void MinimizeWindow() {
        HideNotification();
        WindowState=WindowState.Minimized;
    }
    void OnWindowShortcut(object sender,KeyEventArgs e) {
        if(e.Key!=Key.Q || Keyboard.Modifiers!=ModifierKeys.Control)return;
        e.Handled=true;
        MinimizeWindow();
    }
    void ShowNotification(string key,string body) {
        if((WindowState!=WindowState.Minimized && IsActive) || closing || key.Length>350 || body.Length>240)return;
        HideNotification();
        var signal=new FlashInfo {size=(uint)Marshal.SizeOf(typeof(FlashInfo)),hwnd=new WindowInteropHelper(this).Handle,flags=2,count=3};
        FlashWindowEx(ref signal);
        System.Media.SystemSounds.Asterisk.Play();
        var text=new StackPanel {Margin=new Thickness(12,8,12,8)};
        text.Children.Add(new TextBlock {Text="荔枝 · 新消息",FontWeight=FontWeights.Bold,Margin=new Thickness(0,0,0,4)});
        text.Children.Add(new TextBlock {Text=body,TextWrapping=TextWrapping.Wrap,TextTrimming=TextTrimming.CharacterEllipsis,MaxHeight=42});
        var button=new Button {Content=text,HorizontalContentAlignment=HorizontalAlignment.Left};
        AutomationProperties.SetName(button,"打开荔枝新消息");
        var area=SystemParameters.WorkArea;
        popup=new Window {Title="荔枝 · 消息提醒",WindowStyle=WindowStyle.None,ResizeMode=ResizeMode.NoResize,
            ShowInTaskbar=false,ShowActivated=false,Topmost=true,Width=292,Height=80,Left=area.Right-304,Top=area.Bottom-92,Content=button};
        popup.PreviewKeyDown+=OnWindowShortcut;
        button.Click+=delegate {
            HideNotification();
            if(closing)return;
            if(WindowState==WindowState.Minimized)WindowState=restoreState;
            Activate();
            web.CoreWebView2.PostWebMessageAsString("notify:open\n"+key);
        };
        popup.Show();dismissNotification.Start();
    }
    Button AddCaptionButton(StackPanel parent,string icon,string label,Action click) {
        var button=new Button {Content=icon,ToolTip=label,FontSize=16,Width=36,Height=30,Background=Brushes.Transparent,BorderThickness=new Thickness(0),Foreground=new SolidColorBrush(Color.FromRgb(45,76,58))};
        AutomationProperties.SetName(button,label);WindowChrome.SetIsHitTestVisibleInChrome(button,true);
        button.Click+=delegate {click();};parent.Children.Add(button);return button;
    }
    void ToggleMaximize(){WindowState=WindowState==WindowState.Maximized?WindowState.Normal:WindowState.Maximized;}
    void UpdateStatus(string state,string details) {
        if(closing||web.CoreWebView2==null)return;
        var payload=new {type="lychee:update",state=state,message=details,
            version=offered==null?"":offered.Version.ToString(),current=WindowsInstallationIdentity.Version};
        web.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(payload));
    }
    async Task CheckUpdate(bool manual) {
        if(!updatesEnabled||closing)return;
        if(manual)updateView=true;
        if(installing){if(manual)UpdateStatus("downloading","正在下载并校验更新包…");return;}
        if(manual)UpdateStatus("checking","正在检查新版本…");
        if(checking)return;
        checking=true;
        try {
            var release=await WindowsUpdateFeed.CheckAsync(testFeed);
            if(closing)return;
            offered=release!=null&&release.Version.CompareTo(new Version(WindowsInstallationIdentity.Version))>0?release:null;
            if(offered!=null){updateView=true;UpdateStatus("available","更新完成后会重新打开荔枝。");}
            else if(updateView)UpdateStatus("current","已是最新版本，暂时无需更新。");
        } catch(Exception) {
            offered=null;
            if(updateView&&!closing)UpdateStatus("check-error","请检查网络连接，或稍后重试。");
        } finally {checking=false;}
    }
    async Task InstallUpdate() {
        if(!updatesEnabled||!updateView||checking||installing||closing||offered==null)return;
        installing=true;var release=offered;
        UpdateStatus("downloading","正在下载并校验更新包…");
        try {
            string exe=Process.GetCurrentProcess().MainModule.FileName;
            string kind=WindowsUpdateApply.DetectKind(exe);
            var package=await WindowsUpdateFeed.DownloadAsync(release,kind,testFeed);
            try {
                if(closing)return;
                WindowsUpdateApply.Start(package.Path,package.Sha256,release.Version.ToString(),kind,exe,testFeed!=null,
                                         testFeed==null?null:testFeed.AbsoluteUri);
            } finally {
                try {
                    File.Delete(package.Path);
                    Directory.Delete(Path.GetDirectoryName(package.Path),false);
                }catch(IOException){}catch(UnauthorizedAccessException){}
            }
            Close();
        } catch(Exception err) {
            if(testFeed!=null)Console.Error.WriteLine(err);
            if(!closing)UpdateStatus("error","无法完成更新。你可以继续使用当前版本，或重试。");
        } finally {installing=false;}
    }
    void SetIntegrated(bool integrated) {
        caption.Visibility=integrated?Visibility.Collapsed:Visibility.Visible;
        if(chrome.CaptionHeight!=(integrated?0:34))chrome.CaptionHeight=integrated?0:34;
    }
    bool IsSameOrigin(Uri u) {return u.Scheme==origin.Scheme && u.Host==origin.Host && u.Port==origin.Port && u.UserInfo.Length==0;}
    static bool IsApi(string path) {
        if(path.StartsWith("/api/",StringComparison.Ordinal))return true;
        var seg=path.Split('/');
        return seg.Length>=5 && seg[1]=="g" && seg[2].Length!=0 && seg[3]=="api";
    }
    void LocalAsset(object sender,CoreWebView2WebResourceRequestedEventArgs e) {
        var u=new Uri(e.Request.Uri);
        if(u.Scheme!="https" && u.Scheme!="http")return;
        var env=web.CoreWebView2.Environment;
        string path=u.AbsolutePath;
        if(!IsSameOrigin(u)){e.Response=env.CreateWebResourceResponse(null,403,"Forbidden","");return;}
        if(IsApi(path))return;
        if(path.EndsWith("/"))path+="index.html";
        ZipArchiveEntry entry;string type;
        if((e.Request.Method!="GET" && e.Request.Method!="HEAD") || !assets.TryGetValue(path,out entry)) {
            e.Response=env.CreateWebResourceResponse(null,404,"Not found","");return;
        }
        if(!types.TryGetValue(Path.GetExtension(path),out type))type="application/octet-stream";
        var bytes=new MemoryStream();
        if(e.Request.Method=="GET"){using(var content=entry.Open())content.CopyTo(bytes);bytes.Position=0;}
        e.Response=env.CreateWebResourceResponse(bytes,200,"OK","Content-Type: "+type+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
    }
    async Task Open() {
        retry.Visibility=Visibility.Collapsed;message.Text="正在打开荔枝…";
        try {
            if(!connected){
                var env=await CoreWebView2Environment.CreateAsync(null,profile);
                if(closing)return;
                await web.EnsureCoreWebView2Async(env);if(closing)return;
                var core=web.CoreWebView2;
                core.Settings.IsStatusBarEnabled=false;
                core.Settings.IsZoomControlEnabled=false;
                await core.AddScriptToExecuteOnDocumentCreatedAsync("window.lycheeDesktopHost=true;");
                if(updatesEnabled)await core.AddScriptToExecuteOnDocumentCreatedAsync("window.lycheeCanUpdate=true;");
                try {
                    core.Settings.IsNonClientRegionSupportEnabled=true;
                    await core.AddScriptToExecuteOnDocumentCreatedAsync("window.lycheeNativeFrame=true;");
                } catch(NotImplementedException) { /* Older WebView runtimes keep the native title bar. */ }
                core.WebMessageReceived+=async delegate(object s,CoreWebView2WebMessageReceivedEventArgs m) {
                    Uri source;
                    if(!Uri.TryCreate(m.Source,UriKind.Absolute,out source)||!IsSameOrigin(source)||source.AbsolutePath!="/windows/workspace.html")return;
                    string command;
                    try {command=m.TryGetWebMessageAsString();}catch(ArgumentException){return;}
                    if(command=="update:check"){await CheckUpdate(true);return;}
                    if(command=="update:install"){await InstallUpdate();return;}
                    if(command=="update:dismiss"){if(!installing)updateView=false;return;}
                    if(command=="notify:reset"){HideNotification();return;}
                    if(command!=null && command.StartsWith("notify:show\n",StringComparison.Ordinal)){
                        var fields=command.Split(new[]{'\n'},3);
                        if(fields.Length==3)ShowNotification(fields[1],fields[2]);
                        return;
                    }
                    switch(m.WebMessageAsJson) {
                        case "\"frame:on\"":SetIntegrated(true);break;
                        case "\"frame:off\"":SetIntegrated(false);break;
                        case "\"window:minimize\"":MinimizeWindow();break;
                        case "\"window:maximize\"":ToggleMaximize();break;
                        case "\"window:close\"":Close();break;
                    }
                };
                core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);
                core.WebResourceRequested+=LocalAsset;
                core.NavigationStarting+=delegate(object s,CoreWebView2NavigationStartingEventArgs n){
                    Uri u;if(!Uri.TryCreate(n.Uri,UriKind.Absolute,out u) || !IsSameOrigin(u) || IsApi(u.AbsolutePath))n.Cancel=true;else SetIntegrated(false);
                    if(!n.Cancel)HideNotification();
                };
                core.NewWindowRequested+=delegate(object s,CoreWebView2NewWindowRequestedEventArgs n){n.Handled=true;};
                core.NavigationCompleted+=async delegate(object s,CoreWebView2NavigationCompletedEventArgs n){
                    if(closing)return;
                    if(!n.IsSuccess){ShowError("页面未能打开，可以重试。");return;}
                    web.Visibility=Visibility.Visible;startup.Visibility=Visibility.Collapsed;
                    WindowsUpdateApply.ConfirmReady();
                    if(!updateChecked){
                        updateChecked=true;
                        if(WindowsUpdateApply.ConsumeRecoveryNotice()){
                            updateView=true;
                            UpdateStatus("error","新版未能完成更新，荔枝已恢复到原版本。");
                        }else await CheckUpdate(false);
                    }
                    else if(updateView&&offered!=null)UpdateStatus(installing?"downloading":"available",
                        installing?"正在下载并校验更新包…":"更新完成后会重新打开荔枝。");
                };connected=true;notifications.Start();
            }
            web.CoreWebView2.Navigate(new Uri(origin,"windows/workspace.html").AbsoluteUri);
        } catch(WebView2RuntimeNotFoundException) {
            ShowError("此电脑需要 Microsoft Edge WebView2 运行时。安装后点重试。");
            if(startup.Children.OfType<Button>().Count()==1){
                var download=new Button{Content="打开微软官方下载页",Margin=new Thickness(0,10,0,0)};
                download.Click+=delegate{Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/"){UseShellExecute=true});};
                startup.Children.Add(download);
            }
        } catch(Exception failure) {if(origin.IsLoopback) Console.Error.WriteLine(failure);if(!closing)ShowError("荔枝窗口启动失败，可以重试。");}
    }
    void ShowError(string text){SetIntegrated(false);web.Visibility=Visibility.Hidden;startup.Visibility=Visibility.Visible;message.Text=text;retry.Visibility=Visibility.Visible;}
}
