import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Looper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Device-side tests in a disposable app_process. The production ShellUpdates class comes from CLASSPATH. */
public final class AndroidUpdatePolicyProbe {
    private static final String ORIGIN="https://lychee-link-check.onrender.com/android-update/";
    private static final String GH="https://github.com/z1807767180-pixel/Lychee/releases/download/";
    private static final String CDN="https://release-assets.githubusercontent.com/github-production-release-asset/1471636015/01234567-89ab-cdef-0123-0123456789ab";
    private static final ArrayDeque<Reply> pending=new ArrayDeque<>();
    private static final JSONObject passed=new JSONObject();
    private static Class<?> shell;
    private static Class<?> release;
    private static byte[] manifest;

    private static void require(boolean condition,String reason) {
        if(!condition)throw new AssertionError(reason);
    }
    private static final class Reply {
        final String address;
        final int status;
        final byte[] body;
        long declared;
        String location, encoding;
        boolean interruptBody, timeout, cold;
        Reply(String address,int status,byte[] body) {
            this.address=address;this.status=status;this.body=body;declared=body.length;
            pending.add(this);
        }
    }
    private static Reply response(String address,int status,byte[] body){return new Reply(address,status,body);}
    private static final class Connection extends HttpsURLConnection {
        final Reply reply;
        Connection(URL url,Reply reply){super(url);this.reply=reply;}
        public int getResponseCode() throws IOException {
            require(!getInstanceFollowRedirects()&&!getUseCaches(),"redirects/cache must be controlled by the app");
            require("identity".equals(getRequestProperty("Accept-Encoding")),"unexpected encoding");
            require(getConnectTimeout()>0 && getReadTimeout()>0,"missing network deadlines");
            if(reply.cold)require(getReadTimeout()>30000,"expected longer cold-start window");
            if(reply.timeout)throw new SocketTimeoutException("fixture timeout before headers");
            return reply.status;
        }
        public String getHeaderField(String name){return "Location".equalsIgnoreCase(name)?reply.location:null;}
        public long getContentLengthLong(){return reply.declared;}
        public String getContentEncoding(){return reply.encoding;}
        public InputStream getInputStream(){
            final ByteArrayInputStream body=new ByteArrayInputStream(reply.body);
            return new InputStream(){
                public int read()throws IOException{byte[] one=new byte[1];return read(one,0,1)<0?-1:one[0]&255;}
                public int read(byte[] b,int off,int len)throws IOException{
                    if(body.available()==0&&reply.interruptBody)throw new SocketTimeoutException("fixture body read");
                    return body.read(b,off,len);
                }
            };
        }
        public void disconnect(){}
        public void connect(){}
        public boolean usingProxy(){return false;}
        public String getCipherSuite(){return "fixture";}
        public Certificate[] getLocalCertificates(){return null;}
        public Certificate[] getServerCertificates(){return null;}
    }
    private static void registerFixture(){
        URL.setURLStreamHandlerFactory(protocol->!"https".equals(protocol)?null:new URLStreamHandler(){
            protected URLConnection openConnection(URL url){
                Reply next=pending.poll();
                require(next!=null && next.address.equals(url.toExternalForm()),"unexpected network request "+url);
                return new Connection(url,next);
            }
        });
    }
    private static Method method(String name,Class<?>... args)throws Exception {
        Method result=shell.getDeclaredMethod(name,args);result.setAccessible(true);return result;
    }
    private static Object invoke(Method method,Object target,Object... args)throws Exception{
        try{return method.invoke(target,args);}
        catch(InvocationTargetException wrapped){
            Throwable cause=wrapped.getCause();
            if(cause instanceof Exception)throw (Exception)cause;
            if(cause instanceof Error)throw (Error)cause;
            throw wrapped;
        }
    }
    private static void done(String label)throws Exception {
        require(pending.isEmpty(),"fixture source was not requested: "+label);
        passed.put(label,true);
    }
    private static void reject(Method m,Object... args)throws Exception{
        try{invoke(m,null,args);}
        catch(IOException|org.json.JSONException expected){return;}
        throw new AssertionError("Expected update rejection");
    }
    private static Object transferCases(String version)throws Exception{
        String current=ORIGIN+"current.json",backup=GH+"android-friends/current.json";
        Method read=method("readRelease");
        response(current,200,manifest);
        Object offered=invoke(read,null);
        done("officialManifestOnly");
        response(current,0,new byte[0]).timeout=true;
        response(backup,302,new byte[0]).location=CDN;
        response(CDN,200,manifest);
        invoke(read,null);done("unavailableOriginUsesApprovedGithubCdn");
        response(current,503,new byte[0]);
        response(backup,503,new byte[0]);
        response(current,200,manifest).cold=true;
        invoke(read,null);done("coldOriginRetriedAfterGithubUnavailable");
        response(current,302,new byte[0]).location=current;
        reject(read);done("originRedirectRejected");
        response(current,200,"{bad".getBytes(StandardCharsets.UTF_8));
        reject(read);done("malformedManifestStopsAtOrigin");
        response(current,200,manifest).encoding="gzip";
        reject(read);done("unexpectedEncodingRejected");
        response(current,200,manifest).declared=16385;
        reject(read);done("oversizedManifestRejected");
        response(current,503,new byte[0]);
        response(backup,302,new byte[0]).location="https://example.invalid/not-an-asset";
        reject(read);done("untrustedFallbackRedirectRejected");
        String path="android-friends-v"+version+"/Lychee-Friends-V"+version+".apk";
        Method transfer=method("fromSources",String.class,boolean.class,OutputStream.class,long.class);
        byte[] complete={1,2,3,4};
        for(boolean emptyTimeout:new boolean[]{false,true}){
            response(ORIGIN+path,200,new byte[0]).interruptBody=emptyTimeout;
            response(GH+path,200,complete);
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            invoke(transfer,null,path,true,out,4L);
            require(Arrays.equals(out.toByteArray(),complete),"partial data mixed across sources");
        }
        done("zeroByteEofAndTimeoutRetryCleanly");
        byte[] part={1,2};
        for(boolean interrupted:new boolean[]{false,true}){
            Reply partial=response(ORIGIN+path,200,part);partial.declared=4;partial.interruptBody=interrupted;
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            reject(transfer,path,true,out,4L);
            require(Arrays.equals(out.toByteArray(),part),"unexpected partial bytes");
        }
        done("partialEofAndPartialTimeoutDoNotSwitchSource");
        response(ORIGIN+path,206,part);
        reject(transfer,path,true,new ByteArrayOutputStream(),4L);done("partialHttpStatusRejected");
        return offered;
    }
    private static class ProbeActivity extends Activity {
        final PackageManager manager;
        String packageName="com.android.shell";
        ProbeActivity(PackageManager manager){this.manager=manager;}
        @Override public PackageManager getPackageManager(){return manager;}
        @Override public String getPackageName(){return packageName;}
    }
    private static void packageCases(File official,Object offered,String version,File wrongSigner)throws Exception {
        Method digest=method("digestMatches",File.class,release);
        require((Boolean)invoke(digest,null,official,offered),"official digest rejected");
        JSONObject bad=new JSONObject(new String(manifest,StandardCharsets.UTF_8));
        bad.put("sha256",new String(new char[64]).replace('\0','0'));
        Constructor<?> ctor=release.getDeclaredConstructor(JSONObject.class);ctor.setAccessible(true);
        require(!(Boolean)invoke(digest,null,official,ctor.newInstance(bad)),"bad digest accepted");
        done("correctAndIncorrectFullApkDigest");
        Looper.prepareMainLooper();
        Class<?> threadClass=Class.forName("android.app.ActivityThread");
        Object system=threadClass.getMethod("systemMain").invoke(null);
        Context context=(Context)threadClass.getMethod("getSystemContext").invoke(system);
        PackageManager pm=context.getPackageManager();
        ProbeActivity activity=new ProbeActivity(pm);
        Constructor<?> shellCtor=shell.getDeclaredConstructor(Activity.class);shellCtor.setAccessible(true);
        Object instance=shellCtor.newInstance(activity);
        // This local PackageInfo models an earlier friends installation without changing guest registration.
        Field installed=shell.getDeclaredField("installed");installed.setAccessible(true);
        PackageInfo current=(PackageInfo)installed.get(instance);
        PackageInfo target=pm.getPackageArchiveInfo(official.getPath(),PackageManager.GET_SIGNING_CERTIFICATES);
        require(target!=null && version.equals(target.versionName),"bad Android test input");
        activity.packageName="dev.lychee.friends";
        current.setLongVersionCode(target.getLongVersionCode()-1);
        Method authentic=method("authentic",File.class,release);
        require((Boolean)invoke(authentic,instance,official,offered),"authentic signed target rejected");
        current.setLongVersionCode(target.getLongVersionCode());
        require(!(Boolean)invoke(authentic,instance,official,offered),"current APK would be reinstalled");
        current.setLongVersionCode(target.getLongVersionCode()-1);
        activity.packageName="wrong.app.for.test";
        require(!(Boolean)invoke(authentic,instance,official,offered),"wrong application accepted");
        activity.packageName="dev.lychee.friends";
        done("validFriendsArchiveAndWrongPackageOrVersion");
        Method trusted=method("trusted",Signature[].class);
        Signature[] platform=pm.getPackageInfo("com.android.shell",PackageManager.GET_SIGNING_CERTIFICATES).signingInfo.getApkContentsSigners();
        require(!(Boolean)invoke(trusted,null,(Object)platform),"unrelated Android certificate trusted");
        done("actualSystemCertificateRejected");
        if(wrongSigner!=null){
            PackageInfo wrong=pm.getPackageArchiveInfo(wrongSigner.getPath(),PackageManager.GET_SIGNING_CERTIFICATES);
            require(wrong!=null&&wrong.packageName.equals(target.packageName)&&wrong.versionName.equals(version)&&
                    wrong.getLongVersionCode()==target.getLongVersionCode(),"wrong-signer control must have the same package and version");
            require(!(Boolean)invoke(trusted,null,(Object)wrong.signingInfo.getApkContentsSigners()),"invalid control signer");
            require(!(Boolean)invoke(authentic,instance,wrongSigner,offered),"wrong-signer APK accepted");
            done("samePackageAndVersionDifferentSignerRejected");
        }
    }
    public static void main(String[] args)throws Exception{
        require(args.length==3||args.length==4,"Pass APK, version, pinned digest, and optionally an otherwise-matching wrong-signer APK.");
        File official=new File(args[0]);
        String version=args[1],expected=args[2];
        byte[] actual=MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(official.toPath()));
        StringBuilder hex=new StringBuilder();
        for(byte b:actual)hex.append(String.format(Locale.ROOT,"%02x",b&255));
        require(expected.equals(hex.toString()),"unexpected signed APK");
        shell=Class.forName("dev.lychee.pilot.ShellUpdates");
        release=Class.forName("dev.lychee.pilot.ShellUpdates$Release");
        manifest=new JSONObject().put("version",version).put("sha256",expected).put("note","test").toString().getBytes(StandardCharsets.UTF_8);
        registerFixture();
        Object offered=transferCases(version);
        packageCases(official,offered,version,args.length==4?new File(args[3]):null);
        System.out.println(new JSONObject().put("apkVersion",version).put("sha256",expected).put("passedCases",passed).put("passed",true));
    }
}
