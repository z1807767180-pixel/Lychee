# 荔枝 Android 6.4.7

使用 Capacitor 8.6.1、Android Gradle Plugin 8.13.0 和 Gradle 8.14.3。原生包名为 `dev.lychee.pilot`。最低 Android 7.0（API 24），面向 API 36。构建机需要 Node 22+、Python 3.10+、JDK 21、Android SDK Platform 36 和 Build Tools 36.0.0。手机需要支持本版页面的 Android System WebView。

## 本地构建

将 `JAVA_HOME` 指向 JDK 21，`ANDROID_HOME` 指向已安装的 SDK。在本目录执行以下命令。第一条从冻结版本生成静态输入，已有随交付提供的 `lychee-mobile-assets.zip` 时可直接执行第二条。

```powershell
python mobile_assets.py --site "<6.4.7 冻结目录>/mobile-static/public" --expected-build 6.4.7 --out lychee-mobile-assets.zip
python build.py --assets lychee-mobile-assets.zip --expected-build 6.4.7 --sha256 856b197061106f08cb3eb3126998de1a508b9d412956c86b099a0c13571ad975 --out dist/Lychee-6.4.7-debug.apk
```

加 `--prepare-only` 可以在安装 Android 工具前复核素材，然后生成 Capacitor 的 `www`。本次用冻结目录做了这个步骤，146 个移动文件通过验证。素材包含五张工具卡、共享界面脚本、字体和字体授权。

6.4.7 正式构建的完整 `package-lock.json` 已随源码归档。新机器沿用该锁文件；构建脚本先核对三项 Capacitor 直接依赖的 SHA-512，再运行 `npm ci`。Gradle wrapper 和发行 ZIP 有固定 SHA-256。首次构建需访问 npm、Gradle 和 Android Maven 仓库。

构建调用 `cap sync android` 和 `:app:assembleDebug`。只有通过 Android SDK 的签名验证、ZIP 对齐、包名/入口/版本、应用字节码和每个冻结资源逐字节核对后，才复制最终 APK。命令行输出包括 APK 与调试签名证书摘要。

## 手机上的网络与文件

`MainActivity` 继承官方 `BridgeActivity`。空白引导文档随包提供，在设置好官方 `BridgeWebViewClient` 后进入本地 `/mobile/index.html`。HTML、字体、脚本由 Capacitor 读取 APK。能力检查、新版账户、已指明园子的接口使用同一固定 HTTPS 域名，WebView 自行进行 TLS 校验和管理第一方 Cookie。应用没有登录 JS 桥，也不重写 Origin。

普通 HTTPS 以外的子资源仅放行 JPEG、PNG、WebP、GIF 的内联图片，以及本应用 HTTPS 来源创建的 blob。主页面不能导航到任意外部地址。需在真机分别检查相册/头像选择、文件上传、个人封面读回、分享或保存图片、系统返回、软键盘和重启后的登录。文件系统保存和下载是独立的真机验收项目。现有三个 Edge 会话验证过共享网页的成员权限和个人封面，不代表 Android 安装测试。

## 正式安装包与后续更新

朋友使用[已签名的 6.4.7 APK](https://github.com/z1807767180-pixel/Lychee/releases/tag/android-v6.4.7)。[正式构建](../../.github/workflows/android-release.yml)从同仓归档还原 146 项手机资源，以 `--unsigned-release` 生成供负责人签名的 release APK。[发布验证](../../.github/workflows/android-delivery.yml)核对摘要、签名、版本和 ZIP 对齐，在 Android 15 模拟器安装并打开登录页之后，才发布成品。上面的本地调试包用于开发。

覆盖更新需要保留包名 `dev.lychee.pilot`、提高 `versionCode` 并沿用负责人保管的正式签名私钥。已发布的 APK、公开签名和校验值不能替代私钥。真机验收范围见[多端发布记录](../../docs/项目交接.md)。
