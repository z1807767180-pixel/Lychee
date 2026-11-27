# 荔枝朋友版 Android

朋友版首次单独安装，包名为 `dev.lychee.friends`，系统图标名为「荔枝朋友版」。打开后连接原来的荔枝园，用自己的账号登录，日常聊天、工具和网页公告随官网更新。旧试用版 `dev.lychee.pilot` 使用另一份签名，可以和朋友版同时保留。

## 安装与更新

用安卓浏览器打开[荔枝官网下载页](https://lychee-link-check.onrender.com/android-update/download.html)，下载朋友版 **A8.1.1**。在「文件管理 → 下载」点 `Lychee-Friends-A8.1.1.apk`，若系统询问，允许这个来源安装应用，再点「安装」。装好后从桌面打开「荔枝朋友版」。安装要求为 Android 7.0 及以上的兼容设备，需要系统 WebView 和互联网连接。

从 A8.0.0 开始，安卓在应用里和官网下载文件名中都显示 A。旧朋友版仍可从既有 V 文件路径取得同一安装包。安卓系统记录当前包版本为 8.1.1，内部版本号为 80101，沿用原朋友版证书。

**Android 9 用户**若还在 A8.0.0 或更早版，软件内可能下载完仍提示「未能安装更新」。请按上面的方法从官网覆盖安装当前版一次，无须卸载。从 A8.0.1 起，应用已修复 Android 9 读取安装包签名的问题。

V7.0.6 起，启动和设置会先访问荔枝官网取得版本及签名包，暂时无法连通时保留原 GitHub 更新源。V7.0.5 及以前的软件内只认 GitHub，无法连接时，从上述官网页手动覆盖安装一次即可保留原应用和账号资料。在「我 → 设置 → 检查安卓更新」可以手动检查。断网启动时，提示页的「重试」旁也有「检查安卓更新」。网络故障或无法验证更新资料时会提示重试。发现新版本后，先点下载，应用核对摘要、包名、版本和证书，再交给安卓的安装确认页。Android 8 及以上有时会要求允许荔枝安装此次更新。

## 发布下一个安卓壳

1. 在 `android/friends-stable` 更新 [friends-release.json](friends-release.json)，把版本升高，`upgradeFrom` 填用于覆盖升级验证的上一公开版本，再用短句写这版的变化。网页日常内容由手机网页分支发布。
2. GitHub Actions 的 [构建流程](../../.github/workflows/android-friends-build.yml) 从固定依赖构建未签名 APK。取回对应运行的 `friends-offline-signing` 工件，核对其中两份输入的 SHA-256。
3. 在保管签名的 Windows 用户下，运行 `python tools/android_friends_key.py sign <java.exe> <apksigner.jar> <friends-unsigned.apk> <新的输出APK> --certificate 19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2`。用 Android SDK 的 apksigner 验证输出，再运行 `python source/android/ci/friends_signing_receipt.py <friends-unsigned.apk> <签名APK> distribution/android-friends/signature.json`。把这次未签名构建的运行号写入同目录的 `build-run.txt`，一起推送。
4. [交付流程](../../.github/workflows/android-friends-delivery.yml) 复原并核对签名成品、首装体验及更新入口。版本成品保存在 `android-friends-v版本号` 发布页，经核验后将 `android-friends` 发布页的 `current.json` 指向新版。同一版本对应的 APK 及摘要应保留。

5. 在手机官网发布分支同步同一份 friends-release.json、签名 APK、signature.json 及构建运行号，用生产构建准备同域静态下载。发布后对比官网与 GitHub 的版本、大小、摘要、包名和证书，并在只允许荔枝官网的环境完成应用内检查和系统覆盖。

## 签名恢复

朋友版使用独立 RSA 正式证书，SHA-256 为 `19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2`。同一包名以后的每次升级沿用这个身份。

日常签名目录是 `%LOCALAPPDATA%\LycheeSigning\FriendsAndroid`，解锁材料由当前 Windows 用户保护。可迁移 P12 在 `%LOCALAPPDATA%\LycheeSigning\FriendsRecovery\friends-portable.p12`，单独的恢复码在 `%USERPROFILE%\.lychee-private\friends-recovery-code.txt`。两项分别放入自己的安全备份位置；本机两处文件仍受同一台电脑丢失的影响。

在新 Windows 用户上安装 Python 和 cryptography，运行 `python tools/android_friends_key.py restore <便携P12> --certificate 19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2`，在隐藏输入提示中提供恢复码。工具匹配原公开证书，再建立新用户的私有签名目录。其他平台可用标准 PKCS12 和 apksigner。公开仓库只保留证书摘要、签名验证资料、成品和脚本。
