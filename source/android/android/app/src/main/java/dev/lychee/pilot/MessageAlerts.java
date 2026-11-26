package dev.lychee.pilot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import java.util.UUID;
import java.util.regex.Pattern;

/** Activity delivery and the scheduled worker share an account-bound delivery ledger. */
final class MessageAlerts {
    private static final String CHANNEL = "garden_messages";
    private static final int JOB = 7001;
    private static final String UUID_RE = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    private static final Pattern OWNER = Pattern.compile(UUID_RE + "/(?:legacy|" + UUID_RE + ")");
    private static final String OPEN = "dev.lychee.friends.OPEN_GARDEN_NOTICE";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("garden_alerts", Context.MODE_PRIVATE); }
    static boolean valid(String owner) { return owner != null && OWNER.matcher(owner).matches(); }
    static String owner(Context c) { return prefs(c).getString("owner", ""); }
    static synchronized void reset(Context c) {
        c.getSystemService(JobScheduler.class).cancel(JOB);
        c.getSystemService(NotificationManager.class).cancelAll();
        prefs(c).edit().clear().apply();
    }
    static synchronized void resetIfOwner(Context c, String owner) {
        if (owner.equals(owner(c))) reset(c);
    }
    static synchronized void bind(Context c, String owner) {
        if (!valid(owner)) return;
        String prior = owner(c);
        if (!owner.equals(prior)) {
            boolean retain = valid(prior) && prior.split("/")[0].equals(owner.split("/")[0])
                && prefs(c).getBoolean("enabled", false);
            reset(c);
            prefs(c).edit().putString("owner", owner).apply();
            if (retain && allowed(c)) enable(c, owner);
        } else if (enabled(c, owner) && c.getSystemService(JobScheduler.class).getPendingJob(JOB) == null) {
            schedule(c);
        }
    }
    static boolean allowed(Context c) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
            return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
        }
        return true;
    }
    static synchronized boolean enabled(Context c, String owner) {
        return valid(owner) && owner.equals(owner(c)) && prefs(c).getBoolean("enabled", false) && allowed(c);
    }
    private static boolean schedule(Context c) {
        JobInfo job = new JobInfo.Builder(JOB, new ComponentName(c, MessagePollJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15L * 60 * 1000).build();
        return c.getSystemService(JobScheduler.class).schedule(job) == JobScheduler.RESULT_SUCCESS;
    }
    static synchronized boolean enable(Context c, String owner) {
        if (!valid(owner) || !owner.equals(owner(c)) || !allowed(c)) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "园中消息", NotificationManager.IMPORTANCE_HIGH);
            c.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        if (!schedule(c)) return false;
        if (!prefs(c).getBoolean("enabled", false)) {
            prefs(c).edit().putBoolean("enabled", true).putLong("since", System.currentTimeMillis())
                .putString("nonce", UUID.randomUUID().toString()).apply();
        }
        return true;
    }
    static synchronized void disable(Context c, String owner) {
        if (!valid(owner) || !owner.equals(owner(c))) return;
        reset(c);
        prefs(c).edit().putString("owner", owner).apply();
    }
    static synchronized void deliver(Context c, String owner, String id, long created) {
        if (!enabled(c, owner) || id == null || id.isEmpty() || id.length() > 256
            || created < prefs(c).getLong("since", Long.MAX_VALUE)) return;
        String receipt = "delivered:" + id;
        if (prefs(c).contains(receipt)) return;
        // No message bodies are written to preferences, intents or the lock screen.
        Uri data = new Uri.Builder().scheme("lychee-notice").authority("open").appendPath(id).build();
        Intent intent = new Intent(c, MainActivity.class).setAction(OPEN).setData(data)
            .putExtra("nonce", prefs(c).getString("nonce", "")).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder note = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        note.setSmallIcon(R.drawable.notice_icon).setContentTitle("荔枝园").setContentText("你有一条新消息")
            .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(tap)
            .setOnlyAlertOnce(true).setWhen(created).setShowWhen(true);
        if (Build.VERSION.SDK_INT < 26) note.setDefaults(Notification.DEFAULT_ALL).setPriority(Notification.PRIORITY_HIGH);
        try { c.getSystemService(NotificationManager.class).notify(id, 1, note.build()); }
        catch (SecurityException denied) { return; }
        prefs(c).edit().putBoolean(receipt, true).apply();
    }
    static synchronized boolean captureClick(Context c, Intent intent) {
        if (intent == null || !OPEN.equals(intent.getAction()) || intent.getData() == null) return false;
        String nonce = prefs(c).getString("nonce", "");
        if (nonce.isEmpty() || !nonce.equals(intent.getStringExtra("nonce"))) return false;
        String id = intent.getData().getLastPathSegment();
        if (id == null || id.isEmpty() || id.length() > 256) return false;
        prefs(c).edit().putString("open", id).apply();
        intent.setAction(null);
        return true;
    }
    static synchronized String takeOpen(Context c, String owner) {
        if (!valid(owner) || !owner.equals(owner(c))) return null;
        String id = prefs(c).getString("open", null);
        prefs(c).edit().remove("open").apply();
        return id;
    }
}
