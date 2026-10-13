// Phone drawing shared by the simulator page and page mode (frame.js): status bar icons
// and the size/position writes that turn a geometry() result into a device on screen.

export const SB_ICONS = `
  <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg class="wifi" viewBox="0 0 16 12"><path d="M1.5 4.6a9.2 9.2 0 0 1 13 0"/><path d="M4.1 7.3a5.5 5.5 0 0 1 7.8 0"/><circle cx="8" cy="10.2" r="1.5"/></svg>
  <svg viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="18" height="9" rx="2"/><path d="M25 4.5v4a2 2 0 0 0 0-4Z" opacity=".45"/></svg>`;

/**
 * Sizes a view's device, base, screen, status bar and iframe for `g` (from geometry()).
 * `v` needs device, base, screen, statusbar, iframe and optionally progress. Sets v.top and
 * v.left (the page's offset inside the screen); the iframe height is left to the caller.
 */
export function applyGeometry(v, d, g, { showFrame = true, statusBar = true } = {}) {
  const [, r, , l] = g.inset;
  // Status bar switched off: the page starts at the top of the screen.
  const t = statusBar ? g.inset[0] : 0;
  v.top = t;
  v.left = l;

  v.device.className = `device frame-${d.frame} ${g.land ? 'land' : 'port'}${showFrame ? '' : ' frameless'}`;
  v.base.className = `base${g.base ? ` base-${g.base} frame-${d.frame}` : ''}`;
  Object.assign(v.base.style, { width: `${g.outerW}px`, height: `${g.baseH}px` });
  Object.assign(v.device.style, {
    width: `${g.outerW}px`,
    height: `${g.outerH}px`,
    padding: g.bezel.map((n) => `${n}px`).join(' '),
    borderRadius: `${g.radius}px`,
  });
  v.device.style.setProperty('--rim', `${g.rim}px`);
  v.device.style.setProperty('--radius', `${g.radius}px`);
  // clip-path, not just overflow + border-radius: Chrome can let a scrolling iframe
  // escape a rounded overflow clip.
  Object.assign(v.screen.style, {
    width: `${g.w}px`,
    height: `${g.h}px`,
    borderRadius: `${g.screenRadius}px`,
    clipPath: `inset(0 round ${g.screenRadius}px)`,
  });
  v.statusbar.style.height = `${t}px`;
  v.statusbar.style.display = t ? '' : 'none';
  Object.assign(v.iframe.style, { top: `${t}px`, left: `${l}px`, width: `${g.w - l - r}px` });
  if (v.progress) v.progress.style.top = `${t}px`;
}
