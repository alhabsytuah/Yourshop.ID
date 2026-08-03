// ============================================================
//  YourShop.Id — assets.js
//  Centralized asset registry: SVG logos, inline images,
//  icon sprites, brand tokens, placeholder generators.
//  Usage: import or include before main.js
// ============================================================

const Assets = (() => {

  // ----------------------------------------------------------
  //  BRAND COLORS
  // ----------------------------------------------------------
  const COLORS = {
    accent:   '#0064D2',
    accent2:  '#004E9A',
    bg:       '#F5F5F5',
    surface:  '#FFFFFF',
    text:     '#191919',
    text2:    '#707070',
    success:  '#057642',
    warn:     '#9A6B00',
    danger:   '#C0292A',
  };

  // ----------------------------------------------------------
  //  LOGO — inline SVG (no external request)
  // ----------------------------------------------------------
  const LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40" fill="none" role="img" aria-label="YourShop.Id Logo">
  <!-- Shopping bag icon -->
  <rect x="2" y="14" width="24" height="22" rx="3" fill="${COLORS.accent}"/>
  <path d="M8 14v-3a6 6 0 0112 0v3" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="10" cy="22" r="1.5" fill="white"/>
  <circle cx="18" cy="22" r="1.5" fill="white"/>
  <!-- Wordmark -->
  <text x="34" y="29" font-family="'Syne','Helvetica Neue',sans-serif" font-weight="800" font-size="18" fill="${COLORS.text}" letter-spacing="-0.5">YourShop</text>
  <text x="134" y="29" font-family="'Syne','Helvetica Neue',sans-serif" font-weight="800" font-size="18" fill="${COLORS.accent2}" letter-spacing="-0.5">.Id</text>
</svg>`.trim();

  // Dark variant (for light backgrounds)
  const LOGO_SVG_DARK = LOGO_SVG;

  // Light variant (for dark navbars)
  const LOGO_SVG_LIGHT = LOGO_SVG
    .replace(`fill="${COLORS.text}"`, 'fill="#FFFFFF"');

  // Favicon-sized mark (32×32)
  const FAVICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="${COLORS.accent}"/>
  <rect x="6" y="13" width="20" height="14" rx="2.5" fill="white" opacity="0.92"/>
  <path d="M11 13v-2a5 5 0 0110 0v2" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <circle cx="12.5" cy="19" r="1.5" fill="${COLORS.accent}"/>
  <circle cx="19.5" cy="19" r="1.5" fill="${COLORS.accent}"/>
</svg>`.trim();

  // ----------------------------------------------------------
  //  PRODUCT PLACEHOLDER IMAGES
  //  Returns an inline SVG data-URI for a given emoji + color
  // ----------------------------------------------------------
  function productPlaceholder(emoji = '📦', bgColor = '#F0EDE6', size = 300) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bgColor}"/>
  <text x="50%" y="55%" font-size="${Math.round(size * 0.38)}" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // Pre-generated placeholders for each product category
  const CATEGORY_PLACEHOLDERS = {
    'Elektronik': productPlaceholder('📱', '#EAF0FA'),
    'Fashion':    productPlaceholder('👕', '#FAF0F5'),
    'Rumah':      productPlaceholder('🏠', '#F0FAF2'),
    'Buku':       productPlaceholder('📚', '#FAFAF0'),
    'Olahraga':   productPlaceholder('⚽', '#F0F5FA'),
    'Makanan':    productPlaceholder('🍎', '#FAF5F0'),
    'Seni':       productPlaceholder('🎨', '#F5F0FA'),
    'default':    productPlaceholder('📦', '#F0EDE6'),
  };

  function getCategoryPlaceholder(category) {
    return CATEGORY_PLACEHOLDERS[category] || CATEGORY_PLACEHOLDERS['default'];
  }

  // ----------------------------------------------------------
  //  ICON SPRITES
  //  Returns inline SVG strings for common UI icons.
  //  Usage: document.innerHTML += Assets.icon('cart')
  // ----------------------------------------------------------
  const ICONS = {
    cart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>`,
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    user: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    star: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    heart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
    package: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    arrow_right: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
    arrow_back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    grid: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    store: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    trending_up: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    trending_down: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
    zap: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    refresh: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  };

  function icon(name, size = 16) {
    const base = ICONS[name];
    if (!base) return '';
    return base.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
  }

  // ----------------------------------------------------------
  //  BANNER / HERO BACKGROUND
  //  Procedural SVG pattern — no external images needed
  // ----------------------------------------------------------
  function heroBannerSVG(width = 1200, height = 500) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="rg1" cx="70%" cy="40%" r="60%">
      <stop offset="0%" stop-color="${COLORS.accent}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${COLORS.bg}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="rg2" cx="20%" cy="80%" r="50%">
      <stop offset="0%" stop-color="${COLORS.accent2}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${COLORS.bg}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="${COLORS.border || '#E0DDD5'}" stroke-width="0.6"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="${COLORS.bg}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity="0.5"/>
  <rect width="${width}" height="${height}" fill="url(#rg1)"/>
  <rect width="${width}" height="${height}" fill="url(#rg2)"/>
</svg>`;
  }

  // ----------------------------------------------------------
  //  AVATAR GENERATOR
  //  Creates initials-based avatar SVG data-URI
  // ----------------------------------------------------------
  function avatarSVG(name = '?', size = 40) {
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    // deterministic color from name
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    const bg  = `hsl(${hue},55%,45%)`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size / 2}" fill="${bg}"/>
  <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="'Syne',sans-serif" font-weight="700" font-size="${Math.round(size * 0.38)}" fill="white">${initials}</text>
</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // ----------------------------------------------------------
  //  INJECT LOGO INTO DOM
  //  Usage: Assets.injectLogo('#logo-container', 'light')
  // ----------------------------------------------------------
  function injectLogo(selector, variant = 'dark', width = 160) {
    const el = document.querySelector(selector);
    if (!el) return;
    const svg = (variant === 'light') ? LOGO_SVG_LIGHT : LOGO_SVG_DARK;
    el.innerHTML = svg.replace('viewBox="0 0 160 40"', `viewBox="0 0 160 40" width="${width}"`);
  }

  // ----------------------------------------------------------
  //  BANNER BG INJECT
  //  Usage: Assets.injectBanner('.hero')
  // ----------------------------------------------------------
  function injectBanner(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(heroBannerSVG());
    el.style.backgroundImage = `url("${uri}")`;
    el.style.backgroundSize  = 'cover';
    el.style.backgroundPosition = 'center';
  }

  // ----------------------------------------------------------
  //  PUBLIC API
  // ----------------------------------------------------------
  return {
    COLORS,
    LOGO_SVG,
    LOGO_SVG_LIGHT,
    LOGO_SVG_DARK,
    FAVICON_SVG,
    ICONS,
    icon,
    productPlaceholder,
    getCategoryPlaceholder,
    avatarSVG,
    heroBannerSVG,
    injectLogo,
    injectBanner,
  };

})();

// Make globally accessible
window.Assets = Assets;
