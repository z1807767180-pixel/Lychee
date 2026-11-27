# 手机网页发布

每次向朋友发布看得到的功能或体验变化，在 [releases.json](releases.json) 顶部加一条更高的版本。写日期、标题和这次改动的短句。保留已经发布的条目及顺序，同一版的变化合写一条。原样重部署已有版本可沿用原公告。

在待发代码检出目录运行 `python source/mobile-web/build.py --check-release 上次线上提交`，把最后一项替换为实际 Git 提交号。检查会拒绝重复版本、空公告以及删改过往记录。然后运行 `python source/mobile-web/build.py 新建输出目录/www` 构建。设置页版本、启动公告、历史列表和资源版本均由同一条发布记录生成。

首次打开新版时只弹本版未读公告。已读由服务端按账号及公告 ID 保存。「我 → 设置 → 账号公告」可以重新查看。验收只需隔离账号核对首见、已读后重开和历史，再在原网址核对公开版本和公告资源。

从 V8 起，构建会用 Node.js、npm 和 `compat/package-lock.json` 将脚本编译为兼容旧 Android WebView 的版本。新环境首次构建需能获取锁定的公开 npm 依赖；缓存可复用。共享客户端文件摘要用仓库根目录 `python tools/check_handoff.py` 核对。
