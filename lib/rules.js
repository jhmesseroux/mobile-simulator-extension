// Session rules that let sites load in our iframes and make them see a mobile browser.
// They are scoped to one simulator and removed when it closes:
// - a tab (new tab, or full screen over a website). In full screen the scope is the whole
//   website tab, so while it is open the page's own iframes lose their frame protection
//   and its requests get the mobile identity too.
// - a window's side panel. Side panel requests have no tab (-1), and DNR cannot tell
//   windows apart, so these rules apply to every tab-less sub_frame while a panel is open;
//   the window id only keeps the rule ids unique.

const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  // iPadOS Safari asks for desktop sites by default, so it reports as a Mac.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

const CLIENT_HINTS = {
  ios: { mobile: '?1', platform: '"iOS"' },
  ipad: { mobile: '?0', platform: '"macOS"' },
  android: { mobile: '?1', platform: '"Android"' },
  androidTablet: { mobile: '?0', platform: '"Android"' },
};

const TAB_UA_TYPES = ['sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'media', 'ping', 'websocket', 'other'];
// Side panel requests carry no tab id (-1), like other browser-wide requests,
// so there only the page documents get the mobile identity.
const PANEL_UA_TYPES = ['sub_frame'];
export const PANEL_RULE_BASE = 3_000_001;

/** Rule ids of a tab simulator (tab ids stay below the side panel range). */
export const ruleIdsForTab = (tabId) => {
  const base = (tabId % 1_000_000) * 2 + 1;
  return [base, base + 1];
};
/** Rule ids of a window's side panel. */
export const ruleIdsForPanel = (windowId) => {
  const base = PANEL_RULE_BASE + (windowId % 1_000_000) * 2;
  return [base, base + 1];
};
/** The window a side panel rule id belongs to (modulo 1e6), or null for a tab rule. */
export const panelWindowOf = (ruleId) => (ruleId >= PANEL_RULE_BASE ? Math.floor((ruleId - PANEL_RULE_BASE) / 2) : null);

/** A simulator's rule scope: { tabId } for a tab, { windowId } for a window's side panel. */
function scopeOf(target) {
  if (target.windowId != null) return { ids: ruleIdsForPanel(target.windowId), tabIds: [-1], uaTypes: PANEL_UA_TYPES };
  return { ids: ruleIdsForTab(target.tabId), tabIds: [target.tabId], uaTypes: TAB_UA_TYPES };
}

/** platform: 'ios' | 'ipad' | 'android' | 'androidTablet' | 'none' (keep the desktop UA) */
export async function applyRules(target, platform) {
  const { ids, tabIds, uaTypes } = scopeOf(target);
  const addRules = [
    {
      id: ids[0],
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'content-security-policy-report-only', operation: 'remove' },
        ],
      },
      condition: { tabIds, resourceTypes: ['sub_frame'] },
    },
  ];
  if (UA[platform]) {
    const hints = CLIENT_HINTS[platform];
    addRules.push({
      id: ids[1],
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'user-agent', operation: 'set', value: UA[platform] },
          { header: 'sec-ch-ua-mobile', operation: 'set', value: hints.mobile },
          { header: 'sec-ch-ua-platform', operation: 'set', value: hints.platform },
        ],
      },
      condition: { tabIds, resourceTypes: uaTypes },
    });
  }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids, addRules });
}

export async function clearRules(target) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: scopeOf(target).ids });
}
