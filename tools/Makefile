CXX ?= c++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra
PKG_FLAGS := $(shell pkg-config --cflags --libs gio-2.0)

all: island

island: island.cpp progressAdapters.hpp
	$(CXX) $(CXXFLAGS) -o $@ $< $(PKG_FLAGS)

clean:
	rm -f island
