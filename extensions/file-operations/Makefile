CXX ?= c++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra
PKG_FLAGS := $(shell pkg-config --cflags --libs gio-2.0)

all: island-file

island-file: file_operations.cpp ../../sdk/live_activity.hpp
	$(CXX) $(CXXFLAGS) -I../../sdk -o $@ $< $(PKG_FLAGS)

clean:
	rm -f island-file
