# YourShop.Id — Makefile
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -pthread -Wall -Wno-unused-parameter
LDFLAGS  ?= -lssl -lcrypto -ldl
TARGET   ?= server
SRC      ?= server.cpp
SQLITE_O ?= sqlite3.o

.PHONY: all clean run run-https run-sqlite dev deps check certs help backup

all: $(TARGET)

$(SQLITE_O): sqlite3.c sqlite3.h
	$(CXX) -O2 -c sqlite3.c -o $(SQLITE_O) -DSQLITE_THREADSAFE=1 || gcc -O2 -c sqlite3.c -o $(SQLITE_O) -DSQLITE_THREADSAFE=1
	@echo "✓ Built $(SQLITE_O)"

$(TARGET): $(SRC) httplib.h json.hpp $(SQLITE_O)
	$(CXX) $(CXXFLAGS) $(SRC) $(SQLITE_O) -o $(TARGET) $(LDFLAGS)
	chmod +x $(TARGET)
	@echo "✓ Built ./$(TARGET)"

deps:
	@bash scripts/fetch_deps.sh

certs:
	@bash scripts/gen_certs.sh

backup:
	@bash scripts/backup_data.sh

run: $(TARGET)
	./$(TARGET)

run-sqlite: $(TARGET)
	YSI_DB=sqlite ./$(TARGET)

run-https: $(TARGET) certs
	YSI_HTTPS=1 ./$(TARGET)

dev: $(TARGET)
	@bash scripts/dev.sh

clean:
	rm -f $(TARGET) $(SQLITE_O) ysi_data.json

help:
	@echo "make | make run | make run-sqlite | make backup | make run-https"
	@echo "Env: YSI_DB=sqlite YSI_REDIS_URL YSI_COMMISSION_RATE YSI_AUTH_SECRET"
