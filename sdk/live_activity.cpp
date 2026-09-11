#include <gio/gio.h>

#include <iostream>
#include <string>

constexpr const char* BUS = "org.gnome.Shell.Extensions.DynamicBar.LiveActivity";
constexpr const char* PATH = "/org/gnome/Shell/Extensions/DynamicBar/LiveActivity";

static bool invoke(GDBusProxy* proxy, const char* method, GVariant* parameters) {
    GError* error = nullptr;
    GVariant* result = g_dbus_proxy_call_sync(proxy, method, parameters,
        G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, &error);
    if (result) g_variant_unref(result);
    if (!error) return true;
    std::cerr << error->message << '\n';
    g_error_free(error);
    return false;
}

int main() {
    GError* error = nullptr;
    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(G_BUS_TYPE_SESSION,
        G_DBUS_PROXY_FLAGS_NONE, nullptr, BUS, PATH, BUS, nullptr, &error);
    if (!proxy) {
        std::cerr << (error ? error->message : "Dynamic Bar is unavailable") << '\n';
        if (error) g_error_free(error);
        return 1;
    }
    const std::string id = "cpp-sdk-demo";
    bool ok = invoke(proxy, "StartV2", g_variant_new("(s)",
        "{\"id\":\"cpp-sdk-demo\",\"title\":\"C++ SDK demo\","
        "\"source\":\"cpp-sdk\",\"progress\":{\"kind\":\"indeterminate\"}}"));
    ok &= invoke(proxy, "UpdateV2", g_variant_new("(ss)", id.c_str(),
        "{\"progress\":{\"kind\":\"determinate\",\"value\":0.5}}"));
    ok &= invoke(proxy, "FinishV2", g_variant_new("(ss)", id.c_str(),
        "{\"status\":\"success\",\"summary\":\"C++ demo completed\"}"));
    g_object_unref(proxy);
    return ok ? 0 : 1;
}
