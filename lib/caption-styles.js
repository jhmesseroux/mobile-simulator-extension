// Watermark (caption) styles for screenshots and videos, shared by the simulator and page
// mode. Display fonts are bundled (vendor/fonts, SIL OFL) and loaded from their bytes, so a
// website's font-src CSP can't block them in page mode.

const SYSTEM = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';

// size: multiple of the base caption size. The first is the default, and what older saved ids
// (clean, serif, badge) fall back to.
export const CAPTION_STYLES = [
  { id: 'elegant', label: 'Elegant', family: '"MS Playfair Italic"', file: 'vendor/fonts/playfair-display-italic.woff2', weight: 700, style: 'italic', size: 1.4 },
  { id: 'script', label: 'Script', family: '"MS Great Vibes"', file: 'vendor/fonts/great-vibes.woff2', weight: 400, size: 2 },
];

export const captionStyle = (id) => CAPTION_STYLES.find((s) => s.id === id) || CAPTION_STYLES[0];

/** Canvas/CSS font string for a style at `px`. */
export const captionFont = (style, px) => `${style.style || 'normal'} ${style.weight} ${px}px ${style.family === SYSTEM ? SYSTEM : `${style.family}, ${SYSTEM}`}`;

const loading = new Map();

/** Loads the bundled fonts (all by default) into this document; never rejects. */
export function loadCaptionFonts(ids = CAPTION_STYLES.map((s) => s.id)) {
  return Promise.all(
    ids.map(captionStyle).filter((s) => s.file).map((s) => {
      if (!loading.has(s.id)) {
        const family = s.family.replace(/"/g, '');
        loading.set(
          s.id,
          fetch(chrome.runtime.getURL(s.file))
            .then((r) => r.arrayBuffer())
            .then((buf) => {
              const face = new FontFace(family, buf, { style: s.style || 'normal', weight: String(s.weight) });
              document.fonts.add(face);
              return face.load();
            })
            .catch((err) => console.warn('[mobile-sim] caption font', s.id, err)),
        );
      }
      return loading.get(s.id);
    }),
  );
}

/**
 * The extension's icon (icons/icon.svg) as a watermark: the tile in `color`, the drawing cut
 * out of it so the background shows through. `size` px square, left edge at x, centred on y.
 */
export function drawAppIcon(ctx, x, y, size, color) {
  const px = Math.ceil(size);
  const stamp = new OffscreenCanvas(px, px);
  const c = stamp.getContext('2d');
  c.scale(px / 128, px / 128);
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(4, 4, 120, 120, 28);
  c.fill();
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = 7;
  c.lineCap = c.lineJoin = 'round';
  c.stroke(new Path2D('M65 44 H33 a9 9 0 0 0 -9 9 V80 a9 9 0 0 0 9 9 H65 M24 53 H65'));
  c.beginPath();
  c.roundRect(65, 25, 38, 78, 10);
  c.stroke();
  c.beginPath();
  c.roundRect(77, 32, 14, 4.5, 2.25);
  c.fill();
  ctx.drawImage(stamp, x, y - size / 2, size, size);
}
