#include "live_activity.hpp"

#include <unistd.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace fs = std::filesystem;

static uintmax_t measure(const fs::path& source) {
    std::error_code error;
    if (fs::is_regular_file(source, error))
        return fs::file_size(source, error);
    uintmax_t total = 0;
    for (fs::recursive_directory_iterator it(source,
             fs::directory_options::skip_permission_denied, error), end;
         it != end; it.increment(error)) {
        if (error) { error.clear(); continue; }
        if (it->is_regular_file(error))
            total += it->file_size(error);
    }
    return total;
}

class Copier {
public:
    Copier(DynamicBar::LiveActivity& activity, uintmax_t total)
        : activity_(activity), total_(total) {}

    void copy(const fs::path& source, const fs::path& destination) {
        if (fs::is_directory(source)) {
            fs::create_directories(destination);
            for (const auto& entry : fs::directory_iterator(source))
                copy(entry.path(), destination / entry.path().filename());
        } else if (fs::is_symlink(source)) {
            fs::copy_symlink(source, destination);
        } else {
            copyFile(source, destination);
        }
    }

private:
    void copyFile(const fs::path& source, const fs::path& destination) {
        fs::create_directories(destination.parent_path());
        std::ifstream input(source, std::ios::binary);
        std::ofstream output(destination, std::ios::binary | std::ios::trunc);
        if (!input || !output)
            throw std::runtime_error("cannot open " + source.string());
        char buffer[1024 * 1024];
        while (input) {
            input.read(buffer, sizeof buffer);
            const auto count = input.gcount();
            if (count <= 0) break;
            output.write(buffer, count);
            if (!output) throw std::runtime_error("write failed: " + destination.string());
            copied_ += static_cast<uintmax_t>(count);
            const auto now = std::chrono::steady_clock::now();
            if (now - lastUpdate_ >= std::chrono::milliseconds(100)) {
                activity_.progress(total_ ? double(copied_) / total_ : 1,
                    source.filename().string());
                lastUpdate_ = now;
            }
        }
        output.close();
        fs::permissions(destination, fs::status(source).permissions());
    }

    DynamicBar::LiveActivity& activity_;
    uintmax_t total_ = 0;
    uintmax_t copied_ = 0;
    std::chrono::steady_clock::time_point lastUpdate_{};
};

int main(int argc, char** argv) {
    if (argc != 4 || (std::string(argv[1]) != "copy" &&
        std::string(argv[1]) != "move")) {
        std::cerr << "Usage: island-file copy|move SOURCE DESTINATION\n";
        return 2;
    }
    const bool moving = std::string(argv[1]) == "move";
    const fs::path source = fs::absolute(argv[2]);
    fs::path destination = fs::absolute(argv[3]);
    if (!fs::exists(source)) {
        std::cerr << "island-file: source does not exist\n";
        return 2;
    }
    if (fs::is_directory(destination))
        destination /= source.filename();
    const std::string id = std::to_string(getpid()) + "-file-operation";
    DynamicBar::LiveActivity activity(id,
        std::string(moving ? "Moving " : "Copying ") + source.filename().string(),
        "file-operations", "file");
    try {
        if (moving) {
            std::error_code error;
            fs::rename(source, destination, error);
            if (!error) {
                activity.progress(1);
                activity.finish(true, "Move completed");
                return 0;
            }
        }
        Copier copier(activity, measure(source));
        copier.copy(source, destination);
        activity.progress(1);
        if (moving)
            fs::remove_all(source);
        activity.finish(true, moving ? "Move completed" : "Copy completed");
        return 0;
    } catch (const std::exception& error) {
        activity.finish(false, error.what());
        std::cerr << "island-file: " << error.what() << '\n';
        return 1;
    }
}
