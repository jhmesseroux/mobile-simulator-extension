// Inline phone, side-by-side: the page is narrowed by a margin, but everything measured on the
// window still sees the whole window: CSS media queries, `vw` lengths and fixed elements. The
// page then keeps its wide layout and slides under the phone. While docked, those are moved by
// the panel's width:
// - media queries: `min-width: 768px` becomes `min-width: 1189px` with a 421px panel;
// - `vw` lengths: `50vw` becomes `calc(50 * (100vw - 421px) / 100)`;
// - fixed elements anchored to the right edge move left of the panel.
// Same-origin and inline stylesheets only (cross-origin ones can't be read); JavaScript
// breakpoints (innerWidth, matchMedia) still see the whole window.

const media = new WeakMap(); // CSSMediaRule → its media text before any change
const decls = new WeakMap(); // CSSStyleRule → { prop: [value, priority] } before any change
const fixed = new Map(); // element → its inline right / max-width before any change
let mediaRules = [];
let vwRules = [];
let offset = 0;
let observer = null;
let timer = 0;

const VW = /(-?\d*\.?\d+)([dsl]?vw)\b/gi;

/** Fits the page's breakpoints, vw lengths and fixed elements to the window minus `px` (0 restores). */
export function fitPage(px) {
  px = Math.max(0, Math.round(px));
  if (px === offset) return;
  const first = !offset;
  offset = px;
  if (first) scan();
  apply();
  if (offset) watch();
  else unwatch();
}

function shiftMedia(text) {
  if (!offset) return text;
  // Each (…) feature about the viewport's width gets every length moved by the offset.
  // em in a media query is always 16px.
  return text.replace(/\(([^()]*\bwidth\b[^()]*)\)/gi, (feature, inner) =>
    /device-width|aspect/i.test(inner)
      ? feature
      : `(${inner.replace(/(\d*\.?\d+)(px|r?em)\b/gi, (_, n, unit) => `${+(Number(n) * (unit.toLowerCase() === 'px' ? 1 : 16) + offset).toFixed(2)}px`)})`,
  );
}

const shiftVw = (value) => (offset ? value.replace(VW, (_, n, unit) => `calc(${n} * (100${unit} - ${offset}px) / 100)`) : value);

function apply() {
  for (const rule of mediaRules) {
    const want = shiftMedia(media.get(rule));
    if (rule.media.mediaText !== want) rule.media.mediaText = want;
  }
  for (const rule of vwRules) {
    for (const [prop, [value, priority]] of Object.entries(decls.get(rule))) rule.style.setProperty(prop, shiftVw(value), priority);
  }
  fitFixed();
}

function scan() {
  const foundMedia = [];
  const foundVw = [];
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule && /\bwidth\b/i.test(rule.media.mediaText)) {
        if (!media.has(rule)) media.set(rule, rule.media.mediaText);
        foundMedia.push(rule);
      }
      if (rule instanceof CSSStyleRule && (decls.has(rule) || /vw\b/i.test(rule.style.cssText))) {
        if (!decls.has(rule)) {
          const saved = {};
          for (const prop of rule.style) {
            const value = rule.style.getPropertyValue(prop);
            if (/vw\b/i.test(value)) saved[prop] = [value, rule.style.getPropertyPriority(prop)];
          }
          decls.set(rule, saved);
        }
        foundVw.push(rule);
      }
      if (rule instanceof CSSImportRule) readable(rule.styleSheet, walk);
      else if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) readable(sheet, walk);
  mediaRules = foundMedia;
  vwRules = foundVw;
}

function readable(sheet, fn) {
  let rules = null;
  try {
    rules = sheet?.cssRules;
  } catch {
    // Cross-origin stylesheet: its rules can't be read or changed.
  }
  if (rules) fn(rules);
}

// Fixed elements reaching under the panel: those anchored to the right move left by the panel's
// width; full-width ones are capped to the page's width.
function fitFixed() {
  for (const [el, prev] of fixed) {
    el.style.setProperty('right', prev.right[0], prev.right[1]);
    el.style.setProperty('max-width', prev.maxWidth[0], prev.maxWidth[1]);
  }
  fixed.clear();
  if (!offset || !document.body) return;
  const area = innerWidth - offset;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.nextNode(); el; el = walker.nextNode()) {
    if (el.localName.startsWith('mobile-sim-')) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.right <= area + 1) continue;
    const prev = {
      right: [el.style.getPropertyValue('right'), el.style.getPropertyPriority('right')],
      maxWidth: [el.style.getPropertyValue('max-width'), el.style.getPropertyPriority('max-width')],
    };
    if (cs.right !== 'auto') {
      fixed.set(el, prev);
      el.style.setProperty('right', `${parseFloat(cs.right) + offset}px`, 'important');
      if (r.width > area) el.style.setProperty('max-width', `${area}px`, 'important');
    } else if (r.left <= 1 && r.width > area) {
      fixed.set(el, prev);
      el.style.setProperty('max-width', `${area}px`, 'important');
    }
  }
}

// Stylesheets and elements added later (route changes, lazy CSS, menus) are fitted too.
function refit() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!offset) return;
    scan();
    apply();
  }, 200);
}

function onLoad(e) {
  if (e.target.nodeName === 'LINK') refit();
}

function watch() {
  if (observer) return;
  observer = new MutationObserver((records) => {
    // Our own inline changes to fixed elements don't count.
    if (records.some((r) => r.type !== 'attributes' || !fixed.has(r.target))) refit();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
  document.addEventListener('load', onLoad, true);
  addEventListener('resize', refit);
}

function unwatch() {
  observer?.disconnect();
  observer = null;
  clearTimeout(timer);
  document.removeEventListener('load', onLoad, true);
  removeEventListener('resize', refit);
}
