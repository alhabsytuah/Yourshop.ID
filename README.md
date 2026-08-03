# YourShop.Id

Marketplace demo (UI bergaya eBay) + API REST C++17.

## Fitur utama

- Frontend: HTML/CSS/JS, dark mode, i18n ID/EN, compare/share, footer legal
- Backend: JWT HS256 + PBKDF2, rate limit (memory/Redis), CORS ketat, SQLite opsional
- Bisnis: pembayaran mock, komisi platform, KYC seller, notifikasi server, pagination
- Deploy: Docker Compose, nginx, Let's Encrypt scripts, CI GitHub Actions

## Jalankan lokal

```bash
# Dependensi header (httplib + json)
bash scripts/fetch_deps.sh

# SQLite amalgamation (opsional — atau unduh dari sqlite.org)
# letakkan sqlite3.c + sqlite3.h di root project

make          # butuh g++, libssl-dev
./server      # http://localhost:8080

# Frontend
python3 -m http.server 5500
# buka http://localhost:5500
```

Akun demo: `buyer@demo.com` / `seller@demo.com` / `admin@demo.com` — password `demo`

## Docker

```bash
docker compose up --build
```

## Env penting

| Variabel | Keterangan |
|----------|------------|
| `YSI_AUTH_SECRET` | Secret JWT (≥16 karakter) |
| `YSI_DB=sqlite` | Persistensi SQLite |
| `YSI_REDIS_URL` | Rate limit Redis |
| `YSI_CORS_ORIGINS` | Origin diizinkan |
| `YSI_COMMISSION_RATE` | Komisi default 0.05 |

Lihat `.env.example` dan `DEPLOY.md`.

## Struktur

- `index.html` `main.js` `assets.js` `config.js` — frontend
- `server.cpp` — API C++
- `scripts/` — build, deploy, test, certs, redis
- `nginx/` — reverse proxy
- `.github/workflows/ci.yml` — CI

## Catatan

Binary `server` di repo mungkin usang — selalu build ulang dengan `make`.
File besar `sqlite3.c` tidak di-commit; unduh amalgamation SQLite jika memakai `YSI_DB=sqlite`.
