// Page mode, page world, document start: inside the phone of page mode (and only there),
// make the page's JavaScript see the phone's browser. Request headers are handled by the
// background's rules; CSS hover/pointer media queries can't be changed from here.
(() => {
  let host;
  try {
    host = window.frameElement;
  } catch {
    return; // cross-origin parent: not a page-mode phone
  }
  if (!host || host.id !== 'mobile-sim-screen' || !host.dataset.ua) return;
  const { ua, mobile, platform, touch } = host.dataset;

  const define = (proto, prop, value) => {
    try {
      Object.defineProperty(proto, prop, { get: () => value, configurable: true });
    } catch {
      // Locked by the page or the browser: leave it as it is.
    }
  };
  const platformName = { '"iOS"': 'iPhone', '"Android"': 'Linux armv81', '"macOS"': 'MacIntel' }[platform] || navigator.platform;

  define(Navigator.prototype, 'userAgent', ua);
  define(Navigator.prototype, 'appVersion', ua.replace(/^Mozilla\//, ''));
  define(Navigator.prototype, 'platform', platformName);
  if (touch === '1') {
    define(Navigator.prototype, 'maxTouchPoints', 5);
    if (!('ontouchstart' in window)) window.ontouchstart = null;
  }
  if (typeof NavigatorUAData !== 'undefined') {
    define(NavigatorUAData.prototype, 'mobile', mobile === '?1');
    define(NavigatorUAData.prototype, 'platform', platform.replace(/"/g, ''));
  }
})();
