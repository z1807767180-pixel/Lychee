# 荔枝 Lychee

荔枝是给朋友和家人共用的小园。大家用自己的账号登录，在统一首页看自己的约定、进群聊天，和好友私聊、发园中事、互赠荔枝，也可以使用 AI 和个人小工具。

## 使用荔枝

| 设备 | 使用入口 | 开发入口 |
| --- | --- | --- |
| Windows 电脑 | [官网下载 W8.1.1 的 EXE 或 MSI](https://lychee-link-check.onrender.com/windows-update/download.html)。双击 EXE 可直接使用，MSI 可安装到开始菜单。需要 Windows x64 和 WebView2。 | [Windows 桌面工程](source/desktop/) · [W7.0.3 历史候选](archive/windows/7.0.3-RC/README.md) |
| 安卓手机 | [从荔枝官网下载朋友版 A8.1.1 APK](https://lychee-link-check.onrender.com/android-update/download.html)。首次安装后用原账号登录，安卓更新在「我 → 设置」查看。支持 Android 7.0 及以上的兼容设备。 | [朋友版安装与维护](source/android/FRIENDS.md) · [旧试用版 6.4.7](https://github.com/z1807767180-pixel/Lychee/releases/tag/android-v6.4.7) |
| 手机及 iPhone 主屏幕网页版 V8.1.1 | [打开荔枝园](https://lychee-link-check.onrender.com/mobile/)，在 Safari 点「分享」→「添加到主屏幕」。更新公告在「我 → 设置 → 账号公告」。 | [手机网页发布说明](source/mobile-web/README.md) |
| iOS 原生试验版 | 当前源码 7.0.0，历史 6.4.7 有未签名构建。7.0.0 待 Mac 编译和 Apple 真机签名。当前供朋友使用的入口是上一行的网页版。 | [iOS 原生工程](source/ios/) |

## 从 main 接手

第一次换电脑或换 AI，请从 [AGENTS.md](AGENTS.md) 开始；安卓更新密钥的导出和跨机校验见[换电脑接手](docs/换电脑接手.md)。

各端共用的功能、原生工程和发布脚本都在本仓库的 `main`。新功能从这里开始；在新分支修改、验证，再合回 `main`。

- 搭建本地工程、查依赖和测试命令，请读[源码接手说明](source/接手说明.md)。
- 查各端发布证据、尚待实测的项目和下一版发布步骤，请读[项目交接](docs/项目交接.md)。
- 找 Windows 朋友分发 ZIP 或还原历史原件，请读[历史版本索引](history/README.md)。历次归档范围见[归档核对记录](docs/归档核对记录.md)，最初设计见[多端实施方案](docs/多端实施方案.md)。
