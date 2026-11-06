// ============================================================
//  YourShop.Id — main.js
//  Frontend logic: data, state, rendering, events
//  Backend API base URL — change this to your C++ server
// ============================================================

const API_BASE = (typeof window !== 'undefined' && window.YourShopConfig && window.YourShopConfig.apiBase)
  ? window.YourShopConfig.apiBase
  : 'http://localhost:8080/api';

// ============================================================
//  API LAYER — fetch helpers with offline fallback
// ============================================================

let apiOnline = false;

async function apiRequest(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  };
  if (currentUser?.token) opts.headers['Authorization'] = 'Bearer ' + currentUser.token;
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (res.status === 401) {
    const msg = (data && data.error) ? data.error : 'Sesi berakhir. Silakan masuk lagi.';
    if (currentUser?.token) {
      currentUser = null;
      saveUser();
      updateUserUI();
      toast(msg, 'error');
      showPage('login');
    }
    throw new Error(msg);
  }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

async function validateSession() {
  if (!currentUser?.token || !apiOnline) return;
  try {
    const me = await apiRequest('GET', '/auth/me');
    if (me) {
      currentUser = { ...currentUser, ...me, token: currentUser.token };
      saveUser();
      updateUserUI();
    }
  } catch (_) {
    // apiRequest sudah handle 401
  }
}

function normalizeProduct(p) {
  const stockFlag = p.stock !== false && p.inStock !== false;
  const stockQty = typeof p.stockQty === 'number' ? p.stockQty
    : (typeof p.stock === 'number' ? p.stock : (stockFlag ? 25 : 0));
  let variants = Array.isArray(p.variants) ? p.variants : [];
  // normalisasi varian: { id, label, color?, size?, priceDelta, stock }
  variants = variants.map((v, i) => ({
    id: v.id || (i + 1),
    label: v.label || [v.color, v.size].filter(Boolean).join(' / ') || v.name || ('Opsi ' + (i + 1)),
    color: v.color || '',
    size: v.size || '',
    priceDelta: Number(v.priceDelta) || 0,
    stock: typeof v.stock === 'number' ? v.stock : stockQty,
  }));
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji || '📦',
    imageUrl: p.imageUrl || p.image || '',
    price: Number(p.price) || 0,
    oldPrice: p.oldPrice == null || p.oldPrice === 0 ? null : Number(p.oldPrice),
    category: p.category || 'Umum',
    seller: p.seller || '',
    rating: Number(p.rating) || 0,
    reviews: Number(p.reviews) || 0,
    badge: p.badge || null,
    stock: stockQty > 0 && stockFlag,
    stockQty,
    desc: p.desc || p.description || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    featured: !!p.featured,
    variants,
  };
}

// Reviews & Q&A — lokal + sync API
let productReviews = JSON.parse(localStorage.getItem('ysi-reviews') || '{}'); // { [productId]: Review[] }
let productQA = JSON.parse(localStorage.getItem('ysi-qa') || '{}');
let selectedVariant = null; // { productId, variantId }

function saveReviews() { localStorage.setItem('ysi-reviews', JSON.stringify(productReviews)); }
function saveQA() { localStorage.setItem('ysi-qa', JSON.stringify(productQA)); }

function getReviews(productId) {
  return productReviews[String(productId)] || [];
}

function getQA(productId) {
  return productQA[String(productId)] || [];
}

function recomputeRating(productId) {
  const list = getReviews(productId);
  const p = adminProducts.find(x => x.id === productId);
  if (!p) return;
  if (!list.length) return;
  const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
  p.rating = Math.round(avg * 10) / 10;
  p.reviews = list.length;
}

function productImageHTML(p, className = '') {
  if (p.imageUrl) {
    return `<img class="${className}" src="${p.imageUrl}" alt="${p.name || ''}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='flex')">
      <span class="img-fallback" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:3rem">${p.emoji || '📦'}</span>`;
  }
  // assets.js category placeholder
  if (typeof YourShopAssets !== 'undefined' && YourShopAssets.CATEGORY_PLACEHOLDERS) {
    const ph = YourShopAssets.CATEGORY_PLACEHOLDERS[p.category] || YourShopAssets.CATEGORY_PLACEHOLDERS.default;
    if (ph) {
      return `<img class="${className}" src="${ph}" alt="${p.name || ''}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    }
  }
  if (typeof YourShopAssets !== 'undefined' && YourShopAssets.productPlaceholder) {
    return `<img class="${className}" src="${YourShopAssets.productPlaceholder(p.emoji || '📦')}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
  }
  return `<span style="font-size:inherit">${p.emoji || '📦'}</span>`;
}

function buildOrderSteps(status) {
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const steps = [
    { title: 'Pesanan Dibuat', date: today, detail: 'Pesananmu telah dikonfirmasi.', done: true },
    { title: 'Diproses', date: '—', detail: 'Penjual sedang menyiapkan barangmu.', done: false },
    { title: 'Dikirim', date: '—', detail: 'Paket diambil oleh kurir.', done: false },
    { title: 'Dalam Pengiriman', date: '—', detail: 'Paket dalam perjalanan.', done: false },
    { title: 'Terkirim', date: '—', detail: 'Paket sampai ke penerima.', done: false },
  ];
  const idx = { diproses: 1, dikirim: 3, terkirim: 4 }[status] ?? 1;
  for (let i = 0; i <= idx; i++) {
    steps[i].done = true;
    steps[i].date = steps[i].date === '—' ? today : steps[i].date;
  }
  steps.forEach(s => { s.active = false; });
  if (status !== 'terkirim') {
    const activeIdx = Math.min(idx, steps.length - 1);
    steps[activeIdx].active = true;
    if (!steps[activeIdx].done) steps[activeIdx].done = false;
  }
  return steps;
}

function enrichOrderItems(items) {
  return (items || []).map(i => {
    const p = adminProducts.find(x => x.id === i.productId);
    return {
      emoji: i.emoji || p?.emoji || '📦',
      name: i.name || i.productName || p?.name || 'Item',
      productId: i.productId,
      qty: i.qty || 1,
    };
  });
}

function normalizeOrder(o) {
  const statusMap = {
    delivered: 'terkirim', shipped: 'dikirim', processing: 'diproses', cancelled: 'dibatalkan',
    terkirim: 'terkirim', dikirim: 'dikirim', diproses: 'diproses', dibatalkan: 'dibatalkan',
  };
  const status = statusMap[o.status] || o.status || 'diproses';
  const items = enrichOrderItems(o.items);
  const steps = (Array.isArray(o.steps) && o.steps.length)
    ? o.steps
    : (status === 'dibatalkan'
        ? [{ title: 'Dibatalkan', date: o.date || '—', detail: o.cancelReason || 'Dibatalkan', done: true, active: true }]
        : buildOrderSteps(status));
  return {
    id: o.id,
    date: o.date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    status,
    items,
    total: Number(o.total) || 0,
    steps,
    customerId: o.customerId || null,
    customerName: o.customerName || '',
    paymentStatus: o.paymentStatus || 'pending',
    paymentMethod: o.paymentMethod || '',
    paidAt: o.paidAt || '',
    invoiceNumber: o.invoiceNumber || '',
    shippingMethod: o.shippingMethod || 'regular',
    shippingCost: Number(o.shippingCost) || 0,
    shipAddress: o.shipAddress || '',
    shipCity: o.shipCity || '',
    shipPhone: o.shipPhone || '',
    cancelReason: o.cancelReason || '',
    returnStatus: o.returnStatus || 'none',
    returnReason: o.returnReason || '',
  };
}

function getMyOrders() {
  if (!currentUser) return [];
  if (currentUser.role === 'admin' || currentUser.role === 'seller') return ordersList;
  // buyer: match by customerId or name
  return ordersList.filter(o =>
    (o.customerId && o.customerId === currentUser.id) ||
    (o.customerName && o.customerName === currentUser.name) ||
    !o.customerId // seed orders tanpa owner ditampilkan ke semua demo
  );
}

function sanitizeCart() {
  cart = cart.filter(c => adminProducts.some(p => p.id === c.id && p.stock));
  saveCart();
  updateCartCount();
}

function decrementStock(items) {
  (items || []).forEach(i => {
    const p = adminProducts.find(x => x.id === i.productId || x.id === i.id);
    if (!p) return;
    if (typeof p.stockQty === 'number') {
      p.stockQty = Math.max(0, p.stockQty - (i.qty || 1));
      p.stock = p.stockQty > 0;
    }
  });
  persistLocalCatalog();
}

function persistLocalCatalog() {
  try {
    localStorage.setItem('ysi-products-cache', JSON.stringify(adminProducts));
    localStorage.setItem('ysi-orders-cache', JSON.stringify(ordersList));
  } catch (_) { /* quota */ }
}

function loadLocalCatalog() {
  try {
    const pc = localStorage.getItem('ysi-products-cache');
    const oc = localStorage.getItem('ysi-orders-cache');
    if (pc) {
      const arr = JSON.parse(pc);
      if (Array.isArray(arr) && arr.length) adminProducts = arr.map(normalizeProduct);
    }
    if (oc) {
      const arr = JSON.parse(oc);
      if (Array.isArray(arr) && arr.length) ordersList = arr.map(normalizeOrder);
    }
  } catch (_) { /* ignore */ }
}

async function loadInitialData() {
  // coba cache lokal dulu agar state tidak hilang saat offline
  loadLocalCatalog();
  try {
    const health = await fetch(API_BASE + '/health', { method: 'GET' });
    if (!health.ok) throw new Error('health fail');
    apiOnline = true;

    const [prods, ords] = await Promise.all([
      apiRequest('GET', '/products'),
      apiRequest('GET', '/orders'),
    ]);
    if (Array.isArray(prods) && prods.length) {
      adminProducts = prods.map(normalizeProduct);
    }
    if (Array.isArray(ords)) {
      ordersList = ords.map(normalizeOrder);
    }
    persistLocalCatalog();
    console.log('[YourShop] API online — data dimuat dari server');
  } catch (err) {
    apiOnline = false;
    // jangan timpa cache yang valid
    if (!adminProducts.length) adminProducts = SEED_PRODUCTS.map(p => normalizeProduct(p));
    if (!ordersList.length) ordersList = SEED_ORDERS.map(o => normalizeOrder(o));
    // jika cache kosong dan seed belum, pastikan seed
    if (!adminProducts.length) adminProducts = SEED_PRODUCTS.map(p => normalizeProduct(p));
    console.warn('[YourShop] API offline — memakai data lokal/cache', err.message);
  }
  sanitizeCart();
  renderProducts();
  renderFeatured();
}

// ============================================================
//  DATA — seed fallback (dipakai jika server C++ tidak berjalan)
// ============================================================

const SEED_PRODUCTS = [
  { id:1,  name:'Wireless Earbuds Pro', emoji:'🎧', imageUrl:'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&h=600&fit=crop', price:79.99, oldPrice:99.99, category:'Elektronik', seller:'SoundCraft', rating:4.7, reviews:3, badge:'Diskon', stock:true, stockQty:40, desc:'Earbuds nirkabel premium dengan peredam kebisingan aktif, baterai 30 jam, dan audio jernih.', tags:['wireless','audio'], featured:true, variants:[{id:1,label:'Hitam',color:'Hitam',priceDelta:0,stock:20},{id:2,label:'Putih',color:'Putih',priceDelta:0,stock:15},{id:3,label:'Biru',color:'Biru',priceDelta:5,stock:5}] },
  { id:2,  name:'Mechanical Keyboard RGB', emoji:'⌨️', imageUrl:'https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?w=600&h=600&fit=crop', price:129.00, oldPrice:null, category:'Elektronik', seller:'TechDesk', rating:4.5, reviews:2, badge:null, stock:true, stockQty:25, desc:'Switch mekanikal taktil dengan pencahayaan RGB penuh. Tata letak TKL kompak.', tags:['keyboard','gaming'], featured:false, variants:[{id:1,label:'Red Switch',size:'Red',priceDelta:0,stock:10},{id:2,label:'Blue Switch',size:'Blue',priceDelta:10,stock:8},{id:3,label:'Brown Switch',size:'Brown',priceDelta:5,stock:7}] },
  { id:3,  name:'Vintage Denim Jacket', emoji:'🧥', imageUrl:'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=600&h=600&fit=crop', price:64.00, oldPrice:89.00, category:'Fashion', seller:'UrbanThread', rating:4.8, reviews:2, badge:'Diskon', stock:true, stockQty:18, desc:'Jaket denim stonewash klasik. Potongan santai, saku dada, dan konstruksi tahan lama.', tags:['denim','jacket'], featured:false, variants:[{id:1,label:'S / Biru',size:'S',color:'Biru',priceDelta:0,stock:4},{id:2,label:'M / Biru',size:'M',color:'Biru',priceDelta:0,stock:6},{id:3,label:'L / Hitam',size:'L',color:'Hitam',priceDelta:5,stock:5},{id:4,label:'XL / Hitam',size:'XL',color:'Hitam',priceDelta:8,stock:3}] },
  { id:4,  name:'Ceramic Pour-Over Set', emoji:'☕', imageUrl:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&h=600&fit=crop', price:45.99, oldPrice:null, category:'Rumah', seller:'BrewHouse', rating:4.9, reviews:1, badge:'Baru', stock:true, stockQty:30, desc:'Dripper pour-over keramik buatan tangan dengan mug serasi.', tags:['coffee','ceramic'], featured:false, variants:[] },
  { id:5,  name:'The Design of Everyday Things', emoji:'📚', imageUrl:'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=600&h=600&fit=crop', price:18.99, oldPrice:null, category:'Buku', seller:'PageTurner', rating:4.6, reviews:2, badge:null, stock:true, stockQty:50, desc:'Klasik abadi karya Don Norman tentang desain yang bisa digunakan.', tags:['design','books'], featured:false, variants:[] },
  { id:6,  name:'Yoga Mat Premium', emoji:'🧘', imageUrl:'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600&h=600&fit=crop', price:49.00, oldPrice:65.00, category:'Olahraga', seller:'ZenFit', rating:4.7, reviews:1, badge:'Diskon', stock:true, stockQty:22, desc:'Matras yoga anti-selip tebal 6mm. Bahan TPE ramah lingkungan.', tags:['yoga','fitness'], featured:false, variants:[{id:1,label:'Ungu',color:'Ungu',priceDelta:0,stock:8},{id:2,label:'Hijau',color:'Hijau',priceDelta:0,stock:7},{id:3,label:'Abu-abu',color:'Abu-abu',priceDelta:0,stock:7}] },
  { id:7,  name:'Artisan Hot Sauce Set', emoji:'🌶️', imageUrl:'https://images.unsplash.com/photo-1596040033229-a0b34b1e0f5b?w=600&h=600&fit=crop', price:28.00, oldPrice:null, category:'Makanan', seller:'HeatCraft', rating:4.8, reviews:1, badge:null, stock:true, stockQty:35, desc:'Set 4 saus pedas buatan tangan dari ringan hingga ekstra pedas.', tags:['food','hot sauce'], featured:false, variants:[] },
  { id:8,  name:'Abstract Print #12', emoji:'🎨', imageUrl:'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=600&h=600&fit=crop', price:120.00, oldPrice:null, category:'Seni', seller:'ArtStudio', rating:5.0, reviews:1, badge:'Original', stock:true, stockQty:8, desc:'Cetakan giclée edisi terbatas di atas kertas seni berkualitas.', tags:['art','print'], featured:false, variants:[{id:1,label:'A4',size:'A4',priceDelta:0,stock:4},{id:2,label:'A3',size:'A3',priceDelta:40,stock:3},{id:3,label:'A2',size:'A2',priceDelta:80,stock:1}] },
  { id:9,  name:'Smart Watch Series 5', emoji:'⌚', imageUrl:'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=600&fit=crop', price:199.00, oldPrice:249.00, category:'Elektronik', seller:'WristTech', rating:4.4, reviews:2, badge:'Diskon', stock:true, stockQty:15, desc:'Pelacak kesehatan, GPS, dan baterai 7 hari. Tahan air hingga 50m.', tags:['smartwatch','tech'], featured:true, variants:[{id:1,label:'42mm Hitam',size:'42mm',color:'Hitam',priceDelta:0,stock:6},{id:2,label:'46mm Hitam',size:'46mm',color:'Hitam',priceDelta:20,stock:5},{id:3,label:'42mm Silver',size:'42mm',color:'Silver',priceDelta:10,stock:4}] },
  { id:10, name:'Linen Throw Blanket', emoji:'🛋️', imageUrl:'https://images.unsplash.com/photo-1584100936595-4f6540c2f0b2?w=600&h=600&fit=crop', price:38.00, oldPrice:null, category:'Rumah', seller:'CozyHome', rating:4.6, reviews:1, badge:'Baru', stock:true, stockQty:20, desc:'Linen Eropa 100% stonewash. Ringan dan bernapas.', tags:['linen','home'], featured:false, variants:[{id:1,label:'Natural',color:'Natural',priceDelta:0,stock:8},{id:2,label:'Sage',color:'Sage',priceDelta:0,stock:6},{id:3,label:'Terracotta',color:'Terracotta',priceDelta:3,stock:6}] },
  { id:11, name:'Running Shoes Ultra', emoji:'👟', imageUrl:'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&h=600&fit=crop', price:95.00, oldPrice:120.00, category:'Fashion', seller:'SpeedStep', rating:4.5, reviews:2, badge:'Diskon', stock:true, stockQty:12, desc:'Sol tengah busa responsif dan mesh bernapas. Ringan untuk lari jarak jauh.', tags:['shoes','running'], featured:false, variants:[{id:1,label:'40 / Hitam',size:'40',color:'Hitam',priceDelta:0,stock:2},{id:2,label:'41 / Hitam',size:'41',color:'Hitam',priceDelta:0,stock:3},{id:3,label:'42 / Putih',size:'42',color:'Putih',priceDelta:0,stock:3},{id:4,label:'43 / Putih',size:'43',color:'Putih',priceDelta:0,stock:2},{id:5,label:'44 / Merah',size:'44',color:'Merah',priceDelta:5,stock:2}] },
  { id:12, name:'Cold Brew Concentrate', emoji:'🧃', imageUrl:'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&h=600&fit=crop', price:16.50, oldPrice:null, category:'Makanan', seller:'BrewHouse', rating:4.7, reviews:1, badge:null, stock:true, stockQty:60, desc:'Kopi cold brew siap diencerkan. Direndam 20 jam. Encerkan 1:3.', tags:['coffee','cold brew'], featured:false, variants:[{id:1,label:'250ml',size:'250ml',priceDelta:0,stock:30},{id:2,label:'500ml',size:'500ml',priceDelta:8,stock:20},{id:3,label:'1L',size:'1L',priceDelta:18,stock:10}] },
  { id:13, name:'Oli Mesin Synthetic 5W-30', emoji:'🛢️', imageUrl:'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=600&h=600&fit=crop', price:32.00, oldPrice:39.00, category:'Otomotif', seller:'AutoPartID', rating:4.8, reviews:2, badge:'Diskon', stock:true, stockQty:48, desc:'Oli mesin fully synthetic 5W-30 untuk mesin bensin. Perlindungan anti-aus dan hemat bahan bakar. Isi 4 liter.', tags:['oli','mesin','sparepart'], featured:true, variants:[{id:1,label:'4L',size:'4L',priceDelta:0,stock:30},{id:2,label:'1L',size:'1L',priceDelta:-18,stock:18}] },
  { id:14, name:'Kampas Rem Ceramic Depan', emoji:'🛑', imageUrl:'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=600&h=600&fit=crop', price:28.50, oldPrice:null, category:'Otomotif', seller:'BrakePro', rating:4.6, reviews:1, badge:'Baru', stock:true, stockQty:36, desc:'Kampas rem ceramic low-dust untuk roda depan. Cocok sedan & hatchback populer. Termasuk sensor keausan.', tags:['rem','kampas','sparepart'], featured:false, variants:[{id:1,label:'Sedan',size:'Sedan',priceDelta:0,stock:20},{id:2,label:'MPV',size:'MPV',priceDelta:5,stock:16}] },
  { id:15, name:'Aki Kering 12V 60Ah', emoji:'🔋', imageUrl:'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=600&fit=crop', price:75.00, oldPrice:89.00, category:'Otomotif', seller:'AutoPartID', rating:4.7, reviews:1, badge:'Diskon', stock:true, stockQty:20, desc:'Aki kering maintenance-free 12V 60Ah. Daya cranking tinggi, tahan getaran. Garansi resmi 12 bulan.', tags:['aki','battery','sparepart'], featured:false, variants:[{id:1,label:'60Ah',size:'60Ah',priceDelta:0,stock:12},{id:2,label:'70Ah',size:'70Ah',priceDelta:15,stock:8}] },
];

// Seed reviews (hanya jika localStorage kosong)
const SEED_REVIEWS = {
  '1': [
    { id:1, userName:'Andi', rating:5, comment:'Bass-nya mantap, ANC bagus buat kerja di kafe.', date:'2026-07-12' },
    { id:2, userName:'Rina', rating:4, comment:'Nyaman dipakai lama, baterai tahan sesuai klaim.', date:'2026-07-20' },
    { id:3, userName:'Budi', rating:5, comment:'Worth it di harga diskon!', date:'2026-08-01' },
  ],
  '3': [
    { id:1, userName:'Sari', rating:5, comment:'Denim-nya tebal dan potongannya pas.', date:'2026-06-15' },
    { id:2, userName:'Doni', rating:4, comment:'Sedikit lebih besar dari ukuran biasa, tapi bagus.', date:'2026-07-02' },
  ],
  '11': [
    { id:1, userName:'Fajar', rating:5, comment:'Ringan dan empuk untuk lari pagi.', date:'2026-07-18' },
    { id:2, userName:'Maya', rating:4, comment:'Desain keren, ukuran true to size.', date:'2026-07-28' },
  ],
};
const SEED_QA = {
  '1': [
    { id:1, userName:'Eko', question:'Apakah support wireless charging?', date:'2026-07-10', answer:'Ya, case-nya mendukung pengisian nirkabel Qi.', answerBy:'SoundCraft', answerDate:'2026-07-11' },
    { id:2, userName:'Lia', question:'Cocok untuk olahraga?', date:'2026-07-25', answer:'', answerBy:'', answerDate:'' },
  ],
  '11': [
    { id:1, userName:'Rudi', question:'Bisa dipakai di trek basah?', date:'2026-07-05', answer:'Outsole punya grip yang cukup untuk jalan basah ringan, bukan trail ekstrem.', answerBy:'SpeedStep', answerDate:'2026-07-06' },
  ],
};
if (!localStorage.getItem('ysi-reviews')) {
  productReviews = SEED_REVIEWS;
  saveReviews();
}
if (!localStorage.getItem('ysi-qa')) {
  productQA = SEED_QA;
  saveQA();
}

const SEED_ORDERS = [
  {
    id: '#ORD-8821', date: 'May 7, 2026', status: 'terkirim',
    customerId: 'u1', customerName: 'Demo Buyer',
    items: [{ emoji:'🎧', name:'Wireless Earbuds Pro', productId: 1, qty: 1 }, { emoji:'☕', name:'Ceramic Pour-Over Set', productId: 4, qty: 1 }],
    total: 125.98,
    steps: [
      { title:'Pesanan Dibuat', date:'May 1', detail:'Pesananmu telah dikonfirmasi.', done:true },
      { title:'Diproses', date:'May 2', detail:'Penjual mengemas barangmu.', done:true },
      { title:'Dikirim', date:'May 3', detail:'Paket diambil oleh kurir.', done:true },
      { title:'Dalam Pengiriman', date:'May 6', detail:'Bersama kurir lokal.', done:true },
      { title:'Terkirim', date:'May 7', detail:'Ditinggal di depan pintu.', done:true, active:false },
    ]
  },
  {
    id: '#ORD-8745', date: 'Apr 29, 2026', status: 'dikirim',
    customerId: 'u1', customerName: 'Demo Buyer',
    items: [{ emoji:'📚', name:'The Design of Everyday Things', productId: 5, qty: 1 }],
    total: 18.99,
    steps: [
      { title:'Pesanan Dibuat', date:'Apr 29', detail:'Pesananmu telah dikonfirmasi.', done:true },
      { title:'Diproses', date:'Apr 30', detail:'Penjual mengemas barangmu.', done:true },
      { title:'Dikirim', date:'May 1', detail:'Paket sedang dalam perjalanan.', done:true },
      { title:'Dalam Pengiriman', date:'ETA May 11', detail:'Estimasi tiba.', done:false, active:true },
      { title:'Terkirim', date:'—', detail:'Menunggu.', done:false },
    ]
  },
  {
    id: '#ORD-8612', date: 'Apr 20, 2026', status: 'diproses',
    customerId: 'u1', customerName: 'Demo Buyer',
    items: [{ emoji:'🎨', name:'Abstract Print #12', productId: 8, qty: 1 }, { emoji:'🛋️', name:'Linen Throw Blanket', productId: 7, qty: 1 }],
    total: 158.00,
    steps: [
      { title:'Pesanan Dibuat', date:'Apr 20', detail:'Pesananmu telah dikonfirmasi.', done:true },
      { title:'Diproses', date:'Apr 21', detail:'Penjual sedang menyiapkan pesananmu.', done:false, active:true },
      { title:'Dikirim', date:'—', detail:'Menunggu.', done:false },
      { title:'Dalam Pengiriman', date:'—', detail:'Menunggu.', done:false },
      { title:'Terkirim', date:'—', detail:'Menunggu.', done:false },
    ]
  },
];

// ============================================================
//  STATE
// ============================================================

let cart         = JSON.parse(localStorage.getItem('ysi-cart') || '[]');
let currentUser  = JSON.parse(localStorage.getItem('ysi-user') || 'null');
let currentCategory = 'All';
let currentSearch   = '';
let selectedRole    = 'buyer';
let adminProducts   = SEED_PRODUCTS.map(p => normalizeProduct(p));
let ordersList      = SEED_ORDERS.map(o => ({ ...o }));
let selectedEmoji   = '📦';
let nextId          = 100;
let watchlist       = JSON.parse(localStorage.getItem('ysi-watchlist') || '[]');
let notifications   = JSON.parse(localStorage.getItem('ysi-notifs') || 'null') || [
  { id: 1, icon: '🎉', title: 'Selamat datang di YourShop.Id', body: 'Jelajahi ribuan produk dari penjual terverifikasi.', time: 'Baru saja', read: false },
  { id: 2, icon: '🏷️', title: 'Deals minggu ini', body: 'Diskon hingga 30% untuk kategori Elektronik.', time: '1 jam lalu', read: false },
  { id: 3, icon: '📦', title: 'Tips pengiriman', body: 'Pesanan di atas $75 mendapat gratis ongkir.', time: 'Kemarin', read: true },
];
let userSettings = JSON.parse(localStorage.getItem('ysi-settings') || 'null') || {
  emailNotif: true, orderNotif: true, promoNotif: false, darkMode: false, language: 'id',
};
let checkoutPayMethod = 'transfer';
let checkoutShipMethod = 'jne';
let pendingPaymentOrderId = null;
let appliedPromo = null; // { code, discount, freeShipping, label }
let editingProductId = null;
let suspendedSellers = JSON.parse(localStorage.getItem('ysi-suspended-sellers') || '[]');

const SHIPPING_OPTIONS = [
  { id: 'jne', name: 'JNE Reguler', eta: '2–4 hari', cost: 8.50 },
  { id: 'jnt', name: 'J&T Express', eta: '1–3 hari', cost: 12.00 },
  { id: 'sicepat', name: 'SiCepat BEST', eta: '1–2 hari', cost: 10.50 },
  { id: 'regular', name: 'Kurir Standar', eta: '3–5 hari', cost: 9.99 },
];

// Base prices disimpan dalam USD. Tampilan mengikuti bahasa/negara.
const CURRENCY = {
  id: { code: 'IDR', symbol: 'Rp', rate: 16000, locale: 'id-ID', freeShipUsd: 75, shippingUsd: 9.99, taxRate: 0.11 },
  en: { code: 'USD', symbol: '$',  rate: 1,     locale: 'en-US', freeShipUsd: 75, shippingUsd: 9.99, taxRate: 0.08 },
};
const PROMO_CODES = {
  FORGE10:      { discount: 0.10, freeShipping: false, label: 'Diskon 10%' },
  HEMAT20:      { discount: 0.20, freeShipping: false, label: 'Diskon 20%' },
  GRATISONGKIR: { discount: 0,    freeShipping: true,  label: 'Gratis Ongkir' },
  WELCOME:      { discount: 0.15, freeShipping: false, label: 'Diskon 15% welcome' },
};

function getCurrency() {
  return CURRENCY[userSettings.language] || CURRENCY.id;
}

/** Format jumlah USD ke mata uang tampilan */
function formatMoney(usdAmount) {
  const c = getCurrency();
  const val = (Number(usdAmount) || 0) * c.rate;
  if (c.code === 'IDR') {
    return 'Rp' + Math.round(val).toLocaleString('id-ID');
  }
  return '$' + val.toFixed(2);
}

/** Konversi input tampilan (IDR/USD) → USD base */
function displayToUsd(displayVal) {
  const c = getCurrency();
  const n = parseFloat(displayVal);
  if (isNaN(n)) return 0;
  return n / c.rate;
}

function currencyLabel() {
  return getCurrency().code;
}

function freeShipThreshold() {
  return getCurrency().freeShipUsd;
}

function getShippingCost(subtotalAfterDiscount) {
  const c = getCurrency();
  const free = subtotalAfterDiscount >= c.freeShipUsd || appliedPromo?.freeShipping;
  const opt = SHIPPING_OPTIONS.find(s => s.id === checkoutShipMethod) || SHIPPING_OPTIONS[0];
  if (free) {
    // express still small fee when free-ship eligible
    if (opt.id === 'jnt') return 3.0;
    if (opt.id === 'sicepat') return 2.5;
    return 0;
  }
  return opt.cost;
}

function unitPrice(item) {
  const p = adminProducts.find(x => x.id === item.id);
  if (!p) return 0;
  return p.price + (Number(item.priceDelta) || 0);
}

function calcCartTotals() {
  const c = getCurrency();
  let subtotal = cart.reduce((s, item) => s + unitPrice(item) * item.qty, 0);
  let discount = 0;
  if (appliedPromo?.discount) discount = subtotal * appliedPromo.discount;
  const afterDiscount = subtotal - discount;
  const shipping = getShippingCost(afterDiscount);
  const tax = afterDiscount * c.taxRate;
  const total = afterDiscount + shipping + tax;
  return { subtotal, discount, shipping, tax, total, afterDiscount };
}

// ============================================================
//  UTILS
// ============================================================

function saveCart() {
  localStorage.setItem('ysi-cart', JSON.stringify(cart));
  updateCartCount();
}

function saveUser() {
  localStorage.setItem('ysi-user', JSON.stringify(currentUser));
}

function updateCartCount() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('cart-count').textContent = total;
}

function toast(msg, type = '') {
  const wrap = document.getElementById('toasts');
  const el   = document.createElement('div');
  el.className   = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function starsRaw(rating, reviews) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return `<span style="color:var(--warn)">${'★'.repeat(full)}${half ? '½' : ''}</span>` +
         `<span style="color:var(--text3);font-size:12px"> ${rating} (${reviews?.toLocaleString()})</span>`;
}

// ============================================================
//  PAGES
// ============================================================

function showPage(name) {
  const known = [
    'store','detail','cart','orders','login','become-seller','admin',
    'profile','settings','help','deals','checkout','payment','watchlist',
    'notifications','terms','privacy','contact'
  ];
  if (!known.includes(name)) {
    console.warn('Page not found:', name);
    toast('Halaman tidak ditemukan', 'error');
    name = 'store';
  }
  const page = document.getElementById('page-' + name);
  if (!page) { console.warn('DOM page missing:', name); return; }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0, 0);
  const catBar = document.querySelector('.cat-bar');
  if (catBar) catBar.style.display = (name === 'store') ? 'flex' : 'none';

  // Remember for refresh after language/theme change
  try { sessionStorage.setItem('ysi-last-page', name); } catch (_) {}

  if (name === 'cart')          renderCart();
  if (name === 'orders')        refreshOrders().then(() => renderOrders());
  if (name === 'admin')         refreshOrders().then(() => renderAdmin('dashboard'));
  if (name === 'store')         { renderProducts(); renderFeatured(); }
  if (name === 'profile')       renderProfile();
  if (name === 'settings')      renderSettings();
  if (name === 'terms')         renderTerms();
  if (name === 'privacy')       renderPrivacy();
  if (name === 'contact')       renderContact();
  if (name === 'help')          renderHelp();
  if (name === 'deals')         renderDeals();
  if (name === 'checkout')      renderCheckout();
  if (name === 'payment') {
    if (pendingPaymentOrderId) renderPaymentPage(pendingPaymentOrderId);
    else {
      const unpaid = ordersList.find(o => o.paymentStatus === 'pending' && o.status !== 'dibatalkan');
      if (unpaid) renderPaymentPage(unpaid.id);
      else {
        const el = document.getElementById('payment-content');
        if (el) el.innerHTML = `<div class="empty-cart"><div class="empty-icon">💳</div>
          <p>Tidak ada pembayaran tertunda</p>
          <button class="btn btn-primary" onclick="showPage('orders')">Pesanan Saya</button>
          <button class="tbl-btn" style="margin-top:0.5rem" onclick="showPage('store')">Lanjut Belanja</button></div>`;
      }
    }
  }
  if (name === 'watchlist')     renderWatchlist();
  if (name === 'notifications') renderNotifications();
  // become-seller, login, detail: static / rendered elsewhere
}

// ============================================================
//  AUTH / USER
// ============================================================

function updateUserUI() {
  const area      = document.getElementById('user-area');
  const ordersBtn = document.getElementById('orders-btn');
  if (currentUser) {
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const firstName = currentUser.name.split(' ')[0];
    const roleLabel = { buyer: 'Pembeli', seller: 'Penjual', admin: 'Admin' }[currentUser.role] || currentUser.role;
    const isDashboardRole = currentUser.role === 'admin' || currentUser.role === 'seller';

    area.innerHTML = `
      <button class="user-pill-btn" onclick="toggleProfileDropdown(event)">
        <div class="user-avatar">${initials}</div>
        <span style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${firstName}</span>
        <span class="profile-caret">▼</span>
      </button>
      <div class="profile-dropdown">
        <div class="pd-header">
          <div class="pd-name">${currentUser.name}</div>
          <div class="pd-role">${roleLabel} · ${currentUser.email}</div>
        </div>
        ${isDashboardRole ? `
        <button class="pd-item" onclick="closeProfileDropdown();showPage('admin')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          Dashboard
        </button>` : ''}
        <button class="pd-item" onclick="closeProfileDropdown();showPage('orders')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          Pesanan Saya
        </button>
        <button class="pd-item" onclick="closeProfileDropdown();showPage('watchlist')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
          Watchlist
        </button>
        <button class="pd-item" onclick="closeProfileDropdown();showPage('profile')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Profil Saya
        </button>
        <button class="pd-item" onclick="closeProfileDropdown();showPage('settings')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>
          Pengaturan
        </button>
        <div class="pd-divider"></div>
        <button class="pd-item danger" onclick="closeProfileDropdown();doLogout()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Keluar
        </button>
      </div>
    `;
    if (ordersBtn) ordersBtn.style.display = 'inline';
    // sync top-bar left
    const topLeft = document.getElementById('top-bar-left');
    if (topLeft) {
      topLeft.innerHTML = `
        <span>Hai, <strong>${firstName}</strong>!</span>
        <span class="sep">|</span>
        <button onclick="showPage('deals')">Deals</button>
        <span class="sep">|</span>
        <button onclick="showPage('help')">Bantuan</button>`;
    }
  } else {
    area.innerHTML = `<button class="nav-btn" onclick="showPage('login')">Masuk</button>`;
    if (ordersBtn) ordersBtn.style.display = 'none';
    const topLeft = document.getElementById('top-bar-left');
    if (topLeft) {
      topLeft.innerHTML = `
        <span>Hai!</span>
        <button onclick="showPage('login')">Masuk</button>
        <span class="sep">|</span>
        <button onclick="showPage('login')">Daftar</button>
        <span class="sep">|</span>
        <button onclick="showPage('deals')">Deals</button>
        <span class="sep">|</span>
        <button onclick="showPage('help')">Bantuan</button>`;
    }
  }
  updateNotifBadge();
}

function toggleProfileDropdown(e) {
  e.stopPropagation();
  document.getElementById('user-area').classList.toggle('open');
}

function closeProfileDropdown() {
  document.getElementById('user-area').classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const area = document.getElementById('user-area');
  if (area && !area.contains(e.target)) area.classList.remove('open');
});

async function doLogin() {
  const email = document.getElementById('login-email')?.value?.trim();
  const pass  = document.getElementById('login-pass')?.value;
  if (!email || !pass) { toast('Harap isi semua kolom', 'error'); return; }

  try {
    if (apiOnline) {
      const data = await apiRequest('POST', '/auth/login', { email, password: pass });
      currentUser = {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role || 'buyer',
        shopName: data.shopName || '',
        token: data.token || null,
      };
    } else {
      // fallback offline
      currentUser = {
        id: 'local',
        name: email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        email,
        role: 'buyer',
        token: null,
      };
    }
    saveUser();
    updateUserUI();
    toast('Selamat datang kembali, ' + currentUser.name + '! 👋', 'success');
    if (currentUser.role === 'admin' || currentUser.role === 'seller') showPage('admin');
    else showPage('store');
    // refresh orders for this user
    await refreshOrders();
  } catch (err) {
    toast(err.message || 'Login gagal', 'error');
  }
}

async function demoLogin(role) {
  const emails = { buyer: 'buyer@demo.com', seller: 'seller@demo.com', admin: 'admin@demo.com' };
  const names  = { buyer: 'Budi Santoso', seller: 'Sari Kerajinan', admin: 'Dian Admin' };
  try {
    if (apiOnline) {
      const data = await apiRequest('POST', '/auth/login', { email: emails[role], password: 'demo' });
      currentUser = {
        id: data.id,
        name: data.name || names[role],
        email: data.email,
        role: data.role || role,
        shopName: data.shopName || '',
        token: data.token || null,
      };
    } else {
      currentUser = { id: 'demo-' + role, name: names[role], email: emails[role], role, token: null };
    }
    saveUser();
    updateUserUI();
    toast('Masuk sebagai ' + currentUser.name, 'success');
    if (role === 'admin' || role === 'seller') showPage('admin');
    else showPage('store');
    await refreshOrders();
  } catch (err) {
    // fallback if demo login fails
    currentUser = { id: 'demo-' + role, name: names[role], email: emails[role], role, token: null };
    saveUser();
    updateUserUI();
    toast('Masuk sebagai ' + names[role] + ' (offline)', 'success');
    if (role === 'admin' || role === 'seller') showPage('admin');
    else showPage('store');
  }
}

async function doRegister() {
  const first = document.getElementById('reg-first')?.value?.trim() || '';
  const last  = document.getElementById('reg-last')?.value?.trim() || '';
  const email = document.getElementById('reg-email')?.value?.trim() || '';
  const pass  = document.getElementById('reg-pass')?.value || '';
  const shop  = document.getElementById('reg-shop')?.value?.trim() || '';
  const name  = (first + ' ' + last).trim() || 'Pengguna Baru';

  if (!email || !pass) { toast('Email dan kata sandi wajib diisi', 'error'); return; }
  if (pass.length < 4) { toast('Kata sandi minimal 4 karakter', 'error'); return; }

  try {
    if (apiOnline) {
      const data = await apiRequest('POST', '/auth/register', {
        name, email, password: pass, role: selectedRole, shopName: shop,
      });
      currentUser = {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role || selectedRole,
        shopName: data.shopName || shop,
        token: data.token || null,
      };
    } else {
      currentUser = { id: 'local-' + Date.now(), name, email, role: selectedRole, shopName: shop, token: null };
    }
    saveUser();
    updateUserUI();
    toast('Akun berhasil dibuat! Selamat datang di YourShop.Id 🎉', 'success');
    if (selectedRole === 'seller') showPage('admin');
    else showPage('store');
  } catch (err) {
    toast(err.message || 'Registrasi gagal', 'error');
  }
}

async function doLogout() {
  try {
    if (apiOnline && currentUser?.token) {
      await apiRequest('POST', '/auth/logout');
    }
  } catch (_) { /* ignore */ }
  currentUser = null;
  localStorage.removeItem('ysi-user');
  updateUserUI();
  toast('Berhasil keluar');
  showPage('store');
}

function switchTab(id, btn) {
  document.querySelectorAll('#login-tab, #register-tab, #forgot-tab').forEach(el => {
    if (el) el.style.display = 'none';
  });
  const tab = document.getElementById(id);
  if (tab) tab.style.display = '';
  if (btn) {
    document.querySelectorAll('.login-card .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
}

async function doForgotPassword() {
  const email = document.getElementById('forgot-email')?.value?.trim();
  if (!email) { toast('Masukkan email', 'error'); return; }
  try {
    if (!apiOnline) { toast('Server offline — reset hanya tersedia online', 'error'); return; }
    const data = await apiRequest('POST', '/auth/forgot', { email });
    toast(data.message || 'Permintaan terkirim', 'success');
    if (data.resetToken) {
      document.getElementById('forgot-result').style.display = '';
      document.getElementById('reset-token').value = data.resetToken;
    }
  } catch (err) {
    toast(err.message || 'Gagal', 'error');
  }
}

async function doResetPassword() {
  const email = document.getElementById('forgot-email')?.value?.trim();
  const token = document.getElementById('reset-token')?.value?.trim();
  const neu = document.getElementById('reset-pass')?.value || '';
  if (!email || !token || neu.length < 4) { toast('Lengkapi email, token, dan sandi baru', 'error'); return; }
  try {
    await apiRequest('POST', '/auth/reset', { email, token, newPassword: neu });
    toast('Kata sandi direset. Silakan masuk.', 'success');
    switchTab('login-tab', document.querySelector('.login-card .tab'));
    document.getElementById('login-email').value = email;
  } catch (err) {
    toast(err.message || 'Gagal reset', 'error');
  }
}

async function doChangePassword() {
  if (!currentUser) { toast('Masuk terlebih dahulu', 'error'); return; }
  const cur = document.getElementById('cp-current')?.value || '';
  const neu = document.getElementById('cp-new')?.value || '';
  const conf = document.getElementById('cp-confirm')?.value || '';
  if (neu.length < 4) { toast('Kata sandi baru minimal 4 karakter', 'error'); return; }
  if (neu !== conf) { toast('Konfirmasi kata sandi tidak cocok', 'error'); return; }
  try {
    if (apiOnline) {
      await apiRequest('POST', '/auth/change-password', { currentPassword: cur, newPassword: neu });
      toast('Kata sandi diubah. Masuk kembali.', 'success');
      await doLogout();
    } else {
      toast('Ubah password memerlukan server online', 'error');
    }
  } catch (err) {
    toast(err.message || 'Gagal mengubah kata sandi', 'error');
  }
}

function selectRole(role) {
  selectedRole = role;
  document.getElementById('role-buyer').classList.toggle('active',  role === 'buyer');
  document.getElementById('role-seller').classList.toggle('active', role === 'seller');
  document.getElementById('seller-fields').style.display = role === 'seller' ? 'block' : 'none';
}

// ============================================================
//  PRODUCT LISTING
// ============================================================

function getFilteredProducts() {
  let list = [...adminProducts];

  // Sembunyikan produk dari penjual yang ditangguhkan
  list = list.filter(p => !isSellerSuspended(p.seller));

  // Search
  if (currentSearch) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(currentSearch) ||
      p.category.toLowerCase().includes(currentSearch) ||
      p.seller.toLowerCase().includes(currentSearch) ||
      p.tags.some(t => t.includes(currentSearch))
    );
  }

  // Category
  if (currentCategory !== 'All') list = list.filter(p => p.category === currentCategory);

  // Price range — input dalam mata uang tampilan, bandingkan ke USD base
  const minRaw = document.getElementById('price-min')?.value;
  const maxRaw = document.getElementById('price-max')?.value;
  const minP = minRaw !== '' && minRaw != null ? displayToUsd(minRaw) : 0;
  const maxP = maxRaw !== '' && maxRaw != null ? displayToUsd(maxRaw) : Infinity;
  list = list.filter(p => p.price >= minP && p.price <= maxP);

  // Rating
  const ratingMin = parseFloat(document.querySelector('input[name="rating"]:checked')?.value || 0);
  if (ratingMin > 0) list = list.filter(p => p.rating >= ratingMin);

  // Checkboxes
  if (document.getElementById('in-stock')?.checked) list = list.filter(p => p.stock);
  if (document.getElementById('on-sale')?.checked)  list = list.filter(p => p.oldPrice);

  // Sort
  const sort = document.getElementById('sort-select')?.value;
  if (sort === 'price-asc')  list.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  if (sort === 'rating')     list.sort((a, b) => b.rating - a.rating);

  return list;
}

function renderProducts() {
  const list  = getFilteredProducts();
  const grid  = document.getElementById('product-grid');
  const title = document.getElementById('products-title');
  if (!grid) return;

  title.textContent = currentCategory === 'All'
    ? `Semua Produk (${list.length})`
    : `${currentCategory} (${list.length})`;

  if (!list.length) {
    grid.innerHTML = `<div class="no-results">😕 Produk tidak ditemukan. Coba ubah filter.</div>`;
    return;
  }

  grid.innerHTML = list.map(p => productCardHTML(p)).join('');
}

function filterCategory(cat, btn) {
  currentCategory = cat;
  document.querySelectorAll('.cat-bar-item, .cat-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    document.querySelectorAll('.cat-bar-item').forEach(b => {
      const label = b.textContent.trim();
      if ((cat === 'All' && label === 'Semua') || label.startsWith(cat.split(' ')[0])) {
        b.classList.add('active');
      }
    });
  }
  const sel = document.getElementById('search-cat');
  if (sel) sel.value = cat;
  renderProducts();
}

function applyFilters()      { renderProducts(); }
function handleSearch(val)   { currentSearch = val.toLowerCase(); renderProducts(); }

/* eBay-style hero promo slides — full auto carousel */
const HERO_SLIDES = [
  {
    title: 'Hemat hingga 20% hari ini',
    text: 'Temukan penawaran terbaik dari penjual terverifikasi. Mulai belanja atau jual barangmu sekarang.',
    cta: 'Ambil Kupon',
    ctaSecondary: 'Lihat Produk',
    ctaAction: "showPage('deals')",
    ctaSecondaryAction: "document.querySelector('.shop-layout')?.scrollIntoView({behavior:'smooth'})",
    bg: '#7FDBDA',
    cards: [
      { icon: '🏷️', label: 'Hemat' },
      { icon: '🎟️', label: 'Kupon' },
      { icon: '', label: '20%<br>OFF', accent: true }
    ]
  },
  {
    title: 'Cari. Belanja. Jual.',
    text: 'Ribuan produk dari penjual independen di seluruh Indonesia — siap dikirim ke rumahmu.',
    cta: 'Lihat Produk',
    ctaSecondary: 'Mulai Jual',
    ctaAction: "document.querySelector('.shop-layout')?.scrollIntoView({behavior:'smooth'})",
    ctaSecondaryAction: "showPage('become-seller')",
    bg: '#A8D5E5',
    cards: [
      { icon: '🔍', label: 'Cari' },
      { icon: '🛒', label: 'Belanja' },
      { icon: '', label: 'Jual', accent: true }
    ]
  },
  {
    title: 'Mulai berjualan hari ini',
    text: 'Gratis daftar sebagai penjual. Jangkau pembeli baru tanpa biaya bulanan di masa demo.',
    cta: 'Jadi Penjual',
    ctaSecondary: 'Pelajari',
    ctaAction: "showPage('become-seller')",
    ctaSecondaryAction: "showPage('help')",
    bg: '#B8E0D2',
    cards: [
      { icon: '📦', label: 'Stok' },
      { icon: '📈', label: 'Naik' },
      { icon: '', label: 'Gratis', accent: true }
    ]
  },
  {
    title: 'Deals & outlet merek',
    text: 'Diskon pilihan diperbarui setiap hari. Cek halaman Deals sebelum stok habis.',
    cta: 'Buka Deals',
    ctaSecondary: 'Watchlist',
    ctaAction: "showPage('deals')",
    ctaSecondaryAction: "showPage('watchlist')",
    bg: '#9ED9F0',
    cards: [
      { icon: '⚡', label: 'Flash' },
      { icon: '⭐', label: 'Outlet' },
      { icon: '', label: 'HOT', accent: true }
    ]
  }
];
let heroIndex = 0;
let heroTimer = null;
const HERO_INTERVAL_MS = 5000;

function renderHeroSlide(index) {
  const n = HERO_SLIDES.length;
  if (!n) return;
  heroIndex = ((index % n) + n) % n;
  const s = HERO_SLIDES[heroIndex];
  const banner = document.getElementById('hero-banner');
  if (!banner) return;

  banner.classList.add('hero-fade');
  banner.style.background = s.bg;

  const h1 = banner.querySelector('h1');
  const p = banner.querySelector('.hero-left p');
  const primaryBtn = banner.querySelector('.hero-cta .btn-primary');
  const secondaryBtn = banner.querySelector('.hero-cta .btn-outline');
  if (h1) h1.textContent = s.title;
  if (p) p.textContent = s.text;
  if (primaryBtn) {
    primaryBtn.textContent = s.cta;
    primaryBtn.setAttribute('onclick', s.ctaAction);
  }
  if (secondaryBtn && s.ctaSecondary) {
    secondaryBtn.textContent = s.ctaSecondary;
    secondaryBtn.setAttribute('onclick', s.ctaSecondaryAction || '');
  }

  const right = banner.querySelector('.hero-right');
  if (right && s.cards) {
    right.innerHTML = s.cards.map((c, i) => {
      const accent = c.accent ? ' hero-card-accent' : '';
      const icon = c.icon ? `<span class="hero-card-icon">${c.icon}</span>` : '';
      return `<div class="hero-card${accent}">${icon}<span class="hero-card-label">${c.label}</span></div>`;
    }).join('');
  }

  banner.querySelectorAll('.hero-dots span').forEach((dot, i) => {
    dot.classList.toggle('active', i === heroIndex);
  });

  requestAnimationFrame(() => {
    banner.classList.remove('hero-fade');
    banner.classList.add('hero-show');
    setTimeout(() => banner.classList.remove('hero-show'), 400);
  });
}

function cycleHero(dir) {
  renderHeroSlide(heroIndex + (dir || 1));
  restartHeroAutoplay();
}

function goHero(index) {
  renderHeroSlide(index);
  restartHeroAutoplay();
}

function startHeroAutoplay() {
  stopHeroAutoplay();
  heroTimer = setInterval(() => {
    // only advance when store page is visible
    const store = document.getElementById('page-store');
    if (store && store.classList.contains('active')) {
      renderHeroSlide(heroIndex + 1);
    }
  }, HERO_INTERVAL_MS);
}

function stopHeroAutoplay() {
  if (heroTimer) {
    clearInterval(heroTimer);
    heroTimer = null;
  }
}

function restartHeroAutoplay() {
  startHeroAutoplay();
}

function initHeroCarousel() {
  const banner = document.getElementById('hero-banner');
  if (!banner) return;

  // clickable dots
  banner.querySelectorAll('.hero-dots span').forEach((dot, i) => {
    dot.style.cursor = 'pointer';
    dot.setAttribute('role', 'button');
    dot.setAttribute('aria-label', 'Slide ' + (i + 1));
    dot.onclick = () => goHero(i);
  });

  // pause on hover / focus
  banner.addEventListener('mouseenter', stopHeroAutoplay);
  banner.addEventListener('mouseleave', startHeroAutoplay);
  banner.addEventListener('focusin', stopHeroAutoplay);
  banner.addEventListener('focusout', startHeroAutoplay);

  renderHeroSlide(0);
  startHeroAutoplay();
}

// ============================================================
//  PRODUCT DETAIL
// ============================================================

function showDetail(id) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  recomputeRating(id);
  showPage('detail');
  selectedVariant = null;
  if (p.variants?.length === 1) selectedVariant = { productId: p.id, variantId: p.variants[0].id };

  const el = document.getElementById('detail-content');
  const reviews = getReviews(p.id);
  const qa = getQA(p.id);
  const priceNow = () => {
    const v = p.variants?.find(x => x.id === selectedVariant?.variantId);
    return p.price + (v?.priceDelta || 0);
  };

  el.innerHTML = `
    <div class="detail-layout-full">
      <div class="detail-top" style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-bottom:2rem">
        <div class="detail-img" style="min-height:320px;display:flex;align-items:center;justify-content:center;background:var(--bg);border-radius:var(--rl);overflow:hidden;font-size:5rem">
          ${productImageHTML(p)}
        </div>
        <div class="detail-info">
          <div class="detail-seller">Dijual oleh ${p.seller}</div>
          <h1 class="detail-title">${p.name}</h1>
          <div class="detail-stars">${starsRaw(p.rating, reviews.length || p.reviews)}</div>
          <div class="detail-price" id="detail-price">
            ${formatMoney(priceNow())}
            ${p.oldPrice ? `<span style="font-size:1rem;color:var(--text3);text-decoration:line-through;font-weight:400">${formatMoney(p.oldPrice)}</span>` : ''}
          </div>
          <p class="detail-desc">${p.desc}</p>
          ${p.variants?.length ? `
          <div class="variant-block" style="margin:1rem 0">
            <div style="font-size:13px;font-weight:600;margin-bottom:0.5rem">Pilih varian</div>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem" id="variant-opts">
              ${p.variants.map(v => `
                <button type="button" class="variant-btn ${selectedVariant?.variantId===v.id?'selected':''}"
                  style="padding:0.45rem 0.85rem;border:1.5px solid ${selectedVariant?.variantId===v.id?'var(--accent)':'var(--border)'};border-radius:var(--r);background:${selectedVariant?.variantId===v.id?'var(--accent-light)':'var(--surface)'};cursor:pointer;font-size:13px"
                  onclick="selectVariant(${p.id}, ${v.id})" ${v.stock<=0?'disabled':''}>
                  ${v.label}${v.priceDelta?` (+${formatMoney(v.priceDelta)})`:''}${v.stock<=0?' · Habis':''}
                </button>`).join('')}
            </div>
          </div>` : ''}
          <div class="detail-actions">
            <div class="qty-ctrl">
              <button onclick="detailQtyChange(-1)">−</button>
              <span id="qty-disp">1</span>
              <button onclick="detailQtyChange(1)">+</button>
            </div>
            <button class="btn-cart" onclick="addToCartFromDetail(${p.id})">Tambah ke Keranjang</button>
            <button class="wl-heart ${isInWatchlist(p.id)?'active':''}" style="position:static;width:40px;height:40px" onclick="toggleWatchlist(${p.id}, event)">${isInWatchlist(p.id)?'❤️':'🤍'}</button>
          </div>
          <div class="detail-tags">${(p.tags||[]).map(t => `<span class="tag">#${t}</span>`).join('')}</div>
        </div>
      </div>

      <!-- Reviews -->
      <div class="content-card" style="margin-bottom:1.25rem">
        <h3 style="font-family:var(--font-head);margin-bottom:1rem">Ulasan Pembeli (${reviews.length})</h3>
        ${reviews.length ? reviews.map(r => `
          <div style="padding:0.75rem 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;gap:1rem">
              <strong style="font-size:13.5px">${r.userName}</strong>
              <span style="color:var(--warn);font-size:13px">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span>
            </div>
            <p style="font-size:13px;color:var(--text2);margin:0.35rem 0 0">${r.comment}</p>
            <div style="font-size:11px;color:var(--text3);margin-top:0.25rem">${r.date}</div>
          </div>`).join('') : '<p style="color:var(--text3);font-size:13px">Belum ada ulasan. Jadilah yang pertama!</p>'}
        ${currentUser ? `
        <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">
          <div style="font-weight:600;font-size:13px;margin-bottom:0.5rem">Tulis ulasan</div>
          <div style="display:flex;gap:0.35rem;margin-bottom:0.5rem" id="review-stars">
            ${[1,2,3,4,5].map(n => `<button type="button" onclick="setReviewRating(${n})" data-r="${n}" style="font-size:1.25rem;background:none;border:none;cursor:pointer;opacity:0.35">★</button>`).join('')}
          </div>
          <textarea id="review-text" rows="2" placeholder="Bagaimana pengalamanmu?" style="width:100%;margin-bottom:0.5rem"></textarea>
          <button class="btn btn-primary btn-sm" onclick="submitReview(${p.id})">Kirim Ulasan</button>
        </div>` : `<p style="font-size:13px;margin-top:1rem"><a href="#" onclick="showPage('login');return false" style="color:var(--accent)">Masuk</a> untuk menulis ulasan</p>`}
      </div>

      <!-- Q&A -->
      <div class="content-card">
        <h3 style="font-family:var(--font-head);margin-bottom:1rem">Tanya Jawab (${qa.length})</h3>
        ${qa.length ? qa.map(q => `
          <div style="padding:0.85rem 0;border-bottom:1px solid var(--border)">
            <div style="font-size:13.5px"><strong>Q:</strong> ${q.question}</div>
            <div style="font-size:11px;color:var(--text3);margin:0.2rem 0 0.5rem">${q.userName} · ${q.date}</div>
            ${q.answer ? `<div style="font-size:13.5px;background:var(--bg);padding:0.65rem 0.85rem;border-radius:var(--r)"><strong>A (${q.answerBy}):</strong> ${q.answer}
              <div style="font-size:11px;color:var(--text3);margin-top:0.25rem">${q.answerDate}</div></div>` :
              ((currentUser?.role === 'seller' || currentUser?.role === 'admin') ?
                `<div style="margin-top:0.5rem"><input type="text" id="ans-${q.id}" placeholder="Tulis jawaban..." style="width:70%;margin-right:0.35rem">
                <button class="tbl-btn" onclick="answerQuestion(${p.id}, ${q.id})">Jawab</button></div>` :
                `<div style="font-size:12px;color:var(--text3)">Belum dijawab</div>`)}
          </div>`).join('') : '<p style="color:var(--text3);font-size:13px">Belum ada pertanyaan.</p>'}
        ${currentUser ? `
        <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">
          <div style="font-weight:600;font-size:13px;margin-bottom:0.5rem">Ajukan pertanyaan</div>
          <textarea id="qa-text" rows="2" placeholder="Tanyakan ke penjual..." style="width:100%;margin-bottom:0.5rem"></textarea>
          <button class="btn btn-primary btn-sm" onclick="submitQuestion(${p.id})">Kirim Pertanyaan</button>
        </div>` : `<p style="font-size:13px;margin-top:1rem"><a href="#" onclick="showPage('login');return false" style="color:var(--accent)">Masuk</a> untuk bertanya</p>`}
      </div>
    </div>
  `;
}

let pendingReviewRating = 5;

function setReviewRating(n) {
  pendingReviewRating = n;
  document.querySelectorAll('#review-stars button').forEach(b => {
    b.style.opacity = Number(b.dataset.r) <= n ? '1' : '0.35';
    b.style.color = Number(b.dataset.r) <= n ? 'var(--warn)' : '';
  });
}

function selectVariant(productId, variantId) {
  selectedVariant = { productId, variantId };
  const p = adminProducts.find(x => x.id === productId);
  if (!p) return;
  const v = p.variants.find(x => x.id === variantId);
  const priceEl = document.getElementById('detail-price');
  if (priceEl) {
    const price = p.price + (v?.priceDelta || 0);
    priceEl.innerHTML = `${formatMoney(price)}${p.oldPrice ? `<span style="font-size:1rem;color:var(--text3);text-decoration:line-through;font-weight:400;margin-left:0.5rem">${formatMoney(p.oldPrice)}</span>` : ''}`;
  }
  document.querySelectorAll('#variant-opts .variant-btn').forEach(btn => {
    const sel = btn.textContent.includes(v?.label?.split(' ')[0]) || btn.getAttribute('onclick')?.includes(String(variantId));
  });
  // re-render variant buttons state simply
  document.querySelectorAll('#variant-opts .variant-btn').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    const isSel = onclick.includes(`, ${variantId})`) || onclick.includes(`,${variantId})`);
    btn.style.borderColor = isSel ? 'var(--accent)' : 'var(--border)';
    btn.style.background = isSel ? 'var(--accent-light)' : 'var(--surface)';
  });
}

function addToCartFromDetail(id) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  if (p.variants?.length && !selectedVariant) {
    toast('Pilih varian terlebih dahulu', 'error'); return;
  }
  const qty = parseInt(document.getElementById('qty-disp')?.textContent || '1', 10);
  const v = p.variants?.find(x => x.id === selectedVariant?.variantId);
  addToCart(id, qty, v || null);
  showPage('cart');
}

function submitReview(productId) {
  if (!currentUser) { toast('Masuk dulu', 'error'); return; }
  const text = document.getElementById('review-text')?.value?.trim();
  if (!text) { toast('Isi ulasan', 'error'); return; }
  const key = String(productId);
  if (!productReviews[key]) productReviews[key] = [];
  productReviews[key].unshift({
    id: Date.now(),
    userName: currentUser.name,
    userId: currentUser.id,
    rating: pendingReviewRating || 5,
    comment: text,
    date: new Date().toISOString().slice(0, 10),
  });
  saveReviews();
  recomputeRating(productId);
  persistLocalCatalog();
  toast('Ulasan terkirim ⭐', 'success');
  showDetail(productId);
}

function submitQuestion(productId) {
  if (!currentUser) { toast('Masuk dulu', 'error'); return; }
  const text = document.getElementById('qa-text')?.value?.trim();
  if (!text) { toast('Isi pertanyaan', 'error'); return; }
  const key = String(productId);
  if (!productQA[key]) productQA[key] = [];
  productQA[key].unshift({
    id: Date.now(),
    userName: currentUser.name,
    question: text,
    date: new Date().toISOString().slice(0, 10),
    answer: '', answerBy: '', answerDate: '',
  });
  saveQA();
  toast('Pertanyaan terkirim', 'success');
  showDetail(productId);
}

function answerQuestion(productId, qid) {
  if (!currentUser) return;
  const ans = document.getElementById('ans-' + qid)?.value?.trim();
  if (!ans) { toast('Isi jawaban', 'error'); return; }
  const key = String(productId);
  const q = (productQA[key] || []).find(x => x.id === qid);
  if (!q) return;
  q.answer = ans;
  q.answerBy = currentUser.shopName || currentUser.name;
  q.answerDate = new Date().toISOString().slice(0, 10);
  saveQA();
  toast('Jawaban dipublikasikan', 'success');
  showDetail(productId);
}

function detailQtyChange(delta) {
  const el  = document.getElementById('qty-disp');
  const val = Math.max(1, parseInt(el.textContent) + delta);
  el.textContent = val;
}

// ============================================================
//  CART
// ============================================================

function addToCart(id, qty = 1, variant = null) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  if (!p.stock) { toast('Produk sedang habis', 'error'); return; }
  if (isSellerSuspended(p.seller)) { toast('Toko penjual sedang ditangguhkan', 'error'); return; }
  if (variant && variant.stock <= 0) { toast('Varian habis', 'error'); return; }
  const vid = variant?.id || null;
  const existing = cart.find(c => c.id === id && (c.variantId || null) === vid);
  const newQty = (existing ? existing.qty : 0) + qty;
  const maxStock = variant ? variant.stock : p.stockQty;
  if (typeof maxStock === 'number' && newQty > maxStock) {
    toast(`Stok tersisa ${maxStock}`, 'error'); return;
  }
  if (existing) existing.qty = newQty;
  else cart.push({
    id, qty,
    variantId: vid,
    variantLabel: variant?.label || '',
    priceDelta: variant?.priceDelta || 0,
  });
  saveCart();
  updateCartCount();
  toast(`${p.emoji} ${p.name}${variant ? ' (' + variant.label + ')' : ''} ditambahkan`, 'success');
}

function removeFromCart(id, variantId = null) {
  cart = cart.filter(c => !(c.id === id && (c.variantId || null) === (variantId || null)));
  saveCart();
  renderCart();
}

function updateQty(id, delta, variantId = null) {
  const item = cart.find(c => c.id === id && (c.variantId || null) === (variantId || null));
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  saveCart();
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cart-content');
  if (!el) return;

  if (!cart.length) {
    appliedPromo = null;
    el.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <p>Keranjangmu masih kosong</p>
        <button class="btn btn-primary" onclick="showPage('store')">Mulai Belanja</button>
      </div>`;
    return;
  }

  const { subtotal, discount, shipping, tax, total } = calcCartTotals();
  const threshold = freeShipThreshold();
  const promoVal = appliedPromo?.code || '';

  el.innerHTML = `
    <div class="cart-layout">
      <div class="cart-items">
        ${cart.map(c => {
          const p = adminProducts.find(x => x.id === c.id);
          if (!p) return '';
          const vid = c.variantId || 'null';
          return `
            <div class="cart-item">
              <div class="cart-item-img" style="overflow:hidden">${p.imageUrl ? `<img src="${p.imageUrl}" alt="" style="width:100%;height:100%;object-fit:cover">` : p.emoji}</div>
              <div class="cart-item-info">
                <div class="cart-item-name">${p.name}</div>
                <div class="cart-item-seller">Oleh ${p.seller}${c.variantLabel ? ' · ' + c.variantLabel : ''}</div>
                <div class="cart-item-ctrl">
                  <div class="qty-ctrl">
                    <button onclick="updateQty(${p.id}, -1, ${vid})">−</button>
                    <span>${c.qty}</span>
                    <button onclick="updateQty(${p.id}, 1, ${vid})">+</button>
                  </div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.5rem">
                <span class="cart-item-price">${formatMoney(unitPrice(c) * c.qty)}</span>
                <button class="remove-btn" onclick="removeFromCart(${p.id}, ${vid})">✕</button>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="cart-summary">
        <h3>Ringkasan Pesanan</h3>
        <div class="summary-row"><span>Subtotal (${cart.reduce((s, c) => s + c.qty, 0)} item)</span><span>${formatMoney(subtotal)}</span></div>
        ${discount > 0 ? `<div class="summary-row" style="color:var(--success)"><span>Diskon (${appliedPromo.label})</span><span>−${formatMoney(discount)}</span></div>` : ''}
        <div class="summary-row"><span>Ongkir</span><span>${shipping === 0 ? '<span style="color:var(--success)">Gratis</span>' : formatMoney(shipping)}</span></div>
        <div class="summary-row"><span>Pajak (${Math.round(getCurrency().taxRate * 100)}%)</span><span>${formatMoney(tax)}</span></div>
        <div class="summary-row total"><span>Total</span><span>${formatMoney(total)}</span></div>
        <button class="checkout-btn" onclick="goToCheckout()">Lanjut ke Pembayaran</button>
        <div class="promo-row">
          <input type="text" placeholder="Kode promo (FORGE10, HEMAT20…)" id="promo-input" value="${promoVal}">
          <button onclick="applyPromo()">${appliedPromo ? 'Hapus' : 'Pakai'}</button>
        </div>
        ${appliedPromo ? `<p style="font-size:12px;color:var(--success);margin-top:0.5rem;text-align:center">✓ Promo ${appliedPromo.code} aktif</p>` : ''}
        ${subtotal < threshold && !appliedPromo?.freeShipping
          ? `<p style="font-size:12px;color:var(--text3);margin-top:0.75rem;text-align:center">Tambah ${formatMoney(threshold - subtotal)} lagi untuk gratis ongkir</p>`
          : `<p style="font-size:12px;color:var(--success);margin-top:0.75rem;text-align:center">✓ Kamu dapat gratis ongkir!</p>`}
      </div>
    </div>`;
}

function goToCheckout() {
  if (!currentUser) { toast('Silakan masuk terlebih dahulu', 'error'); showPage('login'); return; }
  if (!cart.length) { toast('Keranjang kosong', 'error'); return; }
  showPage('checkout');
}

async function placeOrder() {
  if (!currentUser) { toast('Silakan masuk terlebih dahulu', 'error'); showPage('login'); return; }
  if (!cart.length) { toast('Keranjang kosong', 'error'); return; }

  const name = document.getElementById('co-name')?.value?.trim();
  const phone = document.getElementById('co-phone')?.value?.trim();
  const address = document.getElementById('co-address')?.value?.trim();
  const city = document.getElementById('co-city')?.value?.trim();
  if (!name || !phone || !address || !city) {
    toast('Lengkapi alamat pengiriman', 'error'); return;
  }

  const items = cart.map(c => ({ productId: c.id, qty: c.qty }));
  const { total, shipping } = calcCartTotals();
  const shipOpt = SHIPPING_OPTIONS.find(s => s.id === checkoutShipMethod);

  // simpan alamat ke profil
  currentUser.phone = phone;
  currentUser.address = address + (city ? ', ' + city : '');
  saveUser();

  try {
    let normalized;
    if (apiOnline) {
      const order = await apiRequest('POST', '/orders', {
        customerId: currentUser.id || 'guest',
        customerName: name || currentUser.name || 'Customer',
        items,
        paymentMethod: checkoutPayMethod,
        shippingMethod: checkoutShipMethod,
        shippingCost: shipping,
        shipAddress: address,
        shipCity: city,
        shipPhone: phone,
      });
      normalized = normalizeOrder(order);
    } else {
      const orderItems = cart.map(c => {
        const p = adminProducts.find(x => x.id === c.id);
        return { emoji: p?.emoji || '📦', name: p?.name || 'Item', productId: c.id, qty: c.qty };
      });
      normalized = {
        id: '#ORD-' + (9000 + ordersList.length + Math.floor(Math.random() * 90)),
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        status: 'diproses',
        items: orderItems,
        total,
        customerId: currentUser.id || 'guest',
        customerName: name || currentUser.name,
        steps: buildOrderSteps('diproses'),
        paymentStatus: 'pending',
        paymentMethod: checkoutPayMethod,
        invoiceNumber: 'INV-2026-' + (1000 + ordersList.length),
        shippingMethod: checkoutShipMethod,
        shippingCost: shipping,
        shipAddress: address,
        shipCity: city,
        shipPhone: phone,
        returnStatus: 'none',
      };
    }
    ordersList.unshift(normalized);
    decrementStock(items);
    appliedPromo = null;
    cart = [];
    saveCart();
    persistLocalCatalog();
    pendingPaymentOrderId = normalized.id;
    pushNotif('💳', 'Menunggu pembayaran', `Pesanan ${normalized.id} — ${shipOpt?.name || 'kurir'}`);
    toast('Pesanan dibuat. Lanjutkan pembayaran.', 'success');
    showPage('payment');
    renderPaymentPage(normalized.id);
  } catch (err) {
    toast(err.message || 'Gagal membuat pesanan', 'error');
  }
}

function selectShipMethod(id, el) {
  checkoutShipMethod = id;
  document.querySelectorAll('.ship-method').forEach(m => m.classList.remove('selected'));
  if (el) el.classList.add('selected');
  // refresh totals if on checkout
  if (document.querySelector('.page.active')?.id === 'page-checkout') renderCheckout();
}

/** Load Midtrans Snap.js once (sandbox or production URL from config). */
let _snapScriptPromise = null;
function loadSnapScript(snapJsUrl, clientKey) {
  if (window.snap && typeof window.snap.pay === 'function') return Promise.resolve();
  if (_snapScriptPromise) return _snapScriptPromise;
  _snapScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = snapJsUrl || 'https://app.sandbox.midtrans.com/snap/snap.js';
    s.setAttribute('data-client-key', clientKey || '');
    s.onload = () => resolve();
    s.onerror = () => { _snapScriptPromise = null; reject(new Error('Gagal memuat Midtrans Snap.js')); };
    document.head.appendChild(s);
  });
  return _snapScriptPromise;
}

async function openMidtransSnap(gateway) {
  const token = gateway?.snapToken;
  if (!token) throw new Error('Snap token kosong');
  await loadSnapScript(gateway.snapJsUrl, gateway.clientKey);
  return new Promise((resolve) => {
    window.snap.pay(token, {
      onSuccess: (result) => resolve({ status: 'success', result }),
      onPending: (result) => resolve({ status: 'pending', result }),
      onError: (result) => resolve({ status: 'error', result }),
      onClose: () => resolve({ status: 'closed' }),
    });
  });
}

async function payOrder(orderId, simulateFail = false, forceMock = false) {
  const o = ordersList.find(x => x.id === orderId);
  if (!o) { toast('Pesanan tidak ditemukan', 'error'); return; }
  try {
    if (apiOnline) {
      const updated = await apiRequest('POST', '/orders/' + encodeURIComponent(orderId) + '/pay', {
        paymentMethod: checkoutPayMethod || o.paymentMethod,
        simulateFail,
        forceMock,
      });
      const i = ordersList.findIndex(x => x.id === orderId);
      if (i >= 0) ordersList[i] = normalizeOrder(updated);

      const gw = updated.gateway || {};
      if (gw.provider === 'midtrans' && gw.snapToken && !simulateFail) {
        toast('Membuka Midtrans Snap…', 'success');
        // attach snapJsUrl from payment config if missing
        if (!gw.snapJsUrl) {
          try {
            const cfg = await apiRequest('GET', '/payments/config');
            gw.snapJsUrl = cfg.snapJsUrl;
            if (!gw.clientKey) gw.clientKey = cfg.clientKey;
          } catch (_) {}
        }
        const snapResult = await openMidtransSnap(gw);
        if (snapResult.status === 'success') {
          // Webhook will mark paid; optimistically refresh
          await refreshOrders();
          const paid = ordersList.find(x => x.id === orderId);
          if (paid) paid.paymentStatus = paid.paymentStatus === 'paid' ? 'paid' : 'paid';
          pendingPaymentOrderId = null;
          toast('Pembayaran berhasil!', 'success');
          pushNotif('💳', 'Pembayaran berhasil', `Pesanan ${orderId} telah dibayar.`);
          showPage('orders');
          renderOrders();
          return;
        }
        if (snapResult.status === 'pending') {
          toast('Menunggu pembayaran. Selesaikan di aplikasi bank/e-wallet.', 'success');
          await refreshOrders();
          showPage('orders');
          renderOrders();
          return;
        }
        if (snapResult.status === 'error') {
          toast('Pembayaran gagal di Midtrans', 'error');
          return;
        }
        // closed without paying
        toast('Pembayaran dibatalkan. Anda bisa bayar nanti dari Pesanan Saya.', '');
        showPage('orders');
        return;
      }

      // Mock / already paid path
      if (updated.paymentStatus === 'paid' || gw.provider?.includes?.('mock')) {
        pendingPaymentOrderId = null;
        toast('Pembayaran berhasil' + (gw.provider?.includes?.('mock') ? ' (mock)' : ''), 'success');
        pushNotif('💳', 'Pembayaran berhasil', `Pesanan ${orderId} telah dibayar.`);
        showPage('orders');
        renderOrders();
        return;
      }
    } else {
      if (simulateFail) { toast('Pembayaran gagal (simulasi)', 'error'); return; }
      o.paymentStatus = 'paid';
      o.paidAt = new Date().toISOString();
      persistLocalCatalog();
    }
    pushNotif('✅', 'Pembayaran berhasil', `${orderId} telah dibayar. Pesanan diproses.`);
    toast('Pembayaran berhasil! 🎉', 'success');
    pendingPaymentOrderId = null;
    showPage('orders');
  } catch (err) {
    toast(err.message || 'Pembayaran gagal', 'error');
  }
}

async function cancelOrder(orderId) {
  const reason = prompt('Alasan pembatalan?', 'Berubah pikiran');
  if (reason === null) return;
  try {
    if (apiOnline) {
      const updated = await apiRequest('POST', '/orders/' + encodeURIComponent(orderId) + '/cancel', { reason });
      const i = ordersList.findIndex(x => x.id === orderId);
      if (i >= 0) ordersList[i] = normalizeOrder(updated);
    } else {
      const o = ordersList.find(x => x.id === orderId);
      if (!o) return;
      if (o.status === 'dikirim' || o.status === 'terkirim') {
        toast('Sudah dikirim — ajukan return', 'error'); return;
      }
      o.status = 'dibatalkan';
      o.cancelReason = reason || 'Dibatalkan';
      if (o.paymentStatus === 'paid') o.paymentStatus = 'refunded';
      o.steps = [{ title: 'Dibatalkan', date: 'Hari ini', detail: o.cancelReason, done: true, active: true }];
      // restore stock
      (o.items || []).forEach(it => {
        const p = adminProducts.find(x => x.id === it.productId);
        if (p) { p.stockQty = (p.stockQty || 0) + (it.qty || 1); p.stock = true; }
      });
      persistLocalCatalog();
    }
    toast('Pesanan dibatalkan', 'success');
    pushNotif('↩️', 'Pesanan dibatalkan', orderId);
    renderOrders();
  } catch (err) {
    toast(err.message || 'Gagal membatalkan', 'error');
  }
}

async function requestReturn(orderId) {
  const reason = prompt('Alasan return/refund?', 'Barang tidak sesuai');
  if (reason === null) return;
  try {
    if (apiOnline) {
      const updated = await apiRequest('POST', '/orders/' + encodeURIComponent(orderId) + '/return', {
        action: 'request', reason,
      });
      const i = ordersList.findIndex(x => x.id === orderId);
      if (i >= 0) ordersList[i] = normalizeOrder(updated);
    } else {
      const o = ordersList.find(x => x.id === orderId);
      if (!o || o.status !== 'terkirim') { toast('Hanya pesanan terkirim', 'error'); return; }
      o.returnStatus = 'requested';
      o.returnReason = reason;
      persistLocalCatalog();
    }
    toast('Permintaan return dikirim', 'success');
    renderOrders();
  } catch (err) {
    toast(err.message || 'Gagal ajukan return', 'error');
  }
}

async function resolveReturn(orderId, action) {
  try {
    if (apiOnline) {
      const updated = await apiRequest('POST', '/orders/' + encodeURIComponent(orderId) + '/return', { action });
      const i = ordersList.findIndex(x => x.id === orderId);
      if (i >= 0) ordersList[i] = normalizeOrder(updated);
    } else {
      const o = ordersList.find(x => x.id === orderId);
      if (!o) return;
      if (action === 'approve') {
        o.returnStatus = 'refunded';
        o.paymentStatus = 'refunded';
      } else o.returnStatus = 'rejected';
      persistLocalCatalog();
    }
    toast(action === 'approve' ? 'Return disetujui & refund' : 'Return ditolak', 'success');
    renderOrders();
  } catch (err) {
    toast(err.message || 'Gagal', 'error');
  }
}

function showInvoice(orderId) {
  const o = ordersList.find(x => x.id === orderId);
  if (!o) return;
  const invNo = o.invoiceNumber || o.id;
  const shipName = SHIPPING_OPTIONS.find(s => s.id === o.shippingMethod)?.name || o.shippingMethod;
  document.getElementById('modal-content').innerHTML = `
    <div id="invoice-print">
      <h3 style="margin-bottom:0.25rem">Invoice ${invNo}</h3>
      <p style="font-size:12px;color:var(--text3);margin-bottom:1rem">YourShop.Id · ${o.date}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;font-size:13px;margin-bottom:1rem">
        <div><strong>Pelanggan</strong><br>${o.customerName || '—'}<br>${o.shipPhone || ''}<br>${o.shipAddress || ''}<br>${o.shipCity || ''}</div>
        <div><strong>Pembayaran</strong><br>${o.paymentMethod || '—'} · ${o.paymentStatus || 'pending'}
          <br><strong>Pengiriman</strong><br>${shipName} (${formatMoney(o.shippingCost || 0)})</div>
      </div>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border);text-align:left">
          <th style="padding:0.4rem 0">Item</th><th>Qty</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>
          ${(o.items || []).map(i => {
            const p = adminProducts.find(x => x.id === i.productId);
            const unit = p ? p.price : (o.total / Math.max(1, o.items.length));
            return `<tr style="border-bottom:1px solid var(--border)"><td style="padding:0.4rem 0">${i.emoji || ''} ${i.name}</td>
              <td>${i.qty || 1}</td><td style="text-align:right">${formatMoney(unit * (i.qty || 1))}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="text-align:right;margin-top:1rem;font-weight:800;font-size:1.1rem">Total ${formatMoney(o.total)}</div>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1.25rem">
      <button class="btn btn-primary btn-sm" onclick="window.print()">Cetak</button>
      <button class="tbl-btn" onclick="closeModal()">Tutup</button>
    </div>`;
  document.getElementById('track-modal').classList.add('open');
}

async function renderPaymentPage(orderId) {
  const el = document.getElementById('payment-content') || document.getElementById('checkout-content');
  const page = document.getElementById('page-payment') || document.getElementById('page-checkout');
  if (page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    page.classList.add('active');
  }
  const o = ordersList.find(x => x.id === orderId);
  if (!el || !o) return;

  let payCfg = { provider: 'mock', enabled: false };
  if (apiOnline) {
    try { payCfg = await apiRequest('GET', '/payments/config'); } catch (_) {}
  }
  const isMidtrans = payCfg.enabled || payCfg.provider === 'midtrans';
  const methodLabel = { transfer: 'Transfer Bank', ewallet: 'E-Wallet', card: 'Kartu Kredit/Debit' }[o.paymentMethod] || o.paymentMethod || '—';
  const gwLabel = isMidtrans
    ? `Midtrans Snap (${payCfg.isProduction ? 'production' : 'sandbox'})`
    : 'YourShopPay (mock)';
  const gwHint = isMidtrans
    ? 'Anda akan diarahkan ke jendela Midtrans (VA, e-wallet, kartu, QRIS). Status final dikonfirmasi via webhook.'
    : 'Gateway mock — set <code>MIDTRANS_SERVER_KEY</code> &amp; <code>MIDTRANS_CLIENT_KEY</code> di server untuk pembayaran nyata.';

  el.innerHTML = `
    <h1>Pembayaran</h1>
    <p class="page-sub">Pesanan ${o.id} · Invoice ${o.invoiceNumber || '—'}</p>
    <div class="content-card" style="max-width:480px">
      <div class="summary-row total"><span>Total dibayar</span><span>${formatMoney(o.total)}</span></div>
      <p style="font-size:13px;color:var(--text2);margin:1rem 0">Metode preferensi: <strong>${methodLabel}</strong></p>
      <p style="font-size:12px;color:var(--text3);margin-bottom:0.35rem">Gateway: <strong>${gwLabel}</strong></p>
      <p style="font-size:12px;color:var(--text3);margin-bottom:1rem">${gwHint}</p>
      <button class="checkout-btn" onclick="payOrder('${o.id}')">${isMidtrans ? 'Bayar dengan Midtrans' : 'Bayar Sekarang (mock)'}</button>
      ${isMidtrans ? `<button class="tbl-btn" style="width:100%;margin-top:0.5rem;justify-content:center" onclick="payOrder('${o.id}', false, true)">Bayar mock (bypass Midtrans)</button>` : ''}
      <button class="tbl-btn" style="width:100%;margin-top:0.5rem;justify-content:center" onclick="payOrder('${o.id}', true)">Simulasi Gagal Bayar</button>
      <button class="tbl-btn" style="width:100%;margin-top:0.5rem;justify-content:center" onclick="showPage('orders')">Bayar nanti</button>
    </div>`;
}

// keep alias for any old callers
async function checkout() { goToCheckout(); }

async function refreshOrders() {
  if (!apiOnline) return;
  try {
    const q = currentUser?.id ? ('?customerId=' + encodeURIComponent(currentUser.id)) : '';
    // admin/seller lihat semua; buyer filter by customerId
    const path = (currentUser?.role === 'admin' || currentUser?.role === 'seller')
      ? '/orders'
      : ('/orders' + q);
    const ords = await apiRequest('GET', path);
    if (Array.isArray(ords)) ordersList = ords.map(normalizeOrder);
  } catch (_) { /* keep existing */ }
}

function applyPromo() {
  // jika promo sudah aktif, tombol berfungsi sebagai hapus
  if (appliedPromo) {
    appliedPromo = null;
    toast('Promo dihapus');
    renderCart();
    return;
  }
  const code = (document.getElementById('promo-input')?.value || '').trim().toUpperCase();
  if (!code) { toast('Masukkan kode promo', 'error'); return; }
  const promo = PROMO_CODES[code];
  if (!promo) { toast('Kode promo tidak valid', 'error'); return; }
  appliedPromo = { code, ...promo };
  toast(`${promo.label} berhasil diterapkan! 🎉`, 'success');
  renderCart();
}

// ============================================================
//  ORDERS
// ============================================================

function renderOrders() {
  const el = document.getElementById('orders-content');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = `<div class="empty-cart"><div class="empty-icon">🔒</div><p>Masuk untuk melihat pesanan</p><button class="btn btn-primary" onclick="showPage('login')">Masuk</button></div>`;
    return;
  }

  const list = getMyOrders();
  if (!list.length) {
    el.innerHTML = `<div class="empty-cart"><div class="empty-icon">📦</div><p>Belum ada pesanan</p><button class="btn btn-primary" onclick="showPage('store')">Mulai Belanja</button></div>`;
    return;
  }

  const canAdvance = currentUser.role === 'admin' || currentUser.role === 'seller';
  const statusLabel = {
    terkirim: 'Terkirim', dikirim: 'Dikirim', diproses: 'Diproses', dibatalkan: 'Dibatalkan',
  };
  const payLabel = {
    pending: '⏳ Belum bayar', paid: '✅ Lunas', failed: '❌ Gagal', refunded: '↩️ Refund',
  };

  el.innerHTML = list.map(o => `
    <div class="order-card">
      <div class="order-header">
        <div>
          <div class="order-id">${o.id}${o.invoiceNumber ? ' · ' + o.invoiceNumber : ''}</div>
          <div class="order-date">${o.date}${o.customerName ? ' · ' + o.customerName : ''}</div>
        </div>
        <div style="text-align:right">
          <span class="order-status status-${o.status}">${statusLabel[o.status] || capitalize(o.status)}</span>
          <div style="font-size:11px;color:var(--text3);margin-top:0.25rem">${payLabel[o.paymentStatus] || o.paymentStatus || ''}</div>
        </div>
      </div>
      <div class="order-items">
        ${o.items.map(i => `<div class="order-item-thumb">${i.emoji} ${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}</div>`).join('')}
      </div>
      ${o.returnStatus && o.returnStatus !== 'none' ? `<p style="font-size:12px;color:var(--warn);margin:0.5rem 0">Return: ${o.returnStatus}${o.returnReason ? ' — ' + o.returnReason : ''}</p>` : ''}
      <div class="order-footer">
        <span class="order-total">${formatMoney(o.total)}</span>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
          <button class="track-btn" onclick="openTracking('${o.id}')">Lacak</button>
          <button class="tbl-btn" onclick="showInvoice('${o.id}')">Invoice</button>
          ${o.paymentStatus === 'pending' && o.status !== 'dibatalkan' ? `<button class="tbl-btn" onclick="pendingPaymentOrderId='${o.id}';showPage('payment')">Bayar</button>` : ''}
          ${o.status === 'diproses' || (o.paymentStatus === 'pending' && o.status !== 'dibatalkan') ? `<button class="tbl-btn red" onclick="cancelOrder('${o.id}')">Batalkan</button>` : ''}
          ${o.status === 'terkirim' && (!o.returnStatus || o.returnStatus === 'none' || o.returnStatus === 'rejected') ? `<button class="tbl-btn" onclick="requestReturn('${o.id}')">Return</button>` : ''}
          ${canAdvance && o.returnStatus === 'requested' ? `<button class="tbl-btn" onclick="resolveReturn('${o.id}','approve')">Setujui Return</button><button class="tbl-btn red" onclick="resolveReturn('${o.id}','reject')">Tolak</button>` : ''}
          ${canAdvance && o.status !== 'terkirim' && o.status !== 'dibatalkan' && o.paymentStatus === 'paid' ? `<button class="tbl-btn" onclick="advanceOrderStatus('${o.id}')">Majukan</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function openTracking(orderId) {
  const o = ordersList.find(x => x.id === orderId);
  if (!o) return;
  if (!o.steps || !o.steps.length) o.steps = buildOrderSteps(o.status);
  document.getElementById('modal-content').innerHTML = `
    <h3>Tracking — ${o.id}</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:1rem">${o.customerName || ''} · ${formatMoney(o.total)} · ${o.items.length} item</p>
    <div class="track-steps">
      ${o.steps.map(s => `
        <div class="track-step ${s.done ? 'done' : ''} ${s.active ? 'active' : ''}">
          <div class="track-step-title">${s.title}</div>
          <div class="track-step-date">${s.date}</div>
          <p>${s.detail}</p>
        </div>`).join('')}
    </div>`;
  document.getElementById('track-modal').classList.add('open');
}

async function advanceOrderStatus(orderId) {
  const o = ordersList.find(x => x.id === orderId);
  if (!o) return;
  const flow = ['diproses', 'dikirim', 'terkirim'];
  const idx = flow.indexOf(o.status);
  if (idx < 0 || idx >= flow.length - 1) { toast('Status sudah final'); return; }
  const next = flow[idx + 1];
  try {
    if (apiOnline) {
      const updated = await apiRequest('PUT', '/orders/' + encodeURIComponent(orderId) + '/status', { status: next });
      const normalized = normalizeOrder(updated);
      const i = ordersList.findIndex(x => x.id === orderId);
      if (i >= 0) ordersList[i] = normalized;
    } else {
      o.status = next;
      o.steps = buildOrderSteps(o.status);
      persistLocalCatalog();
    }
    pushNotif('📦', `Pesanan ${orderId}`, `Status diperbarui: ${({'terkirim':'Terkirim','dikirim':'Dikirim','diproses':'Diproses'}[next])}`);
    toast(`Status ${orderId} → ${next}`, 'success');
    renderOrders();
    if (document.querySelector('.page.active')?.id === 'page-admin') renderAdmin('orders-admin');
  } catch (err) {
    toast(err.message || 'Gagal memperbarui status', 'error');
  }
}

function closeModal() {
  document.getElementById('track-modal').classList.remove('open');
}

// ============================================================
//  ADMIN
// ============================================================

let currentAdminTab = 'dashboard';

function showAdminTab(tab, el) {
  currentAdminTab = tab;
  document.querySelectorAll('.admin-nav a').forEach(a => a.classList.remove('active'));
  if (el) el.classList.add('active');
  renderAdmin(tab);
}


function renderAdminLocalDashboard(el, isSeller, sellerName) {
  const mine = isSeller
    ? ordersList.filter(o => (o.items||[]).some(i => {
        const pr = adminProducts.find(x => x.id === i.productId);
        return pr && (pr.seller === sellerName || pr.seller === currentUser?.name);
      }))
    : ordersList;
  const revenue = mine.reduce((s, o) => s + (o.total || 0), 0);
  const payout = mine.reduce((s, o) => s + (o.sellerPayout || 0), 0);
  const commission = mine.reduce((s, o) => s + (o.commission || 0), 0);
  const sellers = new Set(adminProducts.map(p => p.seller)).size;
  const recent = mine.slice(0, 5);
  const prodCount = isSeller
    ? adminProducts.filter(p => p.seller === sellerName || p.seller === currentUser?.name).length
    : adminProducts.length;
  el.innerHTML = `
    <h2>Dasbor ${isSeller ? 'Penjual' : 'Admin'}</h2>
    <div class="admin-stats">
      <div class="stat-card"><div class="stat-label">${isSeller?'GMV':'Revenue'}</div><div class="stat-val">${formatMoney(revenue)}</div></div>
      <div class="stat-card"><div class="stat-label">${isSeller?'Payout':'Pesanan'}</div><div class="stat-val">${isSeller?formatMoney(payout):mine.length}</div></div>
      <div class="stat-card"><div class="stat-label">${isSeller?'Komisi':'Produk'}</div><div class="stat-val">${isSeller?formatMoney(commission):prodCount}</div></div>
      <div class="stat-card"><div class="stat-label">${isSeller?'Produk':'Sellers'}</div><div class="stat-val">${isSeller?prodCount:sellers}</div></div>
    </div>
    ${isSeller ? '<div class="content-card" style="margin-bottom:1rem"><button class="btn btn-primary btn-sm" onclick="submitKyc()">Ajukan KYC</button></div>' : ''}
    <div class="admin-table-wrap"><div class="admin-table-head"><h3>Pesanan Terbaru</h3></div>
    <table><thead><tr><th>ID</th><th>Total</th><th>Status</th></tr></thead><tbody>
    ${recent.map(o => '<tr><td>'+o.id+'</td><td>'+formatMoney(o.total)+'</td><td>'+o.status+'</td></tr>').join('') || '<tr><td colspan=3>Kosong</td></tr>'}
    </tbody></table></div>`;
}
async function submitKyc() {
  if (!currentUser) return;
  const note = prompt('Catatan KYC:', 'Dokumen toko lengkap') || '';
  try {
    if (!apiOnline) { toast('Butuh server online', 'error'); return; }
    await apiRequest('POST', '/kyc/submit', { note, shopName: currentUser.shopName || currentUser.name });
    toast('KYC dikirim', 'success');
    renderAdmin('dashboard');
  } catch (e) { toast(e.message || 'Gagal', 'error'); }
}
async function reviewKyc(userId, status) {
  try {
    await apiRequest('POST', '/kyc/review', { userId, status });
    toast('KYC '+status, 'success');
    renderAdmin('sellers-admin');
  } catch (e) { toast(e.message || 'Gagal', 'error'); }
}

function renderAdmin(tab) {
  const el = document.getElementById('admin-main-content');
  if (!el) return;

  // Seller vs Admin: hide sellers tab for non-admin; filter products for seller
  const isSeller = currentUser?.role === 'seller';
  const isAdmin = currentUser?.role === 'admin';
  const logoEl = document.getElementById('admin-logo-text');
  if (logoEl) logoEl.textContent = isSeller ? 'Seller Dashboard' : 'Admin YourShop.Id';
  const sellersNav = document.getElementById('admin-nav-sellers');
  if (sellersNav) sellersNav.style.display = isAdmin ? '' : 'none';
  if (tab === 'sellers-admin' && !isAdmin) tab = 'dashboard';

  // Seller only sees their own products (match shop name or seller name)
  const sellerName = currentUser?.shopName || currentUser?.name || '';
  const visibleProducts = isSeller && sellerName
    ? adminProducts.filter(p => p.seller === sellerName || p.seller === currentUser.name)
    : adminProducts;
  // if seller has no products yet, show all for demo discoverability when empty filter
  const productsForAdmin = (isSeller && visibleProducts.length === 0) ? adminProducts : visibleProducts;

  if (tab === 'dashboard') {
    // Load seller dashboard from API when possible
    if (isSeller && apiOnline) {
      el.innerHTML = `<p style="color:var(--text3)">Memuat dasbor penjual…</p>`;
      apiRequest('GET', '/seller/dashboard').then(d => {
        el.innerHTML = `
          <h2>Dasbor Penjual — ${d.shopName || sellerName}
            <span style="font-size:12px;margin-left:0.5rem;padding:0.15rem 0.5rem;border-radius:4px;background:${d.kycStatus==='verified'?'var(--success-bg)':d.kycStatus==='pending'?'var(--warn-bg)':'var(--surface2)'};color:${d.kycStatus==='verified'?'var(--success)':'var(--text2)'}">KYC: ${d.kycStatus || 'none'}</span>
          </h2>
          <div class="admin-stats">
            <div class="stat-card"><div class="stat-label">GMV (subtotal)</div><div class="stat-val">${formatMoney(d.gmv||0)}</div><div class="stat-sub">${d.orderCount||0} pesanan</div></div>
            <div class="stat-card"><div class="stat-label">Payout penjual</div><div class="stat-val">${formatMoney(d.sellerPayout||0)}</div><div class="stat-sub">Setelah komisi ${((d.commissionRate||0)*100).toFixed(0)}%</div></div>
            <div class="stat-card"><div class="stat-label">Komisi platform</div><div class="stat-val">${formatMoney(d.commission||0)}</div><div class="stat-sub">Dipotong otomatis</div></div>
            <div class="stat-card"><div class="stat-label">Produk</div><div class="stat-val">${d.productCount||0}</div><div class="stat-sub">Listing aktif</div></div>
          </div>
          ${d.kycStatus !== 'verified' ? `<div class="content-card" style="margin-bottom:1rem">
            <h3>Verifikasi KYC</h3>
            <p style="font-size:13px;color:var(--text2);margin-bottom:0.75rem">Status: <strong>${d.kycStatus||'none'}</strong>. Toko terverifikasi lebih dipercaya pembeli.</p>
            <button class="btn btn-primary btn-sm" onclick="submitKyc()">Ajukan / Ulangi KYC</button>
          </div>` : ''}
          <div class="admin-table-wrap">
            <div class="admin-table-head"><h3>Pesanan terkait toko</h3></div>
            <table>
              <thead><tr><th>ID</th><th>Total</th><th>Payout</th><th>Komisi</th><th>Status</th></tr></thead>
              <tbody>
                ${(d.recentOrders||[]).map(o => `
                  <tr>
                    <td class="table-name">${o.id}</td>
                    <td>${formatMoney(o.total)}</td>
                    <td>${formatMoney(o.sellerPayout||0)}</td>
                    <td>${formatMoney(o.commission||0)}</td>
                    <td>${o.status}</td>
                  </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3)">Belum ada pesanan</td></tr>'}
              </tbody>
            </table>
          </div>`;
      }).catch(() => { /* fall through local */ renderAdminLocalDashboard(el, isSeller, sellerName); });
      return;
    }
    renderAdminLocalDashboard(el, isSeller, sellerName);
    return;
  }
  // continue other tabs below — inject helper before other tabs by falling through incorrectly
  // FIX: the original code continued with else if — restore structure
  if (false) {
    const revenue = ordersList.reduce((s, o) => s + (o.total || 0), 0);
    const sellers = new Set(adminProducts.map(p => p.seller)).size;
    const recent = ordersList.slice(0, 5);
    el.innerHTML = `
      <h2>Dasbor</h2>
      <div class="admin-stats">
        <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-val">${formatMoney(revenue)}</div><div class="stat-sub">Dari ${ordersList.length} pesanan</div></div>
        <div class="stat-card"><div class="stat-label">Pesanan</div><div class="stat-val">${ordersList.length}</div><div class="stat-sub">Semua status</div></div>
        <div class="stat-card"><div class="stat-label">Produk Aktif</div><div class="stat-val">${adminProducts.length}</div><div class="stat-sub">Semua seller</div></div>
        <div class="stat-card"><div class="stat-label">Sellers</div><div class="stat-val">${sellers}</div><div class="stat-sub">Toko aktif</div></div>
      </div>
      <div class="admin-table-wrap">
        <div class="admin-table-head"><h3>Pesanan Terbaru</h3><button class="tbl-btn" onclick="showAdminTab('orders-admin', null)">Lihat semua →</button></div>
        <table>
          <thead><tr><th>ID Pesanan</th><th>Pelanggan</th><th>Item</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            ${recent.map(o => `
              <tr>
                <td class="table-name">${o.id}</td>
                <td>${o.customerName || '—'}</td>
                <td>${o.items.length}</td>
                <td>${formatMoney(o.total)}</td>
                <td><span class="badge badge-${o.status === 'terkirim' ? 'success' : o.status === 'dikirim' ? 'warn' : 'info'}">${({'terkirim':'Terkirim','dikirim':'Dikirim','diproses':'Diproses'}[o.status] || o.status)}</span></td>
              </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3)">Belum ada pesanan</td></tr>'}
          </tbody>
        </table>
      </div>`;

  } else if (tab === 'products') {
    const cur = getCurrency();
    const priceHint = cur.code === 'IDR' ? 'contoh: 250000' : 'contoh: 29.99';
    el.innerHTML = `
      <h2>Produk</h2>
      <div class="add-product-form">
        <h3 id="product-form-title">Tambah Produk Baru</h3>
        <div class="form-grid">
          <div class="form-group"><label>Nama Produk</label><input type="text" id="np-name" placeholder="cth. Speaker Nirkabel"></div>
          <div class="form-group"><label>Harga (${cur.code})</label><input type="number" id="np-price" placeholder="${priceHint}" step="any"></div>
          <div class="form-group"><label>Harga Coret / Diskon (${cur.code})</label><input type="number" id="np-oldprice" placeholder="opsional" step="any"></div>
          <div class="form-group"><label>Kategori</label>
            <select id="np-cat"><option>Elektronik</option><option>Fashion</option><option>Rumah</option><option>Buku</option><option>Olahraga</option><option>Makanan</option><option>Seni</option><option>Otomotif</option></select>
          </div>
          <div class="form-group"><label>Nama Toko</label><input type="text" id="np-seller" placeholder="Nama toko kamu" value="${currentUser?.shopName || currentUser?.name || ''}"></div>
          <div class="form-group" style="grid-column:1/-1"><label>Deskripsi</label><textarea id="np-desc" placeholder="Deskripsikan produkmu..."></textarea></div>
          <div class="form-group" style="grid-column:1/-1"><label>URL Gambar produk</label>
            <input type="url" id="np-image" placeholder="https://... atau unggah file di bawah"></div>
          <div class="form-group" style="grid-column:1/-1"><label>Unggah gambar (disimpan sebagai data URL lokal)</label>
            <input type="file" id="np-image-file" accept="image/*" onchange="handleProductImageFile(this)"></div>
          <div class="form-group" style="grid-column:1/-1"><label>Varian (satu baris: Label | delta harga USD | stok)</label>
            <textarea id="np-variants" rows="3" placeholder="Contoh:&#10;S / Hitam | 0 | 10&#10;M / Hitam | 0 | 8&#10;L / Putih | 5 | 5"></textarea></div>
          <div class="form-group" style="grid-column:1/-1"><label>Ikon Emoji (fallback)</label>
            <div class="emoji-picker" id="emoji-picker">
              ${['📱','💻','⌨️','🎧','⌚','📷','🎮','👕','👟','🧥','👜','🏠','☕','🛋️','🪴','📚','⚽','🎨','🌶️','🧃','🎸','🧸','💡','🔧']
                .map(e => `<span class="emoji-opt" onclick="selectEmoji('${e}', this)">${e}</span>`).join('')}
            </div>
          </div>
        </div>
        <div style="margin-top:1rem;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
          <span id="selected-emoji" style="font-size:1.5rem">${selectedEmoji}</span>
          <button class="btn btn-primary btn-sm" id="product-form-submit" onclick="saveProductForm()">+ Tambah Produk</button>
          <button class="tbl-btn" id="product-form-cancel" style="display:none" onclick="cancelEditProduct()">Batal Edit</button>
        </div>
        <p style="font-size:12px;color:var(--text3);margin-top:0.5rem">Harga disimpan dalam USD base; input mengikuti mata uang tampilan (${cur.code}, 1 USD ≈ ${cur.rate.toLocaleString(cur.locale)} ${cur.code === 'IDR' ? 'IDR' : 'USD'}).</p>
      </div>
      <div class="admin-table-wrap">
        <div class="admin-table-head"><h3>Semua Produk (${adminProducts.length})</h3></div>
        <table>
          <thead><tr><th>Produk</th><th>Kategori</th><th>Penjual</th><th>Harga</th><th>Rating</th><th>Aksi</th></tr></thead>
          <tbody id="products-table-body">${renderProductsTable()}</tbody>
        </table>
      </div>`;

  } else if (tab === 'orders-admin') {
    el.innerHTML = `
      <h2>Semua Pesanan</h2>
      <div class="admin-table-wrap">
        <div class="admin-table-head"><h3>Pesanan (${ordersList.length})</h3></div>
        <table>
          <thead><tr><th>ID Pesanan</th><th>Pelanggan</th><th>Item</th><th>Total</th><th>Tanggal</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${ordersList.map(o => `
              <tr>
                <td class="table-name">${o.id}</td>
                <td>${o.customerName || currentUser?.name || 'Pelanggan'}</td>
                <td>${o.items.length}</td>
                <td>${formatMoney(o.total)}</td>
                <td style="color:var(--text3)">${o.date}</td>
                <td><span class="badge badge-${o.status === 'terkirim' ? 'success' : o.status === 'dikirim' ? 'warn' : 'info'}">${({'terkirim':'Terkirim','dikirim':'Dikirim','diproses':'Diproses'}[o.status] || capitalize(o.status))}</span></td>
                <td><div class="action-btns">
                  <button class="tbl-btn" onclick="openTracking('${o.id}')">Lacak</button>
                  ${o.status !== 'terkirim' ? `<button class="tbl-btn" onclick="advanceOrderStatus('${o.id}')">Majukan</button>` : ''}
                </div></td>
              </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text3)">Belum ada pesanan</td></tr>'}
          </tbody>
        </table>
      </div>`;

  } else if (tab === 'sellers-admin') {
    const sellers = [...new Set(adminProducts.map(p => p.seller))];
    const activeCount = sellers.filter(s => !isSellerSuspended(s)).length;
    el.innerHTML = `
      <h2>Penjual</h2>
      <div class="admin-table-wrap">
        <div class="admin-table-head"><h3>Seller (${activeCount} aktif / ${sellers.length} total)</h3></div>
        <table>
          <thead><tr><th>Nama Toko</th><th>Produk</th><th>Kategori</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${sellers.map(s => {
              const ps  = adminProducts.filter(p => p.seller === s);
              const cat = ps[0]?.category || 'Mixed';
              const suspended = isSellerSuspended(s);
              const safe = encodeURIComponent(s);
              return `<tr>
                <td class="table-name">${s}</td>
                <td>${ps.length}</td>
                <td>${cat}</td>
                <td><span class="badge ${suspended ? 'badge-danger' : 'badge-success'}">${suspended ? 'Ditangguhkan' : 'Aktif'}</span></td>
                <td><div class="action-btns">
                  <button class="tbl-btn" onclick="viewSeller('${safe}')">Lihat</button>
                  <button class="tbl-btn ${suspended ? '' : 'red'}" onclick="toggleSuspendSeller('${safe}')">${suspended ? 'Aktifkan' : 'Tangguhkan'}</button>
                </div></td>
              </tr>`;
            }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3)">Belum ada penjual</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }
}

// ============================================================
//  SELLER MANAGEMENT
// ============================================================

function isSellerSuspended(name) {
  return suspendedSellers.includes(name);
}

function saveSuspendedSellers() {
  localStorage.setItem('ysi-suspended-sellers', JSON.stringify(suspendedSellers));
}

function viewSeller(encodedName) {
  const name = decodeURIComponent(encodedName);
  const products = adminProducts.filter(p => p.seller === name);
  const suspended = isSellerSuspended(name);
  const cats = [...new Set(products.map(p => p.category))].join(', ') || '—';
  const avgRating = products.length
    ? (products.reduce((s, p) => s + (p.rating || 0), 0) / products.length).toFixed(1)
    : '—';

  document.getElementById('modal-content').innerHTML = `
    <h3>Toko: ${name}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1.25rem;font-size:14px">
      <div><span style="color:var(--text3)">Status</span><br>
        <span class="badge ${suspended ? 'badge-danger' : 'badge-success'}">${suspended ? 'Ditangguhkan' : 'Aktif'}</span></div>
      <div><span style="color:var(--text3)">Produk</span><br><strong>${products.length}</strong></div>
      <div><span style="color:var(--text3)">Kategori</span><br><strong>${cats}</strong></div>
      <div><span style="color:var(--text3)">Rating rata-rata</span><br><strong>★ ${avgRating}</strong></div>
    </div>
    <h4 style="font-family:var(--font-head);font-size:0.9rem;margin-bottom:0.75rem">Produk toko</h4>
    <div style="max-height:240px;overflow-y:auto">
      ${products.length ? products.map(p => `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border);cursor:pointer"
             onclick="closeModal();showDetail(${p.id})">
          <span style="font-size:1.5rem">${p.emoji}</span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${p.name}</div>
            <div style="font-size:12px;color:var(--text3)">${p.category} · ★ ${p.rating}</div>
          </div>
          <div style="font-weight:700;font-size:13px">${formatMoney(p.price)}</div>
        </div>`).join('') : '<p style="color:var(--text3);font-size:13px">Tidak ada produk</p>'}
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1.25rem;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="closeModal();filterBySeller('${encodedName}')">Lihat di Toko</button>
      <button class="tbl-btn ${suspended ? '' : 'red'}" onclick="toggleSuspendSeller('${encodedName}');viewSeller('${encodedName}')">${suspended ? 'Aktifkan Kembali' : 'Tangguhkan'}</button>
      <button class="tbl-btn" onclick="closeModal()">Tutup</button>
    </div>`;
  document.getElementById('track-modal').classList.add('open');
}

async function toggleSuspendSeller(encodedName) {
  const name = decodeURIComponent(encodedName);
  const willSuspend = !isSellerSuspended(name);
  if (willSuspend && !confirm(`Tangguhkan toko "${name}"? Produk mereka tidak akan tampil di toko.`)) return;

  try {
    if (apiOnline) {
      await apiRequest('POST', '/sellers/suspend', { name, suspend: willSuspend });
    }
    if (willSuspend) {
      if (!suspendedSellers.includes(name)) suspendedSellers.push(name);
      toast(`Toko "${name}" ditangguhkan`, 'success');
      pushNotif('⚠️', 'Penjual ditangguhkan', `Toko ${name} telah ditangguhkan oleh admin.`);
    } else {
      suspendedSellers = suspendedSellers.filter(s => s !== name);
      toast(`Toko "${name}" diaktifkan kembali`, 'success');
      pushNotif('✅', 'Penjual diaktifkan', `Toko ${name} kembali aktif di marketplace.`);
    }
    saveSuspendedSellers();
    if (document.querySelector('.page.active')?.id === 'page-admin') renderAdmin('sellers-admin');
    if (document.querySelector('.page.active')?.id === 'page-store') renderProducts();
  } catch (err) {
    toast(err.message || 'Gagal mengubah status penjual', 'error');
  }
}

function filterBySeller(encodedName) {
  const name = decodeURIComponent(encodedName);
  currentSearch = name.toLowerCase();
  const input = document.getElementById('nav-search-input');
  if (input) input.value = name;
  currentCategory = 'All';
  document.querySelectorAll('.cat-bar-item').forEach(b => b.classList.remove('active'));
  const allBtn = document.querySelector('.cat-bar-item');
  if (allBtn) allBtn.classList.add('active');
  showPage('store');
  renderProducts();
  toast(`Menampilkan produk dari ${name}`);
}

function renderProductsTable() {
  return adminProducts.map(p => `
    <tr id="prod-row-${p.id}">
      <td><span style="font-size:1.1rem;margin-right:0.5rem">${p.emoji}</span><span class="table-name">${p.name}</span></td>
      <td>${p.category}</td>
      <td>${p.seller}</td>
      <td>${formatMoney(p.price)}</td>
      <td><span style="color:var(--warn)">★</span> ${p.rating}</td>
      <td><div class="action-btns">
        <button class="tbl-btn" onclick="showDetail(${p.id})">Lihat</button>
        <button class="tbl-btn" onclick="startEditProduct(${p.id})">Edit</button>
        <button class="tbl-btn red" onclick="deleteProduct(${p.id})">Hapus</button>
      </div></td>
    </tr>`).join('');
}

function startEditProduct(id) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  showAdminTab('products', null);
  // after render, fill form — use timeout so DOM is ready
  setTimeout(() => {
    const c = getCurrency();
    document.getElementById('product-form-title').textContent = 'Edit Produk #' + id;
    document.getElementById('np-name').value = p.name;
    document.getElementById('np-price').value = (p.price * c.rate).toFixed(c.code === 'IDR' ? 0 : 2);
    document.getElementById('np-oldprice').value = p.oldPrice ? (p.oldPrice * c.rate).toFixed(c.code === 'IDR' ? 0 : 2) : '';
    document.getElementById('np-cat').value = p.category;
    document.getElementById('np-seller').value = p.seller;
    document.getElementById('np-desc').value = p.desc || '';
    const imgEl = document.getElementById('np-image');
    if (imgEl) imgEl.value = p.imageUrl || '';
    const varEl = document.getElementById('np-variants');
    if (varEl && p.variants?.length) {
      varEl.value = p.variants.map(v => `${v.label} | ${v.priceDelta || 0} | ${v.stock ?? 10}`).join('\n');
    }
    selectedEmoji = p.emoji || '📦';
    document.getElementById('selected-emoji').textContent = selectedEmoji;
    const btn = document.getElementById('product-form-submit');
    if (btn) btn.textContent = '💾 Simpan Perubahan';
    const cancel = document.getElementById('product-form-cancel');
    if (cancel) cancel.style.display = '';
  }, 50);
}

function cancelEditProduct() {
  editingProductId = null;
  selectedEmoji = '📦';
  renderAdmin('products');
}

async function saveProductForm() {
  if (editingProductId) await updateProduct(editingProductId);
  else await addProduct();
}

function selectEmoji(e, el) {
  selectedEmoji = e;
  document.getElementById('selected-emoji').textContent = e;
  document.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
}

function parseVariantsText(text) {
  if (!text?.trim()) return [];
  return text.trim().split('\n').map((line, i) => {
    const parts = line.split('|').map(s => s.trim());
    const label = parts[0] || ('Opsi ' + (i + 1));
    const priceDelta = parseFloat(parts[1]) || 0;
    const stock = parseInt(parts[2], 10);
    return {
      id: i + 1,
      label,
      color: label,
      size: '',
      priceDelta,
      stock: isNaN(stock) ? 10 : stock,
    };
  }).filter(v => v.label);
}

function handleProductImageFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 1.5e6) { toast('Gambar max ~1.5MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const el = document.getElementById('np-image');
    if (el) el.value = reader.result;
    toast('Gambar siap diunggah', 'success');
  };
  reader.readAsDataURL(file);
}

function readProductForm() {
  const name = document.getElementById('np-name')?.value?.trim();
  const priceDisplay = parseFloat(document.getElementById('np-price')?.value);
  const oldDisplay = parseFloat(document.getElementById('np-oldprice')?.value);
  const cat = document.getElementById('np-cat')?.value;
  const seller = document.getElementById('np-seller')?.value?.trim() || currentUser?.shopName || currentUser?.name || 'Toko';
  const desc = document.getElementById('np-desc')?.value?.trim();
  const imageUrl = document.getElementById('np-image')?.value?.trim() || '';
  const variants = parseVariantsText(document.getElementById('np-variants')?.value);
  if (!name || isNaN(priceDisplay) || !seller) {
    toast('Harap isi nama, harga, dan nama toko', 'error');
    return null;
  }
  const price = displayToUsd(priceDisplay);
  const oldPrice = !isNaN(oldDisplay) && oldDisplay > 0 ? displayToUsd(oldDisplay) : null;
  return {
    name, emoji: selectedEmoji, imageUrl, price, oldPrice, category: cat, seller,
    desc: desc || 'Belum ada deskripsi.',
    tags: [cat.toLowerCase()],
    variants,
  };
}

function resetProductForm() {
  editingProductId = null;
  selectedEmoji = '📦';
  ['np-name','np-price','np-oldprice','np-seller','np-desc','np-image','np-variants'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const title = document.getElementById('product-form-title');
  if (title) title.textContent = 'Tambah Produk Baru';
  const btn = document.getElementById('product-form-submit');
  if (btn) btn.textContent = '+ Tambah Produk';
  const cancel = document.getElementById('product-form-cancel');
  if (cancel) cancel.style.display = 'none';
  const emoji = document.getElementById('selected-emoji');
  if (emoji) emoji.textContent = '📦';
}

async function addProduct() {
  const payload = readProductForm();
  if (!payload) return;

  try {
    let newProduct;
    if (apiOnline) {
      const data = await apiRequest('POST', '/products', payload);
      newProduct = normalizeProduct(data);
    } else {
      newProduct = {
        id: ++nextId, ...payload, rating: 0, reviews: 0,
        badge: payload.oldPrice ? 'Diskon' : 'Baru', stock: true, featured: false,
      };
    }
    adminProducts.unshift(newProduct);
    toast(`${selectedEmoji} ${payload.name} berhasil ditambahkan!`, 'success');
    resetProductForm();
    const tbody = document.getElementById('products-table-body');
    if (tbody) tbody.innerHTML = renderProductsTable();
  } catch (err) {
    toast(err.message || 'Gagal menambah produk', 'error');
  }
}

async function updateProduct(id) {
  const payload = readProductForm();
  if (!payload) return;

  try {
    if (apiOnline) {
      const data = await apiRequest('PUT', '/products/' + id, payload);
      const normalized = normalizeProduct(data);
      const idx = adminProducts.findIndex(p => p.id === id);
      if (idx >= 0) adminProducts[idx] = normalized;
    } else {
      const idx = adminProducts.findIndex(p => p.id === id);
      if (idx >= 0) {
        adminProducts[idx] = {
          ...adminProducts[idx],
          ...payload,
          badge: payload.oldPrice ? 'Diskon' : (adminProducts[idx].badge || null),
        };
      }
    }
    toast('Produk diperbarui ✓', 'success');
    resetProductForm();
    const tbody = document.getElementById('products-table-body');
    if (tbody) tbody.innerHTML = renderProductsTable();
  } catch (err) {
    toast(err.message || 'Gagal memperbarui produk', 'error');
  }
}

async function deleteProduct(id) {
  try {
    if (apiOnline) {
      await apiRequest('DELETE', '/products/' + id);
    }
    adminProducts = adminProducts.filter(p => p.id !== id);
    cart = cart.filter(c => c.id !== id);
    saveCart();
    const row = document.getElementById(`prod-row-${id}`);
    if (row) row.remove();
    toast('Produk dihapus');
  } catch (err) {
    toast(err.message || 'Gagal menghapus produk', 'error');
  }
}

// ============================================================
//  WATCHLIST
// ============================================================

function saveWatchlist() {
  localStorage.setItem('ysi-watchlist', JSON.stringify(watchlist));
}

function isInWatchlist(id) {
  return watchlist.includes(id);
}

function toggleWatchlist(id, ev) {
  if (ev) ev.stopPropagation();
  if (isInWatchlist(id)) {
    watchlist = watchlist.filter(x => x !== id);
    toast('Dihapus dari watchlist');
  } else {
    watchlist.push(id);
    toast('Ditambahkan ke watchlist ❤️', 'success');
  }
  saveWatchlist();
  // re-render if on relevant pages
  const active = document.querySelector('.page.active');
  if (active?.id === 'page-watchlist') renderWatchlist();
  if (active?.id === 'page-store') renderProducts();
  if (active?.id === 'page-deals') renderDeals();
}

function renderWatchlist() {
  const el = document.getElementById('watchlist-content');
  if (!el) return;
  const items = watchlist.map(id => adminProducts.find(p => p.id === id)).filter(Boolean);
  el.innerHTML = `
    <h1>Watchlist</h1>
    <p class="page-sub">${items.length} produk disimpan</p>
    ${!items.length ? `
      <div class="empty-cart"><div class="empty-icon">❤️</div><p>Watchlist masih kosong</p>
      <button class="btn btn-primary" onclick="showPage('store')">Jelajahi Produk</button></div>` : `
      <div class="wl-grid">${items.map(p => productCardHTML(p, true)).join('')}</div>`}`;
}

function productCardHTML(p, showRemove) {
  const inWl = isInWatchlist(p.id);
  const out = !p.stock;
  const inCmp = compareList.includes(p.id);
  return `
    <div class="product-card" onclick="showDetail(${p.id})" style="${out ? 'opacity:0.72' : ''}">
      <div class="product-img" style="position:relative;overflow:hidden">
        ${p.badge ? `<span class="product-badge ${p.badge === 'Baru' || p.badge === 'Original' ? 'green' : ''}">${p.badge}</span>` : ''}
        ${out ? `<span class="product-badge" style="left:auto;right:0.5rem;top:2.5rem;background:var(--danger)">${t('product.soldOut')}</span>` : ''}
        <button class="wl-heart ${inWl ? 'active' : ''}" onclick="toggleWatchlist(${p.id}, event)" title="Watchlist">${inWl ? '❤️' : '🤍'}</button>
        ${productImageHTML(p)}
      </div>
      <div class="product-info">
        <div class="product-seller">${p.seller}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-stars">${starsRaw(p.rating, p.reviews)}</div>
        <div class="product-footer">
          <div>
            <span class="product-price">${formatMoney(p.price)}</span>
            ${p.oldPrice ? `<span class="product-price-old">${formatMoney(p.oldPrice)}</span>` : ''}
          </div>
          <button class="add-cart-btn" onclick="event.stopPropagation();addToCart(${p.id})" ${out ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>${out ? t('product.soldOut') : t('product.addCart')}</button>
        </div>
        <div class="product-actions-row">
          <button class="icon-btn ${inCmp ? 'active' : ''}" onclick="event.stopPropagation();toggleCompare(${p.id})" title="${t('compare.add')}">⚖️</button>
          <button class="icon-btn" onclick="event.stopPropagation();shareProduct(${p.id})" title="${t('share.title')}">🔗</button>
        </div>
      </div>
    </div>`;
}

function renderFeatured() {
  const grid = document.getElementById('featured-grid');
  if (!grid) return;
  let featured = adminProducts.filter(p => p.featured && !isSellerSuspended(p.seller));
  if (!featured.length) featured = adminProducts.filter(p => p.oldPrice && p.stock).slice(0, 4);
  if (!featured.length) featured = adminProducts.slice(0, 4);
  grid.innerHTML = featured.slice(0, 4).map(p => productCardHTML(p)).join('');
}

// ============================================================
//  NOTIFICATIONS
// ============================================================

function saveNotifs() {
  localStorage.setItem('ysi-notifs', JSON.stringify(notifications));
  updateNotifBadge();
}

function pushNotif(icon, title, body) {
  notifications.unshift({ id: Date.now(), icon, title, body, time: 'Baru saja', read: false });
  saveNotifs();
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const unread = notifications.filter(n => !n.read).length;
  badge.style.display = unread > 0 ? 'block' : 'none';
}

function markAllNotifsRead() {
  notifications.forEach(n => n.read = true);
  saveNotifs();
  renderNotifications();
}

function renderNotifications() {
  const el = document.getElementById('notifications-content');
  if (!el) return;
  const unread = notifications.filter(n => !n.read).length;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;gap:1rem;flex-wrap:wrap">
      <h1 style="margin:0">Notifikasi</h1>
      ${notifications.length ? `<button class="tbl-btn" onclick="markAllNotifsRead()">Tandai semua dibaca</button>` : ''}
    </div>
    <p class="page-sub">${unread} belum dibaca · ${notifications.length} total</p>
    <div class="content-card">
      ${notifications.length ? notifications.map(n => `
        <div class="notif-item" style="${n.read ? 'opacity:0.65' : ''}" onclick="this.style.opacity='0.65'">
          <div class="notif-icon">${n.icon || '🔔'}</div>
          <div class="notif-body"><strong>${n.title}</strong><p>${n.body}</p></div>
          <div class="notif-time">${n.time || ''}</div>
        </div>`).join('') : `
        <div class="empty-cart" style="padding:2rem 1rem">
          <div class="empty-icon">🔔</div>
          <p>Belum ada notifikasi</p>
          <button class="btn btn-primary" onclick="showPage('store')">Mulai Belanja</button>
        </div>`}
    </div>`;
  setTimeout(() => { notifications.forEach(n => n.read = true); saveNotifs(); }, 1500);
}

// ============================================================
//  PROFILE
// ============================================================

function renderProfile() {
  const el = document.getElementById('profile-content');
  if (!el) return;
  if (!currentUser) {
    el.innerHTML = `<div class="empty-cart"><p>Silakan masuk untuk melihat profil</p>
      <button class="btn btn-primary" onclick="showPage('login')">Masuk</button></div>`;
    return;
  }
  const initials = currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const roleLabel = { buyer: 'Pembeli', seller: 'Penjual', admin: 'Admin' }[currentUser.role] || currentUser.role;
  el.innerHTML = `
    <h1>Profil Saya</h1>
    <p class="page-sub">Kelola informasi akun kamu</p>
    <div class="content-card">
      <div class="profile-header">
        <div class="profile-avatar-lg">${initials}</div>
        <div class="profile-meta">
          <h2>${currentUser.name}</h2>
          <div class="role-pill">${roleLabel}</div>
          <div style="font-size:13px;color:var(--text2);margin-top:0.35rem">${currentUser.email}</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Nama Lengkap</label>
          <input type="text" id="pf-name" value="${currentUser.name || ''}"></div>
        <div class="form-group"><label>Email</label>
          <input type="email" id="pf-email" value="${currentUser.email || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Telepon</label>
          <input type="tel" id="pf-phone" value="${currentUser.phone || ''}" placeholder="08xxxxxxxxxx"></div>
        <div class="form-group"><label>Nama Toko</label>
          <input type="text" id="pf-shop" value="${currentUser.shopName || ''}" placeholder="${currentUser.role === 'seller' ? 'Nama toko kamu' : '—'}" ${currentUser.role !== 'seller' ? 'disabled' : ''}></div>
      </div>
      <div class="form-group"><label>Alamat</label>
        <textarea id="pf-address" placeholder="Alamat lengkap" rows="2">${currentUser.address || ''}</textarea></div>
      <button class="btn btn-primary" style="margin-top:0.75rem" onclick="saveProfile()">Simpan Perubahan</button>
    </div>
    <div class="content-card">
      <h3>Ringkasan</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;text-align:center">
        <div><div style="font-family:var(--font-head);font-size:1.5rem;font-weight:800">${ordersList.length}</div><div style="font-size:12px;color:var(--text3)">Pesanan</div></div>
        <div><div style="font-family:var(--font-head);font-size:1.5rem;font-weight:800">${watchlist.length}</div><div style="font-size:12px;color:var(--text3)">Watchlist</div></div>
        <div><div style="font-family:var(--font-head);font-size:1.5rem;font-weight:800">${cart.reduce((s,c)=>s+c.qty,0)}</div><div style="font-size:12px;color:var(--text3)">Di Keranjang</div></div>
      </div>
    </div>`;
}

async function saveProfile() {
  if (!currentUser) return;
  currentUser.name = document.getElementById('pf-name')?.value?.trim() || currentUser.name;
  currentUser.email = document.getElementById('pf-email')?.value?.trim() || currentUser.email;
  currentUser.phone = document.getElementById('pf-phone')?.value?.trim() || '';
  currentUser.shopName = document.getElementById('pf-shop')?.value?.trim() || currentUser.shopName || '';
  currentUser.address = document.getElementById('pf-address')?.value?.trim() || '';
  try {
    if (apiOnline && currentUser.id) {
      const updated = await apiRequest('PUT', '/users/' + encodeURIComponent(currentUser.id), {
        name: currentUser.name,
        email: currentUser.email,
        phone: currentUser.phone,
        shopName: currentUser.shopName,
        address: currentUser.address,
      });
      if (updated) Object.assign(currentUser, updated);
    }
  } catch (err) {
    console.warn('Profile sync failed', err);
  }
  saveUser();
  updateUserUI();
  toast('Profil berhasil disimpan', 'success');
  renderProfile();
}

// ============================================================
//  SETTINGS
// ============================================================

function renderSettings() {
  const el = document.getElementById('settings-content');
  if (!el) return;
  const s = userSettings;
  el.innerHTML = `
    <h1>${t('settings.title')}</h1>
    <p class="page-sub">${t('settings.sub')}</p>
    <div class="content-card">
      <h3>${t('settings.notif')}</h3>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.emailNotif')}</div><div class="setting-desc">${t('settings.emailNotifDesc')}</div></div>
        <button class="toggle ${s.emailNotif ? 'on' : ''}" onclick="toggleSetting('emailNotif', this)"></button>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.orderNotif')}</div><div class="setting-desc">${t('settings.orderNotifDesc')}</div></div>
        <button class="toggle ${s.orderNotif ? 'on' : ''}" onclick="toggleSetting('orderNotif', this)"></button>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.promoNotif')}</div><div class="setting-desc">${t('settings.promoNotifDesc')}</div></div>
        <button class="toggle ${s.promoNotif ? 'on' : ''}" onclick="toggleSetting('promoNotif', this)"></button>
      </div>
    </div>
    <div class="content-card">
      <h3>${t('settings.display')}</h3>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.darkMode')}</div><div class="setting-desc">${t('settings.darkModeDesc')}</div></div>
        <button class="toggle ${s.darkMode ? 'on' : ''}" onclick="toggleSetting('darkMode', this); applyTheme()"></button>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings.language')}</div><div class="setting-desc">${t('settings.languageDesc')}</div></div>
        <select id="set-lang" onchange="changeLanguage(this.value)"
          style="border:1px solid var(--border);border-radius:var(--r);padding:0.35rem 0.6rem;font-size:13px;background:var(--surface);color:var(--text)">
          <option value="id" ${s.language==='id'?'selected':''}>Bahasa Indonesia (Rp)</option>
          <option value="en" ${s.language==='en'?'selected':''}>English ($)</option>
        </select>
      </div>
    </div>
    ${currentUser ? `
    <div class="content-card">
      <h3>Ubah Kata Sandi</h3>
      <div class="form-group"><label>Kata sandi saat ini</label>
        <input type="password" id="cp-current" placeholder="••••••••"></div>
      <div class="form-row">
        <div class="form-group"><label>Kata sandi baru</label>
          <input type="password" id="cp-new" placeholder="Min 4 karakter"></div>
        <div class="form-group"><label>Konfirmasi</label>
          <input type="password" id="cp-confirm" placeholder="Ulangi"></div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="doChangePassword()">Simpan Kata Sandi</button>
      <p style="font-size:12px;color:var(--text3);margin-top:0.5rem">Setelah berhasil, kamu akan diminta masuk ulang.</p>
    </div>` : ''}
    <div class="content-card">
      <h3>Akun</h3>
      <p style="font-size:13px;color:var(--text2);margin-bottom:1rem">Status API: ${apiOnline ? '<span style="color:var(--success)">Online</span>' : '<span style="color:var(--text3)">Offline (data lokal)</span>'}</p>
      ${currentUser ? `<button class="btn btn-sm" style="background:var(--danger);color:#fff" onclick="doLogout()">Keluar dari akun</button>` :
        `<button class="btn btn-primary btn-sm" onclick="showPage('login')">Masuk</button>`}
    </div>`;
}

function toggleSetting(key, btn) {
  userSettings[key] = !userSettings[key];
  btn.classList.toggle('on', userSettings[key]);
  localStorage.setItem('ysi-settings', JSON.stringify(userSettings));
  toast('Pengaturan disimpan');
}

function changeLanguage(lang) {
  userSettings.language = lang;
  localStorage.setItem('ysi-settings', JSON.stringify(userSettings));
  document.documentElement.lang = lang;
  applyI18n();
  const c = getCurrency();
  toast(`${t('settings.language')}: ${c.code}`, 'success');
  updatePriceFilterPlaceholders();
  const active = document.querySelector('.page.active');
  const name = active?.id?.replace('page-', '');
  if (name) showPage(name);
  else renderProducts();
}

function applyTheme() {
  const dark = !!userSettings.darkMode;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('ysi-settings', JSON.stringify(userSettings));
}

function updatePriceFilterPlaceholders() {
  const c = getCurrency();
  const minEl = document.getElementById('price-min');
  const maxEl = document.getElementById('price-max');
  if (minEl) minEl.placeholder = c.code === 'IDR' ? 'Min Rp' : 'Min $';
  if (maxEl) maxEl.placeholder = c.code === 'IDR' ? 'Maks Rp' : 'Max $';
}

// ============================================================
//  HELP
// ============================================================

function renderHelp() {
  const el = document.getElementById('help-content');
  if (!el) return;
  const faqs = [
    { q: 'Bagaimana cara memesan?', a: 'Pilih produk → Tambah ke keranjang → Lanjut ke Pembayaran. Isi alamat, pilih kurir, buat pesanan, lalu selesaikan pembayaran.' },
    { q: 'Metode pembayaran apa saja?', a: 'Jika Midtrans aktif: VA bank, QRIS, e-wallet (GoPay/OVO/ShopeePay), kartu kredit/debit. Tanpa key gateway, tersedia mode bayar mock untuk demo.' },
    { q: 'Bagaimana status pembayaran dikonfirmasi?', a: 'Setelah bayar di Midtrans, webhook menandai pesanan sebagai dibayar. Di halaman Pesanan Saya status berubah menjadi lunas; kamu juga bisa menekan Bayar lagi jika masih pending.' },
    { q: 'Berapa lama pengiriman?', a: 'Estimasi 2–5 hari kerja Jabodetabek, 3–7 hari luar kota. Gratis ongkir di atas ambang batas (setara ~$75 / Rp1.200.000 tergantung kurs di pengaturan).' },
    { q: 'Bagaimana melacak / membatalkan pesanan?', a: 'Buka Pesanan Saya → Lacak untuk timeline. Batalkan hanya jika belum dikirim. Setelah terkirim, gunakan Return/Refund.' },
    { q: 'Bagaimana menjadi penjual?', a: 'Menu Jual / Jadi Penjual → daftar dengan peran penjual → kelola produk di Dasbor. Admin dapat meninjau KYC dan menangguhkan toko.' },
    { q: 'Promo & kode diskon?', a: 'Di keranjang atau checkout, masukkan kode promo (contoh demo: FORGE10, HEMAT20, SAVE10) lalu terapkan sebelum membuat pesanan.' },
    { q: 'Bagaimana menghubungi dukungan?', a: 'Email support@yourshop.id · formulir di halaman Kontak · jam kerja Senin–Jumat 09.00–18.00 WIB.' },
  ];
  el.innerHTML = `
    <h1>Bantuan & FAQ</h1>
    <p class="page-sub">Jawaban cepat seputar belanja, bayar, kirim, dan berjualan</p>
    <div class="content-card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem;margin-bottom:1rem">
      <button class="tbl-btn" style="justify-content:center" onclick="showPage('orders')">Pesanan Saya</button>
      <button class="tbl-btn" style="justify-content:center" onclick="showPage('payment')">Pembayaran</button>
      <button class="tbl-btn" style="justify-content:center" onclick="showPage('become-seller')">Jadi Penjual</button>
      <button class="tbl-btn" style="justify-content:center" onclick="showPage('contact')">Kontak</button>
    </div>
    <div class="content-card" style="padding:0 1.5rem">
      ${faqs.map((f,i) => `
        <div class="faq-item" id="faq-${i}">
          <button class="faq-q" onclick="this.parentElement.classList.toggle('open')">
            ${f.q}<span>▼</span>
          </button>
          <div class="faq-a">${f.a}</div>
        </div>`).join('')}
    </div>
    <div class="content-card" style="text-align:center">
      <h3>Masih butuh bantuan?</h3>
      <p style="color:var(--text2);font-size:14px;margin-bottom:1rem">Kirim pesan lewat formulir kontak — kami akan menindaklanjuti.</p>
      <button class="btn btn-primary" onclick="showPage('contact')">Hubungi Dukungan</button>
    </div>`;
}

// ============================================================
//  DEALS
// ============================================================

function renderDeals() {
  const el = document.getElementById('deals-content');
  if (!el) return;
  const deals = adminProducts.filter(p => p.oldPrice && p.oldPrice > p.price);
  el.innerHTML = `
    <div class="deals-banner">
      <h2>🔥 Deals & Diskon</h2>
      <p>Produk dengan harga spesial — buruan sebelum kehabisan!</p>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h1 style="margin:0;font-size:1.25rem">${deals.length} produk diskon</h1>
      <button class="tbl-btn" onclick="showPage('store')">Lihat semua produk →</button>
    </div>
    ${!deals.length
      ? `<div class="empty-cart"><p>Tidak ada deals saat ini</p></div>`
      : `<div class="product-grid">${deals.map(p => productCardHTML(p)).join('')}</div>`}`;
}

// ============================================================
//  CHECKOUT / PAYMENT
// ============================================================

function selectPayMethod(method, el) {
  checkoutPayMethod = method;
  document.querySelectorAll('.pay-method').forEach(m => m.classList.remove('selected'));
  el.classList.add('selected');
}

function renderCheckout() {
  const el = document.getElementById('checkout-content');
  if (!el) return;
  if (!cart.length) {
    el.innerHTML = `<div class="empty-cart"><div class="empty-icon">🛒</div><p>Keranjang kosong</p>
      <button class="btn btn-primary" onclick="showPage('store')">Mulai Belanja</button></div>`;
    return;
  }
  const { subtotal, discount, shipping, tax, total } = calcCartTotals();
  const afterDisc = subtotal - discount;
  const addr = currentUser?.address || '';
  const phone = currentUser?.phone || '';

  el.innerHTML = `
    <h1>Checkout</h1>
    <p class="page-sub">Alamat, kurir, dan metode bayar · ${currencyLabel()}</p>
    <div class="checkout-layout">
      <div>
        <div class="content-card">
          <h3>Alamat Pengiriman</h3>
          <div class="form-row">
            <div class="form-group"><label>Nama Penerima</label>
              <input type="text" id="co-name" value="${currentUser?.name || ''}"></div>
            <div class="form-group"><label>Telepon</label>
              <input type="tel" id="co-phone" value="${phone}" placeholder="08xxxxxxxxxx"></div>
          </div>
          <div class="form-group"><label>Alamat Lengkap</label>
            <textarea id="co-address" rows="2" placeholder="Jalan, nomor, RT/RW, kelurahan">${addr}</textarea></div>
          <div class="form-row">
            <div class="form-group"><label>Kota</label>
              <input type="text" id="co-city" placeholder="Jakarta"></div>
            <div class="form-group"><label>Kode Pos</label>
              <input type="text" id="co-zip" placeholder="12345"></div>
          </div>
        </div>
        <div class="content-card">
          <h3>Kurir Pengiriman</h3>
          ${SHIPPING_OPTIONS.map(s => {
            const prev = checkoutShipMethod;
            checkoutShipMethod = s.id;
            const thisCost = getShippingCost(afterDisc);
            checkoutShipMethod = prev;
            return `<div class="pay-method ship-method ${prev===s.id?'selected':''}" onclick="selectShipMethod('${s.id}', this)">
              <input type="radio" name="ship" ${prev===s.id?'checked':''}>
              <span style="flex:1">${s.name} <small style="color:var(--text3)">· ${s.eta}</small></span>
              <strong>${thisCost===0?'Gratis':formatMoney(thisCost)}</strong>
            </div>`;
          }).join('')}
        </div>
        <div class="content-card">
          <h3>Metode Pembayaran</h3>
          <div class="pay-method ${checkoutPayMethod==='transfer'?'selected':''}" onclick="selectPayMethod('transfer', this)">
            <input type="radio" name="pay" ${checkoutPayMethod==='transfer'?'checked':''}> <span>🏦 Transfer Bank</span></div>
          <div class="pay-method ${checkoutPayMethod==='ewallet'?'selected':''}" onclick="selectPayMethod('ewallet', this)">
            <input type="radio" name="pay" ${checkoutPayMethod==='ewallet'?'checked':''}> <span>📱 E-Wallet (OVO / GoPay / Dana)</span></div>
          <div class="pay-method ${checkoutPayMethod==='card'?'selected':''}" onclick="selectPayMethod('card', this)">
            <input type="radio" name="pay" ${checkoutPayMethod==='card'?'checked':''}> <span>💳 Kartu Kredit / Debit</span></div>
        </div>
      </div>
      <div>
        <div class="content-card" style="position:sticky;top:100px">
          <h3>Ringkasan</h3>
          ${cart.map(c => {
            const p = adminProducts.find(x => x.id === c.id);
            if (!p) return '';
            return `<div class="summary-row"><span>${p.emoji} ${p.name} ×${c.qty}</span><span>${formatMoney(p.price*c.qty)}</span></div>`;
          }).join('')}
          <div class="summary-row" style="margin-top:0.75rem"><span>Subtotal</span><span>${formatMoney(subtotal)}</span></div>
          ${discount > 0 ? `<div class="summary-row" style="color:var(--success)"><span>Diskon</span><span>−${formatMoney(discount)}</span></div>` : ''}
          <div class="summary-row"><span>Ongkir</span><span>${shipping===0?'Gratis':formatMoney(shipping)}</span></div>
          <div class="summary-row"><span>Pajak</span><span>${formatMoney(tax)}</span></div>
          <div class="summary-row total"><span>Total</span><span>${formatMoney(total)}</span></div>
          <button class="checkout-btn" onclick="placeOrder()">Buat Pesanan & Bayar</button>
          <button class="tbl-btn" style="width:100%;margin-top:0.5rem;justify-content:center" onclick="showPage('cart')">← Kembali ke Keranjang</button>
        </div>
      </div>
    </div>`;
}

// ============================================================
//  HELPERS
// ============================================================

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================
//  i18n
// ============================================================
const I18N = {
  id: {
    'product.addCart': '+ Keranjang',
    'product.soldOut': 'Habis',
    'compare.title': 'Bandingkan',
    'compare.open': 'Buka',
    'compare.clear': 'Hapus',
    'compare.add': 'Bandingkan',
    'compare.full': 'Maksimal 4 produk',
    'share.title': 'Bagikan',
    'share.copied': 'Link disalin',
    'settings.title': 'Pengaturan',
    'settings.sub': 'Preferensi akun dan notifikasi',
    'settings.notif': 'Notifikasi',
    'settings.emailNotif': 'Email notifikasi',
    'settings.emailNotifDesc': 'Terima update via email',
    'settings.orderNotif': 'Update pesanan',
    'settings.orderNotifDesc': 'Status pengiriman & konfirmasi',
    'settings.promoNotif': 'Promo & deals',
    'settings.promoNotifDesc': 'Penawaran khusus dan diskon',
    'settings.display': 'Tampilan',
    'settings.darkMode': 'Mode gelap',
    'settings.darkModeDesc': 'Tema gelap untuk kenyamanan malam',
    'settings.language': 'Bahasa',
    'settings.languageDesc': 'Bahasa antarmuka & mata uang',
    'footer.tag': 'Marketplace terbuka untuk semua.',
    'footer.legal': 'Legal',
    'footer.terms': 'Syarat & Ketentuan',
    'footer.privacy': 'Kebijakan Privasi',
    'footer.contact': 'Kontak',
    'footer.help': 'Bantuan',
    'footer.helpCenter': 'Pusat Bantuan',
    'footer.deals': 'Promo',
    'footer.account': 'Akun',
    'footer.login': 'Masuk',
    'footer.sell': 'Jadi Penjual',
    'footer.rights': 'Hak cipta dilindungi',
    'legal.termsTitle': 'Syarat & Ketentuan',
    'legal.privacyTitle': 'Kebijakan Privasi',
    'legal.contactTitle': 'Hubungi Kami',
  },
  en: {
    'product.addCart': '+ Cart',
    'product.soldOut': 'Sold out',
    'compare.title': 'Compare',
    'compare.open': 'Open',
    'compare.clear': 'Clear',
    'compare.add': 'Compare',
    'compare.full': 'Max 4 products',
    'share.title': 'Share',
    'share.copied': 'Link copied',
    'settings.title': 'Settings',
    'settings.sub': 'Account and notification preferences',
    'settings.notif': 'Notifications',
    'settings.emailNotif': 'Email notifications',
    'settings.emailNotifDesc': 'Receive updates by email',
    'settings.orderNotif': 'Order updates',
    'settings.orderNotifDesc': 'Shipping status & confirmation',
    'settings.promoNotif': 'Promos & deals',
    'settings.promoNotifDesc': 'Special offers and discounts',
    'settings.display': 'Display',
    'settings.darkMode': 'Dark mode',
    'settings.darkModeDesc': 'Dark theme for night comfort',
    'settings.language': 'Language',
    'settings.languageDesc': 'Interface language & currency',
    'footer.tag': 'Open marketplace for everyone.',
    'footer.legal': 'Legal',
    'footer.terms': 'Terms of Service',
    'footer.privacy': 'Privacy Policy',
    'footer.contact': 'Contact',
    'footer.help': 'Help',
    'footer.helpCenter': 'Help Center',
    'footer.deals': 'Deals',
    'footer.account': 'Account',
    'footer.login': 'Sign in',
    'footer.sell': 'Sell on YourShop',
    'footer.rights': 'All rights reserved',
    'legal.termsTitle': 'Terms of Service',
    'legal.privacyTitle': 'Privacy Policy',
    'legal.contactTitle': 'Contact Us',
  },
};

function t(key) {
  const lang = userSettings?.language || 'id';
  return (I18N[lang] && I18N[lang][key]) || (I18N.id[key]) || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
}

// ============================================================
//  COMPARE + SHARE
// ============================================================
let compareList = JSON.parse(localStorage.getItem('ysi-compare') || '[]');

function toggleCompare(id) {
  id = Number(id);
  const i = compareList.indexOf(id);
  if (i >= 0) compareList.splice(i, 1);
  else {
    if (compareList.length >= 4) { toast(t('compare.full'), 'error'); return; }
    compareList.push(id);
  }
  localStorage.setItem('ysi-compare', JSON.stringify(compareList));
  renderCompareBar();
  renderProducts?.();
  renderFeatured?.();
}

function clearCompare() {
  compareList = [];
  localStorage.setItem('ysi-compare', '[]');
  renderCompareBar();
  renderProducts?.();
}

function renderCompareBar() {
  const bar = document.getElementById('compare-bar');
  const slots = document.getElementById('compare-slots');
  if (!bar || !slots) return;
  if (!compareList.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  slots.innerHTML = compareList.map(id => {
    const p = adminProducts.find(x => x.id === id);
    if (!p) return '';
    return `<span class="compare-chip">${p.emoji || '📦'} ${p.name.slice(0, 22)}
      <button onclick="toggleCompare(${id})" title="×">×</button></span>`;
  }).join('');
}

function openCompare() {
  if (compareList.length < 2) { toast('Pilih minimal 2 produk', 'error'); return; }
  const items = compareList.map(id => adminProducts.find(x => x.id === id)).filter(Boolean);
  const modal = document.getElementById('modal-content');
  if (!modal) return;
  const cols = items.map(p => `
    <div style="flex:1;min-width:140px;border:1px solid var(--border);border-radius:var(--r);padding:0.75rem;background:var(--surface2)">
      <div style="font-size:2rem;text-align:center">${p.emoji || '📦'}</div>
      <div style="font-weight:600;font-size:13px;margin:0.4rem 0">${p.name}</div>
      <div style="color:var(--accent);font-weight:700">${formatMoney(p.price)}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:0.35rem">⭐ ${p.rating} · ${p.seller}</div>
      <div style="font-size:12px;margin-top:0.25rem">${p.category || ''}</div>
      <div style="font-size:12px">${p.stock ? t('product.addCart') : t('product.soldOut')}</div>
      <button class="btn btn-primary btn-sm" style="width:100%;margin-top:0.5rem" onclick="closeModal();showDetail(${p.id})">Detail</button>
    </div>`).join('');
  modal.innerHTML = `<h2>${t('compare.title')}</h2>
    <div style="display:flex;gap:0.75rem;overflow-x:auto;margin-top:1rem">${cols}</div>`;
  document.getElementById('track-modal').classList.add('open');
}

function shareProduct(id) {
  const p = adminProducts.find(x => x.id === Number(id));
  if (!p) return;
  const url = `${location.origin}${location.pathname}?product=${p.id}`;
  const text = `${p.name} — ${formatMoney(p.price)} | YourShop.Id`;
  if (navigator.share) {
    navigator.share({ title: p.name, text, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast(t('share.copied'), 'success'));
  } else {
    prompt('Copy link:', url);
  }
}

// ============================================================
//  LEGAL PAGES
// ============================================================
function renderTerms() {
  const el = document.getElementById('terms-content');
  if (!el) return;
  el.innerHTML = `<h1>${t('legal.termsTitle')}</h1>
    <p class="page-sub">Ketentuan penggunaan platform YourShop.Id</p>
    <div class="content-card" style="line-height:1.7;font-size:14px;color:var(--text2)">
      <p><strong>1. Penerimaan.</strong> Dengan mengakses atau memakai YourShop.Id Anda menyetujui syarat ini.</p>
      <p><strong>2. Akun.</strong> Anda wajib menjaga kerahasiaan kredensial. Aktivitas atas nama akun menjadi tanggung jawab Anda.</p>
      <p><strong>3. Transaksi & pembayaran.</strong> Pesanan mengikat setelah pembayaran dikonfirmasi (gateway Midtrans atau status lunas). Komisi platform dapat dipotong dari penjual sesuai tarif yang berlaku.</p>
      <p><strong>4. Pengiriman & pengembalian.</strong> Estimasi kirim bersifat indikatif. Pembatalan sebelum pengiriman diizinkan; setelah terkirim gunakan alur return/refund.</p>
      <p><strong>5. Konten penjual.</strong> Dilarang menjual barang ilegal, palsu, atau melanggar hak pihak ketiga. Platform dapat menangguhkan toko.</p>
      <p><strong>6. Batasan tanggung jawab.</strong> Platform menyediakan fasilitas marketplace; sengketa barang antara pembeli dan penjual diselesaikan sesuai kebijakan dukungan.</p>
      <p style="margin-top:1rem;font-size:12px;color:var(--text3)">Terakhir diperbarui: November 2026 · <a href="#" onclick="showPage('privacy');return false">Kebijakan Privasi</a> · <a href="#" onclick="showPage('contact');return false">Kontak</a></p>
    </div>`;
}
function renderPrivacy() {
  const el = document.getElementById('privacy-content');
  if (!el) return;
  el.innerHTML = `<h1>${t('legal.privacyTitle')}</h1>
    <p class="page-sub">Bagaimana kami menangani data Anda</p>
    <div class="content-card" style="line-height:1.7;font-size:14px;color:var(--text2)">
      <p><strong>Data yang dikumpulkan:</strong> email, nama, telepon, alamat pengiriman, riwayat pesanan, preferensi (tema/bahasa), dan log teknis.</p>
      <p><strong>Pembayaran:</strong> data kartu/rekening diproses oleh penyedia pembayaran (Midtrans); kami menyimpan status transaksi, referensi, dan nominal — bukan nomor kartu penuh.</p>
      <p><strong>Penggunaan:</strong> memproses pesanan, keamanan akun, notifikasi, dan peningkatan layanan. Data tidak dijual ke pihak ketiga.</p>
      <p><strong>Penyimpanan:</strong> di server aplikasi (JSON/SQLite) dengan kontrol akses. Cookie/localStorage dipakai untuk sesi & preferensi di perangkat Anda.</p>
      <p><strong>Hak Anda:</strong> minta akses, koreksi, atau penghapusan melalui halaman Kontak atau email support@yourshop.id.</p>
      <p style="margin-top:1rem;font-size:12px;color:var(--text3)">Terakhir diperbarui: November 2026</p>
    </div>`;
}
function renderContact() {
  const el = document.getElementById('contact-content');
  if (!el) return;
  const prefillName = currentUser?.name || '';
  const prefillEmail = currentUser?.email || '';
  el.innerHTML = `<h1>${t('legal.contactTitle')}</h1>
    <p class="page-sub">Tim dukungan YourShop.Id</p>
    <div class="content-card">
      <p style="margin-bottom:1rem;color:var(--text2);font-size:14px;line-height:1.6">
        Email: <a href="mailto:support@yourshop.id">support@yourshop.id</a><br>
        Jam kerja: Senin–Jumat 09.00–18.00 WIB<br>
        Topik: pesanan, pembayaran, akun penjual, KYC
      </p>
      <div class="form-group"><label>Nama</label><input id="contact-name" type="text" value="${prefillName.replace(/"/g,'&quot;')}"></div>
      <div class="form-group"><label>Email</label><input id="contact-email" type="email" value="${prefillEmail.replace(/"/g,'&quot;')}"></div>
      <div class="form-group"><label>Topik</label>
        <select id="contact-topic" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text)">
          <option value="order">Pesanan / pengiriman</option>
          <option value="payment">Pembayaran</option>
          <option value="seller">Akun penjual / KYC</option>
          <option value="other">Lainnya</option>
        </select>
      </div>
      <div class="form-group"><label>Pesan</label><textarea id="contact-msg" rows="4" style="width:100%;border:1px solid var(--border);border-radius:var(--r);padding:0.5rem;background:var(--bg);color:var(--text)" placeholder="Jelaskan kendala Anda..."></textarea></div>
      <button class="btn btn-primary" onclick="submitContact()">Kirim Pesan</button>
      <p id="contact-status" style="font-size:12px;color:var(--text3);margin-top:0.75rem"></p>
    </div>`;
}

function submitContact() {
  const name = document.getElementById('contact-name')?.value?.trim() || '';
  const email = document.getElementById('contact-email')?.value?.trim() || '';
  const topic = document.getElementById('contact-topic')?.value || 'other';
  const msg = document.getElementById('contact-msg')?.value?.trim() || '';
  const status = document.getElementById('contact-status');
  if (!name || !email || !msg) {
    toast('Lengkapi nama, email, dan pesan', 'error');
    if (status) status.textContent = 'Form belum lengkap.';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Format email tidak valid', 'error');
    return;
  }
  const ticket = {
    id: 'T-' + Date.now().toString(36).toUpperCase(),
    name, email, topic, msg,
    at: new Date().toISOString(),
    userId: currentUser?.id || null,
  };
  try {
    const prev = JSON.parse(localStorage.getItem('ysi-contact-tickets') || '[]');
    prev.unshift(ticket);
    localStorage.setItem('ysi-contact-tickets', JSON.stringify(prev.slice(0, 50)));
  } catch (_) {}
  pushNotif('📩', 'Pesan terkirim', `Tiket ${ticket.id} — kami akan meninjau.`);
  toast('Pesan tercatat. Tiket ' + ticket.id, 'success');
  if (status) status.textContent = 'Tersimpan sebagai ' + ticket.id + ' (demo lokal).';
  const ta = document.getElementById('contact-msg');
  if (ta) ta.value = '';
}

function wireAssets() {
  if (typeof YourShopAssets === 'undefined') return;
  try {
    // Favicon
    if (YourShopAssets.FAVICON_SVG) {
      let link = document.querySelector("link[rel='icon']");
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(YourShopAssets.FAVICON_SVG);
    }
    // Logo in nav if empty
    const navLogo = document.querySelector('.nav-logo, .logo-text, #footer-logo');
    if (navLogo && YourShopAssets.LOGO_SVG && !navLogo.querySelector('img')) {
      // keep text brand; optional mark
    }
    // Expose placeholders for product images without imageUrl
    window.ysiPlaceholder = (cat) => {
      const map = YourShopAssets.CATEGORY_PLACEHOLDERS || {};
      return map[cat] || map.default || '';
    };
  } catch (e) { console.warn('assets wire', e); }
}

// ============================================================
//  INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  applyI18n();
  wireAssets();
  renderCompareBar();
  updateCartCount();
  updateUserUI();
  updateNotifBadge();
  updatePriceFilterPlaceholders();
  initHeroCarousel();
  await loadInitialData();
  await validateSession();

  // Deep link ?product=id
  const params = new URLSearchParams(location.search);
  if (params.get('product')) {
    const id = Number(params.get('product'));
    if (id) setTimeout(() => showDetail(id), 300);
  }

  document.getElementById('track-modal')?.addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });
});
