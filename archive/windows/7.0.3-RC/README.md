# Windows W7.0.3 候选备份

这里保存项目负责人电脑上的 W7.0.3 候选原件，供换电脑和继续开发时复核。Windows 正式发布状态见[项目交接](../../../docs/项目交接.md)。

[候选 ZIP](Lychee-Windows-7.0.3-RC.zip) 包含 MSI 和安装说明。需要同时取回免安装 EXE 时，在 Windows 的仓库根目录用 Python 3.10 或以上运行下面的命令，将最后一项换成自己的输出目录。

```powershell
python archive/windows/7.0.3-RC/restore.py "$env:TEMP/Lychee-W7.0.3-RC"
```

脚本从 MSI 取出内置 EXE，按[候选清单](candidate.json)核对两份文件的大小与 SHA-256。已有的同名文件内容不一致时会停止。W7.0.3 本身保留在历史候选目录。2026-11-27 使用此处还原的原 EXE 在 Windows .NET Framework 上调用生产更新方法，发布前读到官方 W7.0.5，发布后复测读到 W7.0.6。两版的 EXE 和 MSI 均经原更新器下载，摘要和内部版本匹配。故障朋友设备的网络和安装情况需现场确认。
