# 荔枝 iPhone 6.4.7

这个工程把归档中 6.4.7 的 146 个手机资源装入 iPhone 应用。首次启动从包内加载界面和字体，随后连接与 Windows 共用的荔枝服务。需要 iOS 17 或以上。

## 构建与取包

在装有 Xcode 的 Mac 上，从仓库根目录运行：

```sh
python3 source/ios/build.py
python3 source/ios/smoke.py
```

构建脚本先从历史分片还原手机资源，核对原 ZIP 与包内文件，再用 Xcode 编译 iPhone 真机的 arm64 程序。输出是 `source/ios/out/export/Lychee-6.4.7-iPhone-unsigned.ipa` 和对应的 SHA-256。GitHub Actions 的 **Build Lychee for iPhone** 使用公开仓库标准 macOS 构建环境，成功后的 IPA 位于当次运行的 Artifacts 中，保留 14 天。模拟器检查使用隔离的未登录响应，无需生产账号。

## 在 iPhone 上运行

这里交付的 IPA 需要签名才能安装到真机。工程使用试用标识 `dev.lychee.pilot.ios`。如需正式分发，请使用自己的 Apple 开发团队和已注册的 App ID，通过签名归档提交。Apple 账号配置、设备验收与 App Store 提交单独进行。

手机端需要实测原账号登录、杀进程后重新打开、同园数据与 Windows 互通、相册选图和保存图片。测试版继续使用原后端。开发者凭证及签名私钥不进入源码仓库。
