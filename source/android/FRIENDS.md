# 荔枝朋友版 Android

朋友版首次单独安装，包名为 `dev.lychee.friends`，系统图标名为「荔枝朋友版」。打开后连接原来的荔枝园，用自己的账号登录，日常聊天、工具和网页公告随官网更新。旧试用版 `dev.lychee.pilot` 使用另一份签名，可以和朋友版同时保留。

## 安装与更新

用安卓手机的浏览器下载 [V7.0.2 首装 APK](https://github.com/z1807767180-pixel/Lychee/releases/download/android-friends-v7.0.2/Lychee-Friends-V7.0.2.apk)。下载完成后，打开手机「文件管理 → 下载」，点 `Lychee-Friends-V7.0.2.apk`。若系统询问，允许这个来源安装应用，再点「安装」。装好后从桌面打开「荔枝朋友版」。支持 Android 7.0 及以上的兼容设备，需要 Android System WebView 和互联网连接。

启动时会检查安卓壳更新。在「我 → 设置 → 检查安卓更新」可以手动检查。网络故障或无法验证更新资料时会提示重试。发现新版本后，先点下载，应用核对摘要、包名、版本和证书，再交给安卓的安装确认页。Android 8 及以上有时会要求允许荔枝安装此次更新。

## 发布下一个安卓壳

1. 在 `android/friends-stable` 更新 [friends-release.json](friends-release.json)，把版本升高并用短句写这版的变化。网页日常内容由手机网页分支发布。
2. GitHub Actions 的 [构建流程](../../.github/workflows/android-friends-build.yml) 从固定依赖构建未签名 APK。取回对应运行的 `friends-offline-signing` 工件，核对其中两份输入的 SHA-256。
3. 在保管签名的 Windows 用户下，运行 `python tools/android_friends_key.py sign <java.exe> <apksigner.jar> <friends-unsigned.apk> <新的输出APK> --certificate 19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2`。用 Android SDK 的 apksigner 验证输出，再运行 `python source/android/ci/friends_signing_receipt.py <friends-unsigned.apk> <签名APK> distribution/android-friends/signature.json`。把这次未签名构建的运行号写入同目录的 `build-run.txt`，一起推送。
4. [交付流程](../../.github/workflows/android-friends-delivery.yml) 复原并核对签名成品、首装体验及更新入口。版本成品保存在 `android-friends-v版本号` 发布页，经核验后将 `android-friends` 发布页的 `current.json` 指向新版。同一版本对应的 APK 及摘要应保留。

## 签名恢复

朋友版使用独立 RSA 正式证书，SHA-256 为 `19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2`。同一包名以后的每次升级沿用这个身份。

日常签名目录是 `%LOCALAPPDATA%\LycheeSigning\FriendsAndroid`，解锁材料由当前 Windows 用户保护。可迁移 P12 在 `%LOCALAPPDATA%\LycheeSigning\FriendsRecovery\friends-portable.p12`，单独的恢复码在 `%USERPROFILE%\.lychee-private\friends-recovery-code.txt`。两项分别放入自己的安全备份位置；本机两处文件仍受同一台电脑丢失的影响。

在新 Windows 用户上安装 Python 和 cryptography，运行 `python tools/android_friends_key.py restore <便携P12> --certificate 19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2`，在隐藏输入提示中提供恢复码。工具匹配原公开证书，再建立新用户的私有签名目录。其他平台可用标准 PKCS12 和 apksigner。公开仓库只保留证书摘要、签名验证资料、成品和脚本。
