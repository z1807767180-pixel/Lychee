# 荔枝 iPhone

这个工程从当前共享源码准备 7.0.0 的手机资源。首次启动从包内加载界面和字体，随后连接与 Windows 共用的荔枝服务。需要 iOS 17 或以上。供朋友使用的 iPhone 入口仍是主屏幕网页版。

## 构建与取包

在装有 Xcode 的 Mac 上，从仓库根目录运行：

```sh
python3 source/ios/build.py
python3 source/ios/smoke.py
```

任何平台可先运行 `python source/ios/build.py --prepare-only` 核对共享资源。Mac 上再用 Xcode 编译 arm64 程序。输出是 `source/ios/out/export/Lychee-7.0.0-iPhone-unsigned.ipa` 和对应的 SHA-256。GitHub Actions 的 **Build Lychee for iPhone** 成功后的 IPA 位于当次运行的 Artifacts 中，保留 14 天。模拟器检查使用隔离的未登录响应。

## 在 iPhone 上运行

这里交付的 IPA 需要签名才能安装到真机。工程使用试用标识 `dev.lychee.pilot.ios`。如需正式分发，请使用自己的 Apple 开发团队和已注册的 App ID，通过签名归档提交。Apple 账号配置、设备验收与 App Store 提交单独进行。

手机端需要实测原账号登录、杀进程后重新打开、同园数据与 Windows 互通、相册选图和保存图片。测试版继续使用原后端。开发者凭证及签名私钥不进入源码仓库。
