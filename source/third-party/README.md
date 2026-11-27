# 第三方材料

下表标出当前工程实际携带的第三方材料。上游作者和贡献者的署名保留在旁边的原文、字体包或题库记录中。荔枝项目自身的发布许可由其权利人决定，各第三方许可分别适用。

| 位置或组件 | 许可、归属与取件来源 |
| --- | --- |
| 手机渲染包中的 React 19.2.6、React DOM、Scheduler | Meta Platforms 及贡献者，MIT。见 `react.txt`。[React](https://github.com/react/react/blob/v19.2.6/LICENSE) |
| Lucide React 1.31.0 图标 | ISC，部分图标起源于 Feather，详见上游完整 `lucide.txt`。[Lucide](https://github.com/lucide-icons/lucide/blob/1.31.0/LICENSE) |
| 原服务合并的 @libsql/client、@libsql/core、@libsql/hrana-client、js-base64、ws、promise-limit | 见 `libsql-client.txt`、`hrana.txt`、`js-base64.txt`、`ws.txt`、`promise-limit.txt`。原发布文件内的依赖边界和署名均保留。[libSQL](https://github.com/tursodatabase/libsql-client-ts) · [Hrana](https://github.com/libsql/hrana-client-ts) · [js-base64](https://github.com/dankogai/js-base64) · [ws](https://github.com/websockets/ws) · [promise-limit](https://github.com/featurist/promise-limit) |
| LXGW 975 Yuan SC 字体 | SIL Open Font License 1.1，附带作者对 web 字体格式转换的许可。五百字重与七百字重 WOFF2 供 App 网页排版。完整上游作者、保留名称和条款在 `client/fonts/OFL.txt`。[字体工程](https://github.com/lxgw/975Yuan) |
| Capacitor Android 8.6.1 模板 | MIT，见 `android/CAPACITOR-LICENSE.txt`。npm、Maven 依赖由构建工具从对应仓库安装。[Capacitor](https://github.com/ionic-team/capacitor/tree/8.6.1) |
| Gradle 8.14.3 Wrapper | 保留脚本原始声明及 `gradle.txt`，构建发行 ZIP 的摘要在 `gradle-wrapper.properties`。[Gradle](https://github.com/gradle/gradle/blob/v8.14.3/LICENSE) |
| 海龟汤改编题目 | 47 条题目保留各自作者、来源链接、上游条款和翻译改编说明。原文记录见 `legacy/camp.mjs`，便于查看的索引见 `soup-attributions.json`。这些改编条目标明 CC BY-SA 4.0。[许可全文](https://creativecommons.org/licenses/by-sa/4.0/legalcode) |
| 圈子新增海龟汤 | [增补题库](../server/circle-puzzles.json)的每题 `source` 记录作者、来源及许可。5 题根据 Puzzling Stack Exchange 的原题及解答改编，三档提示与中文情境为荔枝重写；得分是选题时原帖净票数。站台故事根据伦敦交通局年报中的史实独立编写，其余原创文字在题内标注。[原帖许可规则](https://stackoverflow.com/help/licensing) · [改编许可 CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| 2026-11 新选海龟汤 100 道 | 44 道选自[小乌龟侦探社](https://ltda.wikidot.com/soup-series)，每题保留作者及原作页面，节编按 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 共享。56 道选自 [TURTLE SOUP 中文调查题库](https://github.com/wangyufanshuai/turtle-soup/tree/2a5d14ad509946a312069910e97627b1625a206c/content/zh/cases)，版权与 MIT 许可见[原文](turtle-soup-MIT.txt)。逐题跳转见增补题库的 `source.url`，荔枝整理了还原要点和三档提示。 |
| 2026-11 新选脑筋急转弯 100 道 | 93 道选自 [ShakaRover/ChineseDatasets 的固定版本](https://huggingface.co/datasets/ShakaRover/ChineseDatasets/tree/5090c4f0fc9f2fab0e2de7d9d229f034b0524923) 的 brainteasers/train，逐题记录题行，数据卡标注 [Apache 2.0](apache-2.0.txt)。7 道取自中文维基百科的[智力题](https://zh.wikipedia.org/w/index.php?oldid=94514237)、[冷笑话](https://zh.wikipedia.org/w/index.php?oldid=93953847)、[笑话](https://zh.wikipedia.org/w/index.php?oldid=93924519)示例，按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 改编。选择项与答案解析由荔枝整理。 |
| Windows WPF 所用 Microsoft WebView2 | 随应用携带 x64 WebView2Loader、托管 Core 和 Wpf 组件。构建机所用 Wpf 文件产品版本为 1.0.3967.48。该版允许带条件再分发，二进制分发附版权、条件及免责声明，见 `Microsoft.Web.WebView2-LICENSE.txt`。Microsoft 的 “Files to ship with the app” 明列这三项组件，完整 Evergreen Runtime 由用户设备提供。[该版官方许可](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3967.48/License) · [官方分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#files-to-ship-with-the-app) |
