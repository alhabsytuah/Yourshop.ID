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
#include <cmath>
#include <fstream>
#include <cctype>
#include <cstring>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>

// OpenSSL — JWT HS256 + PBKDF2 password hashing
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <openssl/sha.h>

// Enable TLS support in cpp-httplib when linking -lssl -lcrypto
#define CPPHTTPLIB_OPENSSL_SUPPORT

// Single-header libraries — place in same directory or install system-wide
// https://github.com/yhirose/cpp-httplib   → httplib.h
// https://github.com/nlohmann/json         → json.hpp
#include "httplib.h"
#include "json.hpp"
#include "sqlite3.h"

using json = nlohmann::json;

// Forward decls — dipakai DataStore::seed()
static std::string hashPassword(const std::string& password, const std::string& saltHex = "");
static std::string makeSalt(size_t bytes);
std::string currentTimestamp();

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
    // Komisi platform
    double      subtotal = 0;
    double      commissionRate = 0;  // e.g. 0.05 = 5%
    double      commission = 0;
    double      sellerPayout = 0;
    // Payment gateway (Midtrans)
    std::string paymentProvider;   // midtrans | mock | ""
    std::string paymentRef;        // Midtrans transaction_id / mock ref
    std::string snapToken;         // Midtrans Snap token (short-lived)
    std::string midtransOrderId;   // sanitized order id sent to Midtrans
    long long   grossAmountIdr = 0; // amount charged in IDR

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
        j["subtotal"]       = subtotal;
        j["commissionRate"] = commissionRate;
        j["commission"]     = commission;
        j["sellerPayout"]   = sellerPayout;
        j["paymentProvider"] = paymentProvider.empty() ? json(nullptr) : json(paymentProvider);
        j["paymentRef"]      = paymentRef.empty() ? json(nullptr) : json(paymentRef);
        j["snapToken"]       = snapToken.empty() ? json(nullptr) : json(snapToken);
        j["midtransOrderId"] = midtransOrderId.empty() ? json(nullptr) : json(midtransOrderId);
        j["grossAmountIdr"]  = grossAmountIdr;

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
    std::string passwordHash;
    std::string role;         // "buyer" | "seller" | "admin"
    std::string shopName;
    std::string phone;
    std::string address;
    std::string createdAt;
    // KYC / verifikasi toko
    std::string kycStatus;    // none | pending | verified | rejected
    std::string kycNote;
    std::string kycUpdatedAt;

    json toJson() const {
        json j;
        j["id"]           = id;
        j["name"]         = name;
        j["email"]        = email;
        j["role"]         = role;
        j["shopName"]     = shopName;
        j["phone"]        = phone;
        j["address"]      = address;
        j["createdAt"]    = createdAt;
        j["kycStatus"]    = kycStatus.empty() ? "none" : kycStatus;
        j["kycNote"]      = kycNote;
        j["kycUpdatedAt"] = kycUpdatedAt;
        return j;
    }
};

struct Notification {
    int         id = 0;
    std::string userId;     // empty = broadcast
    std::string title;
    std::string body;
    std::string type;       // order | system | promo | kyc
    std::string createdAt;
    bool        read = false;

    json toJson() const {
        return {
            {"id", id}, {"userId", userId}, {"title", title},
            {"body", body}, {"type", type}, {"createdAt", createdAt},
            {"read", read},
        };
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
    std::vector<Notification> notifications;
    std::vector<std::string> suspendedSellers;
    int                  nextProductId = 100;
    int                  nextOrderSeq  = 9000;
    int                  nextUserSeq   = 10;
    int                  nextInvoiceSeq = 1000;
    int                  nextNotifId   = 1;
    int                  schemaVersion = 2;
    double               commissionRate = 0.05; // 5% default platform fee
    std::mutex           mu;
    std::string          dataFile = "ysi_data.json";
    std::string          sqliteFile = "ysi_data.db";
    bool                 useSqlite = false;

    DataStore() {
        const char* db = std::getenv("YSI_DB");
        if (db && (std::string(db) == "sqlite" || std::string(db) == "sqlite3"))
            useSqlite = true;
        if (const char* r = std::getenv("YSI_COMMISSION_RATE")) {
            double v = std::atof(r);
            if (v >= 0 && v <= 0.5) commissionRate = v;
        }
        bool loaded = useSqlite ? loadFromSqlite() : loadFromDisk();
        if (!loaded) seed();
        if (useSqlite) saveToSqlite();
        else saveToDisk();
    }

    bool isSellerSuspended(const std::string& name) const {
        return std::find(suspendedSellers.begin(), suspendedSellers.end(), name) != suspendedSellers.end();
    }

    void pushNotif(const std::string& userId, const std::string& title,
                   const std::string& body, const std::string& type = "system") {
        Notification n;
        n.id = nextNotifId++;
        n.userId = userId;
        n.title = title;
        n.body = body;
        n.type = type;
        n.createdAt = currentTimestamp();
        n.read = false;
        notifications.insert(notifications.begin(), n);
        if (notifications.size() > 500) notifications.resize(500);
    }

    void saveToDisk() {
        try {
            json root;
            root["schemaVersion"] = schemaVersion;
            root["nextProductId"] = nextProductId;
            root["nextOrderSeq"]  = nextOrderSeq;
            root["nextUserSeq"]   = nextUserSeq;
            root["nextInvoiceSeq"] = nextInvoiceSeq;
            root["nextNotifId"]   = nextNotifId;
            root["commissionRate"] = commissionRate;
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
                j["passwordHash"] = u.passwordHash;
                us.push_back(j);
            }
            root["users"] = us;

            json ns = json::array();
            for (const auto& n : notifications) ns.push_back(n.toJson());
            root["notifications"] = ns;

            std::ofstream ofs(dataFile);
            if (ofs) ofs << root.dump(2);

            if (useSqlite) saveToSqlite();
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
                    o.paymentStatus   = j.value("paymentStatus", "pending");
                    o.paymentMethod   = j.value("paymentMethod", "");
                    o.paidAt          = j.value("paidAt", "");
                    o.invoiceNumber   = j.value("invoiceNumber", "");
                    o.shippingMethod  = j.value("shippingMethod", "");
                    o.shippingCost    = j.value("shippingCost", 0.0);
                    o.shipAddress     = j.value("shipAddress", "");
                    o.shipCity        = j.value("shipCity", "");
                    o.shipPhone       = j.value("shipPhone", "");
                    o.cancelReason    = j.value("cancelReason", "");
                    o.returnStatus    = j.value("returnStatus", "none");
                    o.returnReason    = j.value("returnReason", "");
                    o.subtotal        = j.value("subtotal", 0.0);
                    o.commissionRate  = j.value("commissionRate", 0.0);
                    o.commission      = j.value("commission", 0.0);
                    o.sellerPayout    = j.value("sellerPayout", 0.0);
                    o.paymentProvider = j.value("paymentProvider", "");
                    o.paymentRef      = j.value("paymentRef", "");
                    o.snapToken       = j.value("snapToken", "");
                    o.midtransOrderId = j.value("midtransOrderId", "");
                    o.grossAmountIdr  = j.value("grossAmountIdr", 0LL);
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
                    u.kycStatus    = j.value("kycStatus", "none");
                    u.kycNote      = j.value("kycNote", "");
                    u.kycUpdatedAt = j.value("kycUpdatedAt", "");
                    users.push_back(u);
                }
            }
            notifications.clear();
            if (root.contains("notifications")) {
                for (const auto& j : root["notifications"]) {
                    Notification n;
                    n.id = j.value("id", 0);
                    n.userId = j.value("userId", "");
                    n.title = j.value("title", "");
                    n.body = j.value("body", "");
                    n.type = j.value("type", "system");
                    n.createdAt = j.value("createdAt", "");
                    n.read = j.value("read", false);
                    notifications.push_back(n);
                }
            }
            nextInvoiceSeq = root.value("nextInvoiceSeq", nextInvoiceSeq);
            nextNotifId = root.value("nextNotifId", nextNotifId);
            schemaVersion = root.value("schemaVersion", 1);
            commissionRate = root.value("commissionRate", commissionRate);
            std::cout << "[YourShop] Data dimuat dari " << dataFile
                      << " (schema v" << schemaVersion << ")" << std::endl;
            return !products.empty();
        } catch (...) {
            return false;
        }
    }

    bool saveToSqlite() {
        // Persist as JSON blob in SQLite for durable storage + easy backup
        try {
            // Implemented below after includes of sqlite3
            return saveToSqliteImpl();
        } catch (...) {
            return false;
        }
    }
    bool loadFromSqlite() {
        try {
            return loadFromSqliteImpl();
        } catch (...) {
            return false;
        }
    }
    bool saveToSqliteImpl();
    bool loadFromSqliteImpl();

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
            {13, "Oli Mesin Synthetic 5W-30",       "🛢️", 32.00,  39.00,  "Otomotif",   "AutoPartID",  4.8, 520,  "Diskon",   true, 48, "Oli mesin fully synthetic 5W-30 untuk mesin bensin. Perlindungan anti-aus dan hemat bahan bakar. Isi 4 liter.", {"oli","mesin","sparepart"}, true  },
            {14, "Kampas Rem Ceramic Depan",        "🛑", 28.50,  0,      "Otomotif",   "BrakePro",    4.6, 210,  "Baru",     true, 36, "Kampas rem ceramic low-dust untuk roda depan. Cocok sedan dan hatchback populer. Termasuk sensor keausan.", {"rem","kampas","sparepart"}, false },
            {15, "Aki Kering 12V 60Ah",             "🔋", 75.00,  89.00,  "Otomotif",   "AutoPartID",  4.7, 180,  "Diskon",   true, 20, "Aki kering maintenance-free 12V 60Ah. Daya cranking tinggi, tahan getaran. Garansi resmi 12 bulan.", {"aki","battery","sparepart"}, false },
        };

        // --- Users (password demo: "demo" — di-hash dengan salt) ---
        auto hp = [](const std::string& pw) {
            return hashPassword(pw, makeSalt(16));
        };
        users = {
            {"u1", "Budi Santoso",   "buyer@demo.com",  hp("demo"), "buyer",  "",           "", "", "2026-01-10", "none", "", ""},
            {"u2", "Sari Kerajinan", "seller@demo.com", hp("demo"), "seller", "CraftWorks", "", "", "2026-01-15", "verified", "Demo toko terverifikasi", "2026-01-15"},
            {"u3", "Dian Admin",     "admin@demo.com",  hp("demo"), "admin",  "",           "", "", "2026-01-01", "none", "", ""},
        };
        pushNotif("u2", "Selamat datang, penjual!", "Toko CraftWorks sudah terverifikasi KYC.", "kyc");
        pushNotif("u1", "Promo spesial", "Gunakan kode SAVE10 untuk diskon 10%.", "promo");

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

// --- SQLite persistence (JSON document in single row) ---
bool DataStore::saveToSqliteImpl() {
    sqlite3* db = nullptr;
    if (sqlite3_open(sqliteFile.c_str(), &db) != SQLITE_OK) {
        std::cerr << "[sqlite] open fail\n";
        if (db) sqlite3_close(db);
        return false;
    }
    char* err = nullptr;
    sqlite3_exec(db,
        "CREATE TABLE IF NOT EXISTS store ("
        " id INTEGER PRIMARY KEY CHECK (id=1),"
        " schema_version INTEGER,"
        " payload TEXT NOT NULL,"
        " updated_at TEXT);", nullptr, nullptr, &err);
    if (err) { sqlite3_free(err); sqlite3_close(db); return false; }

    json root;
    root["schemaVersion"] = schemaVersion;
    root["nextProductId"] = nextProductId;
    root["nextOrderSeq"]  = nextOrderSeq;
    root["nextUserSeq"]   = nextUserSeq;
    root["nextInvoiceSeq"] = nextInvoiceSeq;
    root["nextNotifId"]   = nextNotifId;
    root["commissionRate"] = commissionRate;
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
        j["passwordHash"] = u.passwordHash;
        us.push_back(j);
    }
    root["users"] = us;
    json ns = json::array();
    for (const auto& n : notifications) ns.push_back(n.toJson());
    root["notifications"] = ns;

    std::string payload = root.dump();
    sqlite3_exec(db, "BEGIN;", nullptr, nullptr, nullptr);
    sqlite3_exec(db, "DELETE FROM store;", nullptr, nullptr, nullptr);
    sqlite3_stmt* stmt = nullptr;
    const char* sql = "INSERT INTO store(id, schema_version, payload, updated_at) VALUES (1,?,?,datetime('now'));";
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        sqlite3_close(db); return false;
    }
    sqlite3_bind_int(stmt, 1, schemaVersion);
    sqlite3_bind_text(stmt, 2, payload.c_str(), (int)payload.size(), SQLITE_TRANSIENT);
    bool ok = sqlite3_step(stmt) == SQLITE_DONE;
    sqlite3_finalize(stmt);
    sqlite3_exec(db, ok ? "COMMIT;" : "ROLLBACK;", nullptr, nullptr, nullptr);
    sqlite3_close(db);
    return ok;
}

bool DataStore::loadFromSqliteImpl() {
    sqlite3* db = nullptr;
    if (sqlite3_open(sqliteFile.c_str(), &db) != SQLITE_OK) {
        if (db) sqlite3_close(db);
        return false;
    }
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db, "SELECT payload FROM store WHERE id=1;", -1, &stmt, nullptr) != SQLITE_OK) {
        sqlite3_close(db); return false;
    }
    bool ok = false;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        const char* txt = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
        if (txt) {
            try {
                json root = json::parse(txt);
                std::ofstream ofs(dataFile);
                if (ofs) ofs << root.dump(2);
                ok = true;
            } catch (...) { ok = false; }
        }
    }
    sqlite3_finalize(stmt);
    sqlite3_close(db);
    if (ok) return loadFromDisk();
    return false;
}

// ============================================================
//  HELPERS
// ============================================================

static DataStore store;

// ============================================================
//  CORS — allowlist (bukan *). Env: YSI_CORS_ORIGINS=comma-separated
// ============================================================
static std::vector<std::string> corsAllowedOrigins() {
    static std::vector<std::string> origins;
    static bool init = false;
    if (!init) {
        const char* env = std::getenv("YSI_CORS_ORIGINS");
        std::string raw = env ? env :
            "http://localhost:5500,http://127.0.0.1:5500,"
            "http://localhost:8080,http://127.0.0.1:8080,"
            "https://localhost:5500,https://127.0.0.1:5500,"
            "https://localhost:8443,https://127.0.0.1:8443,"
            "null"; // file:// some browsers send Origin: null
        std::stringstream ss(raw);
        std::string part;
        while (std::getline(ss, part, ',')) {
            // trim
            size_t a = part.find_first_not_of(" \t");
            size_t b = part.find_last_not_of(" \t");
            if (a != std::string::npos) origins.push_back(part.substr(a, b - a + 1));
        }
        init = true;
    }
    return origins;
}

static bool originAllowed(const std::string& origin) {
    if (origin.empty()) return true; // same-origin / non-browser
    auto allowed = corsAllowedOrigins();
    return std::find(allowed.begin(), allowed.end(), origin) != allowed.end();
}

void setCorsHeaders(const httplib::Request& req, httplib::Response& res) {
    std::string origin = req.get_header_value("Origin");
    if (originAllowed(origin)) {
        if (!origin.empty())
            res.set_header("Access-Control-Allow-Origin", origin);
        else
            res.set_header("Access-Control-Allow-Origin", "http://localhost:5500");
        res.set_header("Vary", "Origin");
        res.set_header("Access-Control-Allow-Credentials", "true");
    }
    // jika origin tidak diizinkan, jangan set Allow-Origin
    res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set_header("Access-Control-Max-Age", "600");
    res.set_header("X-Content-Type-Options", "nosniff");
    res.set_header("X-Frame-Options", "DENY");
    res.set_header("Referrer-Policy", "strict-origin-when-cross-origin");
}

// Compat: handlers tanpa Request — origin default localhost
void setCorsHeaders(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "http://localhost:5500");
    res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set_header("Access-Control-Allow-Credentials", "true");
    res.set_header("X-Content-Type-Options", "nosniff");
}

void jsonResponse(httplib::Response& res, const json& body, int status = 200) {
    setCorsHeaders(res);
    res.status = status;
    res.set_content(body.dump(), "application/json");
}

void errorResponse(httplib::Response& res, const std::string& msg, int status = 400) {
    jsonResponse(res, {{"error", msg}}, status);
}

static void ysiLog(const std::string& level, const std::string& msg) {
    std::string line = currentTimestamp() + " [" + level + "] " + msg;
    std::cout << line << std::endl;
    const char* path = std::getenv("YSI_LOG_FILE");
    if (path && *path) {
        std::ofstream ofs(path, std::ios::app);
        if (ofs) ofs << line << "\n";
    }
}

static void sendOrderEmail(const Order& order, const std::string& toEmail) {
    const char* mode = std::getenv("YSI_EMAIL_MODE");
    std::string m = mode ? mode : "file";
    if (m == "off" || m == "none") return;
    std::ostringstream body;
    body << "Subject: Konfirmasi Pesanan " << order.id << " — YourShop.Id\n";
    body << "To: " << toEmail << "\n\n";
    body << "Halo " << order.customerName << ",\n\n";
    body << "Pesanan " << order.id << " berhasil dibuat.\n";
    body << "Total: " << order.total << "\n";
    body << "Status: " << order.paymentStatus << "\n";
    body << "Invoice: " << order.invoiceNumber << "\n\n";
    body << "Terima kasih — YourShop.Id\n";
    if (m == "file" || m == "log") {
        system("mkdir -p logs 2>/dev/null");
        std::ofstream ofs("logs/email_orders.eml", std::ios::app);
        if (ofs) ofs << "----\n" << body.str() << "\n";
        ysiLog("EMAIL", "confirmation for " + order.id + " -> " + toEmail);
    } else {
        ysiLog("EMAIL", "mode=" + m + " stub for " + order.id);
    }
}

// ============================================================
//  RATE LIMITING — Redis (YSI_REDIS_URL) + fallback in-memory
//  Redis: INCR + EXPIRE (fixed window). Env contoh:
//    YSI_REDIS_URL=redis://127.0.0.1:6379
//    YSI_REDIS_URL=redis://:password@127.0.0.1:6379/0
// ============================================================
struct RateBucket {
    std::vector<long long> hits;
};
static std::mutex rateMu;
static std::unordered_map<std::string, RateBucket> rateMap;

struct RedisConfig {
    std::string host = "127.0.0.1";
    int port = 6379;
    std::string password;
    int db = 0;
    bool enabled = false;
};

static RedisConfig parseRedisUrl() {
    RedisConfig cfg;
    const char* env = std::getenv("YSI_REDIS_URL");
    if (!env || !*env) return cfg;
    std::string url = env;
    // redis://[:password@]host[:port][/db]
    if (url.rfind("redis://", 0) == 0) url = url.substr(8);
    else if (url.rfind("rediss://", 0) == 0) url = url.substr(9); // TLS not implemented in mini client
    auto at = url.rfind('@');
    if (at != std::string::npos) {
        std::string auth = url.substr(0, at);
        if (!auth.empty() && auth[0] == ':') auth = auth.substr(1);
        cfg.password = auth;
        url = url.substr(at + 1);
    }
    auto slash = url.find('/');
    if (slash != std::string::npos) {
        cfg.db = std::atoi(url.substr(slash + 1).c_str());
        url = url.substr(0, slash);
    }
    auto colon = url.find(':');
    if (colon != std::string::npos) {
        cfg.host = url.substr(0, colon);
        cfg.port = std::atoi(url.substr(colon + 1).c_str());
    } else {
        cfg.host = url.empty() ? "127.0.0.1" : url;
    }
    if (cfg.port <= 0) cfg.port = 6379;
    cfg.enabled = !cfg.host.empty();
    return cfg;
}

static RedisConfig& redisCfg() {
    static RedisConfig c = parseRedisUrl();
    return c;
}

/** Minimal RESP client — one command per connection (simple & safe) */
static std::string redisCommand(const std::vector<std::string>& args) {
    if (!redisCfg().enabled) return "";
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return "";

    // timeout 200ms
    timeval tv{0, 200000};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(redisCfg().port);
    if (inet_pton(AF_INET, redisCfg().host.c_str(), &addr.sin_addr) <= 0) {
        // try resolve hostname
        hostent* he = gethostbyname(redisCfg().host.c_str());
        if (!he) { close(fd); return ""; }
        memcpy(&addr.sin_addr, he->h_addr_list[0], he->h_length);
    }
    if (connect(fd, (sockaddr*)&addr, sizeof(addr)) < 0) {
        close(fd);
        return "";
    }

    auto sendCmd = [&](const std::vector<std::string>& a) -> bool {
        std::string buf = "*" + std::to_string(a.size()) + "\r\n";
        for (const auto& s : a) {
            buf += "$" + std::to_string(s.size()) + "\r\n" + s + "\r\n";
        }
        size_t sent = 0;
        while (sent < buf.size()) {
            ssize_t n = send(fd, buf.data() + sent, buf.size() - sent, 0);
            if (n <= 0) return false;
            sent += (size_t)n;
        }
        return true;
    };

    auto readResp = [&]() -> std::string {
        char tmp[4096];
        std::string out;
        while (true) {
            ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
            if (n <= 0) break;
            out.append(tmp, tmp + n);
            // simple: done if we have at least one complete line-based reply
            if (out.size() >= 2 && out.find("\r\n") != std::string::npos) {
                // for bulk/array might need more; for INCR integer :+n\r\n enough
                if (out[0] == '+' || out[0] == '-' || out[0] == ':' || out[0] == '$')
                    break;
            }
            if (out.size() > 8192) break;
        }
        return out;
    };

    // AUTH + SELECT if needed
    if (!redisCfg().password.empty()) {
        if (!sendCmd({"AUTH", redisCfg().password})) { close(fd); return ""; }
        readResp();
    }
    if (redisCfg().db != 0) {
        if (!sendCmd({"SELECT", std::to_string(redisCfg().db)})) { close(fd); return ""; }
        readResp();
    }

    if (!sendCmd(args)) { close(fd); return ""; }
    std::string resp = readResp();
    close(fd);
    return resp;
}

static long long redisIncrExpire(const std::string& key, int windowSec) {
    // INCR key
    std::string r = redisCommand({"INCR", key});
    if (r.empty() || r[0] != ':') return -1; // redis unavailable
    long long val = 0;
    try { val = std::stoll(r.substr(1)); } catch (...) { return -1; }
    if (val == 1) {
        // first hit in window — set TTL
        redisCommand({"EXPIRE", key, std::to_string(windowSec)});
    }
    return val;
}

static bool checkRateLimitMemory(const std::string& key, int maxHits, int windowSec) {
    long long now = (long long)std::time(nullptr);
    std::lock_guard<std::mutex> lock(rateMu);
    auto& b = rateMap[key];
    b.hits.erase(std::remove_if(b.hits.begin(), b.hits.end(),
        [now, windowSec](long long t){ return t < now - windowSec; }), b.hits.end());
    if ((int)b.hits.size() >= maxHits) return false;
    b.hits.push_back(now);
    return true;
}

/** @return true jika diizinkan; false jika melebihi limit */
static bool checkRateLimit(const std::string& key, int maxHits, int windowSec) {
    if (redisCfg().enabled) {
        std::string rkey = "ysi:rl:" + key;
        long long n = redisIncrExpire(rkey, windowSec);
        if (n >= 0) {
            return n <= maxHits;
        }
        // Redis down → fallback memory
    }
    return checkRateLimitMemory(key, maxHits, windowSec);
}

static std::string clientKey(const httplib::Request& req, const std::string& action) {
    std::string ip = req.remote_addr.empty() ? "unknown" : req.remote_addr;
    // X-Forwarded-For jika di belakang nginx/proxy (ambil IP pertama)
    auto xff = req.get_header_value("X-Forwarded-For");
    if (!xff.empty()) {
        auto comma = xff.find(',');
        ip = (comma == std::string::npos) ? xff : xff.substr(0, comma);
        size_t a = ip.find_first_not_of(" \t");
        size_t b = ip.find_last_not_of(" \t");
        if (a != std::string::npos) ip = ip.substr(a, b - a + 1);
    }
    // X-Real-IP (nginx)
    auto xri = req.get_header_value("X-Real-IP");
    if (!xri.empty() && (ip == "unknown" || ip == "127.0.0.1" || ip == "::1"))
        ip = xri;
    return action + ":" + ip;
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
//  AUTH — JWT HS256 (OpenSSL) + PBKDF2-HMAC-SHA256 passwords
// ============================================================

static std::string authSecret() {
    const char* env = std::getenv("YSI_AUTH_SECRET");
    if (env && std::strlen(env) >= 16) return std::string(env);
    return "YourShop.Id-secret-change-me-in-prod-2026";
}

static const int TOKEN_TTL_SEC = 24 * 3600; // 24 jam
static const int PBKDF2_ITERS  = 100000;
static std::mutex tokenBlacklistMu;
static std::unordered_map<std::string, long long> tokenBlacklist;

struct AuthContext {
    std::string userId;
    std::string role;
    std::string email;
    std::string token;
    long long   exp = 0;
};

static std::string toHex(const unsigned char* data, size_t len) {
    static const char* hex = "0123456789abcdef";
    std::string out(len * 2, '0');
    for (size_t i = 0; i < len; ++i) {
        out[i * 2]     = hex[(data[i] >> 4) & 0xf];
        out[i * 2 + 1] = hex[data[i] & 0xf];
    }
    return out;
}

static std::string fromHex(const std::string& hex) {
    std::string out;
    out.reserve(hex.size() / 2);
    for (size_t i = 0; i + 1 < hex.size(); i += 2) {
        unsigned int v = 0;
        std::sscanf(hex.c_str() + i, "%02x", &v);
        out.push_back(static_cast<char>(v));
    }
    return out;
}

// Fallback FNV (hanya migrasi format ysi1$ lama)
static uint64_t fnv1a64(const std::string& s) {
    uint64_t h = 14695981039346656037ull;
    for (unsigned char c : s) { h ^= c; h *= 1099511628211ull; }
    return h;
}
static std::string toHex64(uint64_t v) {
    static const char* hex = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) { out[i] = hex[v & 0xf]; v >>= 4; }
    return out;
}

static std::string makeSalt(size_t bytes) {
    unsigned char buf[32];
    if (RAND_bytes(buf, (int)bytes) != 1) {
        // fallback
        auto now = std::chrono::system_clock::now().time_since_epoch().count();
        return toHex64(fnv1a64(std::to_string(now) + authSecret())).substr(0, bytes * 2);
    }
    return toHex(buf, bytes);
}

/** PBKDF2-HMAC-SHA256 — format: pbkdf2$iters$saltHex$hashHex */
static std::string hashPassword(const std::string& password, const std::string& saltHex) {
    std::string salt = saltHex.empty() ? makeSalt(16) : saltHex;
    std::string saltBin = fromHex(salt);
    if (saltBin.empty()) saltBin = salt; // if not hex
    unsigned char out[32];
    if (PKCS5_PBKDF2_HMAC(password.c_str(), (int)password.size(),
                          reinterpret_cast<const unsigned char*>(saltBin.data()),
                          (int)saltBin.size(),
                          PBKDF2_ITERS, EVP_sha256(), 32, out) != 1) {
        // fallback sangat jarang
        return "ysi1$" + salt + "$" + toHex64(fnv1a64(password + salt));
    }
    return "pbkdf2$" + std::to_string(PBKDF2_ITERS) + "$" + salt + "$" + toHex(out, 32);
}

static bool verifyPassword(const std::string& password, const std::string& stored) {
    // Format PBKDF2
    if (stored.rfind("pbkdf2$", 0) == 0) {
        // pbkdf2$iters$salt$hash
        auto p1 = stored.find('$', 7);
        if (p1 == std::string::npos) return false;
        auto p2 = stored.find('$', p1 + 1);
        if (p2 == std::string::npos) return false;
        int iters = std::atoi(stored.substr(7, p1 - 7).c_str());
        std::string saltHex = stored.substr(p1 + 1, p2 - p1 - 1);
        std::string expect  = stored.substr(p2 + 1);
        std::string saltBin = fromHex(saltHex);
        unsigned char out[32];
        if (PKCS5_PBKDF2_HMAC(password.c_str(), (int)password.size(),
                              reinterpret_cast<const unsigned char*>(saltBin.data()),
                              (int)saltBin.size(),
                              iters > 0 ? iters : PBKDF2_ITERS,
                              EVP_sha256(), 32, out) != 1)
            return false;
        return toHex(out, 32) == expect;
    }
    // Format ysi1$ lama (migrasi)
    if (stored.rfind("ysi1$", 0) == 0) {
        auto p1 = stored.find('$', 5);
        if (p1 == std::string::npos) return false;
        std::string salt = stored.substr(5, p1 - 5);
        std::string cur = salt + ":" + password + ":" + authSecret();
        uint64_t h = 0;
        for (int i = 0; i < 5000; ++i) {
            h = fnv1a64(cur + std::to_string(h) + std::to_string(i));
            cur = toHex64(h) + salt;
        }
        return ("ysi1$" + salt + "$" + toHex64(h)) == stored;
    }
    // Compat seed sangat lama
    if (password == "demo" && (stored == "demo" || stored.rfind("hashed_", 0) == 0 || stored.empty()))
        return true;
    if (stored == password || stored == ("hashed_" + password)) return true;
    return false;
}

static std::string b64urlEncode(const std::string& in) {
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

static std::string b64urlDecode(const std::string& in) {
    static int T[256];
    static bool init = false;
    if (!init) {
        for (int i = 0; i < 256; i++) T[i] = -1;
        const char* t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        for (int i = 0; i < 64; i++) T[(unsigned char)t[i]] = i;
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

/** HMAC-SHA256 → raw 32 bytes */
static std::string hmacSha256(const std::string& key, const std::string& data) {
    unsigned char out[EVP_MAX_MD_SIZE];
    unsigned int outLen = 0;
    HMAC(EVP_sha256(),
         key.data(), (int)key.size(),
         reinterpret_cast<const unsigned char*>(data.data()), data.size(),
         out, &outLen);
    return std::string(reinterpret_cast<char*>(out), outLen);
}

/** JWT standar: header.payload.signature (HS256) */
static std::string createToken(const User& u) {
    long long now = (long long)std::time(nullptr);
    long long exp = now + TOKEN_TTL_SEC;
    json header = {{"alg", "HS256"}, {"typ", "JWT"}};
    json payload = {
        {"sub", u.id},
        {"role", u.role},
        {"email", u.email},
        {"iss", "YourShop.Id"},
        {"iat", now},
        {"exp", exp},
    };
    std::string h = b64urlEncode(header.dump());
    std::string p = b64urlEncode(payload.dump());
    std::string signingInput = h + "." + p;
    std::string sig = b64urlEncode(hmacSha256(authSecret(), signingInput));
    return signingInput + "." + sig;
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
    if (token.size() < 20) return std::nullopt;
    if (isTokenBlacklisted(token)) return std::nullopt;

    // JWT: three parts
    auto d1 = token.find('.');
    if (d1 == std::string::npos) return std::nullopt;
    auto d2 = token.find('.', d1 + 1);
    if (d2 == std::string::npos) return std::nullopt;

    std::string h = token.substr(0, d1);
    std::string p = token.substr(d1 + 1, d2 - d1 - 1);
    std::string s = token.substr(d2 + 1);

    std::string signingInput = h + "." + p;
    std::string expectSig = b64urlEncode(hmacSha256(authSecret(), signingInput));
    if (expectSig != s) {
        // compat token lama ysi.*
        if (token.rfind("ysi.", 0) == 0) {
            // tolak token format lama (paksa re-login)
            return std::nullopt;
        }
        return std::nullopt;
    }

    try {
        json payload = json::parse(b64urlDecode(p));
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

    // Pagination: ?page=1&limit=20
    int total = (int)list.size();
    int page = req.has_param("page") ? std::max(1, std::stoi(req.get_param_value("page"))) : 1;
    int limit = req.has_param("limit") ? std::max(1, std::min(100, std::stoi(req.get_param_value("limit")))) : total;
    if (req.has_param("page") || req.has_param("limit")) {
        if (!req.has_param("limit")) limit = 20;
        int start = (page - 1) * limit;
        if (start > total) start = total;
        int end = std::min(start + limit, total);
        std::vector<Product> pageList(list.begin() + start, list.begin() + end);
        json arr = json::array();
        for (const auto& p : pageList) arr.push_back(p.toJson());
        jsonResponse(res, {
            {"items", arr},
            {"page", page},
            {"limit", limit},
            {"total", total},
            {"totalPages", (total + limit - 1) / limit},
        });
        return;
    }

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
// Parameter: customerId, status, seller, page, limit
void handleGetOrders(const httplib::Request& req, httplib::Response& res) {
    std::lock_guard<std::mutex> lock(store.mu);
    std::string custId = req.get_param_value("customerId");
    std::string status = req.get_param_value("status");
    std::string seller = req.get_param_value("seller");

    std::vector<Order> list;
    for (const auto& o : store.orders) {
        if (!custId.empty() && o.customerId != custId) continue;
        if (!status.empty() && o.status != status && normalizeStatus(o.status) != normalizeStatus(status)) continue;
        if (!seller.empty()) {
            bool hasSeller = false;
            for (const auto& it : o.items) {
                auto pit = std::find_if(store.products.begin(), store.products.end(),
                    [&](const Product& p){ return p.id == it.productId; });
                if (pit != store.products.end() && pit->seller == seller) { hasSeller = true; break; }
            }
            if (!hasSeller) continue;
        }
        list.push_back(o);
    }

    int total = (int)list.size();
    int page = req.has_param("page") ? std::max(1, std::stoi(req.get_param_value("page"))) : 1;
    int limit = 20;
    if (req.has_param("limit")) limit = std::max(1, std::min(100, std::stoi(req.get_param_value("limit"))));
    if (req.has_param("page") || req.has_param("limit")) {
        int start = (page - 1) * limit;
        if (start > total) start = total;
        int end = std::min(start + limit, total);
        json arr = json::array();
        for (int i = start; i < end; i++) arr.push_back(list[i].toJson());
        jsonResponse(res, {
            {"items", arr}, {"page", page}, {"limit", limit},
            {"total", total}, {"totalPages", (total + limit - 1) / std::max(1, limit)},
        });
        return;
    }

    json arr = json::array();
    for (const auto& o : list) arr.push_back(o.toJson());
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
    order.subtotal = subtotal;
    order.commissionRate = store.commissionRate;
    order.commission = std::round(subtotal * store.commissionRate * 100.0) / 100.0;
    order.sellerPayout = std::round((subtotal - order.commission) * 100.0) / 100.0;
    order.total = subtotal + shippingCost + (subtotal * 0.08);

    order.invoiceNumber = "INV-" + std::to_string(2026) + "-" + std::to_string(++store.nextInvoiceSeq);
    order.steps = buildStepsForStatus("processing");
    order.steps[0].date = order.date;

    store.orders.insert(store.orders.begin(), order);
    store.pushNotif(order.customerId, "Pesanan dibuat",
        "Pesanan " + order.id + " menunggu pembayaran.", "order");
    store.saveToDisk();
    ysiLog("ORDER", "created " + order.id + " total=" + std::to_string(order.total));
    {
        std::string email;
        for (const auto& u : store.users)
            if (u.id == order.customerId) { email = u.email; break; }
        if (!email.empty()) sendOrderEmail(order, email);
    }
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

// ============================================================
//  MIDTRANS SNAP — payment gateway
//  Env:
//    MIDTRANS_SERVER_KEY   (required for live Snap)
//    MIDTRANS_CLIENT_KEY   (returned to frontend for Snap.js)
//    MIDTRANS_IS_PRODUCTION=0|1  (default 0 = sandbox)
//    YSI_IDR_RATE=16000          (convert internal USD total → IDR)
//  Fallback: mock pay when SERVER_KEY empty or body.forceMock=true
// ============================================================

struct MidtransConfig {
    std::string serverKey;
    std::string clientKey;
    bool production = false;
    double idrRate = 16000.0;
    bool enabled() const { return !serverKey.empty(); }
};

static MidtransConfig midtransCfg() {
    MidtransConfig c;
    if (const char* s = std::getenv("MIDTRANS_SERVER_KEY")) c.serverKey = s;
    if (const char* s = std::getenv("MIDTRANS_CLIENT_KEY")) c.clientKey = s;
    if (const char* s = std::getenv("MIDTRANS_IS_PRODUCTION"))
        c.production = (std::string(s) == "1" || std::string(s) == "true");
    if (const char* s = std::getenv("YSI_IDR_RATE")) {
        double v = std::atof(s);
        if (v > 0) c.idrRate = v;
    }
    return c;
}

static std::string sha512Hex(const std::string& data) {
    unsigned char hash[SHA512_DIGEST_LENGTH];
    SHA512(reinterpret_cast<const unsigned char*>(data.data()), data.size(), hash);
    static const char* hex = "0123456789abcdef";
    std::string out;
    out.resize(SHA512_DIGEST_LENGTH * 2);
    for (int i = 0; i < SHA512_DIGEST_LENGTH; i++) {
        out[i * 2]     = hex[(hash[i] >> 4) & 0xF];
        out[i * 2 + 1] = hex[hash[i] & 0xF];
    }
    return out;
}

/** Sanitize order id for Midtrans (alphanumeric, dash, underscore; max 50). */
static std::string midtransSafeOrderId(const std::string& id) {
    std::string out;
    for (char ch : id) {
        if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '-' || ch == '_')
            out.push_back(ch);
        else if (ch == '#')
            continue;
        else
            out.push_back('-');
    }
    if (out.empty()) out = "ORD";
    // append short timestamp to keep unique across retries
    out += "-" + std::to_string(std::time(nullptr) % 1000000);
    if (out.size() > 50) out = out.substr(0, 50);
    return out;
}

static long long toIdrAmount(double totalUsdLike, double rate) {
    // Internal catalog uses USD-style decimals; Midtrans needs integer IDR.
    long long idr = static_cast<long long>(std::llround(totalUsdLike * rate));
    if (idr < 1) idr = 1;
    return idr;
}

/** Create Midtrans Snap transaction. Returns {ok, token, redirect_url, order_id, error}. */
static json createMidtransSnap(const Order& order, const User* customer, const MidtransConfig& cfg) {
    json result = {{"ok", false}};
    std::string host = cfg.production ? "https://app.midtrans.com"
                                      : "https://app.sandbox.midtrans.com";
    std::string mtOrderId = order.midtransOrderId.empty()
        ? midtransSafeOrderId(order.id) : order.midtransOrderId;
    long long gross = order.grossAmountIdr > 0
        ? order.grossAmountIdr : toIdrAmount(order.total, cfg.idrRate);

    json itemDetails = json::array();
    for (const auto& it : order.items) {
        long long price = toIdrAmount(it.unitPrice, cfg.idrRate);
        itemDetails.push_back({
            {"id", std::to_string(it.productId)},
            {"price", price},
            {"quantity", it.qty},
            {"name", it.productName.substr(0, 50)}
        });
    }
    if (order.shippingCost > 0) {
        itemDetails.push_back({
            {"id", "SHIPPING"},
            {"price", toIdrAmount(order.shippingCost, cfg.idrRate)},
            {"quantity", 1},
            {"name", "Ongkir"}
        });
    }
    // Align sum to gross (rounding)
    long long sum = 0;
    for (auto& it : itemDetails) sum += it["price"].get<long long>() * it["quantity"].get<int>();
    if (sum != gross && !itemDetails.empty()) {
        long long delta = gross - sum;
        itemDetails.back()["price"] = itemDetails.back()["price"].get<long long>() + delta;
    }

    json payload = {
        {"transaction_details", {
            {"order_id", mtOrderId},
            {"gross_amount", gross}
        }},
        {"item_details", itemDetails},
        {"credit_card", {{"secure", true}}}
    };
    json customerDetails = json::object();
    if (customer) {
        customerDetails["first_name"] = customer->name.empty() ? order.customerName : customer->name;
        if (!customer->email.empty()) customerDetails["email"] = customer->email;
        if (!customer->phone.empty()) customerDetails["phone"] = customer->phone;
    } else {
        customerDetails["first_name"] = order.customerName;
    }
    if (!order.shipPhone.empty() && !customerDetails.contains("phone"))
        customerDetails["phone"] = order.shipPhone;
    payload["customer_details"] = customerDetails;

    try {
        httplib::Client cli(host);
        cli.set_connection_timeout(8, 0);
        cli.set_read_timeout(15, 0);
        cli.set_basic_auth(cfg.serverKey, "");
        auto res = cli.Post("/snap/v1/transactions", payload.dump(), "application/json");
        if (!res) {
            result["error"] = "Tidak bisa menghubungi Midtrans";
            ysiLog("PAY", "midtrans connect failed");
            return result;
        }
        json body;
        try { body = json::parse(res->body); } catch (...) {
            result["error"] = "Respons Midtrans tidak valid";
            result["httpStatus"] = res->status;
            return result;
        }
        if (res->status < 200 || res->status >= 300) {
            std::string err = body.value("error_messages", json::array()).is_array() &&
                              !body["error_messages"].empty()
                ? body["error_messages"][0].get<std::string>()
                : body.value("status_message", "Midtrans error " + std::to_string(res->status));
            result["error"] = err;
            result["httpStatus"] = res->status;
            ysiLog("PAY", "midtrans error: " + err);
            return result;
        }
        result["ok"] = true;
        result["token"] = body.value("token", "");
        result["redirect_url"] = body.value("redirect_url", "");
        result["order_id"] = mtOrderId;
        result["gross_amount"] = gross;
        return result;
    } catch (const std::exception& e) {
        result["error"] = std::string("Midtrans exception: ") + e.what();
        return result;
    }
}

// ------ POST /api/orders/:id/pay ------
// Body: { paymentMethod?, simulateFail?, forceMock? }
// With MIDTRANS_SERVER_KEY → returns snapToken + clientKey (status remains pending until webhook)
// Without key / forceMock → immediate mock paid
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
    if (it->paymentStatus == "paid") {
        json resp = it->toJson();
        resp["gateway"] = {{"provider", it->paymentProvider.empty() ? "mock" : it->paymentProvider},
                           {"status", "already_paid"}};
        jsonResponse(res, resp);
        return;
    }

    if (body.value("simulateFail", false)) {
        it->paymentStatus = "failed";
        it->paymentProvider = "mock";
        store.saveToDisk();
        errorResponse(res, "Pembayaran gagal (simulasi gateway)", 402); return;
    }

    if (body.contains("paymentMethod"))
        it->paymentMethod = body["paymentMethod"].get<std::string>();

    MidtransConfig cfg = midtransCfg();
    bool forceMock = body.value("forceMock", false) || !cfg.enabled();

    if (!forceMock) {
        const User* customer = nullptr;
        for (const auto& u : store.users) {
            if (u.id == it->customerId) { customer = &u; break; }
        }
        if (it->midtransOrderId.empty())
            it->midtransOrderId = midtransSafeOrderId(it->id);
        if (it->grossAmountIdr <= 0)
            it->grossAmountIdr = toIdrAmount(it->total, cfg.idrRate);

        json snap = createMidtransSnap(*it, customer, cfg);
        if (!snap.value("ok", false)) {
            // Soft-fail to mock only if explicitly allowed; otherwise return error
            if (body.value("allowMockFallback", true)) {
                ysiLog("PAY", "midtrans failed, fallback mock: " + snap.value("error", ""));
                forceMock = true;
            } else {
                errorResponse(res, snap.value("error", "Gagal membuat transaksi Midtrans"), 502);
                return;
            }
        } else {
            it->snapToken = snap.value("token", "");
            it->paymentProvider = "midtrans";
            it->paymentStatus = "pending";
            it->paymentRef = snap.value("order_id", it->midtransOrderId);
            it->midtransOrderId = snap.value("order_id", it->midtransOrderId);
            it->grossAmountIdr = snap.value("gross_amount", it->grossAmountIdr);
            if (it->invoiceNumber.empty())
                it->invoiceNumber = "INV-2026-" + std::to_string(++store.nextInvoiceSeq);
            store.saveToDisk();

            json resp = it->toJson();
            resp["gateway"] = {
                {"provider", "midtrans"},
                {"mode", cfg.production ? "production" : "sandbox"},
                {"snapToken", it->snapToken},
                {"clientKey", cfg.clientKey},
                {"redirectUrl", snap.value("redirect_url", "")},
                {"orderId", it->midtransOrderId},
                {"grossAmountIdr", it->grossAmountIdr},
                {"message", "Buka Snap untuk menyelesaikan pembayaran"}
            };
            jsonResponse(res, resp);
            return;
        }
    }

    // --- Mock path ---
    it->paymentStatus = "paid";
    it->paidAt = currentTimestamp();
    it->paymentProvider = "mock";
    it->paymentRef = "YP-" + std::to_string(std::time(nullptr));
    it->snapToken.clear();
    if (it->invoiceNumber.empty())
        it->invoiceNumber = "INV-2026-" + std::to_string(++store.nextInvoiceSeq);
    store.saveToDisk();

    json resp = it->toJson();
    resp["gateway"] = {
        {"provider", "YourShopPay (mock)"},
        {"reference", it->paymentRef},
        {"message", cfg.enabled()
            ? "Fallback mock (Midtrans error / forceMock)"
            : "Pembayaran mock — set MIDTRANS_SERVER_KEY untuk gateway nyata"}
    };
    jsonResponse(res, resp);
}

// ------ POST /api/payments/midtrans/notification ------
// Midtrans server-to-server webhook (no JWT). Verifies signature_key.
void handleMidtransNotification(const httplib::Request& req, httplib::Response& res) {
    setCorsHeaders(req, res);
    MidtransConfig cfg = midtransCfg();
    if (!cfg.enabled()) {
        errorResponse(res, "Midtrans belum dikonfigurasi", 503); return;
    }

    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "JSON tidak valid"); return; }

    std::string orderId     = body.value("order_id", "");
    std::string statusCode  = body.value("status_code", "");
    std::string grossAmount = body.value("gross_amount", "");
    std::string signature   = body.value("signature_key", "");
    std::string txnStatus   = body.value("transaction_status", "");
    std::string fraudStatus = body.value("fraud_status", "");
    std::string txnId       = body.value("transaction_id", "");
    std::string payType     = body.value("payment_type", "");

    std::string expected = sha512Hex(orderId + statusCode + grossAmount + cfg.serverKey);
    if (signature != expected) {
        ysiLog("PAY", "midtrans signature mismatch for " + orderId);
        errorResponse(res, "Signature tidak valid", 403); return;
    }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.orders.begin(), store.orders.end(),
        [&](const Order& o){
            return o.midtransOrderId == orderId || o.paymentRef == orderId || o.id == orderId;
        });
    if (it == store.orders.end()) {
        // Also try matching without timestamp suffix
        it = std::find_if(store.orders.begin(), store.orders.end(),
            [&](const Order& o){
                return !o.midtransOrderId.empty() && orderId.find(o.midtransOrderId.substr(0, 12)) == 0;
            });
    }
    if (it == store.orders.end()) {
        ysiLog("PAY", "midtrans notif unknown order " + orderId);
        // Still 200 so Midtrans stops retrying poison messages after investigation
        jsonResponse(res, {{"status", "ignored"}, {"reason", "order_not_found"}});
        return;
    }

    bool markPaid = false;
    bool markFail = false;
    if (txnStatus == "capture") {
        if (fraudStatus.empty() || fraudStatus == "accept") markPaid = true;
    } else if (txnStatus == "settlement") {
        markPaid = true;
    } else if (txnStatus == "pending") {
        it->paymentStatus = "pending";
    } else if (txnStatus == "deny" || txnStatus == "cancel" || txnStatus == "expire") {
        markFail = true;
    }

    if (markPaid && it->paymentStatus != "paid") {
        it->paymentStatus = "paid";
        it->paidAt = currentTimestamp();
        it->paymentProvider = "midtrans";
        it->paymentRef = txnId.empty() ? orderId : txnId;
        if (!payType.empty()) it->paymentMethod = payType;
        if (it->invoiceNumber.empty())
            it->invoiceNumber = "INV-2026-" + std::to_string(++store.nextInvoiceSeq);
        store.pushNotif(it->customerId, "Pembayaran berhasil",
            "Pesanan " + it->id + " telah dibayar via Midtrans.", "order");
        ysiLog("PAY", "midtrans paid " + it->id + " txn=" + txnId);
    } else if (markFail && it->paymentStatus != "paid") {
        it->paymentStatus = "failed";
        it->paymentProvider = "midtrans";
        it->paymentRef = txnId.empty() ? orderId : txnId;
        ysiLog("PAY", "midtrans failed " + it->id + " status=" + txnStatus);
    }

    store.saveToDisk();
    jsonResponse(res, {
        {"status", "ok"},
        {"orderId", it->id},
        {"paymentStatus", it->paymentStatus},
        {"transactionStatus", txnStatus}
    });
}

// ------ GET /api/payments/config ------  public client key for Snap.js
void handlePaymentConfig(const httplib::Request& req, httplib::Response& res) {
    setCorsHeaders(req, res);
    MidtransConfig cfg = midtransCfg();
    jsonResponse(res, {
        {"provider", cfg.enabled() ? "midtrans" : "mock"},
        {"clientKey", cfg.clientKey},
        {"isProduction", cfg.production},
        {"snapJsUrl", cfg.production
            ? "https://app.midtrans.com/snap/snap.js"
            : "https://app.sandbox.midtrans.com/snap/snap.js"},
        {"enabled", cfg.enabled()}
    });
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
    if (!checkRateLimit(clientKey(req, "login"), 10, 900)) {
        errorResponse(res, "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.", 429);
        return;
    }

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

    // Migrasi hash lama → PBKDF2
    if (it->passwordHash.rfind("pbkdf2$", 0) != 0) {
        it->passwordHash = hashPassword(password, "");
        store.saveToDisk();
    }

    std::string token = createToken(*it);
    json resp = it->toJson();
    resp["token"] = token;
    resp["expiresIn"] = TOKEN_TTL_SEC;
    resp["tokenType"] = "Bearer";
    ysiLog("AUTH", "login ok user=" + it->id + " role=" + it->role);
    jsonResponse(res, resp);
}

// ------ POST /api/auth/register ------
void handleRegister(const httplib::Request& req, httplib::Response& res) {
    if (!checkRateLimit(clientKey(req, "register"), 5, 3600)) {
        errorResponse(res, "Terlalu banyak pendaftaran dari IP ini. Coba lagi nanti.", 429);
        return;
    }

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
    u.passwordHash = hashPassword(password, "");
    u.role         = role;
    u.shopName     = body.value("shopName", "");
    if (role == "seller") {
        u.kycStatus = "pending";
        u.kycNote = "Menunggu verifikasi admin";
        u.kycUpdatedAt = currentTimestamp();
    } else {
        u.kycStatus = "none";
    }
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
    it->passwordHash = hashPassword(neu, "");
    store.saveToDisk();
    // invalidate current token
    blacklistToken(auth->token, auth->exp);
    jsonResponse(res, {{"message", "Kata sandi diperbarui. Silakan masuk kembali."}});
}

// ------ POST /api/auth/forgot ------ Body: { email }
void handleForgotPassword(const httplib::Request& req, httplib::Response& res) {
    if (!checkRateLimit(clientKey(req, "forgot"), 5, 900)) {
        errorResponse(res, "Terlalu banyak permintaan reset. Coba lagi dalam 15 menit.", 429);
        return;
    }

    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }
    if (!body.contains("email")) { errorResponse(res, "Email wajib"); return; }

    std::string email = body["email"].get<std::string>();
    std::string resetTok = makeSalt(16);
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
    uit->passwordHash = hashPassword(neu, "");
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
    double revenue = 0.0, commissionTotal = 0.0;
    for (const auto& o : store.orders) {
        revenue += o.total;
        commissionTotal += o.commission;
    }
    int sellers = 0;
    std::unordered_map<std::string, bool> seen;
    for (const auto& p : store.products) {
        if (!seen[p.seller]) { seen[p.seller] = true; sellers++; }
    }
    int kycPending = 0;
    for (const auto& u : store.users)
        if (u.kycStatus == "pending") kycPending++;
    jsonResponse(res, {
        {"totalRevenue",   revenue},
        {"totalCommission", commissionTotal},
        {"commissionRate", store.commissionRate},
        {"totalOrders",    (int)store.orders.size()},
        {"activeProducts", (int)store.products.size()},
        {"activeSellers",  sellers},
        {"kycPending",     kycPending},
        {"storage",        store.useSqlite ? "sqlite" : "json"},
        {"schemaVersion",  store.schemaVersion},
    });
}

// ------ GET /api/seller/dashboard ------
void handleSellerDashboard(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"seller", "admin"});
    if (!auth) return;

    std::lock_guard<std::mutex> lock(store.mu);
    std::string shop;
    std::string kyc = "none";
    for (const auto& u : store.users) {
        if (u.id == auth->userId) {
            shop = u.shopName.empty() ? u.name : u.shopName;
            kyc = u.kycStatus.empty() ? "none" : u.kycStatus;
            break;
        }
    }
    if (req.has_param("seller")) shop = req.get_param_value("seller");

    double gmv = 0, payout = 0, commission = 0;
    int orderCount = 0, productCount = 0;
    json recent = json::array();
    for (const auto& o : store.orders) {
        bool mine = false;
        for (const auto& it : o.items) {
            auto pit = std::find_if(store.products.begin(), store.products.end(),
                [&](const Product& p){ return p.id == it.productId && p.seller == shop; });
            if (pit != store.products.end()) { mine = true; break; }
        }
        if (!mine) continue;
        orderCount++;
        gmv += o.subtotal > 0 ? o.subtotal : o.total;
        payout += o.sellerPayout;
        commission += o.commission;
        if (recent.size() < 10) recent.push_back(o.toJson());
    }
    for (const auto& p : store.products)
        if (p.seller == shop) productCount++;

    jsonResponse(res, {
        {"shopName", shop},
        {"kycStatus", kyc},
        {"productCount", productCount},
        {"orderCount", orderCount},
        {"gmv", gmv},
        {"commission", commission},
        {"sellerPayout", payout},
        {"commissionRate", store.commissionRate},
        {"recentOrders", recent},
    });
}

// ------ GET /api/notifications ------
void handleGetNotifications(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;
    std::lock_guard<std::mutex> lock(store.mu);
    json arr = json::array();
    int unread = 0;
    for (const auto& n : store.notifications) {
        if (!n.userId.empty() && n.userId != auth->userId && auth->role != "admin") continue;
        arr.push_back(n.toJson());
        if (!n.read) unread++;
    }
    jsonResponse(res, {{"items", arr}, {"unread", unread}});
}

// ------ POST /api/notifications/:id/read ------
void handleReadNotification(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireAuth(req, res);
    if (!auth) return;
    int id = std::stoi(req.matches[1].str());
    std::lock_guard<std::mutex> lock(store.mu);
    for (auto& n : store.notifications) {
        if (n.id == id && (n.userId.empty() || n.userId == auth->userId || auth->role == "admin")) {
            n.read = true;
            store.saveToDisk();
            jsonResponse(res, n.toJson());
            return;
        }
    }
    errorResponse(res, "Notifikasi tidak ditemukan", 404);
}

// ------ POST /api/kyc/submit ------ seller mengajukan verifikasi
void handleKycSubmit(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"seller"});
    if (!auth) return;
    json body;
    try { body = req.body.empty() ? json::object() : json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }

    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.users.begin(), store.users.end(),
        [&](const User& u){ return u.id == auth->userId; });
    if (it == store.users.end()) { errorResponse(res, "User tidak ditemukan", 404); return; }
    it->kycStatus = "pending";
    it->kycNote = body.value("note", "Pengajuan KYC dari penjual");
    it->kycUpdatedAt = currentTimestamp();
    if (body.contains("shopName") && !body["shopName"].get<std::string>().empty())
        it->shopName = body["shopName"].get<std::string>();
    store.pushNotif("u3", "KYC baru", it->shopName + " mengajukan verifikasi", "kyc");
    store.saveToDisk();
    jsonResponse(res, it->toJson());
}

// ------ POST /api/kyc/review ------ admin setujui/tolak
void handleKycReview(const httplib::Request& req, httplib::Response& res) {
    auto auth = requireRole(req, res, {"admin"});
    if (!auth) return;
    json body;
    try { body = json::parse(req.body); }
    catch (...) { errorResponse(res, "Format JSON tidak valid"); return; }
    std::string userId = body.value("userId", "");
    std::string decision = body.value("status", ""); // verified | rejected
    if (userId.empty() || (decision != "verified" && decision != "rejected")) {
        errorResponse(res, "userId dan status (verified|rejected) wajib"); return;
    }
    std::lock_guard<std::mutex> lock(store.mu);
    auto it = std::find_if(store.users.begin(), store.users.end(),
        [&](const User& u){ return u.id == userId; });
    if (it == store.users.end()) { errorResponse(res, "User tidak ditemukan", 404); return; }
    it->kycStatus = decision;
    it->kycNote = body.value("note", decision == "verified" ? "Disetujui admin" : "Ditolak admin");
    it->kycUpdatedAt = currentTimestamp();
    store.pushNotif(it->id, "Status KYC",
        decision == "verified" ? "Toko Anda telah diverifikasi!" : "Pengajuan KYC ditolak: " + it->kycNote,
        "kyc");
    store.saveToDisk();
    jsonResponse(res, it->toJson());
}

// ============================================================
//  MAIN — wire up server
// ============================================================

int main() {
    // Port & TLS dari env
    int httpPort = 8080;
    int httpsPort = 8443;
    if (const char* p = std::getenv("YSI_PORT")) httpPort = std::atoi(p);
    if (const char* p = std::getenv("YSI_HTTPS_PORT")) httpsPort = std::atoi(p);
    bool useHttps = false;
    std::string certFile = "certs/server.crt";
    std::string keyFile  = "certs/server.key";
    if (const char* e = std::getenv("YSI_HTTPS")) useHttps = (std::string(e) == "1" || std::string(e) == "true");
    if (const char* e = std::getenv("YSI_TLS_CERT")) certFile = e;
    if (const char* e = std::getenv("YSI_TLS_KEY"))  keyFile = e;

    auto wireRoutes = [](auto& svr) {
    // --- CORS + security headers pada setiap request ---
    svr.set_pre_routing_handler([](const httplib::Request& req, httplib::Response& res) {
        setCorsHeaders(req, res);
        if (req.method == "OPTIONS") {
            res.status = 204;
            return httplib::Server::HandlerResponse::Handled;
        }
        // Tolak Origin tidak diizinkan untuk request browser non-simple
        std::string origin = req.get_header_value("Origin");
        if (!origin.empty() && !originAllowed(origin) &&
            (req.method == "POST" || req.method == "PUT" || req.method == "DELETE")) {
            res.status = 403;
            res.set_content(R"({"error":"Origin tidak diizinkan oleh CORS"})", "application/json");
            return httplib::Server::HandlerResponse::Handled;
        }
        return httplib::Server::HandlerResponse::Unhandled;
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

    // --- Pembayaran (Midtrans) ---
    svr.Post("/api/payments/midtrans/notification",  handleMidtransNotification);
    svr.Get("/api/payments/config",                  handlePaymentConfig);

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
    svr.Get("/api/stats",                      handleGetStats);
    svr.Get("/api/seller/dashboard",           handleSellerDashboard);
    svr.Get("/api/notifications",              handleGetNotifications);
    svr.Post("/api/notifications/(\\d+)/read", handleReadNotification);
    svr.Post("/api/kyc/submit",                handleKycSubmit);
    svr.Post("/api/kyc/review",                handleKycReview);

    // --- Cek Kesehatan ---
    svr.Get("/api/health", [](const httplib::Request& req, httplib::Response& res) {
        setCorsHeaders(req, res);
        json body = {
            {"status", "ok"},
            {"service", "YourShop.Id API"},
            {"pesan", "Layanan berjalan normal"},
            {"products", (int)store.products.size()},
            {"orders", (int)store.orders.size()},
            {"users", (int)store.users.size()},
            {"auth", "JWT-HS256 + PBKDF2"},
            {"payment", midtransCfg().enabled() ? "midtrans" : "mock"},
            {"tls", std::getenv("YSI_HTTPS") ? true : false},
            {"rateLimit", redisCfg().enabled ? "redis" : "memory"},
            {"redis", redisCfg().enabled ?
                (redisCfg().host + ":" + std::to_string(redisCfg().port)) : "disabled"},
        };
        res.set_content(body.dump(), "application/json");
    });
    }; // end wireRoutes

    std::cout << "=====================================" << std::endl;
    std::cout << "  YourShop.Id — Server API" << std::endl;
    std::cout << "  Auth: JWT HS256 + PBKDF2-HMAC-SHA256" << std::endl;
    std::cout << "  Rate-limit: login/forgot/register"
              << (redisCfg().enabled ? " [Redis]" : " [memory]") << std::endl;
    if (redisCfg().enabled)
        std::cout << "  Redis: " << redisCfg().host << ":" << redisCfg().port << std::endl;
    std::cout << "  CORS: allowlist (YSI_CORS_ORIGINS)" << std::endl;

#ifdef CPPHTTPLIB_OPENSSL_SUPPORT
    if (useHttps) {
        std::ifstream c(certFile), k(keyFile);
        if (!c.good() || !k.good()) {
            std::cerr << "  [TLS] Cert/key tidak ditemukan: " << certFile
                      << " / " << keyFile << std::endl;
            std::cerr << "  Jalankan: bash scripts/gen_certs.sh" << std::endl;
            std::cerr << "  Fallback ke HTTP..." << std::endl;
            useHttps = false;
        } else {
            httplib::SSLServer sslSvr(certFile.c_str(), keyFile.c_str());
            if (!sslSvr.is_valid()) {
                std::cerr << "  [TLS] SSLServer gagal init — fallback HTTP" << std::endl;
                useHttps = false;
            } else {
                wireRoutes(sslSvr);
                std::cout << "  HTTPS https://localhost:" << httpsPort << std::endl;
                std::cout << "=====================================" << std::endl;
                std::cout << "  Data file: ysi_data.json" << std::endl;
                sslSvr.listen("0.0.0.0", httpsPort);
                return 0;
            }
        }
    }
#endif

    httplib::Server svr;
    wireRoutes(svr);
    std::cout << "  HTTP  http://localhost:" << httpPort << std::endl;
    std::cout << "=====================================" << std::endl;
    std::cout << "  Data file: ysi_data.json (auto save)" << std::endl;
    std::cout << "  Env: YSI_AUTH_SECRET YSI_CORS_ORIGINS YSI_HTTPS YSI_PORT YSI_REDIS_URL" << std::endl;
    std::cout << std::endl;

    svr.listen("0.0.0.0", httpPort);
    return 0;
}
