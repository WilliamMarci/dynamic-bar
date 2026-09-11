#pragma once
#include <algorithm>
#include <optional>
#include <regex>
#include <string>
#include <vector>

struct ProgressAdapterInfo { std::string id, commands, description; };

// Stable compatibility API: new support registers one Adapter here without
// changing command execution, output forwarding, D-Bus, or Shell UI code.
class ProgressAdapters {
public:
    explicit ProgressAdapters(std::string executable)
        : executable_(std::move(executable)), adapters_(registry()) {}

    std::optional<int> parse(const std::string& line) const {
        for (const auto& adapter : adapters_) {
            if (!adapter.fallback && !matchesCommand(adapter.commands)) continue;
            std::smatch result;
            if (!std::regex_search(line, result, adapter.pattern)) continue;
            return std::min(100, std::max(0, std::stoi(result[1])));
        }
        return std::nullopt;
    }

    static std::vector<ProgressAdapterInfo> available() {
        std::vector<ProgressAdapterInfo> result;
        for (const auto& adapter : registry()) result.push_back(adapter.info);
        return result;
    }

private:
    struct Adapter {
        ProgressAdapterInfo info;
        std::vector<std::string> commands;
        std::regex pattern;
        bool fallback = false;
    };

    static std::vector<Adapter> registry() {
        return {
            {{"cmake", "cmake, make, ninja", "Bracketed build percentages"},
                {"cmake", "make", "ninja"}, std::regex(R"(\[\s*([0-9]{1,3})%\])")},
            {{"apt", "apt, apt-get, dpkg", "APT/DPKG progress output"},
                {"apt", "apt-get", "dpkg"},
                std::regex(R"(Progress.*?([0-9]{1,3})%)", std::regex::icase)},
            {{"generic-percent", "any command", "Any explicit NN% token"},
                {}, std::regex(R"(([0-9]{1,3})%)"), true},
        };
    }

    bool matchesCommand(const std::vector<std::string>& commands) const {
        for (const auto& command : commands) {
            const std::string suffix = "/" + command;
            if (executable_ == command || (executable_.size() >= suffix.size() &&
                executable_.compare(executable_.size() - suffix.size(),
                    suffix.size(), suffix) == 0))
                return true;
        }
        return false;
    }

    std::string executable_;
    std::vector<Adapter> adapters_;
};
