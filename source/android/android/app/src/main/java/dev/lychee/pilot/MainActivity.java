package dev.lychee.pilot;

import android.net.ConnectivityManager;
import android.net.Uri;
import android.content.Intent;
import android.app.AlertDialog;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.regex.Pattern;

public final class MainActivity extends BridgeActivity {
    static final String HOST = "lychee-link-check.onrender.com";
    private static final String ENTRY = "/mobile/";
    private static final String UPDATE = "lychee-android://settings/update";
    private ShellUpdates updates;
    private AlertDialog offline;
    private static boolean entry(Uri uri) {
        return trusted(uri) && (ENTRY.equals(uri.getEncodedPath()) || "/mobile/index.html".equals(uri.getEncodedPath()));
    }
    private static final Pattern SCOPED = Pattern.compile("/g/(?:legacy|[a-f0-9-]{36})/api/(?:for/[a-f0-9-]{36}/)?(?:camp|phone(?:/circles)?)");
    private static boolean trusted(Uri url) {
        return "https".equals(url.getScheme()) && HOST.equals(url.getEncodedAuthority());
    }
    private static WebResourceResponse denied() {
        return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",null,new ByteArrayInputStream(new byte[0]));
    }
    @Override public void onCreate(Bundle state) {
        registerPlugin(LycheeAlerts.class);
        MessageAlerts.captureClick(this, getIntent());
        updates = new ShellUpdates(this);
        super.onCreate(state);
        if (state == null) updates.check(false);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (MessageAlerts.captureClick(this, intent) && bridge != null) {
            bridge.getWebView().evaluateJavascript("window.dispatchEvent(new Event('lychee:android-open'))", null);
        }
    }
    @Override protected void load() {
        super.load();
        final WebView view = bridge.getWebView();
        CookieManager.getInstance().setAcceptThirdPartyCookies(view,false);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (UPDATE.equals(uri.toString())) {
                    if (request.isForMainFrame() && request.hasGesture() && web.getUrl()!=null && entry(Uri.parse(web.getUrl()))) updates.check(true);
                    return true;
                }
                return !entry(uri);
            }
            private void installUpdateLinks(WebView web, String url) {
                if (!entry(Uri.parse(url))) return;
                web.evaluateJavascript("(()=>{if(window.lycheeShellSettings)return;window.lycheeShellSettings=true;"
                    +"Object.defineProperty(window,'lycheeAndroidShellVersion',{value:"+org.json.JSONObject.quote(updates.version())+"});"
                    +"function link(id,label){const a=document.createElement('a');a.id=id;a.href='"+UPDATE+"';a.textContent=label;return a}"
                    +"function install(){const v=document.querySelector('.settings-version');if(v&&!document.getElementById('lychee-shell-update')){"
                    +"const a=link('lychee-shell-update','检查安卓更新 · '+ "+org.json.JSONObject.quote(updates.versionLabel())+");a.className='entry';v.before(a)}"
                    +"const retry=document.querySelector('#lychee-launch button');if(!retry)return;"
                    +"let a=document.getElementById('lychee-launch-update');if(!a&&!retry.hidden){a=link('lychee-launch-update','检查安卓更新');"
                    +"a.style.cssText='display:block;padding:12px;color:inherit;text-decoration:underline';retry.after(a)}"
                    +"if(a)a.style.display=retry.hidden?'none':'block'}"
                    +"new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});install()})()",null);
            }
            @Override public void onPageCommitVisible(WebView web, String url) {
                super.onPageCommitVisible(web,url);
                installUpdateLinks(web,url);
            }
            @Override public void onPageFinished(WebView web, String url) {
                super.onPageFinished(web,url);
                installUpdateLinks(web,url);
            }
            @Override public void onReceivedError(WebView web,WebResourceRequest request,WebResourceError error) {
                super.onReceivedError(web,request,error);
                if(request.isForMainFrame() && entry(request.getUrl())) connectionError(web);
            }
            @Override public void onReceivedHttpError(WebView web,WebResourceRequest request,WebResourceResponse response) {
                super.onReceivedHttpError(web,request,response);
                if(request.isForMainFrame() && entry(request.getUrl()) && response.getStatusCode()>=400) connectionError(web);
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
                    boolean post = "POST".equals(method);
                    if (post && "/api/v640/account".equals(path)) MessageAlerts.reset(MainActivity.this);
                    boolean scopedTool = "/api/v7/diet/entries".equals(path) || "/api/v7/push".equals(path)
                        || "/api/v7/quiz".equals(path) || "/api/v8/social".equals(path);
                    if ((capability && get) || ("/api/v7/diet/recognize".equals(path) && post)
                        || ((scopedTool || account || SCOPED.matcher(path).matches()) && (get || post)))
                        return null; // Ordinary WebView HTTPS, with its own cookie jar, Origin and TLS checks.
                }
                if (!get || !path.startsWith("/mobile/") || (request.isForMainFrame() && !entry(uri))) return denied();
                // Capacitor injects its native bridge into the hosted HTML on older compatible WebViews.
                return request.isForMainFrame() ? super.shouldInterceptRequest(web,request) : null;
            }
        });
        // A cached launch page can render offline without a main-frame network error.
        view.post(() -> { if (hasNoNetwork()) connectionError(view); });
    }
    private boolean hasNoNetwork() {
        ConnectivityManager network = getSystemService(ConnectivityManager.class);
        return network != null && network.getActiveNetwork() == null;
    }
    private void connectionError(WebView web) {
        if (isFinishing() || isDestroyed() || (offline!=null && offline.isShowing())) return;
        offline=new AlertDialog.Builder(this).setTitle("暂时打不开荔枝")
            .setMessage("请检查网络后重试。你的账号和园子仍会保留。")
            .setPositiveButton("重试",(d,w)->web.post(()->{
                if (hasNoNetwork()) connectionError(web); else web.loadUrl("https://"+HOST+ENTRY);
            }))
            .setNeutralButton("检查安卓更新",(d,w)->updates.check(true))
            .setNegativeButton("关闭",(d,w)->finish()).show();
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (request==ShellUpdates.INSTALL_SETTINGS) updates.afterPermission();
    }
    @Override public void onDestroy() {
        if(updates!=null)updates.close();
        super.onDestroy();
    }
}
