package dev.lychee.pilot;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name="LycheeAlerts", permissions={
    @Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})
})
public final class LycheeAlerts extends Plugin {
    private String owner(PluginCall call) { return call.getString("owner", ""); }
    @PluginMethod public void bind(PluginCall call) {
        MessageAlerts.bind(getContext(), owner(call));
        status(call);
    }
    @PluginMethod public void status(PluginCall call) {
        JSObject state = new JSObject();
        state.put("supported", true);
        state.put("configured", true);
        state.put("enabled", MessageAlerts.enabled(getContext(), owner(call)));
        call.resolve(state);
    }
    @PluginMethod public void enable(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
        } else {
            afterPermission(call);
        }
    }
    @PermissionCallback private void afterPermission(PluginCall call) {
        if (!MessageAlerts.allowed(getContext())) {
            call.reject("请在安卓系统的应用设置里允许荔枝发送通知。");
        } else if (!MessageAlerts.enable(getContext(), owner(call))) {
            call.reject("暂未开启，请重新进入当前园子后重试。");
        } else {
            status(call);
        }
    }
    @PluginMethod public void disable(PluginCall call) {
        MessageAlerts.disable(getContext(), owner(call));
        status(call);
    }
    @PluginMethod public void deliver(PluginCall call) {
        MessageAlerts.deliver(getContext(), owner(call), call.getString("id"), call.getData().optLong("created"));
        call.resolve();
    }
    @PluginMethod public void takeOpen(PluginCall call) {
        JSObject result = new JSObject();
        String id = MessageAlerts.takeOpen(getContext(), owner(call));
        if (id != null) result.put("id", id);
        call.resolve(result);
    }
}
