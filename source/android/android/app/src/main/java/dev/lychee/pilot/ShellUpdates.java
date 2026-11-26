package dev.lychee.pilot;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** App-shell releases are independent from the live mobile website. */
final class ShellUpdates {
    static final int INSTALL_SETTINGS=701;
    private static final String REPO="z1807767180-pixel/Lychee";
    private static final String FEED="https://github.com/"+REPO+"/releases/download/android-friends/current.json";
    private static final String CERT="19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2";
    private static final long MAX_APK=128L*1024*1024;
    private final Activity activity;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final PackageInfo installed;
    private boolean manual,checking,downloading;
    private File prepared;
    private Release preparedRelease;
    private AlertDialog dialog;

    ShellUpdates(Activity activity) {
        this.activity=activity;
        try{installed=activity.getPackageManager().getPackageInfo(activity.getPackageName(),0);}
        catch(PackageManager.NameNotFoundException e){throw new IllegalStateException(e);}
    }
    String version(){return installed.versionName.replaceFirst("^V","");}
    @SuppressWarnings("deprecation")
    private static long code(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
    private boolean active(){return !activity.isFinishing()&&!activity.isDestroyed();}
    private void message(String title,String body){
        if(active()) dialog=new AlertDialog.Builder(activity).setTitle(title).setMessage(body).setPositiveButton("知道了",null).show();
    }
    static final class Release {
        final String version,digest,note;
        final int code;
        Release(JSONObject data) throws Exception {
            version=data.getString("version");digest=data.getString("sha256");note=data.getString("note");
            if(!version.matches("(0|[1-9][0-9]?)\\.(0|[1-9][0-9]?)\\.(0|[1-9][0-9]?)")||
               !digest.matches("[0-9a-f]{64}")||note.trim().isEmpty()||note.length()>1000)throw new IOException();
            String[] fields=version.split("\\.");
            code=Integer.parseInt(fields[0])*10000+Integer.parseInt(fields[1])*100+Integer.parseInt(fields[2]);
        }
        String url(){return "https://github.com/"+REPO+"/releases/download/android-friends-v"+version+"/Lychee-Friends-V"+version+".apk";}
    }
    void check(boolean explicit){
        if(!active())return;
        if(downloading){if(explicit)Toast.makeText(activity,"正在下载安卓更新",Toast.LENGTH_SHORT).show();return;}
        if(dialog!=null&&dialog.isShowing())return;
        manual|=explicit;
        if(checking)return;
        checking=true;
        if(explicit)Toast.makeText(activity,"正在检查安卓更新",Toast.LENGTH_SHORT).show();
        worker.execute(()->{
            Release latest=null;
            try{
                ByteArrayOutputStream out=new ByteArrayOutputStream();
                transfer(FEED,false,out,16384);
                latest=new Release(new JSONObject(out.toString("UTF-8")));
            }catch(Exception ignored){}
            final Release release=latest;
            activity.runOnUiThread(()->{
                boolean report=manual;manual=false;checking=false;
                if(!active())return;
                if(release==null){
                    if(report)message("暂时查不到更新","无法连接更新服务或更新资料无效。请检查网络后重试。");
                }else if(release.code<=code(installed)){
                    if(report)message("没有更高版本","当前安卓应用 V"+version()+"。网页内容会在联网打开时更新。");
                }else{
                    dialog=new AlertDialog.Builder(activity).setTitle("可以更新到 V"+release.version)
                        .setMessage(release.note+"\n\n下载后由安卓系统请你确认安装。")
                        .setNegativeButton("稍后",null).setPositiveButton("下载更新",(d,w)->download(release)).show();
                }
            });
        });
    }
    private static void transfer(String address,boolean apk,OutputStream out,long limit) throws Exception {
        URL url=new URL(address);
        for(int attempt=0;attempt<6;attempt++){
            String host=url.getHost();
            boolean allowed="github.com".equals(host)||"release-assets.githubusercontent.com".equals(host)||
                "objects.githubusercontent.com".equals(host);
            if(!allowed||!"https".equals(url.getProtocol())||url.getPort()!=-1||url.getUserInfo()!=null)throw new IOException();
            HttpsURLConnection conn=(HttpsURLConnection)url.openConnection();
            try{
                conn.setInstanceFollowRedirects(false);conn.setUseCaches(false);
                conn.setConnectTimeout(10000);conn.setReadTimeout(apk?30000:10000);
                conn.setRequestProperty("User-Agent","Lychee Android");conn.setRequestProperty("Cache-Control","no-cache");
                int status=conn.getResponseCode();
                if(status==301||status==302||status==303||status==307||status==308){
                    String location=conn.getHeaderField("Location");if(location==null)throw new IOException();
                    url=new URL(url,location);continue;
                }
                if(status!=200||conn.getContentLengthLong()>limit)throw new IOException();
                try(InputStream in=conn.getInputStream()){
                    byte[] buf=new byte[16384];long count=0;int n;
                    while((n=in.read(buf))!=-1){
                        count+=n;if(count>limit||Thread.currentThread().isInterrupted())throw new IOException();
                        out.write(buf,0,n);
                    }
                }
                return;
            }finally{conn.disconnect();}
        }
        throw new IOException();
    }
    private static String hex(byte[] bytes){
        StringBuilder text=new StringBuilder(bytes.length*2);
        for(byte b:bytes)text.append(String.format(Locale.ROOT,"%02x",b&255));
        return text.toString();
    }
    @SuppressWarnings("deprecation")
    private boolean authentic(File apk,Release release) throws Exception {
        PackageManager pm=activity.getPackageManager();
        PackageInfo info=pm.getPackageArchiveInfo(apk.getAbsolutePath(),Build.VERSION.SDK_INT>=28?
            PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES);
        if(info==null||!activity.getPackageName().equals(info.packageName)||code(info)!=release.code||
           code(info)<=code(installed)||!release.version.equals(info.versionName))return false;
        Signature[] signatures=Build.VERSION.SDK_INT>=28?
            (info.signingInfo==null?null:info.signingInfo.getApkContentsSigners()):info.signatures;
        return signatures!=null&&signatures.length==1&&CERT.equals(hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())));
    }
    private void download(Release release){
        if(downloading)return;downloading=true;
        Toast.makeText(activity,"正在下载安卓更新…",Toast.LENGTH_LONG).show();
        worker.execute(()->{
            File candidate=null;
            try{
                File dir=new File(activity.getCacheDir(),"updates");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException();
                candidate=File.createTempFile("Lychee-", ".apk",dir);MessageDigest sha=MessageDigest.getInstance("SHA-256");
                try(OutputStream out=new java.security.DigestOutputStream(new FileOutputStream(candidate),sha)){transfer(release.url(),true,out,MAX_APK);}
                if(!release.digest.equals(hex(sha.digest()))||!authentic(candidate,release))throw new IOException();
                final File verified=candidate;
                activity.runOnUiThread(()->{downloading=false;if(active()){
                    if(prepared!=null)prepared.delete();prepared=verified;preparedRelease=release;install();
                }else verified.delete();});
            }catch(Exception e){
                if(candidate!=null)candidate.delete();
                activity.runOnUiThread(()->{downloading=false;message("未能安装更新","下载中断或安装包未通过验证。现有版本可以继续使用，请稍后重试。");});
            }
        });
    }
    private void install(){
        if(!active()||prepared==null)return;
        try{
            if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){
                dialog=new AlertDialog.Builder(activity).setTitle("允许荔枝发起安装")
                    .setMessage("请在系统设置允许此来源，然后返回。最后仍由你确认安装。")
                    .setNegativeButton("取消",null).setPositiveButton("打开系统设置",(d,w)->{
                        try{activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:"+activity.getPackageName())),INSTALL_SETTINGS);}
                        catch(RuntimeException e){message("无法打开系统设置","可在系统设置中允许荔枝安装应用。");}
                    }).show();return;
            }
            if(!authentic(prepared,preparedRelease))throw new IOException();
            Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".fileprovider",prepared);
            Intent install=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.setClipData(ClipData.newRawUri("荔枝安卓更新",uri));
            activity.startActivity(install);
        }catch(Exception e){message("暂时不能安装","请检查系统安装权限，或从荔枝的正式发布页获取安装包。");}
    }
    void afterPermission(){
        if(prepared==null)return;
        if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){
            message("尚未允许安装","保留当前版本。需要时可以在设置中再次检查更新。");return;
        }
        install();
    }
    void close(){worker.shutdownNow();}
}
