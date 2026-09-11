#include <gio/gio.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <condition_variable>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <regex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "progressAdapters.hpp"

constexpr const char* BUS = "org.gnome.Shell.Extensions.DynamicBar.LiveActivity";
constexpr const char* PATH = "/org/gnome/Shell/Extensions/DynamicBar/LiveActivity";

static void call(GDBusProxy* proxy, const char* method, GVariant* args) {
    GError* error = nullptr;
    GVariant* result = g_dbus_proxy_call_sync(proxy, method, args,
        G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, &error);
    if (result) g_variant_unref(result);
    if (error) {
        std::cerr << "island: " << error->message << '\n';
        g_error_free(error);
    }
}

static GDBusProxy* connectService() {
    GError* error = nullptr;
    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(G_BUS_TYPE_SESSION,
        G_DBUS_PROXY_FLAGS_NONE, nullptr, BUS, PATH, BUS, nullptr, &error);
    if (error) g_error_free(error);
    if (proxy && !g_dbus_proxy_get_name_owner(proxy)) {
        g_object_unref(proxy);
        proxy = nullptr;
    }
    return proxy;
}

static std::string jsonEscape(const std::string& value) {
    std::ostringstream out;
    for (char c : value) {
        if (c == '"' || c == '\\') out << '\\' << c;
        else if (c == '\n') out << "\\n";
        else if (c == '\r') out << "\\r";
        else if (static_cast<unsigned char>(c) >= 0x20) out << c;
    }
    return out.str();
}

static std::string makeId(const std::string& tag = "task") {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    return std::to_string(getpid()) + "-" + tag + "-" + std::to_string(stamp);
}

static std::string displayCommand(const std::vector<std::string>& args) {
    std::ostringstream out;
    for (size_t i = 0; i < args.size(); ++i) {
        if (i) out << ' ';
        out << args[i];
    }
    return out.str();
}

static void printHelp(std::ostream& out) {
    out << "Usage:\n"
        << "  island [run] [--title TITLE] [--] COMMAND [ARGS...]\n"
        << "  island help\n"
        << "  island list\n"
        << "  island inspect | demo [progress]\n"
        << "  island start ID [TITLE] | update ID PERCENT | done ID [SUMMARY]\n"
        << "  island fail ID [SUMMARY] | dismiss ID\n"
        << "  island timer DURATION[s|m|h] [--title TITLE]\n\n"
        << "The run subcommand is optional. Use 'island run' when a command is "
        << "literally named help or list.\n";
}

static void printAdapters() {
    std::cout << "Built-in activity commands:\n"
              << "  timer, start, update, done, fail, dismiss, inspect, demo\n\n";
    std::cout << "Installed progress adapters:\n";
    for (const auto& info : ProgressAdapters::available())
        std::cout << "  " << info.id << "\n    commands: " << info.commands
                  << "\n    " << info.description << "\n";
}

static unsigned parseDuration(const std::string& text) {
    if (text.empty()) return 0;
    char suffix = text.back();
    unsigned multiplier = 1;
    std::string number = text;
    if (suffix == 's' || suffix == 'm' || suffix == 'h') {
        number.pop_back();
        if (suffix == 'm') multiplier = 60;
        if (suffix == 'h') multiplier = 3600;
    }
    try { return static_cast<unsigned>(std::stoul(number)) * multiplier; }
    catch (...) { return 0; }
}

static int createTimer(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "Usage: island timer DURATION[s|m|h] [--title TITLE]\n";
        return 2;
    }
    const unsigned seconds = parseDuration(argv[2]);
    if (!seconds) return 2;
    std::string title = "Timer";
    if (argc >= 5 && std::string(argv[3]) == "--title") title = argv[4];
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const std::string id = std::to_string(getpid()) + "-timer-" + std::to_string(stamp);
    GError* error = nullptr;
    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(G_BUS_TYPE_SESSION,
        G_DBUS_PROXY_FLAGS_NONE, nullptr, BUS, PATH, BUS, nullptr, &error);
    if (proxy && !g_dbus_proxy_get_name_owner(proxy)) {
        g_object_unref(proxy);
        proxy = nullptr;
    }
    if (!proxy) {
        std::cerr << "island: Dynamic Bar is unavailable: "
                  << (error ? error->message : "no service owner") << '\n';
        if (error) g_error_free(error);
        return 125;
    }
    call(proxy, "Timer", g_variant_new("(ssu)", id.c_str(), title.c_str(), seconds));
    g_object_unref(proxy);
    std::cout << id << '\n';
    return 0;
}

static int activityCommand(int argc, char** argv) {
    GDBusProxy* proxy = connectService();
    if (!proxy) { std::cerr << "island: Dynamic Bar is unavailable\n"; return 125; }
    const std::string mode = argv[1];
    if (mode == "inspect") {
        GError* error = nullptr;
        GVariant* result = g_dbus_proxy_call_sync(proxy, "Inspect", nullptr,
            G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, &error);
        if (result) { const char* json = nullptr; g_variant_get(result, "(&s)", &json);
            std::cout << json << '\n'; g_variant_unref(result); }
        if (error) { std::cerr << error->message << '\n'; g_error_free(error); }
    } else if (mode == "demo") {
        const bool slow = argc >= 3 && std::string(argv[2]) == "progress";
        const std::string id = makeId(slow ? "demo-progress" : "demo");
        const std::string start = "{\"id\":\"" + id +
            "\",\"title\":\"" + std::string(slow ? "Progress demo (20s)" : "Live Activity demo") +
            "\",\"source\":\"island-demo\",\"type\":\"demo\","
            "\"progress\":{\"kind\":\"determinate\",\"value\":0}}";
        call(proxy, "StartV2", g_variant_new("(s)", start.c_str()));
        const int steps = slow ? 20 : 10;
        for (int step = 1; step <= steps; ++step) {
            usleep(slow ? 1000000 : 80000);
            const std::string update = "{\"progress\":{\"kind\":\"determinate\",\"value\":" +
                std::to_string(static_cast<double>(step) / steps) + "}}";
            call(proxy, "UpdateV2", g_variant_new("(ss)", id.c_str(), update.c_str()));
        }
        call(proxy, "FinishV2", g_variant_new("(ss)", id.c_str(),
            "{\"status\":\"success\",\"summary\":\"Demo completed\"}"));
    } else if (mode == "dismiss" && argc >= 3) {
        call(proxy, "Dismiss", g_variant_new("(s)", argv[2]));
    } else if (mode == "start" && argc >= 3) {
        const std::string title = argc >= 4 ? argv[3] : argv[2];
        const std::string payload = "{\"id\":\"" + jsonEscape(argv[2]) +
            "\",\"title\":\"" + jsonEscape(title) +
            "\",\"source\":\"island-cli\",\"type\":\"external\","
            "\"progress\":{\"kind\":\"indeterminate\"}}";
        call(proxy, "StartV2", g_variant_new("(s)", payload.c_str()));
    } else if (mode == "update" && argc >= 4) {
        double value = std::stod(argv[3]); if (value > 1) value /= 100.0;
        const std::string payload = "{\"progress\":{\"kind\":\"determinate\",\"value\":" +
            std::to_string(value) + "}}";
        call(proxy, "UpdateV2", g_variant_new("(ss)", argv[2], payload.c_str()));
    } else if ((mode == "done" || mode == "fail") && argc >= 3) {
        const std::string summary = argc >= 4 ? argv[3] : "";
        const std::string payload = "{\"status\":\"" +
            std::string(mode == "done" ? "success" : "error") +
            "\",\"summary\":\"" + jsonEscape(summary) + "\"}";
        call(proxy, "FinishV2", g_variant_new("(ss)", argv[2], payload.c_str()));
    } else { printHelp(std::cerr); g_object_unref(proxy); return 2; }
    g_object_unref(proxy);
    return 0;
}

namespace {

struct RetryState {
    std::string id;
    std::string title;
    std::vector<std::string> args;
    GMainLoop* loop = nullptr;
    bool retry = false;
    guint timeoutId = 0;
};

int runTask(const std::string& id, const std::string& title,
    const std::vector<std::string>& args, bool armRetry);

void spawnRetryListener(const std::string& id, const std::string& title,
    const std::vector<std::string>& args) {
    const pid_t pid = fork();
    if (pid != 0)
        return;

    setsid();
    signal(SIGPIPE, SIG_IGN);

    GError* error = nullptr;
    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(G_BUS_TYPE_SESSION,
        G_DBUS_PROXY_FLAGS_NONE, nullptr, BUS, PATH, BUS, nullptr, &error);
    if (!proxy || !g_dbus_proxy_get_name_owner(proxy)) {
        if (proxy) g_object_unref(proxy);
        if (error) g_error_free(error);
        _exit(0);
    }

    RetryState state;
    state.id = id;
    state.title = title;
    state.args = args;
    state.loop = g_main_loop_new(nullptr, FALSE);

    g_signal_connect(proxy, "g-signal",
        G_CALLBACK(+[](GDBusProxy*, gchar*, gchar* signal, GVariant* params,
            gpointer data) {
            auto* retry = static_cast<RetryState*>(data);
            if (g_strcmp0(signal, "ActionRequested") != 0)
                return;
            const char* activityId = nullptr;
            const char* actionId = nullptr;
            g_variant_get(params, "(&s&s)", &activityId, &actionId);
            if (retry->id == activityId && g_strcmp0(actionId, "retry") == 0) {
                retry->retry = true;
                g_main_loop_quit(retry->loop);
            }
        }), &state);

    // Keep listening for a bounded window so a forgotten card cannot leak a
    // process for the whole session.
    state.timeoutId = g_timeout_add_seconds(900, +[](gpointer data) -> gboolean {
        auto* retry = static_cast<RetryState*>(data);
        retry->timeoutId = 0;
        g_main_loop_quit(retry->loop);
        return G_SOURCE_REMOVE;
    }, &state);

    g_main_loop_run(state.loop);

    if (state.timeoutId)
        g_source_remove(state.timeoutId);
    g_signal_handlers_disconnect_by_data(proxy, &state);
    g_object_unref(proxy);
    g_main_loop_unref(state.loop);

    // The task owner restarts its own command; the Shell only forwarded the
    // activityId + actionId pair and never sees the command string.
    if (state.retry)
        _exit(runTask(id, title, args, true));
    _exit(0);
}

int runTask(const std::string& id, const std::string& title,
    const std::vector<std::string>& args, bool armRetry) {
    signal(SIGPIPE, SIG_IGN);
    const char* cacheEnv = std::getenv("XDG_CACHE_HOME");
    const char* homeEnv = std::getenv("HOME");
    std::filesystem::path logDir = cacheEnv ? cacheEnv :
        (homeEnv ? std::filesystem::path(homeEnv) / ".cache" : "/tmp");
    logDir /= "dynamic-bar/logs";
    std::error_code fsError;
    std::filesystem::create_directories(logDir, fsError);
    const std::filesystem::path logPath = logDir / (id + ".log");
    std::ofstream log(logPath, std::ios::out | std::ios::trunc);

    GError* error = nullptr;
    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(G_BUS_TYPE_SESSION,
        G_DBUS_PROXY_FLAGS_NONE, nullptr, BUS, PATH, BUS, nullptr, &error);
    if (proxy && !g_dbus_proxy_get_name_owner(proxy)) {
        // The bus name resolved to no owner (extension disabled): keep the
        // command usable and skip both reporting and the retry listener.
        g_object_unref(proxy);
        proxy = nullptr;
    }
    if (!proxy) {
        std::cerr << "island: Dynamic Bar unavailable; running without Live Activity\n";
        if (error) g_error_free(error);
    } else {
        const std::string payload = "{\"id\":\"" + id + "\",\"title\":\"" +
            jsonEscape(title) + "\",\"source\":\"island-run\",\"type\":\"command\"," +
            "\"terminalPid\":" + std::to_string(getppid()) +
            ",\"logPath\":\"" + jsonEscape(logPath.string()) +
            "\",\"progress\":{\"kind\":\"indeterminate\"}}";
        call(proxy, "StartV2", g_variant_new("(s)", payload.c_str()));
    }

    std::mutex heartbeatMutex;
    std::condition_variable heartbeatWake;
    bool heartbeatStop = false;
    std::thread heartbeat;
    int pipes[2];
    if (pipe(pipes) != 0) {
        if (proxy) g_object_unref(proxy);
        return 125;
    }
    pid_t child = fork();
    if (child == 0) {
        close(pipes[0]);
        dup2(pipes[1], STDOUT_FILENO);
        dup2(pipes[1], STDERR_FILENO);
        close(pipes[1]);
        std::vector<char*> execArgs;
        for (const auto& arg : args) execArgs.push_back(const_cast<char*>(arg.data()));
        execArgs.push_back(nullptr);
        execvp(execArgs[0], execArgs.data());
        _exit(127);
    }
    if (child < 0) {
        close(pipes[0]);
        close(pipes[1]);
        if (proxy) g_object_unref(proxy);
        return 125;
    }
    close(pipes[1]);
    FILE* stream = fdopen(pipes[0], "r");
    if (!stream)
        close(pipes[0]);

    if (proxy) {
        heartbeat = std::thread([&] {
            std::unique_lock<std::mutex> lock(heartbeatMutex);
            while (!heartbeatWake.wait_for(lock, std::chrono::seconds(15),
                [&] { return heartbeatStop; })) {
                lock.unlock();
                call(proxy, "Heartbeat", g_variant_new("(s)", id.c_str()));
                lock.lock();
            }
        });
    }

    int lastPercent = -1;
    std::string lastSummary;
    if (stream) {
        char* line = nullptr;
        size_t capacity = 0;
        const std::regex ansi(R"(\x1B\[[0-?]*[ -/]*[@-~])");
        const ProgressAdapters progressAdapters(args.front());
        while (getline(&line, &capacity, stream) != -1) {
            fputs(line, stdout);
            fflush(stdout);
            std::string clean = std::regex_replace(std::string(line), ansi, "");
            while (!clean.empty() && (clean.back() == '\n' || clean.back() == '\r'))
                clean.pop_back();
            if (!clean.empty()) lastSummary = clean;
            if (log) {
                log << clean << '\n';
                if (log.tellp() > 1024 * 1024) {
                    log.close();
                    std::filesystem::remove(logPath.string() + ".1", fsError);
                    std::filesystem::rename(logPath, logPath.string() + ".1", fsError);
                    log.open(logPath, std::ios::out | std::ios::trunc);
                }
            }
            if (auto parsed = progressAdapters.parse(clean)) {
                int value = *parsed;
                if (value != lastPercent) {
                    lastPercent = value;
                    if (proxy) {
                        const std::string update =
                            "{\"progress\":{\"kind\":\"determinate\",\"value\":" +
                            std::to_string(value / 100.0) + "}}";
                        call(proxy, "UpdateV2",
                            g_variant_new("(ss)", id.c_str(), update.c_str()));
                    }
                }
            }
        }
        free(line);
        fclose(stream);
    }

    int status = 0;
    waitpid(child, &status, 0);
    log.close();
    int exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    if (proxy) {
        {
            std::lock_guard<std::mutex> lock(heartbeatMutex);
            heartbeatStop = true;
        }
        heartbeatWake.notify_one();
        heartbeat.join();
        std::string result = "{\"status\":\"" +
            std::string(exitCode == 0 ? "success" : "error") +
            "\",\"exitCode\":" + std::to_string(exitCode) +
            ",\"summary\":\"" + jsonEscape(lastSummary) +
            "\",\"logPath\":\"" + jsonEscape(logPath.string()) + "\"";
        if (exitCode != 0 && armRetry)
            result += ",\"actions\":[{\"id\":\"retry\",\"label\":\"Retry\","
                "\"icon\":\"view-refresh-symbolic\"}]";
        result += "}";
        call(proxy, "FinishV2", g_variant_new("(ss)", id.c_str(), result.c_str()));
        if (exitCode != 0 && armRetry)
            spawnRetryListener(id, title, args);
        g_object_unref(proxy);
    }
    return exitCode;
}

} // namespace

int main(int argc, char** argv) {
    if (argc == 1) {
        printHelp(std::cout);
        return 0;
    }
    const std::string first = argv[1];
    if (first == "help" || first == "--help" || first == "-h") {
        printHelp(std::cout);
        return 0;
    }
    if (first == "list") {
        printAdapters();
        return 0;
    }
    if (first == "timer") return createTimer(argc, argv);
    if (first == "inspect" || first == "demo" || first == "start" ||
        first == "update" || first == "done" || first == "fail" ||
        first == "dismiss") return activityCommand(argc, argv);
    std::string title;
    int index = first == "run" ? 2 : 1;
    if (index >= argc) {
        printHelp(std::cerr);
        return 2;
    }
    if (index + 1 < argc && std::string(argv[index]) == "--title") {
        title = argv[index + 1];
        index += 2;
    }
    if (index < argc && std::string(argv[index]) == "--") ++index;
    if (index >= argc) return 2;

    std::vector<std::string> args;
    for (int i = index; i < argc; ++i) args.emplace_back(argv[i]);
    if (title.empty()) title = displayCommand(args);
    return runTask(makeId(), title, args, true);
}
