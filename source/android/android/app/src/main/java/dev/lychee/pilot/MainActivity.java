package dev.lychee.pilot;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.regex.Pattern;

public final class MainActivity extends BridgeActivity {
    private static final String HOST = "lychee-link-check.onrender.com";
    private static final String ENTRY = "/mobile/index.html";
    private static final Pattern SCOPED = Pattern.compile("/g/(?:legacy|[a-f0-9-]{36})/api/(?:for/[a-f0-9-]{36}/)?(?:camp|phone(?:/circles)?)");
    private static boolean trusted(Uri url) {
        return "https".equals(url.getScheme()) && HOST.equals(url.getEncodedAuthority());
    }
    private static WebResourceResponse denied() {
        return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",null,new ByteArrayInputStream(new byte[0]));
    }
    @Override protected void load() {
        super.load();
        final WebView view = bridge.getWebView();
        CookieManager.getInstance().setAcceptThirdPartyCookies(view,false);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !trusted(uri) || !ENTRY.equals(uri.getEncodedPath()) || super.shouldOverrideUrlLoading(web,request);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame() && "GET".equals(request.getMethod())) {
                    String scheme = uri.getScheme();
                    if ("data".equals(scheme)) {
                        String source=uri.toString();
                        if (source.startsWith("data:image/jpeg;base64,") || source.startsWith("data:image/png;base64,")
                            || source.startsWith("data:image/webp;base64,") || source.startsWith("data:image/gif;base64,"))
                            return null;
                    }
                    if ("blob".equals(scheme) && uri.toString().startsWith("blob:https://"+HOST+"/")) return null;
                }
                if (!trusted(uri)) return denied();
                String path = uri.getEncodedPath(), method = request.getMethod();
                if (path == null) return denied();
                boolean get = "GET".equals(method);
                if (!request.isForMainFrame()) {
                    boolean capability = "/api/client-capabilities".equals(path) && "accountApi=v640".equals(uri.getEncodedQuery());
                    boolean account = "/api/v640/account".equals(path) || "/api/v640/workspace".equals(path);
                    if ((capability && get) || ((account || SCOPED.matcher(path).matches()) && (get || "POST".equals(method))))
                        return null; // Ordinary WebView HTTPS, with its own cookie jar, Origin and TLS checks.
                }
                if (!get || path.startsWith("/api/") || path.startsWith("/g/") || path.startsWith("/_capacitor")
                    || (request.isForMainFrame() && !"/".equals(path) && !ENTRY.equals(path))) return denied();
                return super.shouldInterceptRequest(web,request); // Capacitor serves the bundled release assets.
            }
        });
        // Capacitor's initial root is an inert bundled document. Load the real page only after the API route is installed.
        view.loadUrl("https://"+HOST+ENTRY);
    }
}
