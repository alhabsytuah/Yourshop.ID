# YourShop.Id

Marketplace demo (frontend HTML/CSS/JS + backend REST C++).

UI terinspirasi eBay, bahasa Indonesia, mata uang Rp / USD, auth token, checkout, pembayaran mock, invoice, kurir, batalkan/return pesanan.

---

## Struktur

```
artifacts/
├── index.html          # UI utama
├── main.js             # Logika frontend
├── assets.js           # Brand tokens / SVG
├── config.js           # URL API (edit di sini)
├── server.cpp          # Backend REST C++17
├── httplib.h           # cpp-httplib (single-header)
├── json.hpp            # nlohmann/json (single-header)
├── Makefile
├── scripts/
│   ├── fetch_deps.sh   # Unduh header jika belum ada
│   ├── start.sh        # Build + jalankan API
│   └── dev.sh          # API + static frontend
└── README.md
```

---

## Prasyarat

- **g++** dengan C++17 (`build-essential` di Debian/Ubuntu)
- **curl** atau **wget** (untuk unduh dependency)
- **Python 3** (opsional, untuk `make dev` — static file server)

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y build-essential curl python3
```

---

## Menjalankan (cepat)

```bash
cd artifacts   # atau folder project ini

# 1) Dependency header (sekali)
make deps
# atau: bash scripts/fetch_deps.sh

# 2) Build server
make

# 3a) Hanya API
make run
# → http://localhost:8080/api/health

# 3b) API + frontend sekaligus
make dev
# → Frontend http://localhost:5500/
# → API      http://localhost:8080/api
```

Buka browser di **http://localhost:5500/** (bukan `file://`) agar `fetch` ke API tidak diblok CORS/file origin.

### Akun demo

| Role   | Email             | Password |
|--------|-------------------|----------|
| Buyer  | buyer@demo.com    | demo     |
| Seller | seller@demo.com   | demo     |
| Admin  | admin@demo.com    | demo     |

---

## Konfigurasi

Edit `config.js`:

```js
window.YourShopConfig = {
  apiBase: 'http://localhost:8080/api',
};
```

Jika API di host/port lain, ubah `apiBase` saja.

Data persistensi server disimpan di **`ysi_data.json`** (otomatis dibuat saat order/produk berubah).

---

## API ringkas

| Method | Path | Keterangan |
|--------|------|------------|
| GET | `/api/health` | Health check |
| GET | `/api/products` | Katalog |
| POST | `/api/auth/login` | Login → token |
| POST | `/api/orders` | Buat pesanan |
| POST | `/api/orders/:id/pay` | Bayar (Midtrans Snap / mock) |
| POST | `/api/orders/:id/cancel` | Batalkan |
| POST | `/api/orders/:id/return` | Return/refund |
| GET | `/api/orders/:id/invoice` | Invoice JSON |
| GET | `/api/payments/config` | Client key + URL Snap.js |
| POST | `/api/payments/midtrans/notification` | Webhook Midtrans |

Header auth: `Authorization: Bearer <token>`.

---

## Pembayaran (Midtrans Snap)

1. Buat akun [Midtrans Sandbox](https://dashboard.sandbox.midtrans.com).
2. Salin **Server Key** & **Client Key** ke environment:

```bash
export MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
export MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
export MIDTRANS_IS_PRODUCTION=0
export YSI_IDR_RATE=16000   # konversi harga internal → IDR
```

3. Restart API. `GET /api/health` menampilkan `"payment":"midtrans"`.
4. Di dashboard Midtrans, set **Payment Notification URL** ke:
   `https://your-domain/api/payments/midtrans/notification`
5. Tanpa key, tombol bayar tetap memakai **mock** (langsung `paid`).

## Offline frontend

Jika server C++ tidak jalan, frontend tetap memakai **seed data lokal** (keranjang, checkout offline, dll.). Fitur yang butuh token server (suspend seller, majukan status via API, ubah password) memerlukan API online.

---

## Docker (opsional)

```bash
docker build -t yourshop .
docker run --rm -p 8080:8080 -p 5500:5500 yourshop
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `httplib.h: No such file` | `make deps` |
| CORS / failed fetch | Buka lewat `http://localhost:5500`, bukan `file://` |
| Port 8080 dipakai | Hentikan proses lain atau ubah port di `server.cpp` (`svr.listen`) |
| Login gagal setelah update auth | Hapus `ysi_data.json` agar seed user di-hash ulang, atau pakai password `demo` |
| g++ not found | Install `build-essential` |

---

## Lisensi dependensi

- [cpp-httplib](https://github.com/yhirose/cpp-httplib) — MIT  
- [nlohmann/json](https://github.com/nlohmann/json) — MIT  

Project demo YourShop.Id untuk pembelajaran / prototipe.
