# 测试入口

先在工程根目录执行 `python build.py`，默认网页目录 `public/` 需存在。

```powershell
node --test test/accounts.test.mjs test/domains.test.mjs test/gateway.test.mjs
node --test test/ai-quota.test.mjs test/image-publication.test.mjs test/provider.test.mjs
node --test test/turso-accounts.test.mjs test/turso-domains.test.mjs test/turso-legacy.test.mjs
node --test static-host/proxy.test.mjs
```

SQLite 和原 libSQL SDK 可通过本机回环协议夹具验证。测试账号、供应商应答和数据库在本次测试中创建。测试代码中的微型 JPEG 来自测试夹具。Pillow 用于生成大尺寸图像。

Windows 上的浏览器和 WPF 验收需另有 Edge、WebView2 和对应构建成品。真实宿主可执行 `node desktop/verify-client.mjs dist/win --isolated-host`。Windows 窗框的隔离桌面测试程序为 `resize-hwnd.py` 和 `resize-window.mjs`。普通网页验收脚本会在本机启动自己的浏览器实例。

旧正式监听器的分片共存验收需要维护者持有源交接归档及生成的私有分片。公开目录保留相应测试程序，不提供分片、线上环境文件或真实账号。正式 AI 与生产验收工具默认关闭，使用时遵循 `../server/OPERATIONS.md` 的授权、额度和隔离要求。
