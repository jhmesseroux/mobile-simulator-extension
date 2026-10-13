// Page mode: the phone drawn inside the website's own page, with plain DOM in a shadow root
// and a same-origin iframe of the page. Built for testing tools that can't reach extension
// pages (chrome-extension:// tabs, the side panel, extension iframes), e.g. Claude in Chrome.
// Loaded on demand by frame.js in the top frame. Triggers, on allowed hosts only:
//   #mobile-sim  ·  #mobile-sim=<device>,<portrait|landscape>,<dock|full>  ·  #mobile-sim=off
//   window.postMessage({ __mobileSimPage: 'open' | 'close', device, orientation, layout }, '*')
// State for automation: <html data-mobile-sim="loading|ready|blocked:framing|not-allowed|off">.

import { DEVICES, FRAMES, GROUPS, FINISHES, DEFAULT_DEVICE, DEFAULT_FINISH, geometry, finishColors } from './devices.js';
import { SB_ICONS, applyGeometry } from './device-view.js';
import { identityFor } from './rules.js';
import { loadPageMode, hostAllowed } from './page-mode-settings.js';
import { DEFAULT_EXPORT, computeLayout, paint, encode, extensionOf } from './export.js';
import { shotScene } from './shot-scene.js';
import { createRecorder } from './recorder.js';
import { esc, deviceCard, TAB_LABELS } from './device-picker.js';
import { fitPage } from './page-fit.js';
import { dragPill } from './drag-pill.js';
import { CAPTION_STYLES, captionStyle, captionFont, loadCaptionFonts } from './caption-styles.js';

const KEY = '__mobileSimPage'; // sessionStorage: the open phone survives a reload of the page
const HOST_TAG = 'mobile-sim-host';
const SCREEN_ID = 'mobile-sim-screen';
const PAD = 24;
const BAR_H = 54; // the floating glass bar
const BAR_TOP = 12;
const GAP = 12;
const DOCK_MAX = 0.5; // the docked phone takes at most half the window
// A phone whose page loaded and stayed this long is "stable". After a reload of the website,
// an unstable phone whose page started loading less than BUST_WINDOW_MS ago means the page
// broke out of its frame (top.location = …): reopening it would loop forever.
const STABLE_MS = 1500;
const BUST_WINDOW_MS = 10_000;
const THEMES = ['auto', 'light', 'dark'];
const URLBAR_H = 54;
const DOCK_MIN = 400; // room for the bar's buttons
const DOCK_MAX_SHARE = 0.85; // dragged wider than this would leave no page
const PREFS_KEY = 'pageModePrefs';
const DEFAULT_PREFS = { sync: true, statusBar: true, homeBar: true, urlBar: false, dockWidth: 0 };
// Screenshot density: device pixels per CSS pixel of the phone screen. 3 (an iPhone's native)
// on 1x displays; on Retina, 2 is enough and usually fits one capture inside the panel.
const shotDensity = () => (devicePixelRatio >= 2 ? 2 : 3);
const SHOT_MAX_TILES = 12;
const CAPTURE_GAP_MS = 520; // Chrome allows about two tab captures per second
// Same presets as the simulator's recording (Settings → Record → Quality).
const QUALITY = {
  good: { fps: 30, bitsPerPixel: 0.06, maxUnit: 1.5 },
  high: { fps: 60, bitsPerPixel: 0.1, maxUnit: 2 },
  max: { fps: 60, bitsPerPixel: 0.16, maxUnit: 3 },
};
const SETTLE_MS = 650; // the phone's resize transition (.55s) before measuring it
const PICKER_TABS = ['iphone', 'android', 'tablet', 'custom'];
const html = document.documentElement;

let current = null; // { config, host, shadow, v, stable, loadingSince, themePref, … }

const setState = (value) => {
  html.dataset.mobileSim = value;
};


/** '' | 'iphone-17-pro,landscape,full' | 'off' → config (null for off). */
export function parseSpec(spec = '') {
  if (spec === 'off') return null;
  const config = { deviceId: DEFAULT_DEVICE, orientation: 'portrait', layout: 'dock' };
  for (const part of String(spec).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (part === 'portrait' || part === 'landscape') config.orientation = part;
    else if (part === 'dock' || part === 'full') config.layout = part;
    else if (DEVICES.some((d) => d.id === part)) config.deviceId = part;
  }
  return config;
}

// Built-in devices plus the user's custom ones (saved by the simulator).
let customDevices = [];
const allDevices = () => [...DEVICES, ...customDevices];
const deviceOf = (id) => allDevices().find((d) => d.id === id) || DEVICES.find((d) => d.id === DEFAULT_DEVICE);

function remember(config, stable = false, since = Date.now()) {
  try {
    if (config) {
      const { deviceId, orientation, layout } = config;
      sessionStorage.setItem(KEY, JSON.stringify({ deviceId, orientation, layout, stable, since }));
    } else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the phone just won't come back after a reload.
  }
}
const rememberCurrent = () => current && remember(current.config, current.stable, current.loadingSince);

/** After a reload of the website: reopen the phone, unless its page just broke out of the frame. */
export function restore() {
  const saved = remembered();
  if (!saved) return;
  if (!saved.stable && Date.now() - (saved.since || 0) < BUST_WINDOW_MS) {
    remember(null);
    setState('blocked:frame-busting');
    console.warn('[mobile-sim] page mode closed: this page left its frame (frame-busting), so it cannot be shown inside the phone.');
    return;
  }
  return open(saved, { source: 'restore' });
}

function remembered() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The page shown in the phone: this page, without our own trigger in the hash.
function pageUrl() {
  const url = new URL(location.href);
  if (/^#?mobile-sim\b/.test(url.hash)) url.hash = '';
  return url.href;
}

/**
 * From the extension's menus (background): { layout: 'dock'|'full'|'off' } and/or
 * { action: 'shot'|'record', streamId }. Opens the phone first when needed.
 */
export async function fromMenu({ layout, action, added = false, streamId = null, deviceId, orientation }) {
  if (layout === 'off') return close();
  if (!current || layout || deviceId) {
    await open({ ...(currentConfig() || parseSpec('')), ...(layout && { layout }), ...(deviceId && { deviceId }), ...(orientation && { orientation }) }, { source: 'menu', added });
  }
  if (!current || !action) return;
  if (!(await whenReady())) return notify('The phone could not load this page.');
  if (action === 'shot') await screenshot().catch((err) => notify(`Screenshot failed: ${err.message}`));
  if (action === 'record' && !current.rec) await startRecording(streamId).catch((err) => notify(`Recording failed: ${err.message}`));
}

async function whenReady(timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (html.dataset.mobileSim === 'ready') return true;
    if (/^blocked|not-allowed/.test(html.dataset.mobileSim || '')) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** The open phone's settings, or null. */
export const currentConfig = () => (current ? { ...current.config } : null);

/**
 * Opens (or reconfigures) the phone. `config` from parseSpec or a postMessage.
 * source: 'hash' | 'message' | 'menu' | 'restore'. Only the user's own triggers (the address
 * hash, the icon menu) show a notice; a page's postMessage never makes extension UI appear.
 */
export async function open(config, { source = 'hash', added = false } = {}) {
  if (!current) setState('loading');
  const settings = await loadPageMode();
  if (!hostAllowed(location.hostname, settings)) {
    setState('not-allowed');
    console.info(`[mobile-sim] page mode is not allowed on ${location.hostname}: add it in the simulator settings (Inline phone).`);
    if (source === 'hash') {
      notify(`The inline phone isn't allowed on ${location.hostname}.`, {
        label: `Allow ${location.hostname}`,
        run: async () => {
          const reply = await chrome.runtime.sendMessage({ type: 'page-mode-allow' }).catch((err) => ({ ok: false, error: err.message }));
          if (reply?.ok) open(config, { source: 'menu', added: true });
          else console.warn('[mobile-sim] page mode allow', reply?.error);
        },
      });
    }
    return;
  }
  if (added) notify(`${location.hostname} was added to the inline phone sites. Remove it in Settings → Inline phone.`);
  // Our trigger leaves the address bar so the page's own router never sees it.
  if (/^#mobile-sim\b/.test(location.hash)) history.replaceState(history.state, '', pageUrl());
  const d = deviceOf(config.deviceId);
  const platform = FRAMES[d.frame].os;
  const reply = await chrome.runtime.sendMessage({ type: 'page-mode-rules', deviceId: d.id }).catch((err) => ({ ok: false, error: err.message }));
  if (!reply?.ok) console.warn('[mobile-sim] page mode rules', reply?.error);

  if (!current) await mount();
  current.config = { deviceId: d.id, orientation: config.orientation, layout: config.layout };
  render(d, platform);
  rememberCurrent();
}

export function close() {
  if (!current) return;
  const { host, prevMargin, prevOverflow, onResize, onKey, clock, stableTimer, themeWatch, rec, unsync } = current;
  current.unwatchScreen?.();
  clearTimeout(stableTimer);
  themeWatch();
  unsync();
  if (rec) stopRecording().catch(() => {});
  host.detach();
  html.style.marginRight = prevMargin;
  html.style.overflow = prevOverflow;
  fitPage(0);
  removeEventListener('resize', onResize);
  removeEventListener('keydown', onKey, true);
  clearInterval(clock);
  current = null;
  remember(null);
  setState('off');
  chrome.runtime.sendMessage({ type: 'page-mode-clear' }).catch(() => {});
}

// ---------- staying on the page ----------

// Frameworks that hydrate the whole document (Next.js, React on <html>) drop elements they
// didn't render. Ours come back until page mode removes them itself.
function keepAttached(el) {
  const observer = new MutationObserver(() => {
    if (!el.isConnected) html.appendChild(el);
  });
  observer.observe(html, { childList: true });
  el.detach = () => {
    observer.disconnect();
    el.remove();
  };
  html.appendChild(el);
}

// ---------- notice ----------

const NOTICE_MS = 6000;

/**
 * A short message at the top of the page, in its own closed shadow root. A plain message goes
 * after a few seconds; one with an `action` button stays until used or closed (×). The button
 * only answers a real click (event.isTrusted), so the page's own scripts can't press it.
 */
export function notify(text, action = null, { sticky = !!action } = {}) {
  const el = document.createElement('mobile-sim-notice');
  const shadow = el.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<div role="status"><span></span></div>`;
  const box = shadow.firstElementChild;
  box.firstElementChild.textContent = text;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      el.detach();
      action.run();
    });
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', () => el.detach());
    box.append(btn, x);
  }
  // The simulator's toast: dark glass at the bottom, rising in with its spring.
  adopt(shadow, `:host { all: initial; position: fixed; z-index: 2147483647; left: 50%; bottom: 28px; transform: translateX(-50%); }
    div { max-width: min(560px, calc(100vw - 32px)); padding: 10px 12px 10px 16px; border-radius: 12px; background: rgba(22, 20, 32, .9);
      -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, .1); color: #ecebf3;
      font: 500 13.5px/1.4 "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 20px 50px -20px rgba(0, 0, 0, .7);
      display: flex; align-items: center; gap: 12px; animation: rise .3s cubic-bezier(.34, 1.4, .5, 1); }
    div.out { opacity: 0; transform: translateY(20px); transition: opacity .2s, transform .3s; }
    @keyframes rise { from { opacity: 0; transform: translateY(20px); } }
    button { font: 600 13px "Geist", ui-sans-serif, system-ui, sans-serif; color: #fff; background: linear-gradient(135deg, #7c3aed, #ec4899);
      border: 0; border-radius: 10px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
    button:hover { filter: brightness(1.1); }
    button.x { background: rgba(255, 255, 255, .07); color: #b9b4c9; width: 30px; height: 30px; padding: 0; border-radius: 50%; }
    button.x:hover { color: #ecebf3; filter: none; background: rgba(255, 255, 255, .12); }`);
  keepAttached(el);
  if (!sticky) {
    setTimeout(() => {
      box.classList.add('out');
      setTimeout(() => el.detach(), 300);
    }, action ? NOTICE_MS * 1.5 : NOTICE_MS);
  }
}

// Constructable sheet (immune to the page's style-src CSP), inline <style> as a fallback.
function adopt(shadow, css) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.prepend(style);
  }
}

// ---------- DOM ----------

const ICONS = {
  rotate: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 3.5v5h-5"/><rect x="7" y="11" width="9" height="9" rx="1.5"/>',
  dock: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  shot: '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>',
  address: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9.5h18"/><circle cx="6" cy="7.3" r=".6" fill="currentColor"/><circle cx="8.3" cy="7.3" r=".6" fill="currentColor"/>',
  status: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M9 5.5h2M13.5 5.5h1.5"/>',
  home: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18.5h4"/>',
  sync: '<path d="M8 3v18M8 3 4.5 6.5M8 3l3.5 3.5M16 21V3M16 21l-3.5-3.5M16 21l3.5-3.5"/>',
  watermark: '<path d="M4 20h16"/><path d="M7 16 12 4l5 12M8.8 12h6.4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/><path d="M17.5 9h1M17.5 12h1"/>',
  logo: '<path d="M12 8H5.5A1.5 1.5 0 0 0 4 9.5v6A1.5 1.5 0 0 0 5.5 17H12"/><path d="M4 11h8"/><rect x="12" y="4" width="8" height="16" rx="2"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-1.2-1-1.6-1-2.6 0-.9.8-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1.2" fill="currentColor"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const THEME_LABELS = { auto: 'Background: Auto (follows the site)', light: 'Background: Light', dark: 'Background: Dark' };

async function styles(shadow) {
  const [base, picker] = await Promise.all(['lib/device-frame.css', 'lib/device-picker.css'].map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.text())));
  const { a, b, angle } = finishColors(((await chrome.storage.local.get('finish')).finish) || DEFAULT_FINISH);
  const own = `
    /* Same tokens as simulator.css (dark, then light). */
    :host { all: initial; position: fixed; z-index: 2147483647; top: 0; bottom: 0; right: 0; display: block;
      --rim-a: ${a}; --rim-b: ${b}; --rim-angle: ${angle}deg;
      --bg: #07060b; --text: #ecebf3; --muted: #8f8aa3; --soft: #b9b4c9;
      --glass-bg: rgba(22, 20, 32, .55); --glass-border: rgba(255, 255, 255, .09); --glass-hi: rgba(255, 255, 255, .08);
      --glass-shadow: 0 20px 50px -20px rgba(0, 0, 0, .7); --card-bg: rgba(18, 16, 26, .92);
      --inset: rgba(255, 255, 255, .05); --inset-line: rgba(255, 255, 255, .07); --hover: rgba(255, 255, 255, .07);
      --line: rgba(255, 255, 255, .08); --border: rgba(255, 255, 255, .12);
      --accent: #8b5cf6; --accent-strong: #7c3aed; --pink: #ec4899; --danger: #ff453a;
      --accent-soft: rgba(139, 92, 246, .22); --panel: #16141f;
      --gradient: linear-gradient(135deg, #7c3aed, #ec4899); --tint: linear-gradient(135deg, rgba(124, 58, 237, .45), rgba(236, 72, 153, .35));
      --glow-opacity: 1; --device-shadow: 0 60px 120px -40px rgba(0, 0, 0, .9);
      --spring: cubic-bezier(.34, 1.4, .5, 1); --ease: cubic-bezier(.2, .8, .2, 1); --glide: cubic-bezier(.22, 1, .36, 1);
      --font: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font: 14px/1.4 var(--font); color: var(--text); -webkit-font-smoothing: antialiased; color-scheme: dark;
      --grid-dot: rgba(255, 255, 255, .055);
      /* The simulator's stage: dot grid over the violet and pink ambient glow. */
      background-color: var(--bg);
      background-image:
        radial-gradient(var(--grid-dot) 1px, transparent 1.2px),
        radial-gradient(520px 520px at 30% 58%, rgba(124, 58, 237, calc(.32 * var(--glow-opacity))), rgba(124, 58, 237, calc(.12 * var(--glow-opacity))) 45%, transparent 70%),
        radial-gradient(460px 460px at 78% 44%, rgba(236, 72, 153, calc(.22 * var(--glow-opacity))), rgba(236, 72, 153, calc(.08 * var(--glow-opacity))) 45%, transparent 70%);
      background-size: 24px 24px, auto, auto;
      transition: background-color .3s; }
    :host([data-theme="light"]) {
      --bg: #efeaf8; --text: #1b1528; --muted: #6d6680; --soft: #4b4460;
      --glass-bg: rgba(255, 255, 255, .62); --glass-border: rgba(255, 255, 255, .8); --glass-hi: rgba(255, 255, 255, .9);
      --glass-shadow: 0 20px 50px -24px rgba(40, 20, 80, .3); --card-bg: rgba(250, 248, 255, .94);
      --inset: rgba(40, 20, 80, .05); --inset-line: rgba(40, 20, 80, .08); --hover: rgba(40, 20, 80, .06);
      --line: rgba(40, 20, 80, .08); --border: rgba(40, 20, 80, .12); --accent: #7c3aed; --accent-soft: rgba(124, 58, 237, .16); --panel: #ffffff;
      --tint: linear-gradient(135deg, rgba(124, 58, 237, .22), rgba(236, 72, 153, .18));
      --glow-opacity: .55; --device-shadow: 0 50px 100px -40px rgba(40, 20, 80, .45); --grid-dot: rgba(40, 20, 80, .08); color-scheme: light; }
    :host([data-layout="full"]) { left: 0; }
    /* The simulator page sets this globally; device geometry assumes it. */
    *, *::before, *::after { box-sizing: border-box; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    button, select, input { font: inherit; color: inherit; }
    button, a[href], select, summary, [role="button"], label:has(> input[type="checkbox"]) { cursor: pointer; }
    button:disabled { cursor: not-allowed; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .glass { background: var(--glass-bg); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6);
      border: 1px solid var(--glass-border); box-shadow: inset 0 1px 0 var(--glass-hi), var(--glass-shadow); }

    /* Floating bars, like the simulator's top bar */
    .bar, .urlbar { position: absolute; left: ${GAP}px; right: ${GAP}px; height: ${BAR_H}px; display: flex; align-items: center; gap: 4px;
      padding: 6px; border-radius: 20px; z-index: 2; }
    .bar { top: ${BAR_TOP}px; }
    .urlbar { top: ${BAR_TOP + BAR_H + 8}px; display: none; z-index: 1; }
    :host([data-urlbar]) .urlbar { display: flex; }
    .icon-btn { position: relative; width: 40px; height: 40px; flex: none; display: grid; place-items: center; padding: 0;
      border: 0; border-radius: 50%; background: transparent; color: var(--soft); cursor: pointer;
      transition: background .15s, color .15s, transform .15s; }
    .icon-btn svg { width: 19px; height: 19px; }
    .icon-btn:hover { background: var(--hover); color: var(--text); }
    .icon-btn:active { transform: scale(.94); }
    .icon-btn.open { background: var(--hover); color: var(--text); box-shadow: inset 0 0 0 1px var(--inset-line); }
    .icon-btn:disabled { opacity: .35; pointer-events: none; }
    .icon-btn.rec-on { background: var(--danger); color: #fff; box-shadow: 0 0 0 4px rgba(255, 69, 58, .25); }
    .icon-btn.rec-on svg { animation: blink 1s infinite; }
    @keyframes blink { 50% { opacity: .35; } }
    /* Close: the simulator's round corner button */
    .icon-btn.close { border: 1px solid var(--border); color: var(--text); }
    .icon-btn.close svg { width: 18px; height: 18px; stroke-width: 2.2; }
    .icon-btn.close:hover { transform: scale(1.06); }
    .sep { width: 1px; height: 22px; margin: 0 3px; background: var(--line); flex: none; }
    /* Fields, like the simulator's address field */
    .field { flex: 1; min-width: 0; height: 40px; padding: 0 14px; border: 0; border-radius: 13px; background: var(--inset);
      box-shadow: inset 0 0 0 1px var(--inset-line); color: var(--text); font-size: 13.5px; outline: 0; transition: box-shadow .2s; }
    .field:focus { box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 3px rgba(139, 92, 246, .35); }
    select.field { cursor: pointer; font-weight: 500; }
    .urlbar .field { font: 12.5px var(--mono); color: var(--soft); }
    .urlbar .icon-btn { width: 36px; height: 36px; }
    .urlbar .icon-btn svg { width: 16px; height: 16px; stroke-width: 2; }

    /* Tooltips: the simulator's (dark bubble, fade + slide, after a short delay), below the bar */
    [data-tip]::after { --tip-from: translate(-50%, -6px); --tip-to: translate(-50%, 0);
      content: attr(data-tip); position: absolute; left: 50%; top: calc(100% + 12px); padding: 6px 10px; border-radius: 9px;
      background: rgba(22, 20, 32, .92); border: 1px solid rgba(255, 255, 255, .09); color: #ecebf3; font: 500 12.5px var(--font);
      white-space: nowrap; opacity: 0; transform: var(--tip-from); pointer-events: none; z-index: 5;
      transition: opacity .15s, transform .2s var(--ease); }
    [data-tip]:hover::after { opacity: 1; transform: var(--tip-to); transition-delay: .25s; }
    [data-tip].open::after { opacity: 0; }
    .bar > :last-child[data-tip]::after { left: auto; right: 0; --tip-from: translate(0, -6px); --tip-to: translate(0, 0); }
    :host(.snap) [data-tip]::after { display: none; }

    .stage { position: absolute; top: ${BAR_TOP + BAR_H + GAP}px; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; }
    .device-box { position: relative; flex: none; }
    .device { box-shadow: var(--device-shadow); }
    .flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; border-radius: inherit; }
    .flash.on { animation: flash .45s ease-out; }
    @keyframes flash { from { opacity: .85; } to { opacity: 0; } }
    .note { position: absolute; left: 12px; right: 12px; bottom: 10px; font-size: 12px; color: #f87171; text-align: center; }
    .note:empty { display: none; }

    /* Resize grip (dock) */
    .grip { position: absolute; left: -4px; top: 0; bottom: 0; width: 10px; cursor: ew-resize; z-index: 3; display: none; }
    :host([data-layout="dock"]) .grip { display: block; }
    .grip::after { content: ""; position: absolute; left: 4px; top: 50%; width: 3px; height: 44px; margin-top: -22px; border-radius: 2px;
      background: var(--border); transition: background .15s, height .2s var(--ease); }
    .grip:hover::after, :host(.resizing) .grip::after { background: var(--accent); height: 64px; margin-top: -32px; }
    :host(.resizing) .stage { pointer-events: none; }

    /* More menu: a glass popover with the simulator's pop animation, rows and switches */
    .menu { position: absolute; top: ${BAR_TOP + BAR_H + 8}px; right: ${GAP}px; z-index: 4; width: 300px;
      max-height: calc(100vh - ${BAR_TOP + BAR_H + 24}px); overflow: auto; scrollbar-width: none;
      padding: 8px; border-radius: 24px; transform-origin: top right; animation: pop .22s var(--ease); }
    .menu[hidden] { display: none; }
    @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
    .menu button.row { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; min-height: 42px;
      padding: 0 10px; border: 0; border-radius: 12px; background: none; color: var(--text); cursor: pointer; text-align: left;
      transition: background .15s; }
    .menu button.row:hover { background: var(--hover); }
    .menu .item { display: flex; align-items: center; gap: 11px; font-weight: 500; }
    .menu .item svg { color: var(--soft); }
    .menu .rec-item svg { color: var(--danger); }
    .menu hr { border: 0; border-top: 1px solid var(--line); margin: 6px 8px; }
    .menu .label { display: flex; align-items: center; gap: 8px; padding: 8px 10px 4px; font-size: 11.5px; font-weight: 600;
      letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
    .menu .label svg { width: 14px; height: 14px; }
    .switch { position: relative; width: 40px; height: 24px; border-radius: 12px; background: var(--border); flex: none; transition: background .2s; }
    .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, .4); transition: translate .25s var(--spring); }
    .switch.on { background: var(--gradient); }
    .switch.on::after { translate: 16px 0; }
    .wm { display: flex; flex-direction: column; gap: 8px; padding: 4px 10px 8px; }
    .wm.off { opacity: .4; pointer-events: none; }
    .wm .text-input { flex: none; width: 100%; font-size: 13.5px; }
    .wm-opacity { display: flex; align-items: center; gap: 10px; padding: 2px 2px 0; font-size: 12.5px; font-weight: 500; color: var(--soft); }
    .wm-opacity input { flex: 1; min-width: 0; accent-color: var(--accent); }
    .wm-opacity b { min-width: 36px; text-align: right; font: 500 11.5px var(--mono); }
    .wm-sub.off { opacity: .4; pointer-events: none; }
    .wm-styles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .wm-style { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 52px; padding: 6px 4px; color: var(--text);
      border: 1px solid var(--inset-line); border-radius: 12px; background: var(--inset); cursor: pointer; transition: background .15s, transform .15s; }
    .wm-style:hover { background: var(--hover); transform: translateY(-1px); }
    .wm-style.on { background: linear-gradient(160deg, rgba(124, 58, 237, .28), rgba(236, 72, 153, .16)); border-color: rgba(196, 181, 253, .5); }
    .wm-style b { line-height: 1.15; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wm-style small { font: 500 10.5px var(--font); color: var(--muted); }
    .swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; padding: 6px 10px 10px; }
    .swatches i { width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .3), 0 0 0 1px rgba(0, 0, 0, .25); transition: transform .15s var(--spring); }
    .swatches i:hover { transform: scale(1.12); }
    .swatches i.on { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* Device button + the simulator's device picker in a glass popover */
    .dev-btn { display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; }
    .dev-btn b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dev-btn svg { width: 14px; height: 14px; stroke-width: 2.2; color: var(--muted); transition: transform .2s var(--ease); }
    .dev-btn.open svg { transform: rotate(180deg); }
    .devpop { position: absolute; top: ${BAR_TOP + BAR_H + 8}px; left: ${GAP}px; right: ${GAP}px; z-index: 4; max-width: 460px;
      max-height: calc(100vh - ${BAR_TOP + BAR_H + 24}px); overflow: auto; scrollbar-width: none; padding: 16px; border-radius: 24px;
      display: flex; flex-direction: column; gap: 14px; transform-origin: top left; animation: pop .22s var(--ease); }
    .devpop[hidden] { display: none; }
    .devpop .dev-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
    .dev-card { cursor: pointer; }
    /* Recording: the phone fills the window (more pixels = a sharper video), a REC pill aside */
    :host(.rec-stage) { left: 0 !important; width: auto !important; }
    :host(.rec-stage) .bar, :host(.rec-stage) .urlbar, :host(.rec-stage) .grip, :host(.rec-stage) .menu, :host(.rec-stage) .devpop { display: none !important; }
    :host(.rec-stage) .stage { top: 0 !important; }
    .rec-pill { position: absolute; top: 16px; right: 16px; z-index: 5; display: none; align-items: center; gap: 10px; padding: 6px 6px 6px 14px;
      border-radius: 999px; font: 600 13px var(--mono); cursor: grab; touch-action: none; user-select: none; }
    .rec-pill.dragging { cursor: grabbing; }
    :host(.rec-stage) .rec-pill { display: flex; animation: pop .22s var(--ease); }
    .rec-pill .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 0 4px rgba(255, 69, 58, .25); animation: blink 1s infinite; }
    .rec-pill button { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border: 0; border-radius: 999px;
      background: var(--danger); color: #fff; font: 600 13px var(--font); cursor: pointer; }
    .rec-pill button:hover { filter: brightness(1.1); }
    .rec-pill button svg { width: 12px; height: 12px; }

    /* Tile capture: the phone alone, at full density, moved under the window part by part. */
    :host(.capturing:not(.capture-in-panel)) { left: 0 !important; width: auto !important; }
    :host(.capturing) { background-image: none; }
    :host(.capturing) .bar, :host(.capturing) .urlbar, :host(.capturing) .grip, :host(.capturing) .menu, :host(.capturing) .note { display: none !important; }
    :host(.capturing) .stage { top: 0 !important; display: block; }
    :host(.capturing) .device-box { position: absolute; left: 0; top: 0; }
    :host(.capturing) .device { transition: none !important; box-shadow: none; }`;
  adopt(shadow, `${base}\n${picker}\n${own}`);
}


async function mount() {
  const host = document.createElement(HOST_TAG);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <div class="bar glass">
      <button class="dev-btn field" aria-label="Device" aria-haspopup="dialog"><b></b>${icon('chevron')}</button>
      <button class="lay icon-btn" aria-label="Layout"></button>
      <button class="shot icon-btn" data-tip="Screenshot" aria-label="Screenshot">${icon('shot')}</button>
      <button class="set icon-btn" data-tip="Inline phone settings" aria-label="Inline phone settings">${icon('settings')}</button>
      <button class="more icon-btn" data-tip="More" aria-label="More options" aria-haspopup="menu">${icon('more')}</button>
      <span class="sep"></span>
      <button class="x icon-btn close" data-tip="Close (Esc)" aria-label="Close">${icon('close')}</button>
    </div>
    <div class="urlbar glass">
      <button class="ub-back icon-btn" data-tip="Back" aria-label="Back">${icon('back')}</button>
      <button class="ub-fwd icon-btn" data-tip="Forward" aria-label="Forward">${icon('forward')}</button>
      <button class="ub-reload icon-btn" data-tip="Reload the phone" aria-label="Reload the phone">${icon('reload')}</button>
      <input class="ub-url field" spellcheck="false" aria-label="Address in the phone">
    </div>
    <div class="menu glass" role="menu" hidden></div>
    <div class="devpop glass" role="dialog" aria-label="Choose a device" hidden></div>
    <div class="rec-pill glass" role="status"><i class="dot"></i><span class="rec-t">0:00</span><button class="rec-stop">${icon('stop')}Stop</button></div>
    <div class="grip" title="Drag to resize · double-click to reset" aria-hidden="true"></div>
    <div class="stage">
      <div class="device-box">
        <div class="device">
          <i class="hw hw-action"></i><i class="hw hw-vol1"></i><i class="hw hw-vol2"></i><i class="hw hw-power"></i>
          <i class="speaker"></i><i class="home-btn"></i>
          <div class="screen has-url">
            <div class="statusbar"><span class="sb-time"></span><span class="sb-icons">${SB_ICONS}</span></div>
            <iframe id="${SCREEN_ID}" title="Mobile preview"></iframe>
            <div class="island" data-state="idle"><span class="isl-l"></span><span class="isl-r"></span></div>
            <i class="notch"></i><i class="punch"></i><i class="home-ind"></i>
            <i class="flash"></i>
          </div>
        </div>
        <i class="base"></i>
      </div>
    </div>
    <div class="note"></div>`;
  const $ = (sel) => shadow.querySelector(sel);
  const v = {
    box: $('.device-box'),
    device: $('.device'),
    base: $('.base'),
    screen: $('.screen'),
    statusbar: $('.statusbar'),
    iframe: $('iframe'),
    time: $('.sb-time'),
    note: $('.note'),
    devBtn: $('.dev-btn'),
    devPop: $('.devpop'),
    recT: $('.rec-t'),
    lay: $('.lay'),
    flash: $('.flash'),
    stage: $('.stage'),
    menu: $('.menu'),
    more: $('.more'),
    shotBtn: $('.shot'),
    url: $('.ub-url'),
  };
  styles(shadow).catch((err) => console.warn('[mobile-sim] page mode styles', err));

  const onResize = () => current && layout();
  const onKey = (e) => {
    if (e.key !== 'Escape' || !current) return;
    if (current.rec) stopRecording().catch(() => {});
    else if (!current.v.devPop.hidden) toggleDevicePicker(false);
    else if (!current.v.menu.hidden) toggleMenu(false);
    else close();
  };
  const tick = () => {
    const d = new Date();
    v.time.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  const stored = await chrome.storage.local.get(['pageModeTheme', PREFS_KEY, 'finish', 'custom']);
  customDevices = Array.isArray(stored.custom) ? stored.custom : [];
  const pageModeTheme = stored.pageModeTheme;
  current = {
    host, shadow, v,
    stable: false,
    loadingSince: Date.now(),
    themePref: THEMES.includes(pageModeTheme) ? pageModeTheme : 'auto',
    prefs: { ...DEFAULT_PREFS, ...(stored[PREFS_KEY] || {}) },
    finish: stored.finish || DEFAULT_FINISH,
    rec: null,
    unsync: () => {},
    prevMargin: html.style.marginRight,
    prevOverflow: html.style.overflow,
    onResize, onKey,
    clock: setInterval(tick, 15_000),
    themeWatch: watchPageTheme(),
  };

  const reconfigure = (patch) => open({ ...current.config, ...patch }, { source: 'menu' });
  v.devBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDevicePicker();
  });
  shadow.querySelector('.rec-stop').addEventListener('click', () => stopRecording().catch((err) => notify(`Recording failed: ${err.message}`)));
  dragPill(shadow.querySelector('.rec-pill'));
  v.lay.addEventListener('click', () => reconfigure({ layout: current.config.layout === 'dock' ? 'full' : 'dock' }));
  $('.shot').addEventListener('click', () => {
    v.shotBtn.disabled = true;
    screenshot()
      .catch((err) => notify(`Screenshot failed: ${err.message}`))
      .finally(() => (v.shotBtn.disabled = false));
  });
  v.more.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  shadow.addEventListener('click', (e) => {
    const path = e.composedPath();
    if (!v.menu.hidden && !path.includes(v.menu) && !path.includes(v.more)) toggleMenu(false);
    if (!v.devPop.hidden && !path.includes(v.devPop) && !path.includes(v.devBtn)) toggleDevicePicker(false);
  });
  bindUrlBar(shadow);
  bindGrip($('.grip'));
  $('.set').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'page-mode-settings' }).catch(() => {}));
  $('.x').addEventListener('click', close);
  v.iframe.addEventListener('load', () => checkFrame(v));
  addEventListener('resize', onResize);
  addEventListener('keydown', onKey, true);
  keepAttached(host);
  applyHostTheme();
}

function render(d, platform) {
  const { v, config, host } = current;
  const g = geometry(d, config.orientation, true);
  v.g = g;
  v.d = d;
  applyGeometry(v, d, g, { showFrame: true, statusBar: current.prefs.statusBar });
  host.toggleAttribute('data-urlbar', current.prefs.urlBar);
  host.toggleAttribute('data-no-homebar', !current.prefs.homeBar);
  applyFinish();
  v.iframe.style.height = `${g.h - v.top - g.inset[2]}px`;
  v.devBtn.querySelector('b').textContent = d.name;
  host.dataset.layout = config.layout;
  host.dataset.device = d.id;
  host.dataset.orientation = config.orientation;
  const dock = config.layout === 'dock';
  v.lay.innerHTML = icon(dock ? 'full' : 'dock');
  v.lay.dataset.tip = dock ? 'Full window' : 'Side-by-side';

  // What identity.js reads, from the page world, before the phone's page runs.
  const id = identityFor(platform);
  const f = v.iframe;
  Object.assign(f.dataset, id ? { ua: id.ua, mobile: id.mobile, platform: id.platform, touch: '1' } : { ua: '', touch: '0' });
  // Keep the page the phone navigated to; an error page (refused framing) can't be read.
  let url = pageUrl();
  try {
    const inner = f.src ? f.contentWindow?.location?.href : '';
    if (inner && inner !== 'about:blank') url = inner;
  } catch {
    // cross-origin error page: reload the page itself
  }
  // A new device means a new identity: the phone's page reloads and has to settle again.
  if (f.dataset.loadedFor !== d.id) {
    f.dataset.loadedFor = d.id;
    current.stable = false;
    current.loadingSince = Date.now();
    clearTimeout(current.stableTimer);
    setState('loading');
    f.src = url;
  }
  layout();
}

function layout() {
  const { v, config, host } = current;
  const g = v.g;
  const fullW = innerWidth;
  const recording = host.classList.contains('rec-stage');
  const top = recording ? PAD : BAR_TOP + BAR_H + GAP + (current.prefs.urlBar ? URLBAR_H - 4 : 0);
  v.stage.style.top = `${top}px`;
  const availH = innerHeight - top - PAD * 2;
  // Dock: the width the user dragged to, else just wide enough for the phone.
  const dragged = current.prefs.dockWidth ? Math.min(Math.max(current.prefs.dockWidth, DOCK_MIN), fullW * DOCK_MAX_SHARE) : 0;
  const dockW = dragged || Math.min(fullW * DOCK_MAX, g.outerW + PAD * 2);
  const availW = config.layout === 'full' || recording ? fullW - PAD * 2 : dockW - PAD * 2;
  const scale = Math.max(0.2, Math.min(dragged || recording ? 2 : 1, availH / (g.outerH + g.baseH), availW / g.outerW));
  v.scale = scale;
  v.box.style.width = `${g.outerW * scale}px`;
  v.box.style.height = `${(g.outerH + g.baseH) * scale}px`;
  v.device.style.transform = `scale(${scale})`;
  v.base.style.top = `${g.outerH * scale}px`;
  v.base.style.transform = `scale(${scale})`;

  if (recording) {
    host.style.width = '';
  } else if (config.layout === 'dock') {
    // Wide enough for the bar's buttons, whatever the phone's scaled width.
    const width = Math.max(dragged || Math.ceil(g.outerW * scale + PAD * 2), DOCK_MIN);
    host.style.width = `${width}px`;
    host.style.left = '';
    // The page keeps running beside the phone, narrowed to the rest of the window.
    html.style.marginRight = `${width}px`;
    html.style.overflow = current.prevOverflow;
    // …and its CSS breakpoints follow that width, not the window's.
    fitPage(width);
  } else {
    host.style.width = '';
    html.style.marginRight = current.prevMargin;
    html.style.overflow = 'hidden';
    fitPage(0);
  }
  host.dataset.scale = scale.toFixed(3);
  current.recRect = null; // recording re-measures the phone after any layout change
  requestAnimationFrame(() => {
    if (!current) return;
    const r = v.iframe.getBoundingClientRect();
    html.dataset.mobileSimScreen = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
  });
}

// Same-origin frame: readable unless the page refused to be framed (error page instead).
function checkFrame(v) {
  let doc = null;
  try {
    doc = v.iframe.contentDocument;
  } catch {
    doc = null;
  }
  if (!doc || doc.URL === 'about:blank' || !doc.documentElement) {
    v.note.textContent = 'This page refuses to be shown in a frame (X-Frame-Options / frame-ancestors).';
    setState('blocked:framing');
    return;
  }
  v.note.textContent = '';
  watchScreenTheme(v, doc);
  setState('ready');
  if (document.activeElement !== current.host || current.shadow.activeElement !== v.url) v.url.value = doc.location.href;
  setupSync();
  clearTimeout(current.stableTimer);
  current.stableTimer = setTimeout(() => {
    if (!current) return;
    current.stable = true;
    rememberCurrent();
  }, STABLE_MS);
}

// ---------- colours ----------

// rgb(a) of a CSS colour or computed background; null when transparent or unreadable.
function rgbOf(color) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(color || '');
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.1)) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const isDark = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b < 140;

// The status bar takes the colour of what sits under it, like Safari: the first painted
// background at the top of the phone's page, else the page's, else its theme-color.
function screenColor(doc) {
  const w = doc.defaultView;
  const paint = (el) => {
    const c = el && w.getComputedStyle(el).backgroundColor;
    return rgbOf(c) ? c : null;
  };
  // A sticky/fixed bar at the top first: elementFromPoint skips bars with pointer-events: none.
  for (const el of doc.querySelectorAll('header, nav, [role="banner"]')) {
    if (!/sticky|fixed/.test(w.getComputedStyle(el).position)) continue;
    const r = el.getBoundingClientRect();
    const c = r.top <= 1 && r.bottom > 1 && r.width >= w.innerWidth * 0.9 && paint(el);
    if (c) return c;
  }
  for (let el = doc.elementFromPoint(w.innerWidth / 2, 1); el; el = el.parentElement) {
    const c = paint(el);
    if (c) return c;
  }
  const page = paint(doc.body) || paint(doc.documentElement);
  if (page) return page;
  // theme-color, the one whose media matches; resolved to rgb() through the browser.
  const meta = [...doc.querySelectorAll('meta[name="theme-color"]')].find((m) => !m.media || w.matchMedia(m.media).matches);
  if (!meta || !doc.body) return null;
  const probe = doc.createElement('i');
  probe.style.color = meta.content;
  doc.body.append(probe);
  const c = w.getComputedStyle(probe).color;
  probe.remove();
  return probe.style.color ? c : null;
}

function applyScreenTheme(v, doc) {
  if (!doc.body) return;
  const bg = screenColor(doc);
  const rgb = rgbOf(bg);
  if (!rgb) return;
  v.screen.style.setProperty('--page-bg', bg);
  v.screen.classList.toggle('on-dark', isDark(rgb));
}

// Again when the phone's page scrolls, switches theme (class, attribute, system) or loads more.
function watchScreenTheme(v, doc) {
  current.unwatchScreen?.();
  const w = doc.defaultView;
  let pending = 0;
  const update = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => current && applyScreenTheme(v, doc));
  };
  const observer = new MutationObserver(update);
  const watch = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] };
  observer.observe(doc.documentElement, watch);
  if (doc.body) observer.observe(doc.body, watch);
  const scheme = w.matchMedia('(prefers-color-scheme: dark)');
  w.addEventListener('scroll', update, { passive: true });
  scheme.addEventListener('change', update);
  const later = setTimeout(update, 1000);
  current.unwatchScreen = () => {
    observer.disconnect();
    w.removeEventListener('scroll', update);
    scheme.removeEventListener('change', update);
    clearTimeout(later);
    cancelAnimationFrame(pending);
  };
  update();
}

// The website's own look: its background colour, else a `dark` class or data-theme on
// <html>/<body>, else the system preference.
function pageLooksDark() {
  for (const el of [document.body, html]) {
    const rgb = el && rgbOf(getComputedStyle(el).backgroundColor);
    if (rgb) return isDark(rgb);
  }
  const marker = `${html.className} ${document.body?.className || ''} ${html.dataset.theme || ''} ${html.getAttribute('data-mode') || ''}`;
  if (/\bdark\b/i.test(marker)) return true;
  if (/\blight\b/i.test(marker)) return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyHostTheme() {
  if (!current) return;
  const { host, themePref } = current;
  host.dataset.theme = themePref === 'auto' ? (pageLooksDark() ? 'dark' : 'light') : themePref;
}

// Sites switch theme with a class/attribute on <html>/<body>, or follow the system.
function watchPageTheme() {
  let pending = 0;
  const update = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(applyHostTheme);
  };
  const observer = new MutationObserver(update);
  const watch = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] };
  observer.observe(html, watch);
  if (document.body) observer.observe(document.body, watch);
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', update);
  };
}

// ---------- more menu ----------

function toggleMenu(open = current.v.menu.hidden) {
  const { v } = current;
  if (open) renderMenu();
  v.menu.hidden = !open;
  v.more.setAttribute('aria-expanded', String(open));
  v.more.classList.toggle('open', open);
}

function renderMenu() {
  const { v, prefs, rec } = current;
  const check = (on) => `<i class="switch${on ? ' on' : ''}" aria-hidden="true"></i>`;
  const item = (name, text) => `<span class="item">${icon(name)}<span>${text}</span></span>`;
  const toggle = (act, name, text, on) =>
    `<button class="row" data-act="${act}" role="menuitemcheckbox" aria-checked="${on}">${item(name, text)}${check(on)}</button>`;
  v.menu.innerHTML = `
    <button class="row rec-item" data-act="record" role="menuitem">${item(rec ? 'stop' : 'record', rec ? 'Stop recording' : 'Record a video')}</button>
    <button class="row" data-act="theme" role="menuitem">${item(current.themePref, THEME_LABELS[current.themePref])}</button>
    <button class="row" data-act="rotate" role="menuitem">${item('rotate', current.config.orientation === 'portrait' ? 'Rotate to landscape' : 'Rotate to portrait')}</button>
    <hr>
    ${toggle('urlBar', 'address', 'Address bar', prefs.urlBar)}
    ${toggle('statusBar', 'status', 'Status bar', prefs.statusBar)}
    ${toggle('homeBar', 'home', 'Home indicator', prefs.homeBar)}
    ${toggle('sync', 'sync', 'Scroll sync with the page', prefs.sync)}
    <hr>
    ${toggle('caption', 'watermark', 'Watermark on screenshots', !!current.captionOn)}
    <div class="wm${current.captionOn ? '' : ' off'}">
      <input type="text" class="wm-text text-input" maxlength="60" placeholder="Watermark text" aria-label="Watermark text" value="${esc(current.captionText || '')}">
      <div class="wm-styles" role="radiogroup" aria-label="Watermark style">${CAPTION_STYLES.map((s) => `
        <button class="wm-style${current.captionStyle === s.id ? ' on' : ''}" role="radio" aria-checked="${current.captionStyle === s.id}" data-style="${s.id}" title="${s.label}">
          <b style="font: ${esc(captionFont(s, 16))}">${esc((current.captionText || 'JHM').slice(0, 10))}</b><small>${s.label}</small>
        </button>`).join('')}
      </div>
      <label class="wm-opacity"><span>Opacity</span><input type="range" min="10" max="100" step="5" value="${current.captionOpacity}" aria-label="Watermark opacity"><b>${current.captionOpacity}%</b></label>
    </div>
    <div class="wm-sub${current.captionOn ? '' : ' off'}">${toggle('caption-icon', 'logo', 'Extension icon watermark', !!current.captionIcon)}</div>
    <hr>
    <div class="label">${icon('dock')}<span>Open in the simulator</span></div>
    <button class="row" data-act="sim-overlay" role="menuitem">${item('full', 'Full screen simulator')}</button>
    <button class="row" data-act="sim-panel" role="menuitem">${item('panel', 'Side panel')}</button>
    <hr>
    <div class="label">${icon('palette')}<span>Frame colour</span></div>
    <div class="swatches">${FINISHES.map((f) => `<i data-finish="${f.id}" title="${f.name}" class="${current.finish.id === f.id ? 'on' : ''}" style="background: linear-gradient(135deg, ${f.a}, ${f.b})"></i>`).join('')}</div>`;
  v.menu.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => menuAction(b.dataset.act)));
  v.menu.querySelectorAll('[data-finish]').forEach((sw) =>
    sw.addEventListener('click', () => {
      current.finish = { id: sw.dataset.finish };
      chrome.storage.local.set({ finish: current.finish }).catch(() => {});
      applyFinish();
      renderMenu();
    }),
  );
  // The watermark lives in the simulator's export settings (shared with its screenshots).
  v.menu.querySelector('.wm-text').addEventListener('change', (e) => setWatermark({ captionText: e.target.value.trim() || 'JHM' }));
  const opacity = v.menu.querySelector('.wm-opacity input');
  opacity.addEventListener('input', () => (v.menu.querySelector('.wm-opacity b').textContent = `${opacity.value}%`));
  opacity.addEventListener('change', () => setWatermark({ captionOpacity: Number(opacity.value) }));
  v.menu.querySelectorAll('[data-style]').forEach((b) =>
    b.addEventListener('click', () => loadCaptionFonts([b.dataset.style]).then(() => setWatermark({ captionStyle: b.dataset.style }))),
  );
  if (!current.watermarkLoaded) {
    current.watermarkLoaded = true;
    Promise.all([chrome.storage.local.get('exportOpts'), loadCaptionFonts()]).then(([{ exportOpts }]) => {
      if (!current) return;
      const o = { ...DEFAULT_EXPORT, ...(exportOpts || {}) };
      Object.assign(current, watermarkState(o));
      if (!v.menu.hidden) renderMenu();
    });
  }
}

async function menuAction(act) {
  const { prefs } = current;
  if (act === 'sim-overlay' || act === 'sim-panel') {
    toggleMenu(false);
    const reply = await chrome.runtime.sendMessage({ type: 'page-mode-open-sim', where: act === 'sim-panel' ? 'panel' : 'overlay' }).catch((err) => ({ ok: false, error: err.message }));
    if (reply?.ok) close();
    else notify(act === 'sim-panel' ? 'Chrome only opens the side panel from the extension icon: click it once.' : `Could not open the simulator: ${reply?.error}`);
    return;
  }
  if (act === 'theme') {
    current.themePref = THEMES[(THEMES.indexOf(current.themePref) + 1) % THEMES.length];
    chrome.storage.local.set({ pageModeTheme: current.themePref }).catch(() => {});
    applyHostTheme();
    renderMenu();
    return;
  }
  if (act === 'rotate') {
    toggleMenu(false);
    open({ ...current.config, orientation: current.config.orientation === 'portrait' ? 'landscape' : 'portrait' }, { source: 'menu' });
    return;
  }
  if (act === 'record') {
    toggleMenu(false);
    (current.rec ? stopRecording() : startRecording()).catch((err) => notify(`Recording failed: ${err.message}`));
    return;
  }
  if (act === 'caption-icon') {
    await setWatermark({ captionIcon: !current.captionIcon });
    return;
  }
  if (act === 'caption') {
    await setWatermark({ caption: !current.captionOn });
  } else {
    prefs[act] = !prefs[act];
    savePrefs();
    if (act === 'sync') setupSync();
    else open(current.config, { source: 'menu' }); // status bar / address bar change the layout
  }
  renderMenu();
}

// Watermark settings are the simulator's export options (one look for both).
const watermarkState = (o) => ({
  captionOn: o.caption,
  captionText: o.captionText,
  captionStyle: captionStyle(o.captionStyle).id,
  captionOpacity: o.captionOpacity,
  captionIcon: o.captionIcon,
});

async function setWatermark(patch) {
  const { exportOpts } = await chrome.storage.local.get('exportOpts');
  const opts = { ...DEFAULT_EXPORT, ...(exportOpts || {}), ...patch };
  await chrome.storage.local.set({ exportOpts: opts });
  if (!current) return;
  Object.assign(current, watermarkState(opts));
  renderMenu();
}

const savePrefs = () => chrome.storage.local.set({ [PREFS_KEY]: current.prefs }).catch(() => {});

function applyFinish() {
  const { a, b, angle } = finishColors(current.finish);
  const style = current.host.style;
  style.setProperty('--rim-a', a);
  style.setProperty('--rim-b', b);
  style.setProperty('--rim-angle', `${angle}deg`);
}

// ---------- address bar ----------

function bindUrlBar(shadow) {
  const { v } = current;
  const win = () => v.iframe.contentWindow;
  shadow.querySelector('.ub-back').addEventListener('click', () => win()?.history.back());
  shadow.querySelector('.ub-fwd').addEventListener('click', () => win()?.history.forward());
  shadow.querySelector('.ub-reload').addEventListener('click', () => win()?.location.reload());
  v.url.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    let target;
    try {
      target = new URL(v.url.value.trim(), location.href);
    } catch {
      return;
    }
    // Another site would leave page mode's reach (and its permissions): open it in the tab.
    if (target.origin !== location.origin) {
      notify(`The phone stays on ${location.hostname}; open other sites in the tab itself.`);
      return;
    }
    v.iframe.src = target.href;
    v.url.blur();
  });
}

// ---------- resize (dock) ----------

function bindGrip(grip) {
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    current.host.classList.add('resizing');
    const move = (ev) => {
      current.prefs.dockWidth = Math.round(innerWidth - ev.clientX);
      layout();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      current.host.classList.remove('resizing');
      savePrefs();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });
  grip.addEventListener('dblclick', () => {
    current.prefs.dockWidth = 0;
    savePrefs();
    layout();
  });
}

// ---------- scroll sync (by percentage, both ways) ----------

function setupSync() {
  current.unsync();
  current.unsync = () => {};
  const inner = current.v.iframe.contentWindow;
  if (!current.prefs.sync || !inner) return;
  let lockedUntil = 0;
  const ratio = (w) => {
    const el = w.document.scrollingElement || w.document.documentElement;
    const max = el.scrollHeight - w.innerHeight;
    return max > 0 ? el.scrollTop / max : 0;
  };
  // The scroll we cause on the other side echoes back as an event: ignore it briefly.
  const follow = (from, to) => () => {
    if (performance.now() < lockedUntil) return;
    lockedUntil = performance.now() + 120;
    const el = to.document.scrollingElement || to.document.documentElement;
    to.scrollTo({ top: ratio(from) * (el.scrollHeight - to.innerHeight), behavior: 'instant' });
  };
  const fromPage = follow(window, inner);
  const fromPhone = follow(inner, window);
  addEventListener('scroll', fromPage, { passive: true });
  inner.addEventListener('scroll', fromPhone, { passive: true });
  current.unsync = () => {
    removeEventListener('scroll', fromPage);
    try {
      inner.removeEventListener('scroll', fromPhone);
    } catch {
      // the phone's page is gone
    }
  };
}

// ---------- screenshot (same composition as the simulator's screenshot dialog) ----------

let lastCaptureAt = 0;
async function grabTab() {
  const wait = lastCaptureAt + CAPTURE_GAP_MS - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCaptureAt = performance.now();
  const reply = await chrome.runtime.sendMessage({ type: 'page-mode-shot' });
  if (!reply?.ok) throw new Error(reply?.error || 'capture refused');
  const img = new Image();
  img.src = reply.dataUrl;
  await img.decode();
  return img;
}
const frames = (n = 2) => new Promise((r) => {
  const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : r());
  step(n);
});

/**
 * The phone's screen at SHOT_DENSITY, whatever the window size: the phone is drawn that big
 * in the full window and captured tile by tile (the window shows one part at a time).
 */
async function captureScreenHD() {
  const { v, host } = current;
  const g = v.g;
  let density = shotDensity() / devicePixelRatio;
  // Area shown during the capture: the docked panel itself when the screen fits in it (the
  // page stays visible), else the whole window.
  const panel = host.getBoundingClientRect();
  const fitsPanel = current.config.layout === 'dock' && g.w * density <= panel.width && g.h * density <= innerHeight;
  const areaW = fitsPanel ? panel.width : innerWidth;
  const tiles = (k) => Math.ceil((g.w * k) / areaW) * Math.ceil((g.h * k) / innerHeight);
  while (density > 1 && tiles(density) > SHOT_MAX_TILES) density -= 0.25;
  density = Math.max(1, density);
  const cols = Math.ceil((g.w * density) / areaW);
  const rows = Math.ceil((g.h * density) / innerHeight);
  const originX = fitsPanel ? panel.left : 0;
  const prevTransform = v.device.style.transform;
  host.classList.toggle('capture-in-panel', fitsPanel);
  host.classList.add('capturing');
  let canvas = null;
  try {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Screen's top-left at (-col·W, -row·H): this tile of the screen fills the window.
        const x = -g.bezel[3] * density - col * areaW;
        const y = -g.bezel[0] * density - row * innerHeight;
        v.device.style.transform = `translate(${x}px, ${y}px) scale(${density})`;
        await frames(3);
        const img = await grabTab();
        const ratio = img.naturalWidth / innerWidth;
        const r = v.screen.getBoundingClientRect();
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.width = Math.round(r.width * ratio);
          canvas.height = Math.round(r.height * ratio);
        }
        const x0 = Math.max(originX, r.left);
        const y0 = Math.max(0, r.top);
        const w = Math.min(originX + areaW, innerWidth, r.right) - x0;
        const h = Math.min(innerHeight, r.bottom) - y0;
        if (w > 0 && h > 0) {
          canvas.getContext('2d').drawImage(img, x0 * ratio, y0 * ratio, w * ratio, h * ratio, (x0 - r.left) * ratio, (y0 - r.top) * ratio, w * ratio, h * ratio);
        }
      }
    }
  } finally {
    host.classList.remove('capturing', 'capture-in-panel');
    v.device.style.transform = prevTransform;
    layout();
  }
  return canvas;
}

async function screenshot() {
  const { v } = current;
  const { exportOpts, finish } = await chrome.storage.local.get(['exportOpts', 'finish']);
  const opts = { ...DEFAULT_EXPORT, ...(exportOpts || {}) };
  await loadCaptionFonts([captionStyle(opts.captionStyle).id]);
  const canvas = await captureScreenHD();
  const captures = [{ canvas, g: v.g }];
  const { items, draw } = shotScene(captures, opts, finish || DEFAULT_FINISH);
  const out = computeLayout(opts, items, canvas.width / v.g.w);
  const sheet = document.createElement('canvas');
  sheet.width = out.W;
  sheet.height = out.H;
  paint(sheet.getContext('2d'), out, opts, draw);
  const blob = await encode(sheet, opts.format);
  await save(blob, 'screenshot', extensionOf(opts.format));
  v.flash.classList.remove('on');
  void v.flash.offsetWidth;
  v.flash.classList.add('on');
}

// Saved quietly (no Chrome download bubble), then a toast with "Show in folder".
async function save(blob, kind, ext) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const filename = `${kind}-${location.hostname}-${current?.v.d.id || 'phone'}-${stamp}.${ext}`;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const reply = await chrome.runtime.sendMessage({ type: 'page-mode-save', dataUrl, filename }).catch((err) => ({ ok: false, error: err.message }));
  const label = kind === 'recording' ? 'Video saved' : 'Screenshot saved';
  if (reply?.ok) {
    notify(label, { label: 'Show in folder', run: () => chrome.runtime.sendMessage({ type: 'page-mode-show-download', id: reply.id }).catch(() => {}) }, { sticky: false });
    return;
  }
  // Downloads API unavailable: a plain download (Chrome shows its own bubble).
  console.warn('[mobile-sim] quiet download', reply?.error);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  notify(label);
}

// ---------- device picker (the simulator's, in a popover) ----------

let pickerTab = null;
let pickerQuery = '';

function toggleDevicePicker(open = current.v.devPop.hidden) {
  const { v } = current;
  if (open) {
    toggleMenu(false);
    pickerTab = null;
    pickerQuery = '';
    renderDevicePicker();
  }
  v.devPop.hidden = !open;
  v.devBtn.classList.toggle('open', open);
  if (open) v.devPop.querySelector('input')?.focus({ preventScroll: true });
}

function renderDevicePicker() {
  const { v, config } = current;
  const tabs = PICKER_TABS.filter((t) => t !== 'custom' || customDevices.length);
  const tab = pickerTab || deviceOf(config.deviceId).group || 'iphone';
  v.devPop.innerHTML = `
    <div class="dev-head"><b>Device</b></div>
    <label class="dev-search">${icon('search')}<input placeholder="Search devices" autocomplete="off" value="${esc(pickerQuery)}"></label>
    <div class="dev-tabs" role="tablist">
      ${tabs.map((t) => `<button class="dev-tab${t === tab && !pickerQuery ? ' on' : ''}" role="tab" data-tab="${t}">${TAB_LABELS[t]}</button>`).join('')}
    </div>
    <div class="dev-grid"></div>`;
  renderDeviceGrid(tab);
  const input = v.devPop.querySelector('input');
  input.addEventListener('input', () => {
    pickerQuery = input.value;
    v.devPop.querySelectorAll('.dev-tab').forEach((b) => b.classList.toggle('on', !pickerQuery && b.dataset.tab === tab));
    renderDeviceGrid(tab);
  });
  v.devPop.querySelectorAll('.dev-tab').forEach((b) =>
    b.addEventListener('click', () => {
      pickerTab = b.dataset.tab;
      pickerQuery = '';
      renderDevicePicker();
    }),
  );
}

function renderDeviceGrid(tab) {
  const { v, config } = current;
  const q = pickerQuery.trim().toLowerCase();
  const list = allDevices().filter((d) => FRAMES[d.frame]?.os !== 'desktop' && (q ? d.name.toLowerCase().includes(q) : d.group === tab));
  const grid = v.devPop.querySelector('.dev-grid');
  grid.innerHTML = list.length
    ? list.map((d) => deviceCard(d, d.id === config.deviceId)).join('').replace(/<span class="del"[\s\S]*?<\/span>/g, '')
    : `<p class="dev-empty">No device matches “${esc(pickerQuery.trim())}”</p>`;
  grid.querySelectorAll('.dev-card').forEach((card) =>
    card.addEventListener('click', () => {
      toggleDevicePicker(false);
      open({ ...current.config, deviceId: card.dataset.id }, { source: 'menu' });
    }),
  );
}

// ---------- recording ----------

// This tab without a prompt when Chrome allows it, else Chrome's "share this tab" prompt
// cropped to the phone (same fallback as the simulator).
async function openRecordingStream(menuStreamId, fps) {
  const reply = menuStreamId ? { ok: true, streamId: menuStreamId } : await chrome.runtime.sendMessage({ type: 'page-mode-capture-id' }).catch(() => null);
  if (reply?.ok) {
    try {
      const w = Math.round(innerWidth * devicePixelRatio);
      const h = Math.round(innerHeight * devicePixelRatio);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        // The exact window size in device pixels: otherwise Chrome picks its own size and letterboxes.
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: reply.streamId, maxFrameRate: fps, minWidth: w, maxWidth: w, minHeight: h, maxHeight: h } },
      });
      return { stream, cropped: false };
    } catch (err) {
      console.warn('[mobile-sim] tab capture unavailable', err);
    }
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps } },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  });
  const [track] = stream.getVideoTracks();
  if (track.cropTo && window.CropTarget) {
    try {
      await track.cropTo(await CropTarget.fromElement(current.v.device));
      return { stream, cropped: true };
    } catch (err) {
      console.warn('[mobile-sim] crop unavailable', err);
    }
  }
  return { stream, cropped: false };
}

// A video only has the pixels the phone takes on screen: while recording, the phone fills
// the window (the page comes back when it stops).
async function enterRecordingStage(on) {
  const { host } = current;
  host.classList.toggle('rec-stage', on);
  layout();
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  if (current) current.recRect = null;
}

async function startRecording(menuStreamId = null) {
  const { v } = current;
  const { recordOpts } = await chrome.storage.local.get('recordOpts');
  const preset = QUALITY[recordOpts?.quality] || QUALITY.high;
  toggleMenu(false);
  await enterRecordingStage(true);
  let stream;
  let cropped;
  try {
    ({ stream, cropped } = await openRecordingStream(menuStreamId, preset.fps));
  } catch (err) {
    await enterRecordingStage(false);
    throw err;
  }
  const [track] = stream.getVideoTracks();
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const r0 = v.device.getBoundingClientRect();
  // Device pixels the phone covers, capped by the preset's density and the encoder's limit.
  const density = Math.min(devicePixelRatio, (preset.maxUnit * v.g.outerW) / r0.width);
  const k = Math.min(density, 4096 / Math.max(r0.width, r0.height));
  const W = even(r0.width * k);
  const H = even(r0.height * k);
  const render = (ctx, frame) => {
    if (!current) return;
    ctx.clearRect(0, 0, W, H);
    if (cropped) {
      ctx.drawImage(frame, 0, 0, W, H);
      return;
    }
    const r = (current.recRect ??= v.device.getBoundingClientRect());
    // The tab fits the frame at one scale, centred (letterbox bars when the shapes differ).
    const s = Math.min(frame.displayWidth / innerWidth, frame.displayHeight / innerHeight);
    const ox = (frame.displayWidth - innerWidth * s) / 2;
    const oy = (frame.displayHeight - innerHeight * s) / 2;
    ctx.drawImage(frame, ox + r.left * s, oy + r.top * s, r.width * s, r.height * s, 0, 0, W, H);
  };
  let recorder;
  try {
    recorder = await createRecorder({ track, width: W, height: H, fps: preset.fps, bitsPerPixel: preset.bitsPerPixel, render });
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await enterRecordingStage(false);
    throw err;
  }
  const start = Date.now();
  const timer = setInterval(() => {
    const t = Math.floor((Date.now() - start) / 1000);
    v.recT.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }, 250);
  current.rec = { recorder, stream, timer };
  v.recT.textContent = '0:00';
  v.shotBtn.disabled = true;
  track.addEventListener('ended', () => stopRecording().catch(() => {}));
}

async function stopRecording() {
  const rec = current?.rec;
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  clearInterval(rec.timer);
  try {
    const blob = await rec.recorder.stop();
    await save(blob, 'recording', 'mp4');
  } finally {
    rec.stream.getTracks().forEach((t) => t.stop());
    if (current) {
      current.rec = null;
      current.v.shotBtn.disabled = false;
      await enterRecordingStage(false);
    }
  }
}
