// YourShop.Id — runtime config (load before main.js)
// Ubah nilai di sini tanpa menyentuh main.js
window.YourShopConfig = {
  // URL backend C++ (tanpa trailing slash)
  apiBase: 'http://localhost:8080/api',
  // Timeout fetch (ms) — opsional, dipakai jika main.js mendukung
  apiTimeoutMs: 8000,
};
