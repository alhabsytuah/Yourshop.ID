# YourShop.Id

Marketplace demo (frontend HTML/CSS/JS + backend REST C++).

UI terinspirasi eBay, bahasa Indonesia, mata uang Rp / USD, auth token, checkout, pembayaran mock, invoice, kurir, batalkan/return pesanan, gambar produk, review, varian, Q&A.

---

## Struktur

```
Yourshop.ID/
├── index.html          # UI utama
├── main.js             # Logika frontend
├── assets.js           # Brand tokens / SVG
├── config.js           # URL API (edit di sini)
├── server.cpp          # Backend REST C++17
├── Makefile
├── Dockerfile
├── scripts/
│   ├── fetch_deps.sh   # Unduh httplib.h + json.hpp
│   ├── start.sh        # Build + jalankan API
│   └── dev.sh          # API + static frontend
└── README.md
```

---

## Prasyarat

- **g++** dengan C++17 (`build-essential` di Debian/Ubuntu)
- **curl** atau **wget** (untuk unduh dependency)
- **Python 3** (opsional, untuk `make dev`)

```bash
sudo apt update && sudo apt install -y build-essential curl python3
```

---

## Menjalankan (cepat)

```bash
# 1) Dependency header (sekali)
make deps

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

Buka browser di **http://localhost:5500/** (bukan `file://`).

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

Data persistensi server: **`ysi_data.json`** (otomatis).

---

## Fitur utama

- Katalog + filter + search + featured
- Keranjang, checkout, ongkir multi-kurir
- Pembayaran mock (YourShopPay), invoice, batalkan, return
- Auth token + role (buyer/seller/admin)
- Gambar produk, varian, review, Q&A
- Admin/seller dashboard

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `httplib.h: No such file` | `make deps` |
| CORS / failed fetch | Buka lewat `http://localhost:5500` |
| Login gagal setelah update | Hapus `ysi_data.json` |

---

## Lisensi dependensi

- [cpp-httplib](https://github.com/yhirose/cpp-httplib) — MIT
- [nlohmann/json](https://github.com/nlohmann/json) — MIT
