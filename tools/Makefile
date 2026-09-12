CXX ?= c++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra
PKG_FLAGS := $(shell pkg-config --cflags --libs gio-2.0)

.PHONY: all clean install-completions

all: island

island: island.cpp progressAdapters.hpp
	$(CXX) $(CXXFLAGS) -o $@ $< $(PKG_FLAGS)

clean:
	rm -f island

install-completions:
	install -Dm644 completions/island.bash $(HOME)/.local/share/bash-completion/completions/island
	install -Dm644 completions/_island $(HOME)/.local/share/zsh/site-functions/_island
	install -Dm644 completions/island.fish $(HOME)/.config/fish/completions/island.fish
