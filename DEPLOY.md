# YourShop.Id — Production deploy

## Arsitektur

```
Browser ──HTTPS──▶ nginx :443
                     ├─ /        → /var/www/yourshop (static)
                     └─ /api/    → 127.0.0.1:8080 (C++ API)
                                      │
                                      └─ Redis :6379 (rate limit)
```

TLS diakhiri di **nginx** (Let's Encrypt). API internal HTTP saja.

---

## 1. Redis (rate limiting)

```bash
sudo bash scripts/setup_redis.sh
export YSI_REDIS_URL=redis://127.0.0.1:6379
```

Tanpa Redis, API otomatis fallback ke rate-limit in-memory.

Key pattern: `ysi:rl:{action}:{ip}` dengan TTL = window.

---

## 2. API service

```bash
sudo mkdir -p /opt/yourshop
sudo cp server server.cpp /opt/yourshop/   # binary hasil `make`
# atau build di server: make deps && make

# Edit secret & domain
sudo cp deploy/yourshop-api.service /etc/systemd/system/
sudo nano /etc/systemd/system/yourshop-api.service

sudo systemctl daemon-reload
sudo systemctl enable --now yourshop-api
curl http://127.0.0.1:8080/api/health
```

---

## 3. nginx reverse proxy

```bash
# Ganti domain
sudo bash scripts/deploy_nginx.sh yourshop.example.com
```

File:
- `nginx/yourshop.conf` — production HTTPS
- `nginx/yourshop.local.conf` — HTTP lokal
- `nginx/yourshop-proxy.conf` — snippet proxy headers

---

## 4. Let's Encrypt

```bash
# DNS A record domain → IP server (wajib)
sudo bash scripts/setup_letsencrypt.sh yourshop.example.com admin@example.com

# Pasang lagi config SSL penuh
sudo bash scripts/deploy_nginx.sh yourshop.example.com
```

Renew otomatis: `certbot.timer` (systemd).

Uji renew: `sudo certbot renew --dry-run`

---

## 5. CORS & frontend

```bash
export YSI_CORS_ORIGINS=https://yourshop.example.com
```

Di `config.js` (production):

```js
window.YourShopConfig = {
  apiBase: 'https://yourshop.example.com/api',
};
```

---

## Env ringkas

| Variabel | Contoh |
|----------|--------|
| `YSI_REDIS_URL` | `redis://127.0.0.1:6379` |
| `YSI_AUTH_SECRET` | string acak ≥16 karakter |
| `YSI_CORS_ORIGINS` | `https://yourshop.example.com` |
| `YSI_PORT` | `8080` (internal, di belakang nginx) |

---

## Checklist

- [ ] Redis `PING` → PONG  
- [ ] API `/api/health` → `"rateLimit":"redis"`  
- [ ] nginx `nginx -t` OK  
- [ ] HTTPS browser tanpa warning  
- [ ] Login rate-limit 429 setelah spam  
- [ ] `YSI_AUTH_SECRET` bukan default  
