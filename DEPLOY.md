# YourShop.Id — Production deploy

## Architecture

Browser → HTTPS → nginx :443 → static + /api/ → C++ API :8080 → Redis

## Quick start

```bash
sudo bash scripts/setup_redis.sh
export YSI_REDIS_URL=redis://127.0.0.1:6379
export YSI_AUTH_SECRET=$(openssl rand -hex 32)
make && YSI_DB=sqlite ./server

# Frontend
python3 -m http.server 5500
```

## Docker

```bash
docker compose up --build
```

## nginx + Let's Encrypt

```bash
sudo bash scripts/deploy_nginx.sh yourshop.example.com
sudo bash scripts/setup_letsencrypt.sh yourshop.example.com you@email.com
```

See scripts/ and nginx/ for full configs.
