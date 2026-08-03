// ============================================================
//  YourShop.Id — Backend API REST C++
//  server.cpp
//
//  Dependensi (install via vcpkg atau apt):
//    - cpp-httplib   (single-header HTTP server)
//    - nlohmann/json (single-header JSON)
//
//  Build:
//    g++ -std=c++17 -O2 -pthread server.cpp -o server
//
//  Jalankan:
//    ./server
//    → Listening on http://localhost:8080
//
//  Semua rute berawalan:  /api
// ============================================================

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <algorithm>
#include <mutex>
#include <optional>
#include <sstream>
#include <chrono>
#include <ctime>
#include <fstream>
#include <cctype>

// Single-header libraries — place in same directory or install system-wide
// https://github.com/yhirose/cpp-httplib   → httplib.h
// https://github.com/nlohmann/json         → json.hpp
#include "httplib.h"
#include "json.hpp"

using json = nlohmann::json;

// Forward decls — dipakai DataStore::seed()
static std::string hashPassword(const std::string& password, const std::string& salt);
static std::string makeSalt();

// ============================================================
//  DATA MODELS
// ============================================================

struct Product {
    int         id;
    std::string name;
    std::string emoji;
    double      price;
    double      oldPrice;     // 0.0 = no old price
    std::string category;
    std::string seller;
    double      rating;
    int         reviews;
    std::string badge;        // "Diskon", "Baru", "Original", ""
    bool        inStock;
    int         stockQty;     // kuantitas stok
    std::string description;
    std::vector<std::string> tags;
    bool        featured;

    json toJson() const {
        json j;
        j["id"]          = id;
        j["name"]        = name;
        j["emoji"]       = emoji;
        j["price"]       = price;
        j["oldPrice"]    = oldPrice > 0 ? json(oldPrice) : json(nullptr);
        j["category"]    = category;
        j["seller"]      = seller;
        j["rating"]      = rating;
        j["reviews"]     = reviews;
        j["badge"]       = badge.empty() ? json(nullptr) : json(badge);
        j["stock"]       = inStock && stockQty > 0;
        j["stockQty"]    = stockQty;
        j["inStock"]     = inStock && stockQty > 0;
        j["desc"]        = description;
        j["description"] = description;
        j["tags"]        = tags;
        j["featured"]    = featured;
        j["imageUrl"]    = imageUrl;
        j["variants"]    = variantsJson.is_array() ? variantsJson : json::array();
        return j;
    }

    std::string imageUrl;
    json        variantsJson = json::array();
};

struct OrderItem {
    int         productId;
    std::string productName;
    std::string emoji;
    int         qty;
    double      unitPrice;
};

struct TrackStep {
    std::string title;
    std::string date;
    std::string detail;
    bool        done;
    bool        active;
};

struct Order {
    std::string             id;
    std::string             customerId;
    std::string             customerName;
    std::string             date;
    std::string             status;   // processing | shipped | delivered | cancelled
    std::vector<OrderItem>  items;
    double                  total;
    std::vector<TrackStep>  steps;
    // Pembayaran & fulfillment
    std::string paymentStatus;   // pending | paid | failed | refunded
    std::string paymentMethod;   // transfer | ewallet | card
    std::string paidAt;
    std::string invoiceNumber;
    std::string shippingMethod;  // jne | jnt | sicepat | regular
    double      shippingCost = 0;
    std::string shipAddress;
    std::string shipCity;
    std::string shipPhone;
    std::string cancelReason;
    std::string returnStatus;    // none | requested | approved | rejected | refunded
    std::string returnReason;

    json toJson() const {
        json j;
        j["id"]             = id;
        j["customerId"]     = customerId;
        j["customerName"]   = customerName;
        j["date"]           = date;
        j["status"]         = status;
        j["total"]          = total;
        j["paymentStatus"]  = paymentStatus;
        j["paymentMethod"]  = paymentMethod;
        j["paidAt"]         = paidAt;
        j["invoiceNumber"]  = invoiceNumber;
        j["shippingMethod"] = shippingMethod;
        j["shippingCost"]   = shippingCost;
        j["shipAddress"]    = shipAddress;
        j["shipCity"]       = shipCity;
        j["shipPhone"]      = shipPhone;
        j["cancelReason"]   = cancelReason;
        j["returnStatus"]   = returnStatus.empty() ? "none" : returnStatus;
        j["returnReason"]   = returnReason;

        json itemsArr = json::array();
        for (const auto& item : items) {
            json i;
            i["productId"]   = item.productId;
            i["name"]        = item.productName;
            i["emoji"]       = item.emoji;
            i["qty"]         = item.qty;
            i["unitPrice"]   = item.unitPrice;
            itemsArr.push_back(i);
        }
        j["items"] = itemsArr;

        json stepsArr = json::array();
        for (const auto& s : steps) {
            json step;
            step["title"]  = s.title;
            step["date"]   = s.date;
            step["detail"] = s.detail;
            step["done"]   = s.done;
            step["active"] = s.active;
            stepsArr.push_back(step);
        }
        j["steps"] = stepsArr;
        return j;
    }
};

struct User {
    std::string id;
    std::string name;
    std::string email;
    std::string passwordHash; // simpan hash bcrypt di produksi
    std::string role;         // "buyer" | "seller" | "admin"
    std::string shopName;     // khusus penjual
    std::string phone;
    std::string address;
    std::string createdAt;

    json toJson() const {
        json j;
        j["id"]        = id;
        j["name"]      = name;
        j["email"]     = email;
        j["role"]      = role;
        j["shopName"]  = shopName;
        j["phone"]     = phone;
        j["address"]   = address;
        j["createdAt"] = createdAt;
        // jangan pernah kembalikan passwordHash ke klien
        return j;
    }
};

// ============================================================
//  IN-MEMORY DATA STORE
//  Ganti dengan DB nyata (PostgreSQL, SQLite, MySQL) via
//  libpqxx, SQLiteCpp, atau mysqlcppconn di produksi
// ============================================================

class DataStore {
public:
    std::vector<Product> products;
    std::vector<Order>   orders;
    std::vector<User>    users;
    std::vector<std::string> suspendedSellers;
    int                  nextProductId = 100;
    int                  nextOrderSeq  = 9000;
    int                  nextUserSeq   = 10;
    int                  nextInvoiceSeq = 1000;
    std::mutex           mu;
    std::string          dataFile = "ysi_data.json";

    DataStore() {
        if (!loadFromDisk()) seed();
    }

    bool isSellerSuspended(const std::string& name) const {
        return std::find(suspendedSellers.begin(), suspendedSellers.end(), name) != suspendedSellers.end();
    }

    void saveToDisk() {
        try {
            json root;
            root["nextProductId"] = nextProductId;
            root["nextOrderSeq"]  = nextOrderSeq;
            root["nextUserSeq"]   = nextUserSeq;
            root["suspendedSellers"] = suspendedSellers;

            json prods = json::array();
            for (const auto& p : products) prods.push_back(p.toJson());
            root["products"] = prods;

            json ords = json::array();
            for (const auto& o : orders) ords.push_back(o.toJson());
            root["orders"] = ords;

            json us = json::array();
            for (const auto& u : users) {
                auto j = u.toJson();
                j["passwordHash"] = u.passwordHash; // simpan internal saja di file
                us.push_back(j);
            }
            root["users"] = us;

            std::ofstream ofs(dataFile);
            if (ofs) ofs << root.dump(2);
        } catch (...) {
            std::cerr << "[warn] gagal menyimpan " << dataFile << std::endl;
        }
    }

private:
    bool loadFromDisk() {
        try {
            std::ifstream ifs(dataFile);
            if (!ifs.good()) return false;
            json root;
            ifs >> root;
            if (!root.contains("products") || !root["products"].is_array()) return false;

            nextProductId = root.value("nextProductId", 100);
            nextOrderSeq  = root.value("nextOrderSeq", 9000);
            nextUserSeq   = root.value("nextUserSeq", 10);
            if (root.contains("suspendedSellers"))
                suspendedSellers = root["suspendedSellers"].get<std::vector<std::string>>();

            products.clear();
            for (const auto& j : root["products"]) {
                Product p;
                p.id          = j.value("id", 0);
                p.name        = j.value("name", "");
                p.emoji       = j.value("emoji", "📦");
                p.price       = j.value("price", 0.0);
                p.oldPrice    = j["oldPrice"].is_null() ? 0.0 : j.value("oldPrice", 0.0);
                p.category    = j.value("category", "Umum");
                p.seller      = j.value("seller", "");
                p.rating      = j.value("rating", 0.0);
                p.reviews     = j.value("reviews", 0);
                p.badge       = j["badge"].is_null() ? "" : j.value("badge", "");
                p.stockQty    = j.value("stockQty", 25);
                p.inStock     = j.value("stock", true) && p.stockQty > 0;
                p.description = j.contains("desc") ? j.value("desc", "") : j.value("description", "");
                p.featured    = j.value("featured", false);
                if (j.contains("tags") && j["tags"].is_array())
                    p.tags = j["tags"].get<std::vector<std::string>>();
                products.push_back(p);
            }

            orders.clear();
            if (root.contains("orders")) {
                for (const auto& j : root["orders"]) {
                    Order o;
                    o.id           = j.value("id", "");
                    o.customerId   = j.value("customerId", "");
                    o.customerName = j.value("customerName", "");
                    o.date         = j.value("date", "");
                    o.status       = j.value("status", "processing");
                    o.total        = j.value("total", 0.0);
                    if (j.contains("items")) {
                        for (const auto& it : j["items"]) {
                            OrderItem oi;
                            oi.productId   = it.value("productId", 0);
                            oi.productName = it.value("name", it.value("productName", ""));
                            oi.emoji       = it.value("emoji", "📦");
                            oi.qty         = it.value("qty", 1);
                            oi.unitPrice   = it.value("unitPrice", 0.0);
                            o.items.push_back(oi);
                        }
                    }
                    if (j.contains("steps")) {
                        for (const auto& s : j["steps"]) {
                            o.steps.push_back({
                                s.value("title", ""), s.value("date", ""), s.value("detail", ""),
                                s.value("done", false), s.value("active", false)
                            });
                        }
                    }
                    orders.push_back(o);
                }
            }

            users.clear();
            if (root.contains("users")) {
                for (const auto& j : root["users"]) {
                    User u;
                    u.id           = j.value("id", "");
                    u.name         = j.value("name", "");
                    u.email        = j.value("email", "");
                    u.passwordHash = j.value("passwordHash", "demo");
                    u.role         = j.value("role", "buyer");
                    u.shopName     = j.value("shopName", "");
                    u.phone        = j.value("phone", "");
                    u.address      = j.value("address", "");
                    u.createdAt    = j.value("createdAt", "");
                    users.push_back(u);
                }
            }
            std::cout << "[YourShop] Data dimuat dari " << dataFile << std::endl;
            return !products.empty();
        } catch (...) {
            return false;
        }
    }

    void seed() {
        // --- Produk (kategori & badge selaras dengan frontend ID) ---
        // id, name, emoji, price, oldPrice, category, seller, rating, reviews, badge, inStock, stockQty, desc, tags, featured
        products = {
            {1,  "Wireless Earbuds Pro",           "🎧", 79.99,  99.99,  "Elektronik", "SoundCraft",  4.7, 1240, "Diskon",   true, 40, "Earbuds nirkabel premium dengan peredam kebisingan aktif, baterai 30 jam, dan audio jernih.", {"wireless","audio","electronics"}, true  },
            {2,  "Mechanical Keyboard RGB",         "⌨️", 129.00, 0,      "Elektronik", "TechDesk",    4.5, 856,  "",         true, 25, "Switch mekanikal taktil dengan pencahayaan RGB penuh. Tata letak TKL kompak.", {"keyboard","gaming","rgb"}, false },
            {3,  "Vintage Denim Jacket",            "🧥", 64.00,  89.00,  "Fashion",    "UrbanThread", 4.8, 432,  "Diskon",   true, 18, "Jaket denim stonewash klasik. Potongan santai, saku dada, dan konstruksi tahan lama.", {"denim","jacket","vintage"}, false },
            {4,  "Ceramic Pour-Over Set",           "☕", 45.99,  0,      "Rumah",      "BrewHouse",   4.9, 310,  "Baru",     true, 30, "Dripper pour-over keramik buatan tangan dengan mug serasi.", {"coffee","ceramic","kitchen"}, false },
            {5,  "The Design of Everyday Things",  "📚", 18.99,  0,      "Buku",       "PageTurner",  4.6, 2100, "",         true, 50, "Klasik abadi karya Don Norman tentang desain yang bisa digunakan.", {"design","books","ux"}, false },
            {6,  "Yoga Mat Premium",               "🧘", 49.00,  65.00,  "Olahraga",   "ZenFit",      4.7, 720,  "Diskon",   true, 22, "Matras yoga anti-selip tebal 6mm. Bahan TPE ramah lingkungan.", {"yoga","fitness","eco"}, false },
            {7,  "Artisan Hot Sauce Set",           "🌶️", 28.00,  0,      "Makanan",    "HeatCraft",   4.8, 540,  "",         true, 35, "Set 4 saus pedas buatan tangan dari ringan hingga ekstra pedas.", {"food","hot sauce","artisan"}, false },
            {8,  "Abstract Print #12",             "🎨", 120.00, 0,      "Seni",       "ArtStudio",   5.0, 89,   "Original", true, 8,  "Cetakan giclée edisi terbatas di atas kertas seni berkualitas.", {"art","print","limited"}, false },
            {9,  "Smart Watch Series 5",           "⌚", 199.00, 249.00, "Elektronik", "WristTech",   4.4, 1890, "Diskon",   true, 15, "Pelacak kesehatan, GPS, dan baterai 7 hari. Tahan air hingga 50m.", {"smartwatch","fitness","tech"}, true  },
            {10, "Linen Throw Blanket",            "🛋️", 38.00,  0,      "Rumah",      "CozyHome",    4.6, 230,  "Baru",     true, 20, "Linen Eropa 100% stonewash. Ringan, bernapas, semakin lembut setiap dicuci.", {"linen","home","cozy"}, false },
            {11, "Running Shoes Ultra",            "👟", 95.00,  120.00, "Fashion",    "SpeedStep",   4.5, 678,  "Diskon",   true, 12, "Sol tengah busa responsif dan bagian atas mesh bernapas.", {"shoes","running","sport"}, false },
            {12, "Cold Brew Concentrate",          "🧃", 16.50,  0,      "Makanan",    "BrewHouse",   4.7, 410,  "",         true, 60, "Kopi cold brew siap diencerkan. Direndam 20 jam. Encerkan 1:3.", {"coffee","cold brew","food"}, false },
        };

        // --- Users (password demo: "demo" — di-hash dengan salt) ---
        auto hp = [](const std::string& pw) {
            return hashPassword(pw, makeSalt());
        };
        users = {
            {"u1", "Budi Santoso",   "buyer@demo.com",  hp("demo"), "buyer",  "",           "", "", "2026-01-10"},
            {"u2", "Sari Kerajinan", "seller@demo.com", hp("demo"), "seller", "CraftWorks", "", "", "2026-01-15"},
            {"u3", "Dian Admin",     "admin@demo.com",  hp("demo"), "admin",  "",           "", "", "2026-01-01"},
        };

        // --- Pesanan ---
        orders = {
            {
                "#ORD-8821", "u1", "Budi Santoso", "May 7, 2026", "delivered",
                {{1, "Wireless Earbuds Pro", "🎧", 1, 79.99}, {4, "Ceramic Pour-Over Set", "☕", 1, 45.99}},
                125.98,
                {
                    {"Pesanan Dibuat",     "May 1",  "Pesananmu telah dikonfirmasi.", true,  false},
                    {"Diproses",           "May 2",  "Penjual mengemas barangmu.",    true,  false},
                    {"Dikirim",            "May 3",  "Paket diambil oleh kurir.",     true,  false},
                    {"Dalam Pengiriman",   "May 6",  "Bersama kurir lokal.",          true,  false},
                    {"Terkirim",           "May 7",  "Ditinggal di depan pintu.",     true,  false},
                }
            },
            {
                "#ORD-8745", "u1", "Budi Santoso", "Apr 29, 2026", "shipped",
                {{5, "The Design of Everyday Things", "📚", 1, 18.99}},
                18.99,
                {
                    {"Pesanan Dibuat",     "Apr 29",     "Pesananmu telah dikonfirmasi.", true,  false},
                    {"Diproses",           "Apr 30",     "Penjual mengemas barangmu.",    true,  false},
                    {"Dikirim",            "May 1",      "Paket sedang dalam perjalanan.", true, false},
                    {"Dalam Pengiriman",   "ETA May 11", "Estimasi tiba.",                false, true },
                    {"Terkirim",           "—",          "Menunggu.",                     false, false},
                }
            },
            {
                "#ORD-8612", "u1", "Budi Santoso", "Apr 20, 2026", "processing",
                {{8, "Abstract Print #12", "🎨", 1, 120.00}, {10, "Linen Throw Blanket", "🛋️", 1, 38.00}},
                158.00,
                {
                    {"Pesanan Dibuat",     "Apr 20", "Pesananmu telah dikonfirmasi.",      true,  false},
                    {"Diproses",           "Apr 21", "Penjual sedang menyiapkan pesananmu.", false, true },
                    {"Dikirim",            "—",      "Menunggu.",                           false, false},
                    {"Dalam Pengiriman",   "—",      "Menunggu.",                           false, false},
                    {"Terkirim",           "—",      "Menunggu.",                           false, false},
                }
            },
        };
    }
};

// ============================================================
//  HELPERS
// ============================================================

static DataStore store;

// Header CORS sederhana — perketat origin di produksi
void setCorsHeaders(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin",  "*");
    res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

void jsonResponse(httplib::Response& res, const json& body, int status = 200) {
    setCorsHeaders(res);
    res.status = status;
    res.set_content(body.dump(), "application/json");
}

void errorResponse(httplib::Response& res, const std::string& msg, int status = 400) {
    jsonResponse(res, {{"error", msg}}, status);
}

std::string currentTimestamp() {
    auto now  = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", std::localtime(&t));
    return std::string(buf);
}

std::string shortDate() {
    auto now  = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    char buf[32];
    std::strftime(buf, sizeof(buf), "%b %d", std::localtime(&t));
    return std::string(buf);
}

// ============================================================
//  AUTH — token, password hash, middleware
//  (HMAC-lite + salted hash; ganti ke JWT+bcrypt di produksi)
// ============================================================

static const std::string AUTH_SECRET = "YourShop.Id-secret-change-me-in-prod-2026";
static const int TOKEN_TTL_SEC = 24 * 3600; // 24 jam
static std::mutex tokenBlacklistMu;
static std::unordered_map<std::string, long long> tokenBlacklist; // token -> exp

struct AuthContext {
    std::string userId;
    std::string role;
    std::string email;
    std::string token;
    long long   exp = 0;
};

static uint64_t fnv1a64(const std::string& s) {
    uint64_t h = 14695981039346656037ull;
    for (unsigned char c : s) {
        h ^= c;
        h *= 1099511628211ull;
    }
    return h;
}

static std::string toHex64(uint64_t v) {
    static const char* hex = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) {
        out[i] = hex[v & 0xf];
        v >>= 4;
    }
    return out;
}

/** Hash iteratif ber-salt (bukan bcrypt; cukup untuk demo + lebih baik dari plaintext) */
static std::string hashPassword(const std::string& password, const std::string& salt) {
    std::string cur = salt + ":" + password + ":" + AUTH_SECRET;
    uint64_t h = 0;
    for (int i = 0; i < 5000; ++i) {
        h = fnv1a64(cur + std::to_string(h) + std::to_string(i));
        cur = toHex64(h) + salt;
    }
    return "ysi1$" + salt + "$" + toHex64(h);
}

static std::string makeSalt() {
    auto now = std::chrono::system_clock::now().time_since_epoch().count();
    return toHex64(fnv1a64(std::to_string(now) + AUTH_SECRET)).substr(0, 12);
}

static bool verifyPassword(const std::string& password, const std::string& stored) {
    // Format baru: ysi1$salt$hash
    if (stored.rfind("ysi1$", 0) == 0) {
        auto p1 = stored.find('$', 5);
        if (p1 == std::string::npos) return false;
        std::string salt = stored.substr(5, p1 - 5);
        return hashPassword(password, salt) == stored;
    }
    // Compat seed lama
    if (password == "demo" && (stored == "demo" || stored.rfind("hashed_", 0) == 0 || stored.empty()))
        return true;
    if (stored == password || stored == ("hashed_" + password)) return true;
    return false;
}

static std::string b64encode(const std::string& in) {
    static const char* t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    std::string out;
    int val = 0, valb = -6;
    for (unsigned char c : in) {
        val = (val << 8) + c;
        valb += 8;
        while (valb >= 0) {
            out.push_back(t[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) out.push_back(t[((val << 8) >> (valb + 8)) & 0x3F]);
    return out;
}

static std::string b64decode(const std::string& in) {
    static int T[256];
    static bool init = false;
    if (!init) {
        for (int i = 0; i < 256; i++) T[i] = -1;
        for (int i = 0; i < 64; i++) {
            const char* t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            T[(unsigned char)t[i]] = i;
        }
        init = true;
    }
    std::string out;
    int val = 0, valb = -8;
    for (unsigned char c : in) {
        if (T[c] == -1) break;
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            out.push_back(char((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

static std::string signPayload(const std::string& payload) {
    return toHex64(fnv1a64(payload + "|" + AUTH_SECRET));
}

static std::string createToken(const User& u) {
    long long exp = (long long)std::time(nullptr) + TOKEN_TTL_SEC;
    json payload = {
        {"sub", u.id},
        {"role", u.role},
        {"email", u.email},
        {"exp", exp},
        {"iat", (long long)std::time(nullptr)},
    };
    std::string body = b64encode(payload.dump());
    std::string sig = signPayload(body);
    return "ysi." + body + "." + sig;
}

static bool isTokenBlacklisted(const std::string& token) {
    std::lock_guard<std::mutex> lock(tokenBlacklistMu);
    auto it = tokenBlacklist.find(token);
    if (it == tokenBlacklist.end()) return false;
    if (it->second < (long long)std::time(nullptr)) {
        tokenBlacklist.erase(it);
        return false;
    }
    return true;
}

static void blacklistToken(const std::string& token, long long exp) {
    std::lock_guard<std::mutex> lock(tokenBlacklistMu);
    tokenBlacklist[token] = exp;
}

static std::optional<AuthContext> verifyToken(const std::string& token) {
    if (token.size() < 10 || token.rfind("ysi.", 0) != 0) return std::nullopt;
    if (isTokenBlacklisted(token)) return std::nullopt;

    auto p1 = token.find('.', 4);
    if (p1 == std::string::npos) return std::nullopt;
    std::string body = token.substr(4, p1 - 4);
    std::string sig  = token.substr(p1 + 1);
    if (signPayload(body) != sig) return std::nullopt;

    try {
        json payload = json::parse(b64decode(body));
        long long exp = payload.value("exp", 0LL);
        if (exp < (long long)std::time(nullptr)) return std::nullopt;
        AuthContext ctx;
        ctx.userId = payload.value("sub", "");
        ctx.role   = payload.value("role", "");
        ctx.email  = payload.value("email", "");
        ctx.token  = token;
        ctx.exp    = exp;
        if (ctx.userId.empty()) return std::nullopt;
        return ctx;
    } catch (...) {
        return std::nullopt;
    }
}

static std::string extractBearer(const httplib::Request& req) {
    auto auth = req.get_header_value("Authorization");
    if (auth.size() > 7 && (auth.rfind("Bearer ", 0) == 0 || auth.rfind("bearer ", 0) == 0))
        return auth.substr(7);
    // fallback query ?token=
    if (req.has_param("token")) return req.get_param_value("token");
    return "";
}

static std::optional<AuthContext> requireAuth(const httplib::Request& req, httplib::Response& res) {
    auto token = extractBearer(req);
    if (token.empty()) {
        errorResponse(res, "Unauthorized: token diperlukan", 401);
        return std::nullopt;
    }
    auto ctx = verifyToken(token);
    if (!ctx) {
        errorResponse(res, "Unauthorized: token tidak valid atau kedaluwarsa", 401);
        return std::nullopt;
    }
    return ctx;
}

static std::optional<AuthContext> requireRole(const httplib::Request& req, httplib::Response& res,
                                               const std::vector<std::string>& roles) {
    auto ctx = requireAuth(req, res);
    if (!ctx) return std::nullopt;
    if (std::find(roles.begin(), roles.end(), ctx->role) == roles.end()) {
        errorResponse(res, "Forbidden: peran tidak diizinkan", 403);
        return std::nullopt;
    }
    return ctx;
}

// Reset tokens (email -> {token, exp})
static std::mutex resetMu;
static std::unordered_map<std::string, std::pair<std::string, long long>> resetTokens;

/** Normalisasi status ke bentuk internal Inggris + terima input ID */
std::string normalizeStatus(const std::string& s) {
    if (s == "diproses" || s == "processing") return "processing";
    if (s == "dikirim"  || s == "shipped")    return "shipped";
    if (s == "terkirim" || s == "delivered")  return "delivered";
    return s.empty() ? "processing" : s;
}

std::vector<TrackStep> buildStepsForStatus(const std::string& status) {
    std::string st = normalizeStatus(status);
    std::string today = shortDate();
    std::vector<TrackStep> steps = {
        {"Pesanan Dibuat",     today, "Pesananmu telah dikonfirmasi.",        true,  false},
        {"Diproses",           "—",   "Penjual sedang menyiapkan barangmu.",  false, false},
        {"Dikirim",            "—",   "Paket diambil oleh kurir.",            false, false},
        {"Dalam Pengiriman",   "—",   "Paket dalam perjalanan.",              false, false},
        {"Terkirim",           "—",   "Paket sampai ke penerima.",            false, false},
    };
    int idx = 1;
    if (st == "shipped")   idx = 3;
    if (st == "delivered") idx = 4;
    for (int i = 0; i <= idx; i++) {
        steps[i].done = true;
        if (steps[i].date == "—") steps[i].date = today;
    }
    if (st != "delivered") {
        steps[idx].active = true;
    }
    return steps;
}

// ============================================================
//  ROUTE HANDLERS
// ============================================================

// ------ GET /api/products ------
// Parameter kueri: category, search, minPrice, maxPrice, sort, inStock, onSale
void handleGetProducts(const httplib::Request& req, httplib::Response& res) {
    std::lock_guard<std::mutex> lock(store.mu);

    std::string category  = req.get_param_value("category");
    std::string search    = req.get_param_value("search");
    std::string sortBy    = req.get_param_value("sort");
    double      minPrice  = req.has_param("minPrice") ? std::stod(req.get_param_value("minPrice")) : 0.0;
    double      maxPrice  = req.has_param("maxPrice") ? std::stod(req.get_param_value("maxPrice")) : 1e9;
    bool        inStock   = req.get_param_value("inStock")  == "true";
    bool        onSale    = req.get_param_value("onSale")   == "true";

    std::vector<Product> list = store.products;

    // Filter kategori
    if (!category.empty() && category != "All") {
        list.erase(std::remove_if(list.begin(), list.end(),
            [&](const Product& p){ return p.category != category; }), list.end());
    }

    // Filter pencarian
    if (!search.empty()) {
        std::string q = search;
        std::transform(q.begin(), q.end(), q.begin(), ::tolower);
        list.erase(std::remove_if(list.begin(), list.end(), [&](const Product& p){
            auto lower = [](const std::string& s){
                std::string r = s;
                std::transform(r.begin(), r.end(), r.begin(), ::tolower);
                return r;
            };
            return lower(p.name).find(q) == std::string::npos &&
                   lower(p.category).find(q) == std::string::npos &&
                   lower(p.seller).find(q) == std::string::npos;
        }), list.end());
    }

    // Filter harga
    list.erase(std::remove_if(list.begin(), list.end(),
        [&](const Product& p){ return p.price < minPrice || p.price > maxPrice; }), list.end());

    // Filter stok / diskon
    if (inStock) list.erase(std::remove_if(list.begin(), list.end(),
        [](const Product& p){ return !p.inStock; }), list.end());
    if (onSale)  list.erase(std::remove_if(list.begin(), list.end(),
        [](const Product& p){ return p.oldPrice <= 0; }), list.end());

    // Featured only
    bool featuredOnly = req.get_param_value("featured") == "true";
    if (featuredOnly) {
        list.erase(std::remove_if(list.begin(), list.end(),
            [](const Product& p){ return !p.featured; }), list.end());
    }

    // Sembunyikan produk penjual ditangguhkan
    list.erase(std::remove_if(list.begin(), list.end(),
        [](const Product& p){ return store.isSellerSuspended(p.seller); }), list.end());

    // Urutkan
    if (sortBy == "price-asc")  std::sort(list.begin(), list.end(), [](const Product& a, const Product& b){ return a.price < b.price; });
    if (sortBy == "price-desc") std::sort(list.begin(), list.end(), [](const Product& a, const Product& b){ return a.price > b.price; });
    if (sortBy == "rating")     std::sort(list.begin(), list.end(), [](const Product& a, const Product& b){ return a.rating > b.rating; });
    if (sortBy == "newest")     std::sort(list.begin(), list.end(), [](const Product& a, const Product& b){ return a.id > b.id; });

    json arr = json::array();
    for (const auto& p : list) arr.push_back(p.toJson());
    jsonResponse(res, arr);
}

// ------ GET /api/products/:id ------
void handleGetProduct(const httplib::Request& req, httplib::Response& res) {
    int id = std::stoi(req.matches[1]);
    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.products.begin(), store.products.end(),
                           [id](const Product& p){ return p.id == id; });
    if (it == store.products.end()) { errorResponse(res, "Produk tidak ditemukan", 404); return; }
    jsonResponse(res, it->toJson());
}

// ------ POST /api/products ------
void handleCreateProduct(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"seller", "admin"});
    if (!auth) return;

    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    if (!body.contains("name") || !body.contains("price") || !body.contains("seller")) {
        errorResponse(res, "Kolom wajib kosong: name, price, seller"); return;
    }

    Product p;
    {
        std::lock_guard<std::mutex> lock(store.mu);
        p.id          = ++store.nextProductId;
        p.name        = body["name"].get<std::string>();
        p.emoji       = body.value("emoji", "📦");
        p.price       = body["price"].get<double>();
        p.oldPrice    = body.value("oldPrice", 0.0);
        p.category    = body.value("category", "General");
        p.seller      = body["seller"].get<std::string>();
        p.rating      = 0.0;
        p.reviews     = 0;
        p.badge       = body.value("oldPrice", 0.0) > 0 ? "Diskon" : "Baru";
        p.stockQty    = body.value("stockQty", 25);
        p.inStock     = p.stockQty > 0;
        p.description = body.value("desc", body.value("description", ""));
        p.featured    = body.value("featured", false);
        p.imageUrl    = body.value("imageUrl", "");
        if (body.contains("variants") && body["variants"].is_array())
            p.variantsJson = body["variants"];
        if (body.contains("tags") && body["tags"].is_array())
            p.tags = body["tags"].get<std::vector<std::string>>();
        else
            p.tags = {p.category};
        store.products.insert(store.products.begin(), p);
        store.saveToDisk();
    }
    jsonResponse(res, p.toJson(), 201);
}

// ------ PUT /api/products/:id ------
void handleUpdateProduct(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"seller", "admin"});
    if (!auth) return;

    int id = std::stoi(req.matches[1]);
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.products.begin(), store.products.end(),
                           [id](const Product& p){ return p.id == id; });
    if (it == store.products.end()) { errorResponse(res, "Produk tidak ditemukan", 404); return; }

    if (body.contains("name"))        it->name        = body["name"].get<std::string>();
    if (body.contains("price"))       it->price       = body["price"].get<double>();
    if (body.contains("oldPrice"))    it->oldPrice    = body["oldPrice"].is_null() ? 0.0 : body["oldPrice"].get<double>();
    if (body.contains("category"))    it->category    = body["category"].get<std::string>();
    if (body.contains("seller"))      it->seller      = body["seller"].get<std::string>();
    if (body.contains("stock"))       it->inStock     = body["stock"].get<bool>();
    if (body.contains("stockQty")) {
        it->stockQty = body["stockQty"].get<int>();
        it->inStock  = it->stockQty > 0;
    }
    if (body.contains("desc"))        it->description = body["desc"].get<std::string>();
    if (body.contains("emoji"))       it->emoji       = body["emoji"].get<std::string>();
    if (body.contains("badge"))       it->badge       = body["badge"].is_null() ? "" : body["badge"].get<std::string>();
    if (body.contains("featured"))    it->featured    = body["featured"].get<bool>();
    if (body.contains("imageUrl"))    it->imageUrl    = body["imageUrl"].get<std::string>();
    if (body.contains("variants") && body["variants"].is_array())
        it->variantsJson = body["variants"];
    if (it->oldPrice > 0 && it->badge.empty()) it->badge = "Diskon";

    store.saveToDisk();
    jsonResponse(res, it->toJson());
}

// ------ DELETE /api/products/:id ------
void handleDeleteProduct(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"seller", "admin"});
    if (!auth) return;

    int id = std::stoi(req.matches[1]);
    std::lock_guard<std::mutex> lock(store.mu);
    auto before = store.products.size();
    store.products.erase(std::remove_if(store.products.begin(), store.products.end(),
        [id](const Product& p){ return p.id == id; }), store.products.end());
    if (store.products.size() == before) { errorResponse(res, "Produk tidak ditemukan", 404); return; }
    store.saveToDisk();
    jsonResponse(res, {{"message", "Produk dihapus"}, {"id", id}});
}

// ------ GET /api/orders ------
// Parameter kueri: customerId, status
void handleGetOrders(const httplib::Request& req, httplib::Response& res) {
    std::lock_guard<std::mutex> lock(store.mu);
    std::string custId = req.get_param_value("customerId");
    std::string status = req.get_param_value("status");

    json arr = json::array();
    for (const auto& o : store.orders) {
        if (!custId.empty() && o.customerId != custId) continue;
        if (!status.empty() && o.status     != status) continue;
        arr.push_back(o.toJson());
    }
    jsonResponse(res, arr);
}

// ------ GET /api/orders/:id ------
void handleGetOrder(const httplib::Request& req, httplib::Response& res) {
    std::string id = req.matches[1].str();
    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.orders.begin(), store.orders.end(),
                           [&id](const Order& o){ return o.id == id; });
    if (it == store.orders.end()) { errorResponse(res, "Pesanan tidak ditemukan", 404); return; }
    jsonResponse(res, it->toJson());
}

// ------ POST /api/orders ------
// Body: { customerId, customerName, items: [{productId, qty}] }
void handleCreateOrder(const httplib::Request& req, httplib::Response& res) {
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    if (!body.contains("customerId") || !body.contains("items")) {
        errorResponse(res, "Kolom wajib kosong: customerId, items"); return;
    }

    std::lock_guard<std::mutex> lock(store.mu);

    Order order;
    order.id           = "#ORD-" + std::to_string(++store.nextOrderSeq);
    order.customerId   = body["customerId"].get<std::string>();
    order.customerName = body.value("customerName", "Customer");
    order.date         = currentTimestamp();
    order.status       = "processing";
    order.total        = 0.0;

    for (const auto& item : body["items"]) {
        int productId = item["productId"].get<int>();
        int qty       = item.value("qty", 1);
        auto pit = std::find_if(store.products.begin(), store.products.end(),
                                [productId](const Product& p){ return p.id == productId; });
        if (pit == store.products.end()) continue;
        if (store.isSellerSuspended(pit->seller)) {
            errorResponse(res, "Produk dari toko yang ditangguhkan tidak bisa dipesan"); return;
        }
        if (!pit->inStock || pit->stockQty < qty) {
            errorResponse(res, "Stok tidak cukup untuk: " + pit->name); return;
        }
        order.items.push_back({productId, pit->name, pit->emoji, qty, pit->price});
        order.total += pit->price * qty;
        pit->stockQty -= qty;
        if (pit->stockQty <= 0) { pit->stockQty = 0; pit->inStock = false; }
    }

    if (order.items.empty()) {
        errorResponse(res, "Tidak ada item valid dalam pesanan"); return;
    }

    double shippingCost = body.value("shippingCost", 0.0);
    order.shippingCost   = shippingCost;
    order.shippingMethod = body.value("shippingMethod", "regular");
    order.paymentMethod  = body.value("paymentMethod", "transfer");
    order.paymentStatus  = "pending";
    order.shipAddress    = body.value("shipAddress", "");
    order.shipCity       = body.value("shipCity", "");
    order.shipPhone      = body.value("shipPhone", "");
    order.returnStatus   = "none";
    order.total         += shippingCost;
    // pajak sederhana 8% dari subtotal (total sebelum shipping)
    double subtotal = order.total - shippingCost;
    order.total = subtotal + shippingCost + (subtotal * 0.08);

    order.invoiceNumber = "INV-" + std::to_string(2026) + "-" + std::to_string(++store.nextInvoiceSeq);
    order.steps = buildStepsForStatus("processing");
    order.steps[0].date = order.date;

    store.orders.insert(store.orders.begin(), order);
    store.saveToDisk();
    jsonResponse(res, order.toJson(), 201);
}

// ------ PUT /api/orders/:id/status ------
void handleUpdateOrderStatus(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"seller", "admin"});
    if (!auth) return;

    std::string id = req.matches[1].str();
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.orders.begin(), store.orders.end(),
                           [&id](const Order& o){ return o.id == id; });
    if (it == store.orders.end()) { errorResponse(res, "Pesanan tidak ditemukan", 404); return; }
    if (!body.contains("status")) { errorResponse(res, "Kolom status tidak ada"); return; }
    if (it->status == "cancelled") { errorResponse(res, "Pesanan sudah dibatalkan"); return; }

    std::string newStatus = normalizeStatus(body["status"].get<std::string>());
    if (newStatus != "cancelled" && it->paymentStatus != "paid") {
        errorResponse(res, "Pesanan belum dibayar"); return;
    }
    it->status = newStatus;
    it->steps  = buildStepsForStatus(newStatus);
    store.saveToDisk();
    jsonResponse(res, it->toJson());
}

// ------ POST /api/orders/:id/pay ------  Mock payment gateway
// Body: { paymentMethod?, simulateFail? }
void handlePayOrder(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;

    std::string id = req.matches[1].str();
    json body;
    try { body = req.body.empty() ? json::object() : json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.orders.begin(), store.orders.end(),
                           [&id](const Order& o){ return o.id == id; });
    if (it == store.orders.end()) { errorResponse(res, "Pesanan tidak ditemukan", 404); return; }
    if (auth->role != "admin" && it->customerId != auth->userId) {
        errorResponse(res, "Forbidden", 403); return;
    }
    if (it->status == "cancelled") { errorResponse(res, "Pesanan dibatalkan"); return; }
    if (it->paymentStatus == "paid") { jsonResponse(res, it->toJson()); return; }

    if (body.value("simulateFail", false)) {
        it->paymentStatus = "failed";
        store.saveToDisk();
        errorResponse(res, "Pembayaran gagal (simulasi gateway)", 402); return;
    }

    if (body.contains("paymentMethod"))
        it->paymentMethod = body["paymentMethod"].get<std::string>();
    it->paymentStatus = "paid";
    it->paidAt = currentTimestamp();
    if (it->invoiceNumber.empty())
        it->invoiceNumber = "INV-2026-" + std::to_string(++store.nextInvoiceSeq);
    store.saveToDisk();

    json resp = it->toJson();
    resp["gateway"] = {
        {"provider", "YourShopPay (mock)"},
        {"reference", "YP-" + std::to_string(std::time(nullptr))},
        {"message", "Pembayaran berhasil diproses"}
    };
    jsonResponse(res, resp);
}

// ------ POST /api/orders/:id/cancel ------
void handleCancelOrder(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;

    std::string id = req.matches[1].str();
    json body;
    try { body = req.body.empty() ? json::object() : json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.orders.begin(), store.orders.end(),
                           [&id](const Order& o){ return o.id == id; });
    if (it == store.orders.end()) { errorResponse(res, "Pesanan tidak ditemukan", 404); return; }
    if (auth->role != "admin" && it->customerId != auth->userId) {
        errorResponse(res, "Forbidden", 403); return;
    }
    if (it->status == "shipped" || it->status == "delivered") {
        errorResponse(res, "Pesanan sudah dikirim/terkirim — ajukan return"); return;
    }
    if (it->status == "cancelled") { errorResponse(res, "Sudah dibatalkan"); return; }

    it->status = "cancelled";
    it->cancelReason = body.value("reason", "Dibatalkan pembeli");
    // restore stock
    for (const auto& item : it->items) {
        auto pit = std::find_if(store.products.begin(), store.products.end(),
                                [&](const Product& p){ return p.id == item.productId; });
        if (pit != store.products.end()) {
            pit->stockQty += item.qty;
            pit->inStock = true;
        }
    }
    if (it->paymentStatus == "paid") {
        it->paymentStatus = "refunded";
        it->returnStatus = "refunded";
    }
    it->steps = {
        {"Pesanan Dibuat", it->date, "Pesanan dikonfirmasi.", true, false},
        {"Dibatalkan", shortDate(), it->cancelReason, true, true},
    };
    store.saveToDisk();
    jsonResponse(res, it->toJson());
}

// ------ POST /api/orders/:id/return ------
void handleReturnOrder(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;

    std::string id = req.matches[1].str();
    json body;
    try { body = req.body.empty() ? json::object() : json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.orders.begin(), store.orders.end(),
                           [&id](const Order& o){ return o.id == id; });
    if (it == store.orders.end()) { errorResponse(res, "Pesanan tidak ditemukan", 404); return; }
    if (auth->role != "admin" && auth->role != "seller" && it->customerId != auth->userId) {
        errorResponse(res, "Forbidden", 403); return;
    }

    std::string action = body.value("action", "request"); // request | approve | reject
    if (action == "request") {
        if (it->status != "delivered") {
            errorResponse(res, "Return hanya untuk pesanan terkirim"); return;
        }
        if (it->returnStatus == "requested" || it->returnStatus == "approved" || it->returnStatus == "refunded") {
            errorResponse(res, "Return sudah diajukan"); return;
        }
        it->returnStatus = "requested";
        it->returnReason = body.value("reason", "Permintaan return pembeli");
    } else if (action == "approve") {
        if (auth->role != "admin" && auth->role != "seller") {
            errorResponse(res, "Hanya admin/seller yang dapat menyetujui", 403); return;
        }
        it->returnStatus = "refunded";
        it->paymentStatus = "refunded";
        // restore stock
        for (const auto& item : it->items) {
            auto pit = std::find_if(store.products.begin(), store.products.end(),
                                    [&](const Product& p){ return p.id == item.productId; });
            if (pit != store.products.end()) {
                pit->stockQty += item.qty;
                pit->inStock = true;
            }
        }
    } else if (action == "reject") {
        if (auth->role != "admin" && auth->role != "seller") {
            errorResponse(res, "Forbidden", 403); return;
        }
        it->returnStatus = "rejected";
    } else {
        errorResponse(res, "action tidak valid"); return;
    }
    store.saveToDisk();
    jsonResponse(res, it->toJson());
}

// ------ GET /api/orders/:id/invoice ------
void handleOrderInvoice(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;

    std::string id = req.matches[1].str();
    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.orders.begin(), store.orders.end(),
                           [&id](const Order& o){ return o.id == id; });
    if (it == store.orders.end()) { errorResponse(res, "Pesanan tidak ditemukan", 404); return; }
    if (auth->role != "admin" && auth->role != "seller" && it->customerId != auth->userId) {
        errorResponse(res, "Forbidden", 403); return;
    }

    json inv = it->toJson();
    inv["invoice"] = {
        {"number", it->invoiceNumber.empty() ? it->id : it->invoiceNumber},
        {"issuedAt", it->paidAt.empty() ? it->date : it->paidAt},
        {"merchant", "YourShop.Id"},
        {"paymentStatus", it->paymentStatus},
        {"shipping", {
            {"method", it->shippingMethod},
            {"cost", it->shippingCost},
            {"address", it->shipAddress},
            {"city", it->shipCity},
            {"phone", it->shipPhone},
        }},
    };
    jsonResponse(res, inv);
}

// ------ GET /api/shipping/rates ------
void handleShippingRates(const httplib::Request& req, httplib::Response& res) {
    double subtotal = req.has_param("subtotal") ? std::stod(req.get_param_value("subtotal")) : 0;
    bool freeEligible = subtotal >= 75.0;
    json rates = json::array({
        {{"id","jne"},{"name","JNE Reguler"},{"eta","2-4 hari"},{"cost", freeEligible ? 0.0 : 8.50}},
        {{"id","jnt"},{"name","J&T Express"},{"eta","1-3 hari"},{"cost", freeEligible ? 3.0 : 12.00}},
        {{"id","sicepat"},{"name","SiCepat BEST"},{"eta","1-2 hari"},{"cost", freeEligible ? 2.5 : 10.50}},
        {{"id","regular"},{"name","Kurir Standar"},{"eta","3-5 hari"},{"cost", freeEligible ? 0.0 : 9.99}},
    });
    jsonResponse(res, {{"subtotal", subtotal},{"freeShippingEligible", freeEligible},{"rates", rates}});
}

// ------ GET /api/users ------
void handleGetUsers(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"admin"});
    if (!auth) return;

    std::lock_guard<std::mutex> lock(store.mu);
    json arr = json::array();
    for (const auto& u : store.users) arr.push_back(u.toJson());
    jsonResponse(res, arr);
}

// ------ POST /api/auth/login ------
void handleLogin(const httplib::Request& req, httplib::Response& res) {
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    if (!body.contains("email") || !body.contains("password")) {
        errorResponse(res, "Email atau kata sandi tidak diisi"); return;
    }

    std::string email = body["email"].get<std::string>();
    std::string password = body["password"].get<std::string>();
    if (password.size() < 4) { errorResponse(res, "Kata sandi minimal 4 karakter", 400); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.users.begin(), store.users.end(),
                           [&email](const User& u){ return u.email == email; });
    if (it == store.users.end() || !verifyPassword(password, it->passwordHash)) {
        errorResponse(res, "Kredensial tidak valid", 401); return;
    }

    // Migrasi hash lama → format ysi1$
    if (it->passwordHash.rfind("ysi1$", 0) != 0) {
        it->passwordHash = hashPassword(password, makeSalt());
        store.saveToDisk();
    }

    std::string token = createToken(*it);
    json resp = it->toJson();
    resp["token"] = token;
    resp["expiresIn"] = TOKEN_TTL_SEC;
    resp["tokenType"] = "Bearer";
    jsonResponse(res, resp);
}

// ------ POST /api/auth/register ------
void handleRegister(const httplib::Request& req, httplib::Response& res) {
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    if (!body.contains("name") || !body.contains("email") || !body.contains("password")) {
        errorResponse(res, "Kolom wajib tidak lengkap"); return;
    }

    std::string password = body["password"].get<std::string>();
    if (password.size() < 4) { errorResponse(res, "Kata sandi minimal 4 karakter"); return; }

    std::string email = body["email"].get<std::string>();
    std::lock_guard<std::mutex> lock(store.mu);
    auto exists = std::find_if(store.users.begin(), store.users.end(),
                               [&email](const User& u){ return u.email == email; });
    if (exists != store.users.end()) { errorResponse(res, "Email sudah terdaftar", 409); return; }

    std::string role = body.value("role", "buyer");
    if (role != "buyer" && role != "seller") role = "buyer"; // cegah self-register admin

    User u;
    u.id           = "u" + std::to_string(++store.nextUserSeq);
    u.name         = body["name"].get<std::string>();
    u.email        = email;
    u.passwordHash = hashPassword(password, makeSalt());
    u.role         = role;
    u.shopName     = body.value("shopName", "");
    u.phone        = body.value("phone", "");
    u.address      = body.value("address", "");
    u.createdAt    = currentTimestamp();
    store.users.push_back(u);
    store.saveToDisk();

    std::string token = createToken(u);
    json resp = u.toJson();
    resp["token"] = token;
    resp["expiresIn"] = TOKEN_TTL_SEC;
    resp["tokenType"] = "Bearer";
    jsonResponse(res, resp, 201);
}

// ------ GET /api/auth/me ------
void handleAuthMe(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.users.begin(), store.users.end(),
                           [&](const User& u){ return u.id == auth->userId; });
    if (it == store.users.end()) { errorResponse(res, "User tidak ditemukan", 404); return; }
    json resp = it->toJson();
    resp["tokenExp"] = auth->exp;
    jsonResponse(res, resp);
}

// ------ POST /api/auth/logout ------
void handleLogout(const httplib::Request& req, httplib::Response& res) {
    auto token = extractBearer(req);
    if (!token.empty()) {
        auto ctx = verifyToken(token);
        long long exp = ctx ? ctx->exp : ((long long)std::time(nullptr) + 3600);
        blacklistToken(token, exp);
    }
    jsonResponse(res, {{"message", "Logout berhasil"}});
}

// ------ POST /api/auth/change-password ------
// Body: { currentPassword, newPassword }
void handleChangePassword(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;

    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    if (!body.contains("currentPassword") || !body.contains("newPassword")) {
        errorResponse(res, "currentPassword dan newPassword wajib"); return;
    }
    std::string cur = body["currentPassword"].get<std::string>();
    std::string neu = body["newPassword"].get<std::string>();
    if (neu.size() < 4) { errorResponse(res, "Kata sandi baru minimal 4 karakter"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.users.begin(), store.users.end(),
                           [&](const User& u){ return u.id == auth->userId; });
    if (it == store.users.end()) { errorResponse(res, "User tidak ditemukan", 404); return; }
    if (!verifyPassword(cur, it->passwordHash)) {
        errorResponse(res, "Kata sandi saat ini salah", 401); return;
    }
    it->passwordHash = hashPassword(neu, makeSalt());
    store.saveToDisk();
    // invalidate current token
    blacklistToken(auth->token, auth->exp);
    jsonResponse(res, {{"message", "Kata sandi diperbarui. Silakan masuk kembali."}});
}

// ------ POST /api/auth/forgot ------ Body: { email }
void handleForgotPassword(const httplib::Request& req, httplib::Response& res) {
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }
    if (!body.contains("email")) { errorResponse(res, "Email wajib"); return; }

    std::string email = body["email"].get<std::string>();
    std::string resetTok = toHex64(fnv1a64(email + AUTH_SECRET + std::to_string(std::time(nullptr))));
    long long exp = (long long)std::time(nullptr) + 1800; // 30 menit

    {
        std::lock_guard<std::mutex> lock(store.mu);
        auto it = std::find_if(store.users.begin(), store.users.end(),
                               [&email](const User& u){ return u.email == email; });
        // Selalu respon sukses (anti email enumeration) kecuali mode demo tampilkan token
        if (it != store.users.end()) {
            std::lock_guard<std::mutex> rlock(resetMu);
            resetTokens[email] = {resetTok, exp};
        }
    }

    json resp = {
        {"message", "Jika email terdaftar, instruksi reset telah diproses."},
        {"expiresIn", 1800},
    };
    // Demo only: kembalikan token agar bisa diuji tanpa email
    {
        std::lock_guard<std::mutex> rlock(resetMu);
        if (resetTokens.count(email)) resp["resetToken"] = resetTokens[email].first;
    }
    jsonResponse(res, resp);
}

// ------ POST /api/auth/reset ------ Body: { email, token, newPassword }
void handleResetPassword(const httplib::Request& req, httplib::Response& res) {
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::string email = body.value("email", "");
    std::string token = body.value("token", "");
    std::string neu   = body.value("newPassword", "");
    if (email.empty() || token.empty() || neu.size() < 4) {
        errorResponse(res, "email, token, dan newPassword (min 4) wajib"); return;
    }

    {
        std::lock_guard<std::mutex> rlock(resetMu);
        auto it = resetTokens.find(email);
        if (it == resetTokens.end() || it->second.first != token ||
            it->second.second < (long long)std::time(nullptr)) {
            errorResponse(res, "Token reset tidak valid atau kedaluwarsa", 400); return;
        }
        resetTokens.erase(it);
    }

    std::lock_guard<std::mutex> lock(store.mu);
    auto uit = std::find_if(store.users.begin(), store.users.end(),
                            [&email](const User& u){ return u.email == email; });
    if (uit == store.users.end()) { errorResponse(res, "User tidak ditemukan", 404); return; }
    uit->passwordHash = hashPassword(neu, makeSalt());
    store.saveToDisk();
    jsonResponse(res, {{"message", "Kata sandi berhasil direset. Silakan masuk."}});
}

// ------ PUT /api/users/:id ------
void handleUpdateUser(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;

    std::string id = req.matches[1].str();
    // hanya sendiri atau admin
    if (auth->userId != id && auth->role != "admin") {
        errorResponse(res, "Forbidden: tidak bisa mengubah profil user lain", 403); return;
    }

    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.users.begin(), store.users.end(),
                           [&id](const User& u){ return u.id == id; });
    if (it == store.users.end()) { errorResponse(res, "User tidak ditemukan", 404); return; }

    if (body.contains("name"))     it->name     = body["name"].get<std::string>();
    if (body.contains("phone"))    it->phone    = body["phone"].get<std::string>();
    if (body.contains("address"))  it->address  = body["address"].get<std::string>();
    if (body.contains("shopName")) it->shopName = body["shopName"].get<std::string>();
    if (body.contains("email") && auth->role == "admin")
        it->email = body["email"].get<std::string>();
    // role hanya admin
    if (body.contains("role") && auth->role == "admin")
        it->role = body["role"].get<std::string>();

    store.saveToDisk();
    jsonResponse(res, it->toJson());
}

// ------ GET /api/sellers ------
void handleGetSellers(const httplib::Request& req, httplib::Response& res) {
    std::lock_guard<std::mutex> lock(store.mu);
    std::unordered_map<std::string, json> map;
    for (const auto& p : store.products) {
        if (!map.count(p.seller)) {
            map[p.seller] = {
                {"name", p.seller},
                {"productCount", 0},
                {"categories", json::array()},
                {"suspended", store.isSellerSuspended(p.seller)},
                {"avgRating", 0.0},
                {"_ratingSum", 0.0},
            };
        }
        map[p.seller]["productCount"] = map[p.seller]["productCount"].get<int>() + 1;
        map[p.seller]["_ratingSum"] = map[p.seller]["_ratingSum"].get<double>() + p.rating;
        auto& cats = map[p.seller]["categories"];
        bool found = false;
        for (const auto& c : cats) if (c == p.category) { found = true; break; }
        if (!found) cats.push_back(p.category);
    }
    json arr = json::array();
    for (auto& kv : map) {
        int n = kv.second["productCount"].get<int>();
        kv.second["avgRating"] = n ? kv.second["_ratingSum"].get<double>() / n : 0.0;
        kv.second.erase("_ratingSum");
        arr.push_back(kv.second);
    }
    jsonResponse(res, arr);
}

// ------ POST /api/sellers/suspend ------ Body: { name, suspend: true|false }
void handleSuspendSeller(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"admin"});
    if (!auth) return;

    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }
    if (!body.contains("name")) { errorResponse(res, "name wajib"); return; }

    std::string name = body["name"].get<std::string>();
    bool suspend = body.value("suspend", true);

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find(store.suspendedSellers.begin(), store.suspendedSellers.end(), name);
    if (suspend) {
        if (it == store.suspendedSellers.end()) store.suspendedSellers.push_back(name);
    } else {
        if (it != store.suspendedSellers.end()) store.suspendedSellers.erase(it);
    }
    store.saveToDisk();
    jsonResponse(res, {
        {"name", name},
        {"suspended", store.isSellerSuspended(name)},
        {"message", suspend ? "Penjual ditangguhkan" : "Penjual diaktifkan kembali"}
    });
}

// ------ GET /api/categories ------
void handleGetCategories(const httplib::Request& req, httplib::Response& res) {
    std::lock_guard<std::mutex> lock(store.mu);
    std::unordered_map<std::string, int> counts;
    for (const auto& p : store.products) counts[p.category]++;
    json arr = json::array();
    for (const auto& kv : counts) {
        arr.push_back({{"name", kv.first}, {"count", kv.second}});
    }
    jsonResponse(res, arr);
}

// ------ POST /api/promo/validate ------
void handleValidatePromo(const httplib::Request& req, httplib::Response& res) {
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }
    std::string code = body.value("code", "");
    std::transform(code.begin(), code.end(), code.begin(), ::toupper);

    static const std::unordered_map<std::string, json> promos = {
        {"FORGE10",      {{"code","FORGE10"},{"discount",0.10},{"freeShipping",false},{"label","Diskon 10%"}}},
        {"HEMAT20",      {{"code","HEMAT20"},{"discount",0.20},{"freeShipping",false},{"label","Diskon 20%"}}},
        {"WELCOME",      {{"code","WELCOME"},{"discount",0.15},{"freeShipping",false},{"label","Diskon 15% welcome"}}},
        {"GRATISONGKIR", {{"code","GRATISONGKIR"},{"discount",0.0},{"freeShipping",true},{"label","Gratis Ongkir"}}},
    };
    auto it = promos.find(code);
    if (it == promos.end()) { errorResponse(res, "Kode promo tidak valid", 404); return; }
    jsonResponse(res, it->second);
}

// ------ GET /api/stats ------  (admin dashboard)
void handleGetStats(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"admin", "seller"});
    if (!auth) return;

    std::lock_guard<std::mutex> lock(store.mu);
    double revenue = 0.0;
    for (const auto& o : store.orders) revenue += o.total;
    int sellers = 0;
    std::unordered_map<std::string, bool> seen;
    for (const auto& p : store.products) {
        if (!seen[p.seller]) { seen[p.seller] = true; sellers++; }
    }
    jsonResponse(res, {
        {"totalRevenue",   revenue},
        {"totalOrders",    (int)store.orders.size()},
        {"activeProducts", (int)store.products.size()},
        {"activeSellers",  sellers},
    });
}

// ============================================================
//  MAIN — wire up server
// ============================================================

int main() {
    httplib::Server svr;

    // --- CORS Preflight ---
    svr.Options(".*", [](const httplib::Request&, httplib::Response& res) {
        setCorsHeaders(res);
        res.status = 204;
    });

    // --- Produk ---
    svr.Get("/api/products",          handleGetProducts);
    svr.Get("/api/products/(\\d+)",   handleGetProduct);
    svr.Post("/api/products",         handleCreateProduct);
    svr.Put("/api/products/(\\d+)",   handleUpdateProduct);
    svr.Delete("/api/products/(\\d+)",handleDeleteProduct);

    // --- Pesanan ---
    svr.Get("/api/orders",                           handleGetOrders);
    svr.Post("/api/orders",                          handleCreateOrder);
    svr.Put("/api/orders/(.+)/status",               handleUpdateOrderStatus);
    svr.Post("/api/orders/(.+)/pay",                 handlePayOrder);
    svr.Post("/api/orders/(.+)/cancel",              handleCancelOrder);
    svr.Post("/api/orders/(.+)/return",              handleReturnOrder);
    svr.Get("/api/orders/(.+)/invoice",              handleOrderInvoice);
    svr.Get("/api/orders/(.+)",                      handleGetOrder);
    svr.Get("/api/shipping/rates",                   handleShippingRates);

    // --- Pengguna / Autentikasi ---
    svr.Get("/api/users",                  handleGetUsers);
    svr.Put("/api/users/(.+)",             handleUpdateUser);
    svr.Post("/api/auth/login",            handleLogin);
    svr.Post("/api/auth/register",         handleRegister);
    svr.Get("/api/auth/me",                handleAuthMe);
    svr.Post("/api/auth/logout",           handleLogout);
    svr.Post("/api/auth/change-password",  handleChangePassword);
    svr.Post("/api/auth/forgot",           handleForgotPassword);
    svr.Post("/api/auth/reset",            handleResetPassword);

    // --- Penjual ---
    svr.Get("/api/sellers",           handleGetSellers);
    svr.Post("/api/sellers/suspend",  handleSuspendSeller);

    // --- Kategori & Promo ---
    svr.Get("/api/categories",        handleGetCategories);
    svr.Post("/api/promo/validate",   handleValidatePromo);

    // --- Statistik Admin ---
    svr.Get("/api/stats",             handleGetStats);

    // --- Cek Kesehatan ---
    svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        setCorsHeaders(res);
        json body = {
            {"status", "ok"},
            {"service", "YourShop.Id API"},
            {"pesan", "Layanan berjalan normal"},
            {"products", (int)store.products.size()},
            {"orders", (int)store.orders.size()},
            {"users", (int)store.users.size()},
        };
        res.set_content(body.dump(), "application/json");
    });

    std::cout << "=====================================" << std::endl;
    std::cout << "  YourShop.Id — Server API" << std::endl;
    std::cout << "  Mendengarkan di http://localhost:8080" << std::endl;
    std::cout << "=====================================" << std::endl;
    std::cout << std::endl;
    std::cout << "  Endpoint:" << std::endl;
    std::cout << "  GET    /api/products" << std::endl;
    std::cout << "  POST   /api/products" << std::endl;
    std::cout << "  PUT    /api/products/:id" << std::endl;
    std::cout << "  DELETE /api/products/:id" << std::endl;
    std::cout << "  GET    /api/orders" << std::endl;
    std::cout << "  POST   /api/orders" << std::endl;
    std::cout << "  PUT    /api/orders/:id/status" << std::endl;
    std::cout << "  POST   /api/auth/login" << std::endl;
    std::cout << "  POST   /api/auth/register" << std::endl;
    std::cout << "  PUT    /api/users/:id" << std::endl;
    std::cout << "  GET    /api/sellers" << std::endl;
    std::cout << "  POST   /api/sellers/suspend" << std::endl;
    std::cout << "  GET    /api/categories" << std::endl;
    std::cout << "  POST   /api/promo/validate" << std::endl;
    std::cout << "  GET    /api/stats" << std::endl;
    std::cout << "  GET    /api/health" << std::endl;
    std::cout << "  Data file: ysi_data.json (auto save)" << std::endl;
    std::cout << std::endl;

    svr.listen("0.0.0.0", 8080);
    return 0;
}
