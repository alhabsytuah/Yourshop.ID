# YourShop.Id — Makefile
# Build: make
# Run API: make run
# Full stack (API + static frontend): make dev

CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -pthread -Wall -Wno-unused-parameter
TARGET   ?= server
SRC      ?= server.cpp

.PHONY: all clean run dev deps check help

all: $(TARGET)

$(TARGET): $(SRC) httplib.h json.hpp
	$(CXX) $(CXXFLAGS) $(SRC) -o $(TARGET)
	chmod +x $(TARGET)
	@echo "✓ Built ./$(TARGET)"

deps:
	@bash scripts/fetch_deps.sh

run: $(TARGET)
	./$(TARGET)

dev: $(TARGET)
	@echo "Starting API on :8080 and frontend on :5500 ..."
	@bash scripts/dev.sh

clean:
	rm -f $(TARGET) ysi_data.json
	@echo "Cleaned binary and data file (headers kept)"

check:
	@command -v $(CXX) >/dev/null || (echo "g++ not found"; exit 1)
	@test -f httplib.h || (echo "Missing httplib.h — run: make deps"; exit 1)
	@test -f json.hpp || (echo "Missing json.hpp — run: make deps"; exit 1)
	@echo "✓ Dependencies OK"

help:
	@echo "Targets:"
	@echo "  make / make all   Build C++ API server"
	@echo "  make deps         Download httplib.h + json.hpp"
	@echo "  make run          Run API on http://localhost:8080"
	@echo "  make dev          API + frontend (ports 8080 + 5500)"
	@echo "  make clean        Remove binary and ysi_data.json"
	@echo "  make check        Verify toolchain and headers"
