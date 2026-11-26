package dev.lychee.pilot;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/** System-scheduled catch-up for times when WebView JavaScript is suspended. */
public final class MessagePollJob extends JobService {
    private volatile Thread worker;

    @Override public boolean onStartJob(JobParameters params) {
        final String owner = MessageAlerts.owner(this);
        if (!MessageAlerts.enabled(this, owner)) return false;
        String[] parts = owner.split("/");
        final String url = "https://" + MainActivity.HOST + "/g/" + parts[1] + "/api/for/" + parts[0] + "/phone?v61=notifications";
        final String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie == null || cookie.isEmpty()) {
            MessageAlerts.resetIfOwner(this, owner);
            return false;
        }
        worker = new Thread(() -> {
            Thread thisRun = Thread.currentThread();
            try {
                poll(thisRun, owner, url, cookie);
            } catch (IOException | org.json.JSONException ignored) {
                // A transient offline or malformed response leaves unseen items eligible next time.
            } finally {
                new android.os.Handler(getMainLooper()).post(() -> {
                    if (worker == thisRun) {
                        worker = null;
                        jobFinished(params, false);
                    }
                });
            }
        }, "lychee-message-catch-up");
        worker.start();
        return true;
    }

    private void poll(Thread thisRun, String owner, String url, String cookie) throws IOException, org.json.JSONException {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
        try {
            if (worker != thisRun) return;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(9000);
            connection.setReadTimeout(9000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            int status = connection.getResponseCode();
            if (worker != thisRun) return;
            if (status == 401 || status == 403) {
                MessageAlerts.resetIfOwner(this, owner);
                return;
            }
            if (status != 200) return;
            try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int n; (n = stream.read(buffer)) >= 0;) {
                    if (worker != thisRun || bytes.size() + n > 1024 * 1024) return;
                    bytes.write(buffer, 0, n);
                }
                JSONArray rows = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name())).getJSONArray("notifications");
                for (int i=rows.length()-1; i>=0 && worker == thisRun; i--) {
                    JSONObject row = rows.optJSONObject(i);
                    if (row != null && !row.optBoolean("read", true)) {
                        MessageAlerts.deliver(this, owner, row.optString("id"), row.optLong("created"));
                    }
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    @Override public boolean onStopJob(JobParameters params) {
        Thread prior = worker;
        worker = null;
        if (prior != null) prior.interrupt();
        // Socket reads have bounded timeouts. Keep the system callback off the network path.
        return false;
    }
}
