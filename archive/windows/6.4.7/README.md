# Windows 6.4.7

[下载仓库 ZIP](https://github.com/z1807767180-pixel/Lychee/archive/refs/heads/main.zip) 并全部解压，进入 `archive/windows/6.4.7`，双击 `restore.cmd`。成功时会在同一目录得到两个原始文件。可以直接双击 `Lychee.exe`，或运行 `Lychee.msi` 安装到开始菜单。需要 Windows x64 和 Microsoft Edge WebView2。

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| Lychee.exe | 19,783,168 | `635375f965bcb027a03703c04b9b16f94aa41570bd7a9b4df65d5603df28581e` |
| Lychee.msi | 19,222,528 | `d55b5c95579c624ed761acfb55f712292e377da0345783d43bfc25ac07bcdb7a` |

两个文件各分成五段保存。还原命令校验 SHA-256，保留已有文件。已实测分片还原，并解出 MSI 的程序与免安装版逐字节比对。EXE 文件版本为 6.4.7.0。本次归档没有执行安装或覆盖升级。

[WebView2 分发条款](../../../source/third-party/Microsoft.Web.WebView2-LICENSE.txt) · [其余第三方材料与许可](../../../source/third-party/README.md)
