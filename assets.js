// ============================================================
//  YourShop.Id — assets.js
//  Centralized asset registry: SVG logos, inline images,
//  icon sprites, brand tokens, placeholder generators.
//  Usage: import or include before main.js
// ============================================================

const Assets = (() => {

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

  const LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40" fill="none" role="img" aria-label="YourShop.Id Logo">
  <rect x="2" y="14" width="24" height="22" rx="3" fill="${COLORS.accent}"/>
  <path d="M8 14v-3a6 6 0 0112 0v3" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="10" cy="22" r="1.5" fill="white"/>
  <circle cx="18" cy="22" r="1.5" fill="white"/>
  <text x="34" y="29" font-family="'Syne','Helvetica Neue',sans-serif" font-weight="800" font-size="18" fill="${COLORS.text}" letter-spacing="-0.5">YourShop</text>
  <text x="134" y="29" font-family="'Syne','Helvetica Neue',sans-serif" font-weight="800" font-size="18" fill="${COLORS.accent2}" letter-spacing="-0.5">.Id</text>
</svg>`.trim();

  const LOGO_SVG_DARK = LOGO_SVG;
  const LOGO_SVG_LIGHT = LOGO_SVG.replace(`fill="${COLORS.text}"`, 'fill="#FFFFFF"');

  const FAVICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="${COLORS.accent}"/>
  <rect x="6" y="13" width="20" height="14" rx="2.5" fill="white" opacity="0.92"/>
  <path d="M11 13v-2a5 5 0 0110 0v2" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <circle cx="12.5" cy="19" r="1.5" fill="${COLORS.accent}"/>
  <circle cx="19.5" cy="19" r="1.5" fill="${COLORS.accent}"/>
</svg>`.trim();

  function productPlaceholder(emoji = '📦', bgColor = '#F0EDE6', size = 300) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bgColor}"/>
  <text x="50%" y="55%" font-size="${Math.round(size * 0.38)}" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

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

  const ICONS = {
    cart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>`,
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    user: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    star: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    heart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
    package: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };

  function icon(name, size = 16) {
    const base = ICONS[name];
    if (!base) return '';
    return base.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
  }

  function avatarSVG(name = '?', size = 40) {
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
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

  function injectLogo(selector, variant = 'dark', width = 160) {
    const el = document.querySelector(selector);
    if (!el) return;
    const svg = (variant === 'light') ? LOGO_SVG_LIGHT : LOGO_SVG_DARK;
    el.innerHTML = svg.replace('viewBox="0 0 160 40"', `viewBox="0 0 160 40" width="${width}"`);
  }

  return {
    COLORS, LOGO_SVG, LOGO_SVG_LIGHT, LOGO_SVG_DARK, FAVICON_SVG,
    ICONS, icon, productPlaceholder, getCategoryPlaceholder,
    avatarSVG, injectLogo,
  };

})();

window.Assets = Assets;
