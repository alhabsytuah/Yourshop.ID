// ============================================================
//  YourShop.Id — assets.js
//  Centralized asset registry: SVG logos, inline images,
//  icon sprites, brand tokens, placeholders
// ============================================================
(function (global) {
  'use strict';

  const BRAND = {
    name: 'YourShop.Id',
    accent: '#0064D2',
    accent2: '#004E9A',
    yellow: '#FFD100',
    success: '#057642',
    danger: '#C0292A',
  };

  // Simple SVG logo mark
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="#0064D2"/><text x="16" y="22" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="14" fill="#fff">Y</text></svg>`;

  // Placeholder product image as data-URI style emoji container
  function productPlaceholder(emoji, bg) {
    return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:3rem;background:${bg || '#F0F0F0'}">${emoji || '📦'}</div>`;
  }

  // Category icons (emoji map)
  const CAT_ICONS = {
    Elektronik: '📱',
    Fashion: '👗',
    Rumah: '🏠',
    Buku: '📚',
    Olahraga: '⚽',
    Makanan: '🍜',
    Seni: '🎨',
    All: '🛒',
  };

  // Share / social icons (simple SVG)
  const ICONS = {
    share: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    compare: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>`,
    heart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
  };

  // Dark mode CSS variable overrides (applied by main.js)
  const DARK_VARS = {
    '--bg': '#0F0F0F',
    '--surface': '#1A1A1A',
    '--surface2': '#242424',
    '--border': '#333',
    '--border2': '#444',
    '--text': '#F0F0F0',
    '--text2': '#A0A0A0',
    '--text3': '#707070',
    '--accent-light': '#0A2540',
  };

  global.YourShopAssets = {
    BRAND,
    LOGO_SVG,
    productPlaceholder,
    CAT_ICONS,
    ICONS,
    DARK_VARS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
