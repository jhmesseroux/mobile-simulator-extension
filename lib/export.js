// Shared look for screenshots and videos: background, padding, shadow, ratio, caption.
// Layout sizes are CSS pixels multiplied by `unit` (output pixels per CSS pixel).

export const BACKGROUNDS = [
  { id: 'arc-pink', name: 'Orchid', a: '#ecbbe6', b: '#b86db8', angle: 180 },
  { id: 'grape', name: 'Violet → Pink', a: '#7c3aed', b: '#ec4899', angle: 135 },
  { id: 'lavender', name: 'Lavender', a: '#e0c3fc', b: '#8ec5fc', angle: 135 },
  { id: 'peach', name: 'Peach', a: '#ffecd2', b: '#fcb69f', angle: 135 },
  { id: 'sunset', name: 'Sunset', a: '#f6d365', b: '#fda085', angle: 135 },
  { id: 'mint', name: 'Mint', a: '#d4fc79', b: '#96e6a1', angle: 135 },
  { id: 'sky', name: 'Sky', a: '#89f7fe', b: '#66a6ff', angle: 135 },
  { id: 'ocean', name: 'Ocean', a: '#a1c4fd', b: '#c2e9fb', angle: 180 },
  { id: 'midnight', name: 'Midnight', a: '#302b63', b: '#0f0c29', angle: 160 },
  { id: 'graphite', name: 'Graphite', a: '#434343', b: '#101010', angle: 160 },
];

export const RATIOS = [
  { id: 'auto', label: 'Auto', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
];

const FORMATS = [
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png' },
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp' },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif' },
];

export const DEFAULT_EXPORT = {
  format: 'png',
  background: 'arc-pink', // a BACKGROUNDS id, 'custom', 'solid' or 'none'
  custom: { a: '#7c3aed', b: '#ec4899', angle: 135 },
  solid: '#1e1b2e',
  padding: 72,
  shadow: true,
  shadowStrength: 50,
  ratio: 'auto',
  caption: true,
  captionText: 'JHM',
  frame: true,
};

const DEVICE_GAP = 48;
const CAPTION_SIZE = 26;
const CAPTION_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';

/** items: [{ w, h, radius }] in CSS px. Returns output-pixel boxes; width/height are even (video encoders need it). */
export function computeLayout(opts, items, unit) {
  const gap = DEVICE_GAP * unit;
  const pad = opts.padding * unit;
  const text = opts.caption ? opts.captionText.trim() : '';
  const fontSize = CAPTION_SIZE * unit;
  const captionBlock = text ? fontSize * 2.8 : 0;
  const sizes = items.map((i) => ({ w: i.w * unit, h: i.h * unit, radius: i.radius * unit }));
  const contentW = sizes.reduce((sum, s) => sum + s.w, 0) + gap * (sizes.length - 1);
  const maxH = Math.max(...sizes.map((s) => s.h));
  const contentH = maxH + captionBlock;

  let W = contentW + pad * 2;
  let H = contentH + pad * 2;
  const ratio = RATIOS.find((r) => r.id === opts.ratio)?.value;
  if (ratio) {
    if (W / H < ratio) W = H * ratio;
    else H = W / ratio;
  }
  W = Math.ceil(W / 2) * 2;
  H = Math.ceil(H / 2) * 2;

  let x = (W - contentW) / 2;
  const top = (H - contentH) / 2;
  const boxes = sizes.map((s) => {
    const box = { x, y: top + (maxH - s.h) / 2, ...s };
    x += s.w + gap;
    return box;
  });
  const caption = text ? { text, x: W / 2, y: top + maxH + captionBlock * 0.56, fontSize } : null;
  return { W, H, unit, boxes, caption };
}

function backgroundColors(opts) {
  if (opts.background === 'custom') return opts.custom;
  return BACKGROUNDS.find((b) => b.id === opts.background) || BACKGROUNDS[0];
}

function paintBackground(ctx, W, H, opts) {
  if (opts.background === 'none') return;
  if (opts.background === 'solid') {
    ctx.fillStyle = opts.solid;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const { a, b, angle } = backgroundColors(opts);
  // Same geometry as CSS linear-gradient(<angle>): 0deg points up, 90deg right.
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
  const g = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Any CSS colour (hex, rgb(), named) normalised by a canvas, then read as [r, g, b, a].
let colorCtx = null;
function rgba(color) {
  colorCtx ??= new OffscreenCanvas(1, 1).getContext('2d');
  colorCtx.fillStyle = '#ffffff';
  colorCtx.fillStyle = color;
  const c = colorCtx.fillStyle;
  if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
  const [r, g, b, a = 1] = c.match(/[\d.]+/g).map(Number);
  return [r, g, b, a];
}
const luminance = (color) => {
  const [r, g, b] = rgba(color);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** True for dark colours; transparent counts as light. */
export function isDarkColor(color) {
  return rgba(color)[3] >= 0.1 && luminance(color) < 140;
}

function captionColor(opts) {
  if (opts.background === 'none') return '#8e8e93';
  const c = opts.background === 'solid' ? { a: opts.solid, b: opts.solid } : backgroundColors(opts);
  return (luminance(c.a) + luminance(c.b)) / 2 > 170 ? 'rgba(40, 20, 50, .78)' : 'rgba(255, 255, 255, .92)';
}

/** draw(ctx, box, index) paints device `index` into `box`; it is already clipped to the rounded shape. */
export function paint(ctx, layout, opts, draw) {
  const { W, H, unit } = layout;
  ctx.clearRect(0, 0, W, H);
  paintBackground(ctx, W, H, opts);

  layout.boxes.forEach((box, i) => {
    if (opts.shadow && opts.shadowStrength > 0) {
      const k = opts.shadowStrength / 100;
      ctx.save();
      ctx.shadowColor = `rgba(0, 0, 0, ${0.12 + 0.45 * k})`;
      ctx.shadowBlur = (16 + 70 * k) * unit;
      ctx.shadowOffsetY = (6 + 30 * k) * unit;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, box.radius);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, box.radius);
    ctx.clip();
    draw(ctx, box, i);
    ctx.restore();
  });

  if (layout.caption) {
    const { text, x, y, fontSize } = layout.caption;
    ctx.save();
    ctx.font = `600 ${fontSize}px ${CAPTION_FONT}`;
    ctx.fillStyle = captionColor(opts);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

/** Formats this Chrome can encode natively (AVIF is usually missing and then not offered). */
export async function supportedFormats() {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 2;
  const checks = await Promise.all(
    FORMATS.map((f) => new Promise((resolve) => probe.toBlob((blob) => resolve(blob?.type === f.mime), f.mime, 1))),
  );
  return FORMATS.filter((_, i) => checks[i]);
}

export function encode(canvas, format) {
  const f = FORMATS.find((x) => x.id === format) || FORMATS[0];
  let source = canvas;
  if (f.id === 'jpeg') {
    // JPEG has no transparency: flatten on white.
    source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, source.width, source.height);
    ctx.drawImage(canvas, 0, 0);
  }
  return new Promise((resolve, reject) =>
    source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Encoding failed'))), f.mime, 1),
  );
}

export const extensionOf = (format) => (FORMATS.find((f) => f.id === format) || FORMATS[0]).ext;
