import { applyRules, clearRules, ruleIdsForTab, ruleIdsForPage, panelWindowOf, isPanelRule } from './lib/rules.js';
import { normalize, hostAllowed, matchPatterns } from './lib/page-mode-settings.js';
import { DEVICES, FRAMES } from './lib/devices.js';

const SIM_PAGE = chrome.runtime.getURL('simulator.html');
const OVERLAY_ID = '__mobile_sim_overlay__';
const logError = (err) => console.warn('[mobile-sim]', err);

// Clicking the icon opens page mode (default: the site keeps its cookies, storage and
// session) or the side panel (Settings → "The icon opens"). Doing it from onClicked (rather
// than openPanelOnActionClick, kept off explicitly) also gives this tab the click permission
// that lets the simulator record it without Chrome's sharing prompt.
// The choice is cached: sidePanel.open() must run within the click, before any await.
let iconOpens = 'page';
chrome.storage.local.get('iconOpens').then(({ iconOpens: v }) => (iconOpens = v === 'panel' ? 'panel' : 'page'));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.iconOpens) iconOpens = changes.iconOpens.newValue === 'panel' ? 'panel' : 'page';
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(logError);
chrome.action.onClicked.addListener((tab) => {
  // Page mode needs a website; chrome:// pages, the Web Store or PDFs get the side panel.
  if (iconOpens === 'page' && /^https?:/i.test(tab.url || '')) {
    pageModeFromMenu('dock', tab).catch(logError);
    return;
  }
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(logError);
});

function openInNewTab(url, tab) {
  const target = /^https?:/i.test(url || '') ? `${SIM_PAGE}?url=${encodeURIComponent(url)}` : SIM_PAGE;
  chrome.tabs.create({ url: target, index: tab ? tab.index + 1 : undefined, openerTabId: tab?.id }).catch(logError);
}

// Runs inside the website: covers it with the simulator, restores it on close.
function mountOverlay(id, src) {
  let frame = document.getElementById(id);
  if (frame) {
    frame.src = src;
    return;
  }
  frame = document.createElement('iframe');
  frame.id = id;
  frame.src = src;
  frame.allow = 'microphone; camera; display-capture; clipboard-write; fullscreen; autoplay';
  frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:#07060b;color-scheme:normal;display:block';
  const root = document.documentElement;
  const previousOverflow = root.style.overflow;
  root.style.overflow = 'hidden';
  const origin = new URL(src).origin;
  const onMessage = (e) => {
    if (e.origin !== origin || e.data?.__mobileSimOverlay !== 'close') return;
    removeEventListener('message', onMessage);
    frame.remove();
    root.style.overflow = previousOverflow;
  };
  addEventListener('message', onMessage);
  root.appendChild(frame);
  frame.focus();
}

// Tabs showing the full-screen simulator: it comes back after the page reloads, and the
// simulator page only applies its header rules to a tab registered here. Cleared when
// the user exits or the tab closes. Each entry: { origin } of the website, { url } of the phone.
async function overlayTabs() {
  return (await chrome.storage.session.get('overlayTabs')).overlayTabs || {};
}
// Updates are queued: several events (navigation, phone page change, exit) can race.
let overlayQueue = Promise.resolve();
function rememberOverlay(tabId, entry) {
  const run = overlayQueue.then(async () => {
    const tabs = await overlayTabs();
    if (entry) tabs[tabId] = { ...tabs[tabId], ...entry };
    else delete tabs[tabId];
    await chrome.storage.session.set({ overlayTabs: tabs });
  });
  overlayQueue = run.catch(logError);
  return run;
}

/** Shows the full-screen simulator over `tab`. action: '' | 'shot' | 'record'. */
async function openOverlay(tab, action = '', phoneUrl = tab?.url, immediately = false) {
  if (!tab) throw new Error('No page to simulate in this window');
  if (!/^https?:/i.test(tab.url || '')) throw new Error('This page cannot be simulated');
  const params = new URLSearchParams({ mode: 'overlay', tab: String(tab.id), url: phoneUrl });
  if (action) params.set('action', action);
  // Registered first: the simulator checks this entry before touching the tab's headers.
  await rememberOverlay(tab.id, { origin: new URL(tab.url).origin, url: phoneUrl });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      injectImmediately: immediately,
      func: mountOverlay,
      args: [OVERLAY_ID, `${SIM_PAGE}?${params}`],
    });
  } catch (err) {
    await rememberOverlay(tab.id, null);
    throw err;
  }
}

// Full screen replaces the side panel: ask the window's panel to close itself.
const closePanel = (windowId) => chrome.runtime.sendMessage({ type: 'panel-close', windowId }).catch(() => {
  // No side panel open in that window: nothing to close.
});

// Straight to full screen (icon menu, shortcut). Pages that can't host it get the new-tab simulator.
function openFullScreen(tab) {
  openOverlay(tab)
    .then(() => closePanel(tab.windowId))
    .catch(() => openInNewTab(tab.url, tab));
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-fullscreen' && tab) openFullScreen(tab);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'overlay-closed') {
    rememberOverlay(msg.tabId, null).catch(logError);
    return;
  }
  if (msg?.type === 'overlay-nav') {
    overlayTabs()
      .then((tabs) => tabs[msg.tabId] && rememberOverlay(msg.tabId, { url: msg.url }))
      .catch(logError);
    return;
  }
  if (msg?.type !== 'open-overlay') return;
  chrome.tabs
    .query({ active: true, windowId: msg.windowId })
    .then(([tab]) => openOverlay(tab, msg.action))
    .then(() => reply({ ok: true }))
    .catch((err) => reply({ ok: false, error: err.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-page', title: 'Open page in jhm-web-responsive', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'open-link', title: 'Open link in jhm-web-responsive', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'open-full', title: 'Open full screen', contexts: ['action'] }, () => {
      // Reading lastError keeps a duplicate-id error (fast reinstall) out of the console.
      void chrome.runtime.lastError;
    });
    // Page mode from the icon: the user's own click, so it also allows the site if needed.
    // Page mode on the icon and on the page, same entries (ids get a suffix: Chrome needs
    // them unique). The icon allows 6 top-level entries: "Open full screen" + these 4.
    const done = () => void chrome.runtime.lastError;
    for (const [suffix, contexts] of [['', ['action']], [':page', ['page']]]) {
      // Chrome menus take no per-item icons: a leading symbol stands in for one.
      for (const [id, title] of [['page-mode-dock', '📱  Open inline phone'], ['page-mode-shot', '📸  Inline phone: screenshot'], ['page-mode-record', '🎥  Inline phone: record a video']]) {
        chrome.contextMenus.create({ id: id + suffix, title, contexts }, done);
      }
      chrome.contextMenus.create({ id: `page-mode${suffix}`, title: '⚙️  Inline phone options', contexts }, done);
      for (const [id, title] of [['page-mode-full', '⛶  Open full window'], ['page-mode-off', '✕  Close'], ['page-mode-settings', '⚙️  Settings…']]) {
        chrome.contextMenus.create({ id: id + suffix, parentId: `page-mode${suffix}`, title, contexts }, done);
      }
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const item = String(info.menuItemId).split(':')[0];
  if (item === 'page-mode-settings') {
    openPageModeSettings(tab);
    return;
  }
  if (item.startsWith('page-mode-')) {
    pageModeFromMenu(item.slice('page-mode-'.length), tab).catch(logError);
    return;
  }
  if (info.menuItemId === 'open-link') openInNewTab(info.linkUrl, tab);
  else openFullScreen(tab);
});

// The side panel keeps a port open (and reconnects it); its header rules go when it closes.
chrome.runtime.onConnect.addListener((port) => {
  const match = /^panel:(\d+)$/.exec(port.name);
  if (match) port.onDisconnect.addListener(() => clearRules({ windowId: Number(match[1]) }).catch(logError));
});

// Side panel rules left behind when the worker slept through a panel closing: drop the
// ones whose window has no side panel open.
async function sweepPanelRules() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const panelIds = rules.map((r) => r.id).filter(isPanelRule);
  if (!panelIds.length) return;
  const panels = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
  const open = new Set(panels.map((c) => c.windowId % 1_000_000));
  const stale = panelIds.filter((id) => !open.has(panelWindowOf(id)));
  if (stale.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale });
}
sweepPanelRules().catch(logError);
chrome.runtime.onStartup.addListener(() => sweepPanelRules().catch(logError));

chrome.tabs.onRemoved.addListener((tabId) => {
  clearRules({ tabId }).catch(logError);
  clearPageRules(tabId).catch(logError);
  rememberOverlay(tabId, null).catch(logError);
});

// Only the tab's own page counts (frameId 0): pages loading inside the phone must not
// reset anything. When the website itself reloads in full screen, the simulator comes
// back right away (as the new page starts), on the page the phone was showing, until the
// user exits; another website in that tab ends it. Tabs we never touched return early.
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0 || url.startsWith(SIM_PAGE)) return;
  clearPageRules(tabId).catch(logError);
  try {
    const entry = (await overlayTabs())[tabId];
    const hasRules = entry || (await chrome.declarativeNetRequest.getSessionRules({ ruleIds: ruleIdsForTab(tabId) })).length > 0;
    if (!hasRules) return;
    await clearRules({ tabId });
    if (!entry) return;
    if (!/^https?:/i.test(url) || new URL(url).origin !== entry.origin) {
      await rememberOverlay(tabId, null);
      return;
    }
    const tab = await chrome.tabs.get(tabId);
    await openOverlay({ ...tab, url }, '', entry.url || url, true);
  } catch (err) {
    logError(err);
    rememberOverlay(tabId, null).catch(logError);
  }
});

// ---------- page mode (phone drawn inside an allowed website's own page) ----------

const clearPageRules = (tabId) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIdsForPage(tabId) });

// Only from our own content script, in a tab's top frame, on a host the user allows.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return;
  if (msg?.type === 'page-mode-clear') {
    clearPageRules(sender.tab.id).then(() => reply({ ok: true }), (err) => reply({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'page-mode-settings') {
    openPageModeSettings(sender.tab);
    return;
  }
  if (msg?.type === 'page-mode-shot') {
    // The visible tab, for the page-mode screenshot (cropped and composed in the page).
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then(
      (dataUrl) => reply({ ok: true, dataUrl }),
      (err) => reply({ ok: false, error: err.message }),
    );
    return true;
  }
  if (msg?.type === 'page-mode-save') {
    quietDownload(msg.dataUrl, msg.filename).then((id) => reply({ ok: true, id }), (err) => reply({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'page-mode-show-download') {
    chrome.downloads.show(msg.id);
    return;
  }
  if (msg?.type === 'page-mode-open-sim') {
    // From page mode's menu: the full-screen simulator over this tab, or the side panel.
    const tab = sender.tab;
    const run = msg.where === 'panel' ? chrome.sidePanel.open({ windowId: tab.windowId }) : openOverlay(tab).then(() => closePanel(tab.windowId));
    run.then(() => reply({ ok: true }), (err) => reply({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'page-mode-capture-id') {
    // Recording without a prompt; Chrome refuses unless the extension was used on this tab.
    chrome.tabCapture.getMediaStreamId({ targetTabId: sender.tab.id, consumerTabId: sender.tab.id }).then(
      (streamId) => reply({ ok: true, streamId }),
      (err) => reply({ ok: false, error: err.message }),
    );
    return true;
  }
  if (msg?.type === 'page-mode-allow') {
    // Sent only after a trusted click on the notice's "Allow" button (page-mode.js).
    allowHost(new URL(sender.url).hostname).then(() => reply({ ok: true }), (err) => reply({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type !== 'page-mode-rules') return;
  (async () => {
    const url = new URL(sender.url);
    if (!/^https?:$/.test(url.protocol) || !hostAllowed(url.hostname, await loadSettings())) throw new Error('the inline phone is not allowed on this host');
    const device = DEVICES.find((d) => d.id === msg.deviceId);
    const platform = device ? FRAMES[device.frame].os : 'none';
    await applyRules({ tabId: sender.tab.id, host: url.hostname }, platform === 'desktop' ? 'none' : platform);
  })().then(() => reply({ ok: true }), (err) => reply({ ok: false, error: err.message }));
  return true;
});

async function loadSettings() {
  const { pageMode } = await chrome.storage.local.get('pageMode');
  return normalize(pageMode);
}

// identity.js runs in the page world at document start, on allowed hosts only, and acts
// only inside page mode's phone; kept in step with the allowed hosts.
const IDENTITY_SCRIPT = 'mobile-sim-identity';
// Serialized: the menu and storage.onChanged can both ask at once (duplicate script id).
let identityQueue = Promise.resolve();
function syncIdentityScript() {
  const run = identityQueue.then(registerIdentityScript);
  identityQueue = run.catch(logError);
  return run;
}
async function registerIdentityScript() {
  const matches = matchPatterns(await loadSettings());
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [IDENTITY_SCRIPT] });
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [IDENTITY_SCRIPT] });
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    { id: IDENTITY_SCRIPT, js: ['lib/identity.js'], world: 'MAIN', runAt: 'document_start', allFrames: true, matches, persistAcrossSessions: true },
  ]);
}
syncIdentityScript().catch(logError);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pageMode) syncIdentityScript().catch(logError);
});

/**
 * command: 'dock' | 'full' | 'off' | 'shot' | 'record'. Allows the tab's site first when needed
 * (the user asked). A menu click counts as using the extension on this tab, so recording gets
 * tab capture without Chrome's share prompt.
 */
async function pageModeFromMenu(command, tab, extra = {}) {
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) return;
  const host = new URL(tab.url).hostname;
  let added = false;
  if (command !== 'off') added = await allowHost(host);
  const msg = { type: 'page-mode-menu', added, ...extra };
  if (command === 'shot' || command === 'record') msg.action = command;
  else msg.layout = command;
  if (command === 'record') {
    msg.streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id, consumerTabId: tab.id }).catch((err) => {
      console.warn('[mobile-sim] tab capture id', err);
      return null;
    });
  }
  try {
    await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 });
  } catch {
    // Tab opened before the extension (re)loaded: no content script yet.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['frame.js'] });
    await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 });
  }
}

/** Adds `host` to the page mode sites (turning page mode on). Resolves true when it was new. */
async function allowHost(host) {
  const settings = await loadSettings();
  const added = !hostAllowed(host, settings);
  if (added || !settings.enabled) await chrome.storage.local.set({ pageMode: normalize({ enabled: true, hosts: [...settings.hosts, host] }) });
  // The phone's page needs the identity script before it starts.
  await syncIdentityScript();
  return added;
}

/** The simulator in a new tab, its settings open at the Page mode section. */
function openPageModeSettings(tab) {
  chrome.tabs.create({ url: `${SIM_PAGE}?settings=page-mode`, index: tab ? tab.index + 1 : undefined, openerTabId: tab?.id }).catch(logError);
}

// Simulator (side panel or full screen) → page mode on its tab, same device and orientation.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'sim-to-page-mode') return;
  (async () => {
    const tab = await chrome.tabs.get(msg.tabId);
    if (!/^https?:/i.test(tab.url || '')) throw new Error('The inline phone works on websites only');
    await pageModeFromMenu('dock', tab, { deviceId: msg.deviceId, orientation: msg.orientation });
  })().then(() => reply({ ok: true }), (err) => reply({ ok: false, error: err.message }));
  return true;
});

/** Downloads without Chrome's bubble (page mode shows its own toast), then restores it. */
async function quietDownload(url, filename) {
  await chrome.downloads.setUiOptions({ enabled: false }).catch(logError);
  try {
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    await new Promise((resolve) => {
      const done = (delta) => {
        if (delta.id !== id || !delta.state || delta.state.current === 'in_progress') return;
        chrome.downloads.onChanged.removeListener(done);
        resolve();
      };
      chrome.downloads.onChanged.addListener(done);
      setTimeout(resolve, 20_000);
    });
    return id;
  } finally {
    await chrome.downloads.setUiOptions({ enabled: true }).catch(logError);
  }
}

// The simulator's own pages (side panel, full screen, new tab): quiet saves too.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || msg?.type !== 'quiet-download') return;
  quietDownload(msg.dataUrl, msg.filename).then((id) => reply({ ok: true, id }), (err) => reply({ ok: false, error: err.message }));
  return true;
});
