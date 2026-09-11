#include <gio/gio.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <regex>
#include <sstream>
#include <string>
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
        << "  island timer DURATION[s|m|h] [--title TITLE]\n\n"
        << "The run subcommand is optional. Use 'island run' when a command is "
        << "literally named help or list.\n";
}

static void printAdapters() {
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
    if (!proxy) {
        std::cerr << "island: Dynamic Bar is unavailable: "
                  << (error ? error->message : "unknown error") << '\n';
        if (error) g_error_free(error);
        return 125;
    }
    call(proxy, "Timer", g_variant_new("(ssu)", id.c_str(), title.c_str(), seconds));
    g_object_unref(proxy);
    std::cout << id << '\n';
    return 0;
}

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
    const std::string command = displayCommand(args);
    if (title.empty()) title = command;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const std::string id = std::to_string(getpid()) + "-" + std::to_string(stamp);

    GError* error = nullptr;
    GDBusProxy* proxy = g_dbus_proxy_new_for_bus_sync(G_BUS_TYPE_SESSION,
        G_DBUS_PROXY_FLAGS_NONE, nullptr, BUS, PATH, BUS, nullptr, &error);
    if (!proxy) {
        std::cerr << "island: Dynamic Bar unavailable; running without Live Activity\n";
        if (error) g_error_free(error);
    } else {
        call(proxy, "Start", g_variant_new("(sssu)", id.c_str(), title.c_str(),
            command.c_str(), static_cast<guint32>(getppid())));
    }

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
        for (auto& arg : args) execArgs.push_back(arg.data());
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
    char* line = nullptr;
    size_t capacity = 0;
    int lastPercent = -1;
    const ProgressAdapters progressAdapters(args.front());
    while (getline(&line, &capacity, stream) != -1) {
        fputs(line, stdout);
        fflush(stdout);
        if (auto parsed = progressAdapters.parse(line)) {
            int value = *parsed;
            if (value != lastPercent) {
                lastPercent = value;
                if (proxy)
                    call(proxy, "Update", g_variant_new("(sd)", id.c_str(), value / 100.0));
            }
        }
    }
    free(line);
    fclose(stream);
    int status = 0;
    waitpid(child, &status, 0);
    int exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    if (proxy) {
        call(proxy, "Complete", g_variant_new("(si)", id.c_str(), exitCode));
        g_object_unref(proxy);
    }
    return exitCode;
}
