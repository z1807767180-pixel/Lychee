# 荔枝 Android

朋友版首装、应用内更新和签名恢复见[朋友版 Android](FRIENDS.md)。

## 荔枝 Android 6.4.7 试用工程

使用 Capacitor 8.6.1、Android Gradle Plugin 8.13.0 和 Gradle 8.14.3。原生包名为 `dev.lychee.pilot`。最低 Android 7.0（API 24），面向 API 36。构建机需要 Node 22+、Python 3.10+、JDK 21、Android SDK Platform 36 和 Build Tools 36.0.0。手机需要支持本版页面的 Android System WebView。

## 本地构建

将 `JAVA_HOME` 指向 JDK 21，`ANDROID_HOME` 指向已安装的 SDK。在本目录执行以下命令。第一条从冻结版本生成静态输入，已有随交付提供的 `lychee-mobile-assets.zip` 时可直接执行第二条。

```powershell
python mobile_assets.py --site "<6.4.7 冻结目录>/mobile-static/public" --expected-build 6.4.7 --out lychee-mobile-assets.zip
python build.py --assets lychee-mobile-assets.zip --expected-build 6.4.7 --sha256 856b197061106f08cb3eb3126998de1a508b9d412956c86b099a0c13571ad975 --out dist/Lychee-6.4.7-debug.apk
```

加 `--prepare-only` 可以在安装 Android 工具前复核素材，然后生成 Capacitor 的 `www`。本次用冻结目录做了这个步骤，146 个移动文件通过验证。素材包含五张工具卡、共享界面脚本、字体和字体授权。

首次构建先根据 2026-11-25 00:00 UTC 的 npm 发布截止时间生成完整 `package-lock.json`，核验三项 Capacitor 直接依赖的官方 SHA-512，再通过 `npm ci` 安装。后续将已验收的完整锁文件放回同目录，直接沿用。Gradle Wrapper JAR 和 Gradle 完整发行 ZIP 均有固定 SHA-256。首次仍需从 npm、Gradle 和 Android Maven 仓库取得依赖。当前本机 npm 连接被拒，尚未生成完整 npm 锁或 APK。

构建调用 `cap sync android` 和 `:app:assembleDebug`。只有通过 Android SDK 的签名验证、ZIP 对齐、包名/入口/版本、应用字节码和每个冻结资源逐字节核对后，才复制最终 APK。命令行输出包括 APK 与调试签名证书摘要。

## 手机上的网络与文件

`MainActivity` 继承官方 `BridgeActivity`。空白引导文档随包提供，在设置好官方 `BridgeWebViewClient` 后进入本地 `/mobile/index.html`。HTML、字体、脚本由 Capacitor 读取 APK。能力检查、新版账户、已指明园子的接口使用同一固定 HTTPS 域名，WebView 自行进行 TLS 校验和管理第一方 Cookie。应用没有登录 JS 桥，也不重写 Origin。

普通 HTTPS 以外的子资源仅放行 JPEG、PNG、WebP、GIF 的内联图片，以及本应用 HTTPS 来源创建的 blob。主页面不能导航到任意外部地址。需在真机分别检查相册/头像选择、文件上传、个人封面读回、分享或保存图片、系统返回、软键盘和重启后的登录。文件系统保存和下载是独立的真机验收项目。现有三个 Edge 会话验证过共享网页的成员权限和个人封面，不代表 Android 安装测试。

## 私有 CI

经授权后，可将源工程放在私库的 `android/`，把 `ci/android-pilot.yml` 放在该库已启用手动运行的 `.github/workflows/`。工作流由负责人手动触发，仅接受同一私库的 `lychee-android-6.4.7-input` release 中名为 `lychee-mobile-assets.zip` 的资源并校验上述固定摘要。静态 ZIP 单独交接，JS、字体、服务端源码、账户资料、数据库、环境变量及签名私钥均不需要提交进 Git。

工作流使用只读仓库权限，不发布应用。通过后，私有构建工件保留三天，包含 APK、APK 的 SHA-256 和完整 npm 锁。每个新 runner 默认使用新的 Android 调试证书，适合首次侧载测试。要给已安装的同包名应用原位升级，需要保存并沿用首次使用的调试证书及其私钥，并使用合适的版本号。这里没有正式发布签名，也没有自动上传签名材料。

当前仍待核实的工作为 CI 实际编译、APK 签名和内容实证、Android 手机安装与上述功能实测。
