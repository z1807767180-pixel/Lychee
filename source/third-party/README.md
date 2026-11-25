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
| Windows WPF 所用 Microsoft WebView2 | 随应用携带 x64 WebView2Loader、托管 Core 和 Wpf 组件。构建机所用 Wpf 文件产品版本为 1.0.3967.48。该版允许带条件再分发，二进制分发附版权、条件及免责声明，见 `Microsoft.Web.WebView2-LICENSE.txt`。Microsoft 的 “Files to ship with the app” 明列这三项组件，完整 Evergreen Runtime 由用户设备提供。[该版官方许可](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3967.48/License) · [官方分发说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#files-to-ship-with-the-app) |
