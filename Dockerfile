# YourShop.Id — multi-stage: build C++ API + serve with Python
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY httplib.h json.hpp server.cpp Makefile ./
RUN make all

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/server ./
COPY index.html main.js assets.js config.js ./
COPY scripts/dev.sh scripts/dev.sh
RUN chmod +x scripts/dev.sh server

EXPOSE 8080 5500
ENV API_PORT=8080 WEB_PORT=5500
CMD ["bash", "scripts/dev.sh"]
