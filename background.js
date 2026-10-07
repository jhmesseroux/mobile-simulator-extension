import { clearRules, ruleIdsForTab, panelWindowOf, PANEL_RULE_BASE } from './lib/rules.js';

const SIM_PAGE = chrome.runtime.getURL('simulator.html');
const OVERLAY_ID = '__mobile_sim_overlay__';
const logError = (err) => console.warn('[mobile-sim]', err);

// Clicking the icon opens the side panel. Doing it from onClicked (rather than
// openPanelOnActionClick, kept off explicitly) also gives this tab the click permission
// that lets the full-screen simulator record it without Chrome's sharing prompt.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(logError);
chrome.action.onClicked.addListener((tab) => {
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
    chrome.contextMenus.create({ id: 'open-page', title: 'Open page in Mobile Simulator', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'open-link', title: 'Open link in Mobile Simulator', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'open-full', title: 'Open full screen', contexts: ['action'] }, () => {
      // Reading lastError keeps a duplicate-id error (fast reinstall) out of the console.
      void chrome.runtime.lastError;
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
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
  const panelIds = rules.map((r) => r.id).filter((id) => id >= PANEL_RULE_BASE);
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
  rememberOverlay(tabId, null).catch(logError);
});

// Only the tab's own page counts (frameId 0): pages loading inside the phone must not
// reset anything. When the website itself reloads in full screen, the simulator comes
// back right away (as the new page starts), on the page the phone was showing, until the
// user exits; another website in that tab ends it. Tabs we never touched return early.
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0 || url.startsWith(SIM_PAGE)) return;
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
