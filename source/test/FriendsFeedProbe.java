import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Checks when a reconnected emulator can actually fetch the public update feed. */
public final class FriendsFeedProbe {
    public static void main(String[] args) throws Exception {
        boolean landingPage = "landing".equals(args[0]);
        URL url = new URL(landingPage ? "https://lychee-link-check.onrender.com/mobile/" :
            "https://github.com/z1807767180-pixel/Lychee/releases/download/android-friends/current.json");
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
        conn.setConnectTimeout(6000);
        conn.setReadTimeout(12000);
        conn.setUseCaches(false);
        conn.setRequestProperty("User-Agent", "Lychee Android");
        try {
            int status = conn.getResponseCode();
            if (status != 200) throw new IllegalStateException("Feed returned HTTP " + status);
            if (!landingPage) {
                try (java.util.Scanner body = new java.util.Scanner(conn.getInputStream(), "UTF-8")) {
                    JSONObject feed = new JSONObject(body.useDelimiter("\\A").next());
                    if (!args[0].equals(feed.getString("version"))) throw new IllegalStateException("Unexpected version");
                }
            }
            System.out.println("Device reached " + conn.getURL().getHost() + " for " + args[0]);
        } catch (Exception e) {
            System.err.println("Device HTTPS failed at " + conn.getURL().getHost() + " with " + e.getClass().getSimpleName());
            if (e.getCause() != null) System.err.println("Cause: " + e.getCause().getClass().getSimpleName());
            System.exit(1);
        } finally {
            conn.disconnect();
        }
    }
}
