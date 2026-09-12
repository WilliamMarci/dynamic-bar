#pragma once

#include <gio/gio.h>

#include <algorithm>
#include <iostream>
#include <sstream>
#include <string>

namespace DynamicBar {

inline std::string jsonEscape(const std::string& value) {
    std::ostringstream out;
    for (char c : value) {
        if (c == '"' || c == '\\') out << '\\' << c;
        else if (c == '\n') out << "\\n";
        else if (c == '\r') out << "\\r";
        else if (static_cast<unsigned char>(c) >= 0x20) out << c;
    }
    return out.str();
}

class LiveActivity {
public:
    LiveActivity(std::string id, std::string title, std::string source,
        std::string type = "external") : id_(std::move(id)) {
        GError* error = nullptr;
        proxy_ = g_dbus_proxy_new_for_bus_sync(G_BUS_TYPE_SESSION,
            G_DBUS_PROXY_FLAGS_NONE, nullptr,
            "org.gnome.Shell.Extensions.DynamicBar.LiveActivity",
            "/org/gnome/Shell/Extensions/DynamicBar/LiveActivity",
            "org.gnome.Shell.Extensions.DynamicBar.LiveActivity",
            nullptr, &error);
        if (proxy_ && !g_dbus_proxy_get_name_owner(proxy_)) {
            g_object_unref(proxy_);
            proxy_ = nullptr;
        }
        if (error) {
            std::cerr << "dynamic-bar: " << error->message << '\n';
            g_error_free(error);
        }
        if (!proxy_)
            return;
        const std::string payload = "{\"id\":\"" + jsonEscape(id_) +
            "\",\"title\":\"" + jsonEscape(title) +
            "\",\"source\":\"" + jsonEscape(source) +
            "\",\"type\":\"" + jsonEscape(type) +
            "\",\"progress\":{\"kind\":\"determinate\",\"value\":0}}";
        invoke("StartV2", g_variant_new("(s)", payload.c_str()));
    }

    ~LiveActivity() {
        if (proxy_)
            g_object_unref(proxy_);
    }

    LiveActivity(const LiveActivity&) = delete;
    LiveActivity& operator=(const LiveActivity&) = delete;

    bool available() const { return proxy_ != nullptr; }

    void progress(double value, const std::string& summary = {}) {
        if (!proxy_)
            return;
        std::ostringstream payload;
        payload << "{\"progress\":{\"kind\":\"determinate\",\"value\":"
                << std::max(0.0, std::min(1.0, value)) << '}';
        if (!summary.empty())
            payload << ",\"summary\":\"" << jsonEscape(summary) << '"';
        payload << '}';
        invoke("UpdateV2", g_variant_new("(ss)", id_.c_str(),
            payload.str().c_str()));
    }

    void finish(bool success, const std::string& summary = {}) {
        if (!proxy_)
            return;
        const std::string payload = "{\"status\":\"" +
            std::string(success ? "success" : "error") +
            "\",\"summary\":\"" + jsonEscape(summary) + "\"}";
        invoke("FinishV2", g_variant_new("(ss)", id_.c_str(), payload.c_str()));
    }

private:
    void invoke(const char* method, GVariant* args) {
        GError* error = nullptr;
        GVariant* result = g_dbus_proxy_call_sync(proxy_, method, args,
            G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, &error);
        if (result) g_variant_unref(result);
        if (error) {
            std::cerr << "dynamic-bar: " << error->message << '\n';
            g_error_free(error);
        }
    }

    std::string id_;
    GDBusProxy* proxy_ = nullptr;
};

} // namespace DynamicBar
