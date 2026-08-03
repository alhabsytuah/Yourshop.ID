// YourShop.Id — runtime config (load before main.js)
// Ubah nilai di sini tanpa menyentuh main.js
window.YourShopConfig = {
  // URL backend C++ (tanpa trailing slash)
  apiBase: 'http://localhost:8080/api',
  // Timeout fetch (ms) — opsional, dipakai jika main.js mendukung
  apiTimeoutMs: 8000,
};
// CORS: server only allows origins in YSI_CORS_ORIGINS (default includes localhost:5500).
// HTTPS: set apiBase to "https://localhost:8443/api" when running with YSI_HTTPS=1
