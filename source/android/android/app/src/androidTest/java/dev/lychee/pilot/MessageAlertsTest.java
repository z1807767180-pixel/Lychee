package dev.lychee.pilot;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.accessibility.AccessibilityNodeInfo;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class MessageAlertsTest {
    private static final String FIRST = "bfae5ad3-31b0-464d-b28d-a23eed7980ea/legacy";
    private static final String OTHER = "81dd3411-0c54-4d5d-8cca-b53fb53c8bf9/legacy";

    @Test public void scopedDeliverySchedulingAndTapOnCleanTestDevice() throws Exception {
        android.app.Instrumentation harness = InstrumentationRegistry.getInstrumentation();
        Context c = harness.getTargetContext();
        if (Build.VERSION.SDK_INT >= 33) {
            harness.getUiAutomation().grantRuntimePermission(c.getPackageName(), android.Manifest.permission.POST_NOTIFICATIONS);
        }
        MessageAlerts.reset(c);
        try {
            MessageAlerts.bind(c, FIRST);
            assertFalse(MessageAlerts.enabled(c, FIRST));
            assertTrue(MessageAlerts.enable(c, FIRST));
            JobInfo job = c.getSystemService(JobScheduler.class).getPendingJob(7001);
            assertNotNull(job);
            assertEquals(MessagePollJob.class.getName(), job.getService().getClassName());
            assertTrue(job.isPeriodic());
            assertTrue(job.getIntervalMillis() >= 900000);
            MessageAlerts.deliver(c, FIRST, "old", 1);
            MessageAlerts.deliver(c, OTHER, "wrong-account", System.currentTimeMillis());
            MessageAlerts.deliver(c, FIRST, "test-notice", System.currentTimeMillis());
            MessageAlerts.deliver(c, FIRST, "test-notice", System.currentTimeMillis());
            NotificationManager system = c.getSystemService(NotificationManager.class);
            long until = android.os.SystemClock.elapsedRealtime() + 3000;
            while (system.getActiveNotifications().length == 0 && android.os.SystemClock.elapsedRealtime() < until) {
                Thread.sleep(50);
            }
            StatusBarNotification[] posted = system.getActiveNotifications();
            assertEquals(1, posted.length);
            assertEquals("test-notice", posted[0].getTag());
            assertEquals(Notification.VISIBILITY_PRIVATE, posted[0].getNotification().visibility);
            assertFalse(MessageAlerts.captureClick(c, new Intent("dev.lychee.pilot.OPEN_GARDEN_NOTICE")
                .setData(Uri.parse("lychee-notice://open/test-notice")).putExtra("nonce", "untrusted")));
            // Tap through the notification shade. A synthetic PendingIntent.send from the
            // background test process is subject to different launch restrictions on Android 15.
            harness.getUiAutomation().executeShellCommand("cmd statusbar expand-notifications").close();
            boolean tapped = false;
            until = android.os.SystemClock.elapsedRealtime() + 4000;
            while (!tapped && android.os.SystemClock.elapsedRealtime() < until) {
                AccessibilityNodeInfo root = harness.getUiAutomation().getRootInActiveWindow();
                if (root != null) {
                    for (AccessibilityNodeInfo label : root.findAccessibilityNodeInfosByText("你有一条新消息")) {
                        for (AccessibilityNodeInfo node = label; node != null; node = node.getParent()) {
                            if (node.isClickable() && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                                tapped = true;
                                break;
                            }
                        }
                        if (tapped) break;
                    }
                }
                if (!tapped) Thread.sleep(80);
            }
            assertTrue("Tap the notification in the OS shade", tapped);
            String opened = null;
            until = android.os.SystemClock.elapsedRealtime() + 6000;
            while (opened == null && android.os.SystemClock.elapsedRealtime() < until) {
                assertNull(MessageAlerts.takeOpen(c, OTHER));
                opened = MessageAlerts.takeOpen(c, FIRST);
                if (opened == null) Thread.sleep(80);
            }
            assertEquals("test-notice", opened);
            assertNull(MessageAlerts.takeOpen(c, FIRST));
            MessageAlerts.bind(c, OTHER);
            assertFalse(MessageAlerts.enabled(c, OTHER));
            assertNull(c.getSystemService(JobScheduler.class).getPendingJob(7001));
        } finally {
            MessageAlerts.reset(c);
        }
    }
}
