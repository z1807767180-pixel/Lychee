# 荔枝 Lychee

荔枝是给朋友和家人共用的小园。大家用自己的账号登录，凭邀请码加入圈子，可以聊天、记录园中事、约定倒计时、照料荔枝树，也可以使用 AI 和个人小工具。

## 使用荔枝 6.4.7

| 设备 | 使用入口 | 开发入口 |
| --- | --- | --- |
| Windows 电脑 | [还原已发布的 EXE 和 MSI](archive/windows/6.4.7/README.md)。双击 EXE 可直接使用，MSI 可安装到开始菜单。需要 Windows x64 和 WebView2。 | [Windows 桌面工程](source/desktop/) |
| 安卓手机 | [下载已签名 APK](https://github.com/z1807767180-pixel/Lychee/releases/download/android-v6.4.7/Lychee-6.4.7.apk)。支持 Android 7.0 及以上的兼容设备。 | [安卓工程](source/android/) |
| iPhone 主屏幕网页版 | [打开荔枝园](https://lychee-link-check.onrender.com/mobile/)，在 Safari 点「分享」→「添加到主屏幕」。 | [手机网页发布脚本](source/mobile-web/) |
| iOS 原生试验版 | 已构建未签名 IPA，真机安装需要 Apple 签名。当前供朋友使用的入口是上一行的网页版。 | [iOS 原生工程](source/ios/) |

## 从 main 接手

第一次换电脑或换 AI，请从 [AGENTS.md](AGENTS.md) 开始；安卓更新密钥的导出和跨机校验见[换电脑接手](docs/换电脑接手.md)。

各端共用的功能、原生工程和发布脚本都在本仓库的 `main`。新功能从这里开始；在新分支修改、验证，再合回 `main`。

- 搭建本地工程、查依赖和测试命令，请读[源码接手说明](source/接手说明.md)。
- 查各端发布证据、尚待实测的项目和下一版发布步骤，请读[项目交接](docs/项目交接.md)。
- 找 Windows 朋友分发 ZIP 或还原历史原件，请读[历史版本索引](history/README.md)。历次归档范围见[归档核对记录](docs/归档核对记录.md)，最初设计见[多端实施方案](docs/多端实施方案.md)。
