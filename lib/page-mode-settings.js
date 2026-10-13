// Page mode settings: which websites may open the phone inside their own page
// (#mobile-sim or postMessage). Local development hosts by default; others are opt-in.

export const DEFAULT_PAGE_MODE = { enabled: true, hosts: ['localhost', '127.0.0.1', '*.localhost', '*.test'] };

/** Settings as stored, with defaults filled in. Hosts are lower-case, ports ignored. */
export async function loadPageMode() {
  const { pageMode } = await chrome.storage.local.get('pageMode');
  return normalize(pageMode);
}

export function normalize(value) {
  const merged = { ...DEFAULT_PAGE_MODE, ...(value || {}) };
  const hosts = (Array.isArray(merged.hosts) ? merged.hosts : [])
    .map((h) => String(h).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, ''))
    .filter((h) => /^(\*\.)?[a-z0-9.-]+$/.test(h));
  return { enabled: merged.enabled !== false, hosts: [...new Set(hosts)] };
}

/** `*.example.test` allows example.test and every subdomain of it. */
export function hostAllowed(host, settings) {
  if (!settings.enabled) return false;
  const h = String(host).toLowerCase();
  return settings.hosts.some((p) => (p.startsWith('*.') ? h === p.slice(2) || h.endsWith(p.slice(1)) : h === p));
}

/** Match patterns for the identity script (ports are not part of a match pattern). */
export function matchPatterns(settings) {
  if (!settings.enabled) return [];
  // Chrome's `*.host` pattern also matches the host itself.
  return [...new Set(settings.hosts.map((p) => `*://${p}/*`))];
}
