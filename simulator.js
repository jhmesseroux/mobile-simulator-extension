import {
  DEVICES, FRAMES, GROUPS, CUSTOM_TYPES, FINISHES, DEFAULT_DEVICE, DEFAULT_COMPARE, DEFAULT_FINISH, geometry, finishColors,
} from './lib/devices.js';
import { BACKGROUNDS, RATIOS, DEFAULT_EXPORT, computeLayout, paint, supportedFormats, encode, extensionOf, isDarkColor } from './lib/export.js';
import { applyRules, clearRules } from './lib/rules.js';
import { createRecorder } from './lib/recorder.js';
import { keyboardOs, keyboardHeight, renderKeyboard } from './lib/keyboard.js';

const $ = (sel, root = document) => root.querySelector(sel);
const stage = $('#stage');
const urlInput = $('#url');
const devicePanel = $('#devicePanel');
const settingsPanel = $('#settingsPanel');
const finishPanel = $('#finishPanel');
const shotDialog = $('#shotDialog');
const recordPanel = $('#recordPanel');
const syncPanel = $('#syncPanel');
const reviewDialog = $('#reviewDialog');
const POPOVERS = [devicePanel, settingsPanel, finishPanel, recordPanel, syncPanel, $('#zoomPanel')];

const DEFAULT_RECORD = { countdown: true, mic: false, quality: 'high', look: 'phone' };

const STORED = ['deviceId', 'orientation', 'zoom', 'compare', 'compareIds', 'theme', 'touch', 'showFrame', 'mobileUA', 'custom', 'finish', 'exportOpts', 'glow', 'recordOpts', 'recent', 'scrollSync', 'syncMode', 'syncDir', 'keyboard', 'urlBar', 'labelShow', 'labelPos', 'statusBar', 'homeBar', 'dockPos'];
const state = {
  url: '',
  deviceId: DEFAULT_DEVICE,
  orientation: 'portrait',
  zoom: 'fit',
  compare: false,
  compareIds: DEFAULT_COMPARE,
  theme: 'dark',
  touch: true,
  showFrame: true,
  mobileUA: true,
  custom: [],
  finish: DEFAULT_FINISH,
  exportOpts: DEFAULT_EXPORT,
  glow: true,
  recordOpts: DEFAULT_RECORD,
  recent: [],
  scrollSync: true,
  syncMode: 'percent', // 'percent' | 'section'
  syncDir: 'both', // 'both' | 'site' (website → phone only)
  keyboard: true,
  urlBar: false, // our own back/forward/reload/address bar; Chrome's are used by default
  labelShow: true,
  labelPos: 'br', // 'br' | 'bl' | 'bc' | 'tl' | 'under' (compare mode always uses 'under')
  statusBar: true,
  homeBar: true,
  dockPos: 'right', // 'right' | 'left' | 'top' | 'bottom' (the side panel keeps it at the bottom)
};

const MIN_COMPARE = 2;
const MAX_COMPARE = 5;
const ISLAND_CARD_MS = 3000;
// Chrome allows about two captureVisibleTab calls per second.
const CAPTURE_GAP_MS = 520;
// Video presets: frame rate, bitrate per pixel per frame, and the highest output density.
const QUALITY = {
  good: { fps: 30, bitsPerPixel: 0.06, maxUnit: 1.5 },
  high: { fps: 60, bitsPerPixel: 0.1, maxUnit: 2 },
  max: { fps: 60, bitsPerPixel: 0.16, maxUnit: 3 },
};
const COUNTDOWN_S = 3;
const COMPARE_SYNC_QUIET_MS = 4000;
const ROTATE_MS = 850; // a bit longer than the CSS turn-in animation
// Zoom levels: the +/− control steps through them, the zoom menu lists them (largest first).
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];
const SAVE_DELAY_MS = 300;
const MAX_RECENT = 5;
const MENU_MAX_H = 640;
const ZOOM_CTL_BOTTOM = 60; // clear of the 48px bottom edge blur
const TAB_LABELS = { iphone: 'iPhone', android: 'Android', tablet: 'Tablets', desktop: 'Desktop', custom: 'Custom' };
const VIDEO_MAX_SIDE = 4096;
const VIDEO_MAX_PIXELS = 8_000_000;

const views = [];
let tabId = null;
let rulesPlatform = null;
let rec = null;
let formats = [];
let shot = null; // open screenshot dialog: { captures, res }
let lastCaptureAt = 0;
let review = null; // open review dialog: { blob, url, name }
let countdown = null; // running countdown: { cancelled }
let devTab = null;
let devQuery = '';
let openerUrl = '';
// 'tab': own tab (new-tab mode) · 'overlay': full screen over a website · 'panel': Chrome side panel
let mode = 'tab';
let windowId = null;
let overlayAction = '';
let activeTabId = null; // side panel: the tab the phone follows

const SB_ICONS = `
  <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg class="wifi" viewBox="0 0 16 12"><path d="M1.5 4.6a9.2 9.2 0 0 1 13 0"/><path d="M4.1 7.3a5.5 5.5 0 0 1 7.8 0"/><circle cx="8" cy="10.2" r="1.5"/></svg>
  <svg viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="18" height="9" rx="2"/><path d="M25 4.5v4a2 2 0 0 0 0-4Z" opacity=".45"/></svg>`;

const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation';
const IFRAME_ALLOW = 'clipboard-read; clipboard-write; fullscreen; geolocation; camera; microphone; autoplay; encrypted-media; picture-in-picture; web-share';

// ---------- helpers ----------

const allDevices = () => [...DEVICES, ...state.custom];
const deviceById = (id) => allDevices().find((d) => d.id === id);

const comparing = () => state.compare && mode !== 'panel';

function activeDevices() {
  if (comparing()) {
    const list = state.compareIds.map(deviceById).filter(Boolean);
    if (list.length) return list;
  }
  return [deviceById(state.deviceId) || deviceById(DEFAULT_DEVICE)];
}

// Settings are saved shortly after the last change (sliders fire many events per second).
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set(Object.fromEntries(STORED.map((k) => [k, state[k]]))).catch((err) => console.error('[mobile-sim] save', err));
  }, SAVE_DELAY_MS);
}
addEventListener('pagehide', () => {
  // Flush a pending save when the page goes away.
  if (saveTimer) chrome.storage.local.set(Object.fromEntries(STORED.map((k) => [k, state[k]])));
});

const pad2 = (n) => String(n).padStart(2, '0');
const logError = (label) => (err) => console.error(`[mobile-sim] ${label}`, err);

// Segmented controls: mark the active button, and react to clicks on any of them.
const markSeg = (el, value, sel = 'button') => el.querySelectorAll(sel).forEach((b) => b.classList.toggle('on', b.dataset.v === String(value)));
const onSeg = (el, fn, sel = 'button') =>
  el.addEventListener('click', (e) => {
    const v = e.target.closest(sel)?.dataset.v;
    if (v) fn(v);
  });

// CSS background for a screenshot look (swatches, record "Look" card).
function backgroundCss(e) {
  if (e.background === 'none') return 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 8px 8px';
  if (e.background === 'solid') return e.solid;
  const g = e.background === 'custom' ? e.custom : BACKGROUNDS.find((b) => b.id === e.background) || BACKGROUNDS[0];
  return `linear-gradient(${g.angle}deg, ${g.a}, ${g.b})`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function normalizeUrl(raw) {
  const s = raw.trim();
  if (!s) return '';
  let candidate = s;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s)) {
    const local = /^(localhost|127\.|\d+\.\d+\.\d+\.\d+|\[::1\])/i.test(s);
    candidate = (local ? 'http://' : 'https://') + s;
  }
  try {
    const u = new URL(candidate);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const faviconOf = (url) => `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=64`;

function fileName(kind, ext) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const device = comparing() ? 'compare' : views[0].d.name;
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${kind}-${slug(hostOf(views[0].url) || 'page')}-${slug(device)}-${stamp}.${ext}`;
}

function download(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

// ---------- header rules ----------

const ruleTarget = () => (mode === 'panel' ? (windowId == null ? null : { windowId }) : tabId == null ? null : { tabId });

// Returns true when the user agent changed, so already-loaded pages must reload.
async function ensureRules(device) {
  const platform = state.mobileUA ? FRAMES[device.frame].os : 'none';
  const target = ruleTarget();
  if (platform === rulesPlatform || !target) return false;
  const first = rulesPlatform === null;
  rulesPlatform = platform;
  try {
    await applyRules(target, platform);
  } catch (err) {
    console.error('[mobile-sim] rules', err);
    toast('Could not set up the simulator rules');
  }
  return !first;
}

// ---------- views ----------

function createView() {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.innerHTML = `
    <div class="device-box">
      <div class="device">
        <i class="hw hw-action"></i><i class="hw hw-vol1"></i><i class="hw hw-vol2"></i><i class="hw hw-power"></i>
        <i class="speaker"></i><i class="home-btn"></i>
        <div class="screen">
          <div class="statusbar"><span class="sb-time"></span><span class="sb-icons">${SB_ICONS}</span></div>
          <iframe sandbox="${IFRAME_SANDBOX}" allow="${IFRAME_ALLOW}"></iframe>
          <div class="placeholder">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
            Type a website address above to start
            <div class="suggest"></div>
          </div>
          <div class="progress"></div>
          <div class="island" title="Click me">
            <span class="isl-l"><i class="isl-spin"></i></span>
            <span class="isl-r"><img class="isl-mini" alt=""></span>
            <div class="isl-card"><img class="isl-fav" alt=""><div class="isl-text"><b></b><small></small></div></div>
          </div>
          <i class="notch"></i><i class="punch"></i>
          <div class="kb" aria-hidden="true"></div>
          <i class="home-ind"></i>
          <i class="touch-dot"></i>
          <i class="flash"></i>
        </div>
      </div>
      <i class="base"></i>
    </div>
    <div class="label"><b></b><span></span><button class="label-del" aria-label="Remove this device" title="Remove from comparison"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
  stage.append(slot);

  const v = {
    slot,
    box: $('.device-box', slot),
    base: $('.base', slot),
    device: $('.device', slot),
    screen: $('.screen', slot),
    statusbar: $('.statusbar', slot),
    iframe: $('iframe', slot),
    progress: $('.progress', slot),
    island: $('.island', slot),
    dot: $('.touch-dot', slot),
    kb: $('.kb', slot),
    kbOpen: false,
    url: '',
    title: '',
    loading: false,
    expanded: false,
  };
  $('.sb-time', slot).textContent = clockText();
  renderSuggestions(slot);
  v.iframe.addEventListener('load', () => {
    if (!v.url) return;
    setLoading(v, false);
    bumpIsland(v);
    if (v === views[0]) {
      runOverlayAction();
      alignPhoneWithSite();
    }
  });
  v.island.addEventListener('click', () => expandIsland(v));
  $('.label-del', slot).addEventListener('click', () => removeFromCompare(v.d.id));
  return v;
}

function updateView(v, d, showFrame = state.showFrame) {
  v.d = d;
  const g = geometry(d, state.orientation, showFrame);
  v.g = g;
  const [, r, , l] = g.inset;
  // Status bar switched off: the page starts at the top of the screen.
  const t = state.statusBar ? g.inset[0] : 0;
  v.top = t;
  v.left = l;
  const desktop = FRAMES[d.frame].os === 'desktop';
  v.slot.classList.toggle('desktop', desktop);

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
  sizeIframe(v);
  if (v.kbOpen) renderKb(v);
  v.progress.style.top = `${t}px`;
  v.screen.classList.toggle('has-url', !!state.url);

  $('.label b', v.slot).textContent = d.name;
  $('.label span', v.slot).textContent = `${g.w} × ${g.h}`;
  renderIsland(v);
}

function load(v, url) {
  v.url = url;
  v.iframe.src = url;
  v.screen.classList.add('has-url');
  setLoading(v, true);
}

// Never rejects: callers fire it without awaiting, so failures are logged here.
async function syncViews({ reload = false } = {}) {
  try {
    const devices = activeDevices();
    const uaChanged = await ensureRules(devices[0]);
    while (views.length > devices.length) views.pop().slot.remove();
    devices.forEach((d, i) => {
      const fresh = !views[i];
      if (fresh) views[i] = createView();
      updateView(views[i], d);
      if (state.url && (fresh || uaChanged || reload)) load(views[i], fresh ? state.url : views[i].url || state.url);
    });
    applyLabels();
    layout();
    refreshToolbar();
  } catch (err) {
    logError('syncViews')(err);
  }
}

const STAGE_GAP = 56;

// All measurements first, then one round of style writes (no layout thrash).
function layout() {
  if (!views.length) return;
  let scale = Number(state.zoom);
  if (state.zoom === 'fit') {
    const cs = getComputedStyle(stage);
    // The stage padding keeps devices clear of the top bar, dock and edge blur.
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    // Only labels placed under the devices take room in the stage.
    const labelH = labelUnder() ? (comparing() ? 40 : 50) : 0;
    const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - labelH;
    const maxH = Math.max(...views.map((v) => v.g.outerH + v.g.baseH));
    const sumW = views.reduce((sum, v) => sum + v.g.outerW, 0) + STAGE_GAP * (views.length - 1);
    // Fit always shows every device whole, however many or large they are.
    scale = Math.max(0.05, Math.min(1, availH / maxH, availW / sumW));
    if (views.length > 1) {
      // Labels can be wider than small phones: each slot is as wide as its device or its
      // label (labels don't animate, so their width is reliable to measure).
      const labelW = views.map((v) => (labelUnder() ? $('.label', v.slot).offsetWidth : 0));
      const gaps = (parseFloat(cs.columnGap) || 0) * (views.length - 1);
      const rowWidth = (k) => views.reduce((sum, v, i) => sum + Math.max(v.g.outerW * k, labelW[i]), 0) + gaps;
      for (let i = 0; i < 4 && rowWidth(scale) > availW; i++) scale *= (availW / rowWidth(scale)) * 0.99;
      scale = Math.max(0.05, scale);
    }
  }
  applyScale(scale);
  requestAnimationFrame(placeZoomControl);
  if (rec) rec.rects = null; // device positions changed: the recorder re-measures
}

function applyScale(scale) {
  for (const v of views) {
    v.scale = scale;
    v.box.style.width = `${v.g.outerW * scale}px`;
    v.box.style.height = `${(v.g.outerH + v.g.baseH) * scale}px`;
    v.device.style.transform = `scale(${scale})`;
    v.base.style.top = `${v.g.outerH * scale}px`;
    v.base.style.transform = `scale(${scale})`;
  }
}

function setPageTheme(v, color) {
  if (!color) return;
  v.screen.style.setProperty('--page-bg', color);
  v.screen.classList.toggle('on-dark', isDarkColor(color));
}

// ---------- frame finish ----------

function applyFinish() {
  const { a, b, angle } = finishColors(state.finish);
  const root = document.documentElement.style;
  root.setProperty('--rim-a', a);
  root.setProperty('--rim-b', b);
  root.setProperty('--rim-angle', `${angle}deg`);
}

// Two pickers share this: the toolbar one drives the live phone (`state.showFrame`),
// the dialog one drives exports (`state.exportOpts.frame`).
const pickerIsExport = (container) => container.id === 'shotFinish';
const pickerFrameOn = (container) => (pickerIsExport(container) ? state.exportOpts.frame : state.showFrame);

function renderFinishPicker(container) {
  const current = state.finish;
  const frameOn = pickerFrameOn(container);
  const custom = current.id === 'custom' ? current : { ...DEFAULT_FINISH, id: 'custom' };
  const selected = (id) => (frameOn && current.id === id ? ' on' : '');
  const dot = (f) =>
    `<button class="finish-dot${selected(f.id)}" data-finish="${f.id}" title="${f.name}" style="background:linear-gradient(135deg, ${f.a}, ${f.b})"></button>`;
  const name = !frameOn ? 'No frame' : current.id === 'custom' ? 'Custom gradient' : FINISHES.find((f) => f.id === current.id)?.name || '';
  const inHeader = !pickerIsExport(container);
  if (inHeader) {
    const head = finishPanel.querySelector('.panel-head');
    let slot = head.querySelector('.head-name');
    if (!slot) {
      slot = document.createElement('span');
      slot.className = 'head-name';
      head.querySelector('b').after(slot);
    }
    slot.textContent = name;
  }
  container.innerHTML = `
    ${inHeader ? '' : `<div class="finish-name">${name}</div>`}
    <div class="finish-grid">
      <button class="finish-dot none${frameOn ? '' : ' on'}" data-finish="none" title="No frame"><svg viewBox="0 0 24 24"><path d="M5 19 19 5"/></svg></button>
      ${FINISHES.map(dot).join('')}
      <button class="finish-dot custom${selected('custom')}" data-finish="custom" title="Custom gradient"
        style="background:linear-gradient(${custom.angle}deg, ${custom.a}, ${custom.b})">+</button>
    </div>
    <div class="sub${frameOn && current.id === 'custom' ? ' show' : ''}">
      <input type="color" data-k="a" value="${custom.a}" title="First colour" aria-label="First colour">
      <input type="color" data-k="b" value="${custom.b}" title="Second colour" aria-label="Second colour">
      <input type="range" data-k="angle" min="0" max="360" step="5" value="${custom.angle}" title="Angle" aria-label="Angle">
    </div>`;
}

const renderFinishPickers = () => document.querySelectorAll('.finish-picker').forEach(renderFinishPicker);

function setFinish(finish) {
  state.finish = finish;
  save();
  applyFinish();
}

function setFrameShown(container, on) {
  if (pickerIsExport(container)) {
    state.exportOpts = { ...state.exportOpts, frame: on };
    save();
  } else if (state.showFrame !== on) {
    state.showFrame = on;
    $('#optFrame').checked = on;
    save();
    syncViews();
  }
}

function bindFinishPicker(container) {
  container.addEventListener('click', (e) => {
    const id = e.target.closest('[data-finish]')?.dataset.finish;
    if (!id) return;
    setFrameShown(container, id !== 'none');
    if (id !== 'none' && id !== state.finish.id) {
      const base = state.finish.id === 'custom' ? state.finish : { ...DEFAULT_FINISH };
      setFinish({ ...base, id });
    }
    // One redraw per click. The export frame is drawn, not captured.
    renderFinishPickers();
    if (shot) schedulePreview();
  });
  // Live preview while dragging; the pickers re-render once the input settles.
  container.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    state.finish = { ...state.finish, [k]: k === 'angle' ? Number(e.target.value) : e.target.value };
    applyFinish();
    $('.finish-dot.custom', container).style.background = `linear-gradient(${state.finish.angle}deg, ${state.finish.a}, ${state.finish.b})`;
  });
  container.addEventListener('change', (e) => {
    if (!e.target.dataset.k) return;
    setFinish({ ...state.finish });
    renderFinishPickers();
    if (shot) schedulePreview();
  });
}

// ---------- on-screen keyboard ----------

// The page's visible height: the screen minus the status bar, minus the keyboard when open.
function sizeIframe(v) {
  const b = v.g.inset[2];
  const bottom = v.kbOpen ? keyboardHeight(keyboardOs(v.d.frame), v.g.land) : b;
  v.iframe.style.height = `${v.g.h - v.top - bottom}px`;
}

function renderKb(v) {
  const os = keyboardOs(v.d.frame);
  v.kb.dataset.os = os;
  v.kb.style.height = `${keyboardHeight(os, v.g.land)}px`;
  v.kb.innerHTML = renderKeyboard(os, v.kbInfo, v.kbLayer, v.kbShift);
}

function openKeyboard(v, info) {
  if (!state.keyboard || FRAMES[v.d.frame].os === 'desktop') return;
  const sameField = v.kbOpen && JSON.stringify(v.kbInfo) === JSON.stringify(info);
  v.kbInfo = info;
  if (!sameField) {
    v.kbLayer = 'abc';
    v.kbShift = false;
    renderKb(v);
  }
  if (v.kbOpen) return;
  v.kbOpen = true;
  v.kb.classList.add('show');
  clearTimeout(v.kbTimer);
  // Like a phone: the page resizes once the keyboard is up, then the field is revealed.
  v.kbTimer = setTimeout(() => {
    if (!v.kbOpen) return;
    sizeIframe(v);
    post(v, { type: 'kb-shown' });
  }, 260);
}

function closeKeyboard(v) {
  if (!v.kbOpen) return;
  v.kbOpen = false;
  clearTimeout(v.kbTimer);
  v.kb.classList.remove('show');
  sizeIframe(v);
}

function pressKeyVisual(v, k) {
  const el = v.kb.querySelector(`[data-k="${CSS.escape(k)}"]`);
  if (!el) return;
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 140);
}

// A physical key typed in the page: light up the matching on-screen key.
function onPhysicalKey(v, key) {
  if (!v.kbOpen) return;
  const special = { Backspace: 'backspace', Enter: 'enter', ' ': 'space', Shift: 'shift' }[key];
  pressKeyVisual(v, special || (key.length === 1 ? (v.kbShift ? key : key.toLowerCase()) : ''));
}

function clickKey(v, k) {
  pressKeyVisual(v, k);
  if (k === 'shift') {
    v.kbShift = !v.kbShift;
    return renderKb(v);
  }
  if (k.startsWith('layer:')) {
    v.kbLayer = k.slice(6);
    v.kbShift = false;
    return renderKb(v);
  }
  if (k === 'emoji') return;
  const value = { backspace: 'Backspace', enter: 'Enter', space: ' ' }[k] || k;
  post(v, { type: 'kb-key', value });
  if (v.kbShift && k.length === 1) {
    v.kbShift = false;
    renderKb(v);
  }
}

function bindKeyboard() {
  // mousedown default would move focus out of the phone and close the keyboard.
  stage.addEventListener('mousedown', (e) => {
    if (e.target.closest('.kb')) e.preventDefault();
  });
  stage.addEventListener('click', (e) => {
    const keyEl = e.target.closest('.kb [data-k]');
    if (!keyEl) return;
    const v = views.find((view) => view.slot.contains(keyEl));
    if (v) clickKey(v, keyEl.dataset.k);
  });
}

// ---------- Dynamic Island ----------

function islandState(v) {
  if (v.d.frame !== 'island' || v.g.land) return 'idle';
  if (v.expanded) return 'expanded';
  if (v.loading) return 'loading';
  return 'idle';
}

function renderIsland(v) {
  v.island.dataset.state = islandState(v);
}

function bumpIsland(v) {
  if (islandState(v) !== 'idle' || v.g.land) return;
  v.island.classList.remove('bump');
  void v.island.offsetWidth;
  v.island.classList.add('bump');
}

function expandIsland(v) {
  if (v.d.frame !== 'island' || v.g.land || !v.url) return;
  $('.isl-fav', v.island).src = faviconOf(v.url);
  $('.isl-text b', v.island).textContent = v.title || hostOf(v.url);
  $('.isl-text small', v.island).textContent = hostOf(v.url);
  v.expanded = true;
  renderIsland(v);
  clearTimeout(v.expandTimer);
  v.expandTimer = setTimeout(() => {
    v.expanded = false;
    renderIsland(v);
  }, ISLAND_CARD_MS);
}

function setLoading(v, on) {
  v.loading = on;
  v.screen.classList.toggle('loading', on);
  if (on && v.url) $('.isl-mini', v.island).src = faviconOf(v.url);
  renderIsland(v);
}

// ---------- frame messages ----------

const post = (v, msg) => v.iframe.contentWindow?.postMessage({ __mobileSim: true, ...msg }, '*');

function onFrameMessage(e) {
  const data = e.data;
  if (!data?.__mobileSim) return;
  const v = views.find((view) => view.iframe.contentWindow === e.source);
  if (!v) return;
  switch (data.type) {
    case 'hello':
      post(v, { type: 'sync', value: phoneSync() });
      post(v, { type: 'touch', value: touchFor(v) });
      post(v, { type: 'recording', value: !!rec });
      break;
    case 'nav': {
      const moved = data.url !== v.url;
      v.url = data.url;
      v.title = data.title;
      // Compare: a page opened in one device opens in all of them. Loads we caused
      // (and their redirects, e.g. to a mobile site) are not sent back.
      if (moved && comparing() && Date.now() > (v.syncedUntil || 0)) {
        for (const o of views) {
          if (o === v || o.url === data.url) continue;
          o.syncedUntil = Date.now() + COMPARE_SYNC_QUIET_MS;
          load(o, data.url);
        }
      }
      setPageTheme(v, data.theme);
      if (v === views[0]) {
        // Full screen comes back on this page if the website is refreshed.
        if (mode === 'overlay') chrome.runtime.sendMessage({ type: 'overlay-nav', tabId, url: data.url }).catch(() => {});
        if (document.activeElement !== urlInput) urlInput.value = data.url;
        document.title = `${data.title || hostOf(data.url)} · Mobile Simulator`;
      }
      break;
    }
    case 'loading':
      setLoading(v, true);
      closeKeyboard(v);
      break;
    case 'kb-open':
      openKeyboard(v, data.info);
      break;
    case 'kb-close':
      closeKeyboard(v);
      break;
    case 'kb-press':
      onPhysicalKey(v, data.key);
      break;
    case 'reload-request':
      reloadPhones();
      break;
    case 'pointer':
      moveTouchDot(v, data);
      break;
    case 'scroll':
      // Phone scrolled by the user → move the website.
      if (mode === 'panel' && state.scrollSync && state.syncDir === 'both' && v === views[0] && activeTabId != null) {
        chrome.tabs.sendMessage(activeTabId, { type: 'ms-scroll-to', pos: data.pos }).catch(() => {});
      }
      break;
  }
}

function moveTouchDot(v, p) {
  const show = !!rec && state.touch && p.down && !p.out;
  v.dot.classList.toggle('show', show);
  if (!show) return;
  v.dot.style.left = `${v.left + p.x}px`;
  v.dot.style.top = `${v.top + p.y}px`;
}

// ---------- navigation & devices ----------

function navigate(raw) {
  const url = normalizeUrl(raw);
  if (!url) {
    toast('Enter a valid http(s) address');
    return;
  }
  state.url = url;
  applyUrlBar();
  rememberRecent(url);
  history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  views.forEach((v) => {
    v.syncedUntil = Date.now() + COMPARE_SYNC_QUIET_MS;
    load(v, url);
  });
  urlInput.value = url;
  urlInput.blur();
}

async function rotate() {
  if (rec) return toast('Stop recording to rotate');
  if (views.every((v) => FRAMES[v.d.frame].os === 'desktop')) return toast('Desktops are not rotated');
  state.orientation = state.orientation === 'portrait' ? 'landscape' : 'portrait';
  save();
  await syncViews();
  // Each device starts turned back a quarter (looking like before) and turns into place.
  const from = state.orientation === 'landscape' ? '90deg' : '-90deg';
  for (const v of views) {
    if (FRAMES[v.d.frame].os === 'desktop') continue;
    v.box.classList.remove('rotating');
    v.box.style.setProperty('--turn-from', from);
    void v.box.offsetWidth;
    v.box.classList.add('rotating');
    // Removed by a timer, not animationend: with reduced motion the animation never runs.
    clearTimeout(v.rotateTimer);
    v.rotateTimer = setTimeout(() => v.box.classList.remove('rotating'), ROTATE_MS);
  }
}

function toggleCompare({ keepPanel = false } = {}) {
  if (rec) return toast('Stop recording to change devices');
  state.compare = !state.compare;
  if (state.compare && state.compareIds.filter(deviceById).length < MIN_COMPARE) state.compareIds = DEFAULT_COMPARE;
  if (state.compare) state.zoom = 'fit';
  save();
  if (keepPanel) renderDevicePanel();
  else closePopovers();
  syncViews();
}

function pickDevice(id) {
  if (rec) return toast('Stop recording to change devices');
  if (comparing()) {
    const ids = state.compareIds.filter(deviceById);
    if (ids.includes(id)) {
      if (ids.length <= MIN_COMPARE) return toast(`Compare needs at least ${MIN_COMPARE} devices`);
      state.compareIds = ids.filter((x) => x !== id);
    } else {
      if (ids.length >= MAX_COMPARE) return toast(`Up to ${MAX_COMPARE} devices at once`);
      state.compareIds = [...ids, id];
    }
    renderDeviceGrid();
  } else {
    state.deviceId = id;
    closePopovers();
  }
  save();
  syncViews();
}

function removeFromCompare(id) {
  if (rec) return toast('Stop recording to change devices');
  const ids = state.compareIds.filter(deviceById);
  if (ids.length <= MIN_COMPARE) return toast(`Compare needs at least ${MIN_COMPARE} devices`);
  state.compareIds = ids.filter((x) => x !== id);
  save();
  syncViews();
}

function addCustomDevice(form) {
  const name = form.name.value.trim() || 'Custom device';
  const w = Math.round(Number(form.w.value));
  const h = Math.round(Number(form.h.value));
  if (!(w >= 200 && w <= 3000 && h >= 200 && h <= 3000)) return toast('Width and height must be between 200 and 3000');
  const device = { id: `custom-${Date.now()}`, name, group: 'custom', frame: CUSTOM_TYPES[form.type.value].frame, w, h };
  state.custom = [...state.custom, device];
  if (comparing() && state.compareIds.length < MAX_COMPARE) state.compareIds = [...state.compareIds, device.id];
  else if (!comparing()) state.deviceId = device.id;
  save();
  renderDevicePanel();
  syncViews();
}

function removeCustomDevice(id) {
  state.custom = state.custom.filter((d) => d.id !== id);
  state.compareIds = state.compareIds.filter((x) => x !== id);
  if (state.compareIds.length < MIN_COMPARE) state.compareIds = DEFAULT_COMPARE;
  if (state.deviceId === id) state.deviceId = DEFAULT_DEVICE;
  save();
  renderDevicePanel();
  syncViews();
}

// ---------- high-resolution capture ----------

async function grabTab() {
  const wait = lastCaptureAt + CAPTURE_GAP_MS - performance.now();
  if (wait > 0) await sleep(wait);
  lastCaptureAt = performance.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

// Captures one phone's screen exactly as it is (no movement). The frame is drawn into the
// image afterwards, so frame colour and frame on/off change instantly in the dialog.
async function captureDevice(v) {
  document.body.classList.add('snap');
  try {
    await nextFrame();
    const img = await grabTab();
    const ratio = img.naturalWidth / innerWidth;
    const r = v.screen.getBoundingClientRect();
    // Only the part inside the window can be captured.
    const x0 = Math.max(0, r.left);
    const y0 = Math.max(0, r.top);
    const w = Math.min(innerWidth, r.right) - x0;
    const h = Math.min(innerHeight, r.bottom) - y0;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(r.width * ratio);
    canvas.height = Math.round(r.height * ratio);
    canvas.getContext('2d').drawImage(img, x0 * ratio, y0 * ratio, w * ratio, h * ratio, (x0 - r.left) * ratio, (y0 - r.top) * ratio, w * ratio, h * ratio);
    return { canvas, g: geometry(v.d, state.orientation, true) };
  } finally {
    document.body.classList.remove('snap');
  }
}

// The device body for exports: metal rim in the current finish, highlight, black glass.
function drawFrame(ctx, box, g, unit) {
  const { a, b, angle } = finishColors(state.finish);
  const rim = g.rim * unit;
  const radius = g.radius * unit;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const along = () => ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  const shape = (inset, r) => {
    ctx.beginPath();
    ctx.roundRect(box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2, Math.max(0, r));
  };

  const metal = along();
  metal.addColorStop(0, a);
  metal.addColorStop(1, b);
  ctx.fillStyle = metal;
  shape(0, radius);
  ctx.fill();
  const shine = along();
  shine.addColorStop(0, 'rgba(255,255,255,.4)');
  shine.addColorStop(0.22, 'rgba(255,255,255,0)');
  shine.addColorStop(0.78, 'rgba(255,255,255,0)');
  shine.addColorStop(1, 'rgba(255,255,255,.2)');
  ctx.fillStyle = shine;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.33)';
  ctx.lineWidth = 0.75 * unit;
  shape(0.375 * unit, radius - 0.375 * unit);
  ctx.stroke();
  ctx.fillStyle = '#000';
  shape(rim, radius - rim);
  ctx.fill();
}

// Laptop deck or monitor stand under a desktop's screen, in the frame's finish.
function drawBase(ctx, box, g, unit) {
  const { a, b } = finishColors(state.finish);
  const metal = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  metal.addColorStop(0, a);
  metal.addColorStop(1, b);
  ctx.fillStyle = metal;
  ctx.beginPath();
  if (g.base === 'laptop') {
    // Deck as wide as the lid, with a notch to open it.
    ctx.roundRect(box.x, box.y, box.w, box.h, [0, 0, box.h * 0.6, box.h * 0.6]);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.roundRect(box.x + box.w * 0.42, box.y, box.w * 0.16, box.h * 0.32, [0, 0, 6 * unit, 6 * unit]);
    ctx.fill();
  } else {
    // Neck, then the foot.
    const neckW = box.w * 0.14;
    ctx.rect(box.x + (box.w - neckW) / 2, box.y, neckW, box.h * 0.82);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(box.x + box.w * 0.3, box.y + box.h * 0.82, box.w * 0.4, box.h * 0.18, 8 * unit);
    ctx.fill();
  }
}

// Layout items + draw callback for screenshots, from the captured screens.
function shotScene(opts) {
  const items = shot.captures.map(({ g }) =>
    opts.frame ? { w: g.outerW, h: g.outerH + g.baseH, radius: g.base ? 0 : g.radius } : { w: g.w, h: g.h, radius: g.screenRadius },
  );
  const draw = (ctx, box, i) => {
    const { canvas, g } = shot.captures[i];
    const unit = box.w / items[i].w;
    let screen = box;
    if (opts.frame) {
      drawFrame(ctx, { x: box.x, y: box.y, w: box.w, h: g.outerH * unit }, g, unit);
      if (g.base) drawBase(ctx, { x: box.x, y: box.y + g.outerH * unit, w: box.w, h: g.baseH * unit }, g, unit);
      screen = { x: box.x + g.bezel[3] * unit, y: box.y + g.bezel[0] * unit, w: g.w * unit, h: g.h * unit };
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(screen.x, screen.y, screen.w, screen.h, g.screenRadius * unit);
    ctx.clip();
    ctx.drawImage(canvas, screen.x, screen.y, screen.w, screen.h);
    ctx.restore();
  };
  return { items, draw };
}

// ---------- screenshot dialog ----------

async function openShotDialog() {
  if (!state.url) return toast('Open a website first');
  if (rec) return toast('Stop recording first');
  if (shot) return;
  closePopovers();
  views.forEach((v) => v.dot.classList.remove('show'));
  shot = { captures: [], res: 1 };
  // Start from what is on screen: no frame in the screenshot if the phone shows none.
  if (state.exportOpts.frame !== state.showFrame) {
    state.exportOpts = { ...state.exportOpts, frame: state.showFrame };
    save();
  }
  renderShotControls();
  // Capture before showing the dialog, so it opens once, already filled.
  if (!(await captureShot())) return;
  views.forEach((v) => {
    const flash = $('.flash', v.screen);
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    bumpIsland(v);
  });
  shotDialog.hidden = false;
  renderPreview();
}

// Captures every device as shown. Resolves to false when it failed (the dialog then closes).
async function captureShot() {
  setShotButtons(false);
  try {
    const captures = [];
    for (const v of views) captures.push(await captureDevice(v));
    if (!shot) return false;
    // Output pixels per CSS pixel, as captured.
    Object.assign(shot, { captures, res: captures[0].canvas.width / captures[0].g.w });
    return true;
  } catch (err) {
    logError('capture')(err);
    toast(`Screenshot failed: ${err.message}`);
    closeShotDialog();
    return false;
  } finally {
    setShotButtons(true);
  }
}

function setShotButtons(enabled) {
  for (const id of ['shotSave', 'shotCopy']) $(`#${id}`).disabled = !enabled;
}

function closeShotDialog() {
  shot = null;
  shotDialog.hidden = true;
}

function renderPreview() {
  if (!shot?.captures.length) return;
  const opts = state.exportOpts;
  const { items, draw } = shotScene(opts);
  const full = computeLayout(opts, items, shot.res);
  $('#shotDims').textContent = `${full.W} × ${full.H} px · ${opts.format.toUpperCase()}`;

  const box = $('.preview-canvas').getBoundingClientRect();
  const fit = Math.min(box.width / full.W, box.height / full.H, 1);
  const pixel = devicePixelRatio;
  const preview = computeLayout(opts, items, shot.res * fit * pixel);
  const canvas = $('#previewCanvas');
  canvas.width = preview.W;
  canvas.height = preview.H;
  canvas.style.width = `${preview.W / pixel}px`;
  canvas.style.height = `${preview.H / pixel}px`;
  paint(canvas.getContext('2d'), preview, opts, draw);
}

function renderFullShot() {
  const opts = state.exportOpts;
  const { items, draw } = shotScene(opts);
  const layoutFull = computeLayout(opts, items, shot.res);
  const canvas = document.createElement('canvas');
  canvas.width = layoutFull.W;
  canvas.height = layoutFull.H;
  paint(canvas.getContext('2d'), layoutFull, opts, draw);
  return canvas;
}

async function saveShot() {
  if (!shot?.captures.length) return;
  setShotButtons(false);
  try {
    const format = state.exportOpts.format;
    const blob = await encode(renderFullShot(), format);
    download(blob, fileName('screenshot', extensionOf(format)));
    closeShotDialog();
    toast('Screenshot saved');
  } catch (err) {
    toast(`Could not save: ${err.message}`);
  } finally {
    setShotButtons(true);
  }
}

async function copyShot() {
  if (!shot?.captures.length) return;
  try {
    // The clipboard only accepts PNG images.
    const blob = await encode(renderFullShot(), 'png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied to clipboard');
  } catch (err) {
    toast(`Could not copy: ${err.message}`);
  }
}

// controls: false while dragging a slider / colour / typing: only the preview follows.
function setExport(patch, { controls = true } = {}) {
  state.exportOpts = { ...state.exportOpts, ...patch };
  save();
  if (controls) renderShotControls();
  schedulePreview();
}

let previewFrame = 0;
function schedulePreview() {
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0;
    renderPreview();
  });
}

function renderShotControls() {
  const o = state.exportOpts;
  const seg = (el, items, current) => {
    el.innerHTML = items.map((i) => `<button data-v="${i.id}" class="${String(i.id) === String(current) ? 'on' : ''}">${i.label}</button>`).join('');
  };
  seg($('#fmtSeg'), formats, o.format);
  seg($('#ratioSeg'), RATIOS, o.ratio);

  const sw = (id, label, inner = '') =>
    `<button class="swatch${id === 'none' ? ' none' : ''}${o.background === id ? ' on' : ''}" data-bg="${id}" title="${label}" style="background:${backgroundCss({ ...o, background: id })}">${inner}</button>`;
  $('#bgSwatches').innerHTML = [
    sw('none', 'None (transparent)', '<svg viewBox="0 0 24 24"><path d="M5 19 19 5"/></svg>'),
    ...BACKGROUNDS.map((b) => sw(b.id, b.name)),
    sw('custom', 'Custom gradient', '+'),
    sw('solid', 'Solid colour'),
  ].join('');
  $('#bgCustom').classList.toggle('show', o.background === 'custom');
  $('#bgSolid').classList.toggle('show', o.background === 'solid');
  $('#bgA').value = o.custom.a;
  $('#bgB').value = o.custom.b;
  $('#bgAngle').value = o.custom.angle;
  $('#bgSolidColor').value = o.solid;

  $('#padRange').value = o.padding;
  $('#padVal').textContent = `${o.padding}px`;
  $('#shadowOpt').checked = o.shadow;
  $('#shadowRange').value = o.shadowStrength;
  $('#shadowRange').disabled = !o.shadow;
  $('#captionOpt').checked = o.caption;
  if (document.activeElement !== $('#captionText')) $('#captionText').value = o.captionText;
  $('#captionText').disabled = !o.caption;
}

function bindShotDialog() {
  onSeg($('#fmtSeg'), (v) => setExport({ format: v }));
  onSeg($('#ratioSeg'), (v) => setExport({ ratio: v }));
  $('#bgSwatches').addEventListener('click', (e) => {
    const v = e.target.closest('[data-bg]')?.dataset.bg;
    if (v) setExport({ background: v });
  });
  // While dragging, only the preview follows; the controls catch up on 'change'.
  const live = (el, patch) => {
    el.addEventListener('input', () => setExport(patch(), { controls: false }));
    el.addEventListener('change', () => renderShotControls());
  };
  const customColours = () => ({ custom: { a: $('#bgA').value, b: $('#bgB').value, angle: Number($('#bgAngle').value) } });
  for (const id of ['bgA', 'bgB', 'bgAngle']) live($(`#${id}`), customColours);
  live($('#bgSolidColor'), () => ({ solid: $('#bgSolidColor').value }));
  live($('#shadowRange'), () => ({ shadowStrength: Number($('#shadowRange').value) }));
  live($('#captionText'), () => ({ captionText: $('#captionText').value }));
  $('#padRange').addEventListener('input', (e) => {
    $('#padVal').textContent = `${e.target.value}px`;
    setExport({ padding: Number(e.target.value) }, { controls: false });
  });
  $('#shadowOpt').addEventListener('change', (e) => setExport({ shadow: e.target.checked }));
  $('#captionOpt').addEventListener('change', (e) => setExport({ caption: e.target.checked }));

  $('#shotCancel').addEventListener('click', closeShotDialog);
  $('#shotSave').addEventListener('click', saveShot);
  $('#shotCopy').addEventListener('click', copyShot);
  shotDialog.addEventListener('mousedown', (e) => {
    if (e.target === shotDialog) closeShotDialog();
  });
  addEventListener('resize', () => shot && schedulePreview());
}

// ---------- video recording ----------

// Fixed output size for the whole recording, matching the on-screen pixel density.
function videoLayout(opts, frame, maxUnit) {
  const items = views.map((v) => (frame ? { w: v.g.outerW, h: v.g.outerH, radius: v.g.radius } : { w: v.g.w, h: v.g.h, radius: v.g.screenRadius }));
  let unit = Math.min(maxUnit, Math.max(1, devicePixelRatio * views[0].scale));
  let result = computeLayout(opts, items, unit);
  const shrink = Math.min(1, VIDEO_MAX_SIDE / Math.max(result.W, result.H), Math.sqrt(VIDEO_MAX_PIXELS / (result.W * result.H)));
  if (shrink < 1) {
    unit *= shrink;
    result = computeLayout(opts, items, unit);
  }
  return result;
}

// Records this tab directly (no sharing prompt). Falls back to screen sharing,
// cropped to the devices, when tab capture is not available.
async function openCaptureStream(fps) {
  // Works without a prompt when the user clicked the extension icon on this tab.
  const w = Math.round(innerWidth * devicePixelRatio);
  const h = Math.round(innerHeight * devicePixelRatio);
  for (const options of [{ targetTabId: tabId }, { targetTabId: tabId, consumerTabId: tabId }]) {
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId(options);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, minWidth: w, maxWidth: w, minHeight: h, maxHeight: h, maxFrameRate: fps } },
      });
      return { stream, cropEl: null };
    } catch (err) {
      console.warn('[mobile-sim] tab capture unavailable', options, err);
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
  const cropEl = comparing() ? stage : views[0].device;
  try {
    if (track.cropTo && window.CropTarget) {
      await track.cropTo(await CropTarget.fromElement(cropEl));
      return { stream, cropEl };
    }
  } catch (err) {
    console.warn('[mobile-sim] could not crop the recording to the device', err);
  }
  return { stream, cropEl: null };
}

async function openMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    return stream;
  } catch (err) {
    logError('microphone')(err);
    toast('Microphone blocked: recording without sound');
    return null;
  }
}

// Shows 3 · 2 · 1 over the stage. Resolves to false when cancelled with Esc.
async function runCountdown(seconds) {
  const overlay = $('#countdown');
  const num = $('#cdNum');
  const circle = $('.cd-circle', overlay);
  countdown = { cancelled: false };
  overlay.hidden = false;
  try {
    for (let n = seconds; n > 0; n--) {
      if (countdown.cancelled) return false;
      num.textContent = n;
      num.classList.remove('tick');
      void num.offsetWidth;
      num.classList.add('tick');
      circle.style.setProperty('--p', String((seconds - n + 1) / seconds));
      await sleep(1000);
    }
    return !countdown.cancelled;
  } finally {
    overlay.hidden = true;
    circle.style.setProperty('--p', '0');
    countdown = null;
  }
}

let startingRecording = false;

async function startRecording() {
  // The flag covers the awaits below (sharing prompt, countdown): no second start meanwhile.
  if (rec || countdown || startingRecording) return;
  if (!state.url) return toast('Open a website first');
  if (!window.VideoEncoder || !window.MediaStreamTrackProcessor) return toast('This Chrome version cannot record video');
  closePopovers();
  startingRecording = true;
  try {
    await beginRecording(QUALITY[state.recordOpts.quality] || QUALITY.high);
  } finally {
    startingRecording = false;
  }
}

// "Phone only": the devices as shown, cropped tight (an MP4 has no transparency, so the
// corners outside the rounded device are black). "Screenshot style": the export look.
// Either way the frame can only be recorded when the live phone shows it.
function recordLook() {
  const look = state.recordOpts.look === 'style'
    ? { ...state.exportOpts }
    : { ...DEFAULT_EXPORT, background: 'solid', solid: '#000000', padding: 0, shadow: false, caption: false, ratio: 'auto' };
  return { ...look, frame: look.frame !== false && state.showFrame };
}

async function beginRecording(preset) {
  let capture;
  try {
    capture = await openCaptureStream(preset.fps);
  } catch (err) {
    const cancelled = err?.name === 'NotAllowedError' || err?.name === 'AbortError';
    if (!cancelled) logError('capture')(err);
    toast(cancelled ? 'Recording cancelled' : `Could not record this tab: ${err?.message || err}`);
    return;
  }
  const mic = state.recordOpts.mic ? await openMicrophone() : null;
  const stopTracks = () => [capture.stream, mic].forEach((s) => s?.getTracks().forEach((t) => t.stop()));

  if (state.recordOpts.countdown && !(await runCountdown(COUNTDOWN_S))) {
    stopTracks();
    toast('Recording cancelled');
    return;
  }

  const [track] = capture.stream.getVideoTracks();
  const opts = recordLook();
  const scene = videoLayout(opts, opts.frame, preset.maxUnit);
  // Device rects are measured once and again only after a layout change (not every frame).
  const measure = () => ({
    area: capture.cropEl ? capture.cropEl.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight },
    devices: views.map((v) => (opts.frame ? v.device : v.screen).getBoundingClientRect()),
  });
  const render = (ctx, videoFrame) => {
    if (!rec?.rects) {
      if (rec) rec.rects = measure();
      else return;
    }
    const { area, devices } = rec.rects;
    const sx = videoFrame.displayWidth / area.width;
    const sy = videoFrame.displayHeight / area.height;
    paint(ctx, scene, opts, (c, box, i) => {
      const r = devices[i];
      c.drawImage(videoFrame, (r.left - area.left) * sx, (r.top - area.top) * sy, r.width * sx, r.height * sy, box.x, box.y, box.w, box.h);
    });
  };

  let recorder;
  try {
    recorder = await createRecorder({
      track,
      audioTrack: mic?.getAudioTracks()[0],
      width: scene.W,
      height: scene.H,
      fps: preset.fps,
      bitsPerPixel: preset.bitsPerPixel,
      render,
    });
  } catch (err) {
    stopTracks();
    logError('recorder')(err);
    toast(err.message);
    return;
  }
  rec = { stopTracks, recorder, scene, rects: null, fps: preset.fps, start: Date.now(), timer: setInterval(tickRecording, 250) };
  track.addEventListener('ended', finishRecording);
  setRecordingUi(true);
  tickRecording();
}

async function finishRecording() {
  const r = rec;
  if (!r || r.stopping) return;
  r.stopping = true;
  clearInterval(r.timer);
  const seconds = (Date.now() - r.start) / 1000;
  $('#recTime').textContent = 'Saving…';
  try {
    const blob = await r.recorder.stop();
    openReview(blob, { seconds, width: r.scene.W, height: r.scene.H, fps: r.fps, audio: r.recorder.hasAudio });
  } catch (err) {
    console.error('[mobile-sim] recording', err);
    toast(`Could not finish the video: ${err.message}`);
  } finally {
    r.stopTracks();
    rec = null;
    setRecordingUi(false);
  }
}

const clock = (s) => `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}`;

function tickRecording() {
  if (!rec || rec.stopping) return;
  const text = clock((Date.now() - rec.start) / 1000);
  $('#recTime').textContent = text;
  $('#recordLabel').textContent = text;
}

function setRecordingUi(on) {
  document.body.classList.toggle('is-recording', on);
  $('#recPill').hidden = !on;
  // Anything over a device ends up in the video: drop the pill if it overlaps one
  // (the toolbar's blinking Record button still shows the state and stops it).
  if (on) {
    const p = $('#recPill').getBoundingClientRect();
    const overlaps = views.some((v) => {
      const r = v.device.getBoundingClientRect();
      return p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top;
    });
    if (overlaps) $('#recPill').hidden = true;
  }
  $('#record').classList.toggle('on', on);
  $('#record').dataset.tip = on ? 'Stop · V' : 'Record · V';
  if (!on) $('#recordLabel').textContent = 'Record';
  for (const v of views) {
    post(v, { type: 'recording', value: on });
    if (!on) v.dot.classList.remove('show');
  }
}

function toggleRecording() {
  if (mode === 'panel') return openOverlayFromPanel('record');
  if (countdown) return;
  if (rec) return finishRecording();
  togglePopover(recordPanel, $('#record'));
}

const takeScreenshot = () => (mode === 'panel' ? openOverlayFromPanel('shot') : openShotDialog());

// ---------- side panel & overlay ----------

async function openOverlayFromPanel(action = '') {
  const res = await chrome.runtime.sendMessage({ type: 'open-overlay', windowId, action }).catch((err) => ({ ok: false, error: err.message }));
  if (!res?.ok) return toast(res?.error || 'Could not open the simulator on this page');
  // Full screen takes over: the side panel closes.
  window.close();
}

// The phone in the side panel follows the window's active tab.
async function followActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab) return;
  if (tab.id !== activeTabId) {
    if (activeTabId != null) tellSite(activeTabId, { type: 'ms-sync', value: { on: false } });
    activeTabId = tab.id;
    if (state.scrollSync) tellSite(activeTabId, { type: 'ms-sync', value: siteSync() });
  }
  if (!/^https?:/i.test(tab.url || '') || tab.url === state.url) return;
  navigate(tab.url);
}

// Messages to the website's content script. Tabs opened before the extension was
// (re)loaded have none yet: inject it once, then retry. Pages that can't host it
// (chrome://, the Web Store) just get no sync: null.
async function tellSite(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['frame.js'] });
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      return null;
    }
  }
}

// After the phone loads a page, line it up with where the website is.
async function alignPhoneWithSite() {
  if (mode !== 'panel' || !state.scrollSync || activeTabId == null) return;
  await sleep(300);
  const pos = await tellSite(activeTabId, { type: 'ms-position' });
  if (pos) post(views[0], { type: 'scroll-to', value: pos });
}


const siteSync = () => ({ on: state.scrollSync, mode: state.syncMode, emit: true });
const phoneSync = () => ({ on: mode === 'panel' && state.scrollSync, mode: state.syncMode, emit: state.syncDir === 'both' });

function renderSyncPanel() {
  $('#syncOn').checked = state.scrollSync;
  markSeg($('#syncMode'), state.syncMode);
  markSeg($('#syncDir'), state.syncDir);
  $('#syncBtn').classList.toggle('on', state.scrollSync);
  $('#syncBtn').setAttribute('aria-pressed', String(state.scrollSync));
}

function setSync(patch) {
  Object.assign(state, patch);
  save();
  renderSyncPanel();
  views.forEach((v) => post(v, { type: 'sync', value: phoneSync() }));
  if (activeTabId != null) tellSite(activeTabId, { type: 'ms-sync', value: siteSync() });
  if (state.scrollSync) alignPhoneWithSite();
}

// Settings that only exist outside the side panel are shown disabled there.
function disablePanelOnlySettings() {
  for (const sel of ['#optUrlBar', '#optLabel', '#labelPosSeg', '#dockPosSeg']) {
    const row = $(sel).closest('.row');
    row.classList.add('panel-off');
    row.title = 'Full screen and new tab only';
    row.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
    const label = row.querySelector('span');
    if (label && !row.querySelector('.panel-note')) label.insertAdjacentHTML('beforeend', '<em class="panel-note">Full screen and new tab only</em>');
  }
}

// The background cleans up this panel's rules when the port drops. The worker going idle
// drops it too, so reconnect while the panel is open.
function keepPanelPort() {
  const port = chrome.runtime.connect({ name: `panel:${windowId}` });
  port.onDisconnect.addListener(() => setTimeout(keepPanelPort, 100));
}

function bindPanel() {
  disablePanelOnlySettings();
  keepPanelPort();
  const follow = () => followActiveTab().catch(logError('follow tab'));
  chrome.tabs.onActivated.addListener((info) => info.windowId === windowId && follow());
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab.active && tab.windowId === windowId && info.url) follow();
  });
  $('#fullBtn').addEventListener('click', () => openOverlayFromPanel());
  renderSyncPanel();
  $('#syncBtn').addEventListener('click', (e) => togglePopover(syncPanel, e.currentTarget));
  $('#syncOn').addEventListener('change', (e) => setSync({ scrollSync: e.target.checked }));
  onSeg($('#syncMode'), (v) => setSync({ syncMode: v }));
  onSeg($('#syncDir'), (v) => setSync({ syncDir: v }));
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    // Full screen opened from the icon menu or shortcut: this panel steps aside.
    if (msg?.type === 'panel-close' && msg.windowId === windowId) window.close();
    // Website scrolled by the user → move the phone. The reply tells the website someone
    // is listening (with no answer it would turn its sync off).
    if (msg?.type === 'site-scroll' && sender.tab?.id === activeTabId) {
      if (state.scrollSync) post(views[0], { type: 'scroll-to', value: msg.pos });
      reply(true);
    }
  });
  $('#sideBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/appearance' }).catch(logError('open settings'));
    toast('In Appearance, change "Side panel position"');
  });
}

// Full screen → side panel: open the panel (needs this click), then leave full screen.
async function overlayToPanel() {
  if (rec || countdown) return toast('Stop recording first');
  try {
    await chrome.sidePanel.open({ windowId });
  } catch (err) {
    logError('open side panel')(err);
    return toast('Click the extension icon to open the side panel');
  }
  closeOverlay();
}

async function closeOverlay() {
  if (rec || countdown) return toast('Stop recording first');
  if (tabId != null) await clearRules({ tabId }).catch(logError('clear rules'));
  // No receiver only means the background was asleep; it also cleans up on navigation.
  chrome.runtime.sendMessage({ type: 'overlay-closed', tabId }).catch(() => {});
  window.parent.postMessage({ __mobileSimOverlay: 'close' }, '*');
}

// Screenshot / Record asked from the side panel: start once the page has loaded.
function runOverlayAction() {
  if (!overlayAction) return;
  const action = overlayAction;
  overlayAction = '';
  if (action === 'shot') openShotDialog();
  else if (action === 'record') togglePopover(recordPanel, $('#record'));
}

// ---------- recording review ----------

function openReview(blob, meta) {
  review = { blob, url: URL.createObjectURL(blob), name: fileName('recording', 'mp4') };
  const video = $('#reviewVideo');
  video.src = review.url;
  $('#rvDuration').textContent = clock(meta.seconds);
  $('#rvSize').textContent = `${(blob.size / 1e6).toFixed(1)} MB`;
  $('#rvRes').textContent = `${meta.width} × ${meta.height}`;
  $('#rvFormat').textContent = `MP4 · H.264 · ${meta.fps} fps${meta.audio ? ' · sound' : ''}`;
  $('#rvConfirm').hidden = true;
  reviewDialog.hidden = false;
  video.play().catch(() => {});
}

function closeReview() {
  if (!review) return;
  const video = $('#reviewVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(review.url);
  review = null;
  reviewDialog.hidden = true;
}

const askDiscard = () => {
  $('#rvConfirm').hidden = false;
};

function bindReview() {
  const video = $('#reviewVideo');
  const scrub = $('#rvScrub');
  const sync = () => {
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    const pct = d ? (video.currentTime / d) * 100 : 0;
    scrub.value = String(pct * 10);
    scrub.style.setProperty('--fill', `${pct}%`);
    $('#rvTime').textContent = `${clock(video.currentTime)} / ${clock(d)}`;
  };
  scrub.min = '0';
  scrub.max = '1000';
  video.addEventListener('timeupdate', sync);
  video.addEventListener('loadedmetadata', sync);
  video.addEventListener('play', () => $('#rvPlay').classList.add('playing'));
  video.addEventListener('pause', () => $('#rvPlay').classList.remove('playing'));
  // play() rejects when interrupted by a pause; nothing to report.
  $('#rvPlay').addEventListener('click', () => (video.paused ? video.play().catch(() => {}) : video.pause()));
  scrub.addEventListener('input', () => {
    if (Number.isFinite(video.duration)) video.currentTime = (Number(scrub.value) / 1000) * video.duration;
  });

  $('#rvSave').addEventListener('click', () => {
    download(review.blob, review.name);
    toast('Video saved');
    closeReview();
  });
  $('#rvAgain').addEventListener('click', () => {
    closeReview();
    togglePopover(recordPanel, $('#record'));
  });
  $('#rvDiscard').addEventListener('click', askDiscard);
  $('#rvClose').addEventListener('click', askDiscard);
  $('#rvKeep').addEventListener('click', () => ($('#rvConfirm').hidden = true));
  $('#rvConfirmDiscard').addEventListener('click', () => {
    closeReview();
    toast('Video discarded');
  });
}

// ---------- record menu ----------

function renderRecordPanel() {
  const o = state.recordOpts;
  $('#recCountdown').checked = o.countdown;
  $('#recMic').checked = o.mic;
  markSeg($('#recQuality'), o.quality);
  markSeg($('#recLook'), o.look, '.look-card');
  $('#recLookEdit').hidden = o.look !== 'style';
  $('#recLookThumb').style.background = backgroundCss(state.exportOpts);
}

function setRecordOpts(patch) {
  state.recordOpts = { ...state.recordOpts, ...patch };
  save();
  renderRecordPanel();
}

function bindRecordPanel() {
  $('#recCountdown').addEventListener('change', (e) => setRecordOpts({ countdown: e.target.checked }));
  $('#recMic').addEventListener('change', (e) => setRecordOpts({ mic: e.target.checked }));
  onSeg($('#recQuality'), (v) => setRecordOpts({ quality: v }));
  onSeg($('#recLook'), (v) => setRecordOpts({ look: v }), '.look-card');
  $('#recLookEdit').addEventListener('click', () => {
    closePopovers();
    openShotDialog();
  });
  $('#recStart').addEventListener('click', startRecording);
  $('#recStop').addEventListener('click', finishRecording);
}

// ---------- toolbar & panels ----------

const percent = (scale) => `${Math.round(scale * 100)}%`;
const fitScale = () => views[0]?.scale || 1;

function refreshToolbar() {
  const zoomText = state.zoom === 'fit' ? 'Fit' : percent(Number(state.zoom));
  $('#deviceName').textContent = comparing() ? `${views.length} devices` : views[0].d.name;
  $('#compare').classList.toggle('on', comparing());
  $('#rotate').classList.toggle('on', state.orientation === 'landscape');
  $('#zoomBtn').textContent = zoomText;
  $('#zoomLevel').textContent = zoomText;
  $('#zoomLevel').title = state.zoom === 'fit' ? `Fit (${percent(fitScale())})` : 'Back to Fit';
  for (const id of ['back', 'forward', 'reload']) $(`#${id}`).disabled = !state.url;
}

function setZoom(z) {
  state.zoom = String(z);
  save();
  layout();
  refreshToolbar();
  if (!$('#zoomPanel').hidden) renderZoomMenu();
}

// +/−: next step up or down from the zoom currently shown (Fit's actual scale included).
function stepZoom(dir) {
  const current = state.zoom === 'fit' ? fitScale() : Number(state.zoom);
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > current + 0.001) : ZOOM_STEPS.findLast((z) => z < current - 0.001);
  if (next) setZoom(next);
}

const zoomToFit = () => setZoom('fit');

// The toolbar's zoom button: hover or click shows the zoom levels, double-click fits.
const ZOOM_MENU = ['fit', ...ZOOM_STEPS.toReversed().map(String)];
const ZOOM_HOVER_MS = 250;

function renderZoomMenu() {
  const label = (z) => (z === 'fit' ? `Fit <small>${percent(fitScale())}</small>` : percent(Number(z)));
  $('#zoomPanel .zoom-list').innerHTML = ZOOM_MENU.map((z) =>
    `<button class="zoom-opt${String(state.zoom) === z ? ' on' : ''}" data-zoom="${z}">${label(z)}<i class="check"></i></button>`).join('');
}

function bindZoomMenu() {
  const btn = $('#zoomBtn');
  const panel = $('#zoomPanel');
  let hoverTimer = 0;
  let leaveTimer = 0;
  let clickTimer = 0;
  const open = () => {
    if (!panel.hidden) return;
    renderZoomMenu();
    togglePopover(panel, btn);
  };
  const scheduleClose = () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (!panel.matches(':hover') && !btn.matches(':hover')) closePopovers();
    }, ZOOM_HOVER_MS);
  };
  btn.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimer);
    hoverTimer = setTimeout(open, ZOOM_HOVER_MS);
  });
  btn.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    scheduleClose();
  });
  panel.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
  panel.addEventListener('mouseleave', scheduleClose);
  // A click opens the menu; wait a moment so a double-click can fit instead.
  btn.addEventListener('click', () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(open, ZOOM_HOVER_MS);
  });
  btn.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    clearTimeout(hoverTimer);
    closePopovers();
    setZoom('fit');
  });
  panel.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (z) setZoom(z);
  });
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function deviceCard(d, selected) {
  const k = Math.min(80 / Math.max(1000, d.h), 96 / d.w);
  return `
    <button class="dev-card${selected ? ' on' : ''}" data-id="${d.id}">
      <i class="sil${d.frame === 'home' ? ' home' : ''}" style="width:${Math.round(d.w * k)}px;height:${Math.round(d.h * k)}px"></i>
      <b>${esc(d.name)}</b><span>${d.w} × ${d.h}</span>
      ${d.group === 'custom' ? `<span class="del" data-del="${d.id}" title="Delete" aria-label="Delete ${esc(d.name)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>` : ''}
    </button>`;
}

function currentTab() {
  if (devTab) return devTab;
  const id = comparing() ? state.compareIds[0] : state.deviceId;
  return deviceById(id)?.group || 'iphone';
}

function renderDeviceGrid() {
  const selected = new Set(comparing() ? state.compareIds : [state.deviceId]);
  const q = devQuery.trim().toLowerCase();
  const tab = currentTab();
  const list = allDevices().filter((d) => (q ? d.name.toLowerCase().includes(q) : d.group === tab));
  const empty = q ? `No device matches “${esc(devQuery.trim())}”` : 'No custom device yet';
  $('.dev-grid', devicePanel).innerHTML = list.length
    ? list.map((d) => deviceCard(d, selected.has(d.id))).join('')
    : `<p class="dev-empty">${empty}</p>`;
}

function renderDevicePanel() {
  const tab = currentTab();
  const types = Object.entries(CUSTOM_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
  devicePanel.classList.toggle('compare-mode', comparing());
  devicePanel.innerHTML = `
    <div class="dev-head">
      <b>${comparing() ? `Compare · ${MIN_COMPARE} to ${MAX_COMPARE} devices` : 'Device'}</b>
      <label class="dev-compare">Compare<input type="checkbox" id="devCompare"${comparing() ? ' checked' : ''}><i></i></label>
    </div>
    <label class="dev-search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="devSearch" placeholder="Search devices" autocomplete="off" value="${esc(devQuery)}">
    </label>
    <div class="dev-tabs" role="tablist">
      ${GROUPS.map((g) => `<button class="dev-tab${g.id === tab && !devQuery ? ' on' : ''}" role="tab" aria-selected="${g.id === tab}" data-tab="${g.id}">${TAB_LABELS[g.id]}</button>`).join('')}
    </div>
    <div class="dev-grid"></div>
    ${tab === 'custom' && !devQuery ? `
    <form class="custom-form">
      <input name="name" class="full" placeholder="Custom device name" maxlength="40">
      <select name="type">${types}</select>
      <input name="w" type="number" placeholder="Width" min="200" max="3000" required>
      <input name="h" type="number" placeholder="Height" min="200" max="3000" required>
      <button class="full" type="submit">Add custom device</button>
    </form>` : '<button class="dev-add" data-tab="custom">+ Add a custom size</button>'}`;
  renderDeviceGrid();
  addPopoverClose(devicePanel);
}

function togglePopover(panel, anchor) {
  const wasOpen = !panel.hidden;
  closePopovers();
  if (wasOpen) return;
  if (panel === devicePanel) {
    devTab = null;
    devQuery = '';
    renderDevicePanel();
  }
  if (panel === recordPanel) renderRecordPanel();
  addPopoverClose(panel);
  Object.assign(panel.style, { top: '', bottom: '', maxHeight: '' });
  panel.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = Math.min(panel.offsetHeight, innerHeight - 24, MENU_MAX_H);
  const side = !anchor.closest('.dock') ? 'topbar' : mode === 'panel' ? 'bottom' : state.dockPos;
  const centredX = () => `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  const centredY = () => `${Math.max(12, Math.min(innerHeight - h - 12, r.top + r.height / 2 - h / 2))}px`;
  // Menus are anchored to the free side and never taller than the space there: they scroll.
  if (side === 'bottom') {
    panel.style.left = centredX();
    panel.style.bottom = `${innerHeight - r.top + 10}px`;
    panel.style.maxHeight = `${Math.min(MENU_MAX_H, r.top - 20)}px`;
  } else if (side === 'top') {
    panel.style.left = centredX();
    panel.style.top = `${r.bottom + 10}px`;
    panel.style.maxHeight = `${Math.min(MENU_MAX_H, innerHeight - r.bottom - 22)}px`;
  } else if (side === 'left') {
    panel.style.left = `${Math.min(innerWidth - w - 8, r.right + 12)}px`;
    panel.style.top = centredY();
  } else if (side === 'right') {
    // Panels open to the left of the dock, centred on their button.
    panel.style.left = `${Math.max(8, r.left - w - 12)}px`;
    panel.style.top = centredY();
  } else {
    panel.style.top = `${r.bottom + 8}px`;
    panel.style.left = centredX();
  }
  // Never past the window: the menu scrolls inside instead.
  if (!panel.style.maxHeight) {
    const top = parseFloat(panel.style.top) || 12;
    panel.style.maxHeight = `${Math.min(MENU_MAX_H, innerHeight - top - 12)}px`;
  }
  anchor.classList.add('open');
  updateMoreBelow(panel);
}

// Menus hide their scrollbar; a soft fade at the bottom says there is more below.
const updateMoreBelow = (panel) => panel.classList.toggle('more-below', panel.scrollTop + panel.clientHeight < panel.scrollHeight - 4);

// Every menu gets a close button in its (sticky) header.
function addPopoverClose(panel) {
  const head = panel.querySelector('.panel-head, .dev-head');
  if (!head || head.querySelector('.pop-close')) return;
  const btn = document.createElement('button');
  btn.className = 'pop-close';
  btn.setAttribute('aria-label', 'Close');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  btn.addEventListener('click', closePopovers);
  head.append(btn);
}

function closePopovers() {
  POPOVERS.forEach((p) => (p.hidden = true));
  document.querySelectorAll('[data-popover].open').forEach((b) => b.classList.remove('open'));
}

function applyTheme() {
  const dark = state.theme === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : state.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  settingsPanel.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.theme));
}

const applyGlow = () => document.body.classList.toggle('no-glow', !state.glow);

// Labels sit under the devices in compare mode (each with its device) or when asked to.
const labelUnder = () => state.labelShow && mode !== 'panel' && (comparing() || state.labelPos === 'under');
function applyLabels() {
  const body = document.body.classList;
  body.toggle('no-label', !state.labelShow || mode === 'panel');
  for (const pos of ['br', 'bl', 'bc', 'tl']) body.toggle(`label-${pos}`, !labelUnder() && state.labelPos === pos);
  body.toggle('can-remove', comparing() && views.length > MIN_COMPARE);
  settingsPanel.querySelectorAll('#labelPosSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.labelPos));
}
// The zoom control lines up with the toolbar: centred under a side toolbar, or right after
// a top/bottom one (then laid out in a row).
function placeZoomControl() {
  const ctl = $('.zoom-ctl');
  const dock = $('.dock').getBoundingClientRect();
  const row = state.dockPos === 'top' || state.dockPos === 'bottom';
  ctl.classList.toggle('horizontal', row);
  const c = ctl.getBoundingClientRect();
  if (row) {
    Object.assign(ctl.style, { left: `${dock.right + 12}px`, top: `${dock.top + (dock.height - c.height) / 2}px` });
  } else {
    // At the bottom of the toolbar's column, just above the bottom edge blur.
    const bottomTop = innerHeight - ZOOM_CTL_BOTTOM - c.height;
    const top = bottomTop >= dock.bottom + 12 ? bottomTop : dock.bottom + 12;
    Object.assign(ctl.style, { left: `${dock.left + (dock.width - c.width) / 2}px`, top: `${top}px` });
  }
  // A corner label on the same side moves aside.
  document.body.classList.toggle('zoom-right', !row && state.dockPos === 'right');
}

function applyDock() {
  for (const pos of ['left', 'top', 'bottom']) document.body.classList.toggle(`dock-${pos}`, state.dockPos === pos);
  markSeg($('#dockPosSeg'), state.dockPos);
}

function applyScreenDetails() {
  document.body.classList.toggle('no-homebar', !state.homeBar);
  document.body.classList.toggle('no-statusbar', !state.statusBar);
  views.forEach((v) => updateView(v, v.d));
}

// Reloads only the pages in the phones (not the whole tab).
// Touch emulation is for phones and tablets, not desktops.
const touchFor = (v) => state.touch && FRAMES[v.d.frame].os !== 'desktop';

function reloadPhones() {
  views.forEach((v) => {
    if (!v.url) return;
    setLoading(v, true);
    post(v, { type: 'reload' });
  });
}
// Our address bar is optional; it always shows while there is no page yet (start screen).
const applyUrlBar = () => document.body.classList.toggle('no-urlbar', !state.urlBar && !!state.url);

function rememberRecent(url) {
  state.recent = [url, ...state.recent.filter((u) => u !== url)].slice(0, MAX_RECENT);
  save();
}

// Shortcut chips on the empty screen: a local dev server, the tab we came from, recent sites.
function renderSuggestions(root = document) {
  const items = [{ label: 'localhost:3000', url: 'http://localhost:3000' }];
  if (openerUrl) items.push({ label: `Current tab · ${hostOf(openerUrl)}`, url: openerUrl });
  for (const url of state.recent.slice(0, 2)) {
    if (url !== openerUrl) items.push({ label: `Recent · ${hostOf(url)}`, url });
  }
  const html = items.map((i) => `<button class="sugg" data-url="${esc(i.url)}">${esc(i.label)}</button>`).join('');
  root.querySelectorAll('.suggest').forEach((el) => (el.innerHTML = html));
}

const clockText = () => {
  const d = new Date();
  return `${d.getHours()}:${pad2(d.getMinutes())}`;
};
const updateClock = () => document.querySelectorAll('.sb-time').forEach((el) => (el.textContent = clockText()));

function onKeydown(e) {
  // Reload shortcut: only the pages in the phones, never the simulator itself.
  if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'r' && !e.shiftKey)) {
    e.preventDefault();
    return reloadPhones();
  }
  if (e.key === 'Escape') {
    const popoverOpen = POPOVERS.some((p) => !p.hidden);
    if (countdown) countdown.cancelled = true;
    else if (review) askDiscard();
    else if (shot) closeShotDialog();
    else if (!popoverOpen && mode === 'overlay') closeOverlay();
    return closePopovers();
  }
  if (shot || review || countdown || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, select, textarea')) return;
  const actions = {
    r: rotate,
    c: () => mode !== 'panel' && toggleCompare(),
    s: takeScreenshot,
    v: toggleRecording,
    d: () => togglePopover(devicePanel, $('#deviceBtn')),
    '+': () => stepZoom(1),
    '=': () => stepZoom(1),
    '-': () => stepZoom(-1),
    '0': zoomToFit,
  };
  const action = actions[e.key?.toLowerCase()];
  if (action) {
    e.preventDefault();
    action();
  }
}

function bindUi() {
  $('#urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(urlInput.value);
  });
  urlInput.addEventListener('focus', () => urlInput.select());

  for (const type of ['back', 'forward']) {
    $(`#${type}`).addEventListener('click', () => views.forEach((v) => post(v, { type })));
  }
  for (const id of ['reload', 'reloadDock']) $(`#${id}`).addEventListener('click', reloadPhones);
  onSeg($('#dockPosSeg'), (v) => {
    state.dockPos = v;
    save();
    closePopovers();
    applyDock();
    applyLabels();
    layout();
  });
  onSeg($('#labelPosSeg'), (v) => {
    state.labelPos = v;
    save();
    applyLabels();
    layout();
  });
  $('#deviceBtn').addEventListener('click', (e) => togglePopover(devicePanel, e.currentTarget));
  $('#finishBtn').addEventListener('click', (e) => togglePopover(finishPanel, e.currentTarget));
  $('#settingsBtn').addEventListener('click', (e) => togglePopover(settingsPanel, e.currentTarget));
  $('#rotate').addEventListener('click', rotate);
  $('#compare').addEventListener('click', () => toggleCompare());
  bindZoomMenu();
  $('#zoomIn').addEventListener('click', () => stepZoom(1));
  $('#zoomOut').addEventListener('click', () => stepZoom(-1));
  $('#zoomLevel').addEventListener('click', zoomToFit);
  $('#shot').addEventListener('click', takeScreenshot);
  $('#closeBtn').addEventListener('click', closeOverlay);
  $('#cornerClose').addEventListener('click', closeOverlay);
  $('#panelBtn').addEventListener('click', overlayToPanel);
  $('#record').addEventListener('click', toggleRecording);
  stage.addEventListener('click', (e) => {
    const url = e.target.closest('.sugg')?.dataset.url;
    if (url) navigate(url);
  });

  devicePanel.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) return removeCustomDevice(del.dataset.del);
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      devTab = tab.dataset.tab;
      devQuery = '';
      return renderDevicePanel();
    }
    const card = e.target.closest('[data-id]');
    if (card) pickDevice(card.dataset.id);
  });
  devicePanel.addEventListener('change', (e) => {
    if (e.target.id === 'devCompare') toggleCompare({ keepPanel: true });
  });
  devicePanel.addEventListener('input', (e) => {
    if (e.target.id !== 'devSearch') return;
    devQuery = e.target.value;
    devicePanel.querySelectorAll('.dev-tab').forEach((t) => t.classList.toggle('on', !devQuery && t.dataset.tab === currentTab()));
    renderDeviceGrid();
  });
  devicePanel.addEventListener('submit', (e) => {
    e.preventDefault();
    addCustomDevice(e.target);
  });

  document.querySelectorAll('.finish-picker').forEach((el) => {
    renderFinishPicker(el);
    bindFinishPicker(el);
  });

  onSeg($('#themeSeg'), (v) => {
    state.theme = v;
    save();
    applyTheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  const toggles = {
    optTouch: ['touch', () => views.forEach((v) => post(v, { type: 'touch', value: touchFor(v) }))],
    optFrame: ['showFrame', () => {
      syncViews();
      renderFinishPickers();
    }],
    optUA: ['mobileUA', () => syncViews()],
    optGlow: ['glow', applyGlow],
    optKeyboard: ['keyboard', () => !state.keyboard && views.forEach(closeKeyboard)],
    optUrlBar: ['urlBar', applyUrlBar],
    optLabel: ['labelShow', () => {
      applyLabels();
      layout();
    }],
    optStatusBar: ['statusBar', applyScreenDetails],
    optHomeBar: ['homeBar', applyScreenDetails],
  };
  for (const [id, [key, onChange]] of Object.entries(toggles)) {
    const input = $(`#${id}`);
    input.checked = state[key];
    input.addEventListener('change', () => {
      state[key] = input.checked;
      save();
      onChange?.();
    });
  }

  bindShotDialog();
  bindKeyboard();
  POPOVERS.forEach((p) => p.addEventListener('scroll', () => updateMoreBelow(p), { passive: true }));
  bindRecordPanel();
  bindReview();

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.popover, [data-popover]')) closePopovers();
  });
  // Clicks inside the site's iframe never reach this document.
  addEventListener('blur', closePopovers);
  document.addEventListener('keydown', onKeydown);
  // One layout per frame while resizing (it also places the zoom control).
  let resizeFrame = 0;
  addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      layout();
    });
  });
  addEventListener('message', onFrameMessage);
}

async function init() {
  const stored = await chrome.storage.local.get(STORED);
  Object.assign(state, stored);
  state.exportOpts = { ...DEFAULT_EXPORT, ...stored.exportOpts };
  state.finish = { ...DEFAULT_FINISH, ...stored.finish };
  state.recordOpts = { ...DEFAULT_RECORD, ...stored.recordOpts };
  if (!stored.syncDefaultsV2) {
    // Percentage became the default (2026-10-07): apply it once to existing installs.
    state.syncMode = 'percent';
    chrome.storage.local.set({ syncMode: 'percent', syncDefaultsV2: true }).catch(logError('save'));
  }
  formats = await supportedFormats();
  if (!formats.some((f) => f.id === state.exportOpts.format)) state.exportOpts.format = 'png';
  // A background saved by an older version may no longer exist.
  const knownBg = ['none', 'custom', 'solid', ...BACKGROUNDS.map((b) => b.id)];
  if (!knownBg.includes(state.exportOpts.background)) state.exportOpts.background = DEFAULT_EXPORT.background;

  const params = new URLSearchParams(location.search);
  const requested = params.get('url');
  state.url = requested ? normalizeUrl(requested) : '';
  if (state.url) rememberRecent(state.url);
  urlInput.value = state.url;
  const tab = await chrome.tabs.getCurrent();
  if (params.get('mode') === 'overlay') {
    mode = 'overlay';
    overlayAction = params.get('action') || '';
    windowId = (await chrome.windows.getCurrent()).id;
    // Any website can embed this page: only act on our own tab, and only when the
    // extension opened full screen there (the background registers it first).
    const { overlayTabs = {} } = await chrome.storage.session.get('overlayTabs');
    const ownTab = tab && tab.id === Number(params.get('tab')) && overlayTabs[tab.id];
    tabId = ownTab ? tab.id : null;
  } else if (tab) {
    tabId = tab.id;
    if (tab.openerTabId) {
      const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
      if (/^https?:/.test(opener?.url || '')) openerUrl = opener.url;
    }
  } else {
    mode = 'panel';
    windowId = (await chrome.windows.getCurrent()).id;
  }
  document.body.classList.add(`mode-${mode}`);

  applyTheme();
  applyFinish();
  applyGlow();
  applyUrlBar();
  applyScreenDetails();
  applyDock();
  bindUi();
  if (mode === 'panel') bindPanel();
  setInterval(updateClock, 15_000);
  await syncViews();
  if (mode === 'panel') await followActiveTab();
  if (mode === 'overlay' && tabId == null) toast('Open full screen from the Mobile Simulator icon');
  else if (mode === 'overlay' && !overlayAction) toast('Full screen · press Esc or × (top right) to return to the page');
  if (!state.url && mode !== 'panel') urlInput.focus();
}

init().catch((err) => {
  logError('start')(err);
  toast('The simulator could not start. Reload the page to try again.');
});
