# YourShop.Id — multi-stage build
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make ca-certificates libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY httplib.h json.hpp sqlite3.h sqlite3.c server.cpp Makefile ./
RUN gcc -O2 -c sqlite3.c -o sqlite3.o -DSQLITE_THREADSAFE=1 \
 && g++ -std=c++17 -O2 -pthread server.cpp sqlite3.o -o server -lssl -lcrypto -ldl

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /app/data /app/logs /app/scripts
COPY --from=build /app/server ./
COPY index.html main.js assets.js config.js ./
COPY scripts/start.sh scripts/start.sh
RUN chmod +x server scripts/start.sh

ENV YSI_PORT=8080
ENV YSI_DB=sqlite
ENV YSI_LOG_FILE=/app/logs/api.log
EXPOSE 8080 5500
CMD ["bash", "scripts/start.sh"]
