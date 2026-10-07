// Sizes are CSS-pixel viewports (what media queries see), not physical resolutions.
// inset = [top, right, bottom, left] areas the page does not cover. The bottom stays 0 on
// gesture phones: the page runs under the home indicator, which floats on top.
// rim = width of the coloured metal band inside the bezel.
export const FRAMES = {
  island: { os: 'ios', bezel: 12, rim: 4, radius: 66, screenRadius: 55, inset: { portrait: [54, 0, 0, 0], landscape: [0, 59, 0, 59] } },
  notch: { os: 'ios', bezel: 13, rim: 4, radius: 60, screenRadius: 47, inset: { portrait: [47, 0, 0, 0], landscape: [0, 47, 0, 47] } },
  home: { os: 'ios', bezel: [74, 14, 74, 14], rim: 4, radius: 56, screenRadius: 3, inset: { portrait: [20, 0, 0, 0], landscape: [0, 0, 0, 0] } },
  punch: { os: 'android', bezel: 10, rim: 3, radius: 46, screenRadius: 38, inset: { portrait: [32, 0, 0, 0], landscape: [24, 0, 0, 0] } },
  ipad: { os: 'ipad', bezel: 20, rim: 4, radius: 40, screenRadius: 22, inset: { portrait: [24, 0, 0, 0], landscape: [24, 0, 0, 0] } },
  tab: { os: 'androidTablet', bezel: 20, rim: 3, radius: 30, screenRadius: 14, inset: { portrait: [28, 0, 0, 0], landscape: [28, 0, 0, 0] } },
  // Desktops: no status bar or keyboard, never rotated. `base` is drawn under the screen
  // (laptop deck or monitor stand) and adds `baseH` to the device's height.
  macbook: { os: 'desktop', bezel: 22, rim: 3, radius: 22, screenRadius: 8, inset: { portrait: [0, 0, 0, 0], landscape: [0, 0, 0, 0] }, base: 'laptop', baseH: 30 },
  laptop: { os: 'desktop', bezel: 18, rim: 3, radius: 14, screenRadius: 4, inset: { portrait: [0, 0, 0, 0], landscape: [0, 0, 0, 0] }, base: 'laptop', baseH: 26 },
  monitor: { os: 'desktop', bezel: [18, 18, 70, 18], rim: 3, radius: 18, screenRadius: 4, inset: { portrait: [0, 0, 0, 0], landscape: [0, 0, 0, 0] }, base: 'stand', baseH: 190 },
};

// Rim colours: a = lit side, b = shaded side.
export const FINISHES = [
  { id: 'black', name: 'Black', a: '#b4b0b8', b: '#3b3a3f' },
  { id: 'deep-purple', name: 'Deep Purple', a: '#d3bfe0', b: '#5d4a72' },
  { id: 'black-titanium', name: 'Black Titanium', a: '#55555a', b: '#1a1a1c' },
  { id: 'natural-titanium', name: 'Natural Titanium', a: '#d6d0c6', b: '#7f7970' },
  { id: 'white-titanium', name: 'White / Silver', a: '#f7f6f2', b: '#b9b8b3' },
  { id: 'desert-titanium', name: 'Desert Titanium', a: '#e2cfb3', b: '#958066' },
  { id: 'cosmic-orange', name: 'Cosmic Orange', a: '#f8a463', b: '#b0501a' },
  { id: 'deep-blue', name: 'Deep Blue', a: '#5a6c92', b: '#18213a' },
  { id: 'obsidian', name: 'Obsidian (Android)', a: '#3c3d42', b: '#0d0d0f' },
  { id: 'porcelain', name: 'Porcelain (Android)', a: '#f3eee6', b: '#c4bcae' },
  { id: 'red', name: 'Red', a: '#ff5a5f', b: '#9e1b22' },
  { id: 'crimson', name: 'Crimson', a: '#c0263f', b: '#5c0d1c' },
  { id: 'green', name: 'Green', a: '#7fd17f', b: '#2f7a3a' },
  { id: 'mint', name: 'Mint', a: '#c9f2df', b: '#5fae8c' },
  { id: 'pink', name: 'Pink', a: '#ffc2dc', b: '#d85a95' },
  { id: 'rose-gold', name: 'Rose Gold', a: '#f6d3c5', b: '#b5776a' },
  { id: 'yellow', name: 'Yellow', a: '#fff1a8', b: '#d1a91f' },
  { id: 'sky-blue', name: 'Sky Blue', a: '#c4e3ff', b: '#4f8fd1' },
  { id: 'midnight-green', name: 'Midnight Green', a: '#5a7563', b: '#1b2a22' },
  { id: 'lavender', name: 'Lavender', a: '#e3d7ff', b: '#8d79c9' },
];
// Default finish is the 'black' preset; a, b and angle only seed the custom gradient editor.
export const DEFAULT_FINISH = { id: 'black', a: '#c084fc', b: '#db2777', angle: 135 };

export function finishColors(finish) {
  const preset = FINISHES.find((f) => f.id === finish.id);
  return preset ? { a: preset.a, b: preset.b, angle: 135 } : { a: finish.a, b: finish.b, angle: finish.angle };
}

export const GROUPS = [
  { id: 'iphone', label: 'Apple iPhone' },
  { id: 'android', label: 'Android' },
  { id: 'tablet', label: 'Tablets' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'custom', label: 'Custom' },
];

export const DEVICES = [
  { id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max', group: 'iphone', frame: 'island', w: 440, h: 956 },
  { id: 'iphone-17-pro', name: 'iPhone 17 Pro', group: 'iphone', frame: 'island', w: 402, h: 874 },
  { id: 'iphone-air', name: 'iPhone Air', group: 'iphone', frame: 'island', w: 420, h: 912 },
  { id: 'iphone-17', name: 'iPhone 17', group: 'iphone', frame: 'island', w: 402, h: 874 },
  { id: 'iphone-16-plus', name: 'iPhone 16 Plus', group: 'iphone', frame: 'island', w: 430, h: 932 },
  { id: 'iphone-16e', name: 'iPhone 16e', group: 'iphone', frame: 'notch', w: 390, h: 844 },
  { id: 'iphone-15', name: 'iPhone 15', group: 'iphone', frame: 'island', w: 393, h: 852 },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', group: 'iphone', frame: 'notch', w: 375, h: 812 },
  { id: 'iphone-se', name: 'iPhone SE', group: 'iphone', frame: 'home', w: 375, h: 667 },

  { id: 'pixel-10-pro', name: 'Pixel 10 Pro', group: 'android', frame: 'punch', w: 410, h: 914 },
  { id: 'pixel-8', name: 'Pixel 8', group: 'android', frame: 'punch', w: 412, h: 915 },
  { id: 'galaxy-s25-ultra', name: 'Galaxy S25 Ultra', group: 'android', frame: 'punch', w: 412, h: 891 },
  { id: 'galaxy-s25', name: 'Galaxy S25', group: 'android', frame: 'punch', w: 360, h: 780 },
  { id: 'galaxy-a54', name: 'Galaxy A54', group: 'android', frame: 'punch', w: 412, h: 915 },

  { id: 'ipad-mini', name: 'iPad mini', group: 'tablet', frame: 'ipad', w: 744, h: 1133 },
  { id: 'ipad-air-11', name: 'iPad Air 11"', group: 'tablet', frame: 'ipad', w: 820, h: 1180 },
  { id: 'ipad-pro-13', name: 'iPad Pro 13"', group: 'tablet', frame: 'ipad', w: 1032, h: 1376 },
  { id: 'galaxy-tab-s9', name: 'Galaxy Tab S9', group: 'tablet', frame: 'tab', w: 800, h: 1280 },

  { id: 'macbook-pro-14', name: 'MacBook Pro 14"', group: 'desktop', frame: 'macbook', w: 1512, h: 982 },
  { id: 'windows-laptop', name: 'Windows laptop 15"', group: 'desktop', frame: 'laptop', w: 1536, h: 864 },
  { id: 'monitor-1080', name: 'Desktop monitor', group: 'desktop', frame: 'monitor', w: 1920, h: 1080 },
];

export const DEFAULT_DEVICE = 'iphone-17-pro';
export const DEFAULT_COMPARE = ['iphone-17-pro', 'pixel-10-pro', 'ipad-air-11'];

export const CUSTOM_TYPES = {
  iphone: { label: 'iPhone style', frame: 'island' },
  android: { label: 'Android style', frame: 'punch' },
  tablet: { label: 'Tablet', frame: 'ipad' },
};

const sides = (v) => (Array.isArray(v) ? v : [v, v, v, v]);

export function geometry(device, orientation, showFrame) {
  const frame = FRAMES[device.frame];
  // Desktops are always shown as they are (landscape by nature).
  const land = orientation === 'landscape' && frame.os !== 'desktop';
  const [w, h] = land ? [device.h, device.w] : [device.w, device.h];
  const b = sides(frame.bezel);
  let bezel = land ? [b[3], b[0], b[1], b[2]] : b;
  if (!showFrame) bezel = [0, 0, 0, 0];
  return {
    w,
    h,
    land,
    bezel,
    inset: frame.inset[land ? 'landscape' : 'portrait'],
    outerW: w + bezel[1] + bezel[3],
    outerH: h + bezel[0] + bezel[2],
    radius: showFrame ? frame.radius : frame.screenRadius,
    screenRadius: frame.screenRadius,
    rim: showFrame ? frame.rim : 0,
    base: showFrame ? frame.base || null : null,
    baseH: showFrame ? frame.baseH || 0 : 0,
  };
}
