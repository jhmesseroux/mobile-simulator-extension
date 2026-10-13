// Shows what the page sees: viewport, user agent, touch, theme. Shared by every test page.
const out = document.getElementById('probe');
const show = () => {
  out.textContent = JSON.stringify({
    framed: window !== window.top,
    width: innerWidth,
    mobileQuery: matchMedia('(max-width: 600px)').matches,
    ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 60),
    uaMobile: navigator.userAgentData ? navigator.userAgentData.mobile : null,
    maxTouchPoints: navigator.maxTouchPoints,
    touchEvents: 'ontouchstart' in window,
    path: location.pathname + location.search + location.hash,
    cookie: document.cookie.includes('pm_session=1'),
  }, null, 1);
};
addEventListener('resize', show);
addEventListener('popstate', show);
show();
document.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState({}, '', a.getAttribute('href'));
  document.getElementById('route').textContent = a.textContent;
  show();
}));
document.getElementById('tap')?.addEventListener('click', () => {
  const n = document.getElementById('taps');
  n.textContent = String(Number(n.textContent) + 1);
});
