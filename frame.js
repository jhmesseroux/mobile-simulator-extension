// Runs in every page. In the website's own tab it only answers the side panel's scroll
// sync. Inside a simulator screen it adds touch-style drag scrolling, hides scrollbars,
// reports URL/title/theme colour, and takes part in scroll sync.
(() => {
  // Can be injected again by the side panel into tabs opened before the extension loaded.
  if (window.__mobileSimFrame) return;
  window.__mobileSimFrame = true;

  const SIM = `chrome-extension://${chrome.runtime.id}`;
  const isTop = window === window.top;
  if (!isTop && location.ancestorOrigins?.[0] !== SIM) return;

  // ---------- scroll sync (both sides use the same section matching) ----------

  // Pages differ between desktop and mobile layouts, so positions are exchanged as
  // "which section, and how far into it", not as pixels.
  const READ_LINE = 0.25; // the reading line sits a quarter down the viewport
  const USER_WINDOW_MS = 1200; // scrolls this long after a user gesture count as the user's
  const EMIT_EVERY_MS = 33;
  const GLIDE_MAX_FRAMES = 120;
  const ANCHOR_TTL_MS = 1000;
  const ANCHOR_REBUILD_MS = 250; // DOM changes rebuild the landmarks at most this often
  const MAX_ANCHORS = 400;
  const SKIP_TAGS = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|svg)$/i;
  const AUTO_ID = /^(\d|[:_]|radix|headlessui|react|ember|mui-|__next$|root$|app$)/i;

  // The engine attaches its listeners and DOM observer only while sync is on, so pages
  // that never sync (nearly all of them) pay nothing.
  function createSync(emit) {
    let on = false;
    let attached = false;
    let emitting = true; // false on a side that only follows (one-way sync)
    let mode = 'section'; // 'section' | 'percent'
    let lastInput = 0;
    let follow = 0; // rAF id while gliding to a position received from the other side
    let goal = 0;
    let frames = 0;
    let rootCache = null;
    let rootCachedAt = 0;
    let anchorCache = null; // { at, list, tops }
    let dirty = false;
    let emitTimer = 0;

    const doc = () => document.scrollingElement || document.documentElement;
    const isScroller = (el) =>
      el.scrollHeight > el.clientHeight + 40 && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);
    // The page's main scroller: the document, or a big scrolling box on app-like pages.
    const root = () => {
      const now = performance.now();
      if (rootCache && now - rootCachedAt < 2000) return rootCache;
      let found = doc();
      if (found.scrollHeight <= found.clientHeight + 4 && document.body) {
        for (const el of document.querySelectorAll('main, body > *, body > * > *, body > * > * > *')) {
          if (el.clientHeight > innerHeight * 0.5 && isScroller(el)) {
            found = el;
            break;
          }
        }
      }
      if (found !== rootCache) anchorCache = null;
      rootCache = found;
      rootCachedAt = now;
      return found;
    };
    const isDoc = (r) => r === doc();
    const viewTop = (r) => r.scrollTop;
    const viewH = (r) => (isDoc(r) ? innerHeight : r.clientHeight);
    const maxTop = (r) => Math.max(0, r.scrollHeight - viewH(r));
    const absTop = (el, r) => el.getBoundingClientRect().top + r.scrollTop - (isDoc(r) ? 0 : r.getBoundingClientRect().top);

    // Sticky/fixed things move with the viewport, so they are useless as landmarks.
    // `memo` caches the answer per ancestor for one rebuild (anchors share ancestors).
    const pinned = (el, memo) => {
      const seen = [];
      let result = false;
      for (let n = el, depth = 0; n && n !== document.body && depth < 6; n = n.parentElement, depth++) {
        if (memo.has(n)) {
          result = memo.get(n);
          break;
        }
        seen.push(n);
        if (/fixed|sticky/.test(getComputedStyle(n).position)) {
          result = true;
          break;
        }
      }
      for (const n of seen) memo.set(n, result);
      return result;
    };

    // Landmarks (ids, then headings), cached: rebuilt after DOM changes (at most every
    // ANCHOR_REBUILD_MS), on resize, or after ANCHOR_TTL_MS.
    const anchors = (r) => {
      const now = performance.now();
      if (anchorCache) {
        const age = now - anchorCache.at;
        if (age < ANCHOR_TTL_MS && !(dirty && age >= ANCHOR_REBUILD_MS)) return anchorCache;
      }
      dirty = false;
      const list = [];
      const seen = new Map();
      const memo = new WeakMap();
      for (const el of document.querySelectorAll('h1, h2, h3, h4, [id]')) {
        if (list.length >= MAX_ANCHORS) break;
        if (SKIP_TAGS.test(el.tagName) || el.ownerSVGElement || el.offsetHeight < 4) continue;
        if (el.closest('nav, header, footer, [role="navigation"], [aria-hidden="true"]')) continue;
        let key = null;
        if (el.id && el.id.length < 60 && !AUTO_ID.test(el.id)) key = `#${el.id}`;
        else if (/^H[1-4]$/.test(el.tagName)) {
          const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80).toLowerCase();
          if (!text) continue;
          const n = seen.get(text) || 0;
          seen.set(text, n + 1);
          key = `h:${text}|${n}`;
        }
        if (key && !pinned(el, memo)) list.push({ key, top: absTop(el, r) });
      }
      list.sort((x, y) => x.top - y.top);
      anchorCache = { at: now, list, tops: new Map(list.map((a) => [a.key, a.top])) };
      return anchorCache;
    };

    // Where we are: the landmarks around the reading line and their distance to it.
    const position = () => {
      const r = root();
      const top = viewTop(r);
      const max = maxTop(r);
      const line = top + viewH(r) * READ_LINE;
      const { list } = anchors(r);
      let i = 0;
      while (i < list.length && list[i].top <= line) i++;
      const near = list.slice(Math.max(0, i - 4), i + 4).map((a) => ({ key: a.key, d: a.top - line }));
      return { near, pct: max ? top / max : 0, atTop: top < 2, atBottom: max > 0 && top >= max - 2 };
    };

    const glideTo = (r, y) => {
      goal = y;
      frames = 0;
      if (follow) return;
      let previous = NaN;
      const step = () => {
        const cur = viewTop(r);
        const d = goal - cur;
        // Stop when there, when the page won't scroll further, or after ~2 s.
        if (Math.abs(d) < 1 || cur === previous || ++frames > GLIDE_MAX_FRAMES) {
          r.scrollTo({ top: goal, behavior: 'instant' });
          follow = 0;
          return;
        }
        previous = cur;
        r.scrollTo({ top: cur + d * 0.2, behavior: 'instant' });
        follow = requestAnimationFrame(step);
      };
      follow = requestAnimationFrame(step);
    };

    // Places the reading line between the two nearest landmarks both pages share, so the
    // motion stays continuous even when a section is much longer on one side.
    const apply = (pos) => {
      if (!pos || performance.now() - lastInput < 300) return; // the user is scrolling here
      const r = root();
      const max = maxTop(r);
      const vh = viewH(r);
      let y = pos.pct * max;
      if (pos.atTop) y = 0;
      else if (pos.atBottom) y = max;
      else if (mode === 'section' && pos.near?.length) {
        const { tops } = anchors(r);
        let before = null;
        let after = null;
        for (const n of pos.near) {
          if (!tops.has(n.key)) continue;
          if (n.d <= 0) before = { d: n.d, top: tops.get(n.key) };
          else if (!after) after = { d: n.d, top: tops.get(n.key) };
        }
        let line = null;
        if (before && after && after.top > before.top && after.d - before.d > 1) {
          const t = -before.d / (after.d - before.d);
          line = before.top + t * (after.top - before.top);
        } else if (before) line = before.top - before.d;
        else if (after) line = after.top - after.d;
        if (line != null) y = line - vh * READ_LINE;
      }
      glideTo(r, Math.min(max, Math.max(0, y)));
    };

    const markInput = () => {
      lastInput = performance.now();
      if (follow) {
        cancelAnimationFrame(follow);
        follow = 0;
      }
    };
    const onScroll = () => {
      // Only scrolls the user is making here are sent: never echo a synced scroll back.
      if (!emitting || follow || performance.now() - lastInput > USER_WINDOW_MS || emitTimer) return;
      emitTimer = setTimeout(() => {
        emitTimer = 0;
        if (on) emit(position());
      }, EMIT_EVERY_MS);
    };
    const onResize = () => (anchorCache = null);
    const observer = new MutationObserver(() => (dirty = true));
    const INPUTS = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    const opts = { capture: true, passive: true };

    const attach = () => {
      attached = true;
      for (const type of INPUTS) addEventListener(type, markInput, opts);
      addEventListener('scroll', onScroll, opts);
      addEventListener('resize', onResize);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    const detach = () => {
      attached = false;
      for (const type of INPUTS) removeEventListener(type, markInput, opts);
      removeEventListener('scroll', onScroll, opts);
      removeEventListener('resize', onResize);
      observer.disconnect();
      clearTimeout(emitTimer);
      emitTimer = 0;
      if (follow) cancelAnimationFrame(follow);
      follow = 0;
      anchorCache = null;
      rootCache = null;
    };

    return {
      configure(next) {
        on = !!next?.on;
        if (next?.mode) mode = next.mode;
        if (next?.emit != null) emitting = !!next.emit;
        if (on && !attached) attach();
        else if (!on && attached) detach();
      },
      position,
      apply,
    };
  }

  // Created on first use: most pages never sync.
  let syncEngine = null;
  const getSync = (emit) => (syncEngine ??= createSync(emit));

  // ---------- the website's own tab: scroll sync with the side panel ----------

  if (isTop) {
    const emit = (pos) => {
      try {
        chrome.runtime.sendMessage({ type: 'site-scroll', pos }).catch(() => syncEngine?.configure({ on: false }));
      } catch {
        // Extension reloaded: this orphaned script can no longer reach it.
        syncEngine?.configure({ on: false });
      }
    };
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg?.type === 'ms-sync') getSync(emit).configure(msg.value);
      else if (msg?.type === 'ms-scroll-to') getSync(emit).apply(msg.pos);
      else if (msg?.type === 'ms-position') reply(getSync(emit).position());
      else return;
      if (msg.type !== 'ms-position') reply(true);
    });
    return;
  }

  // ---------- inside a simulator screen ----------

  const html = document.documentElement;
  const post = (msg) => window.parent.postMessage({ __mobileSim: true, ...msg }, SIM);
  const emitScroll = (pos) => post({ type: 'scroll', pos });

  const cursor = (fill) =>
    `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><circle cx='15' cy='15' r='12' fill='${fill}' stroke='white' stroke-opacity='.9' stroke-width='2'/></svg>`,
    )}") 15 15, auto`;

  const style = document.createElement('style');
  style.textContent = `
    *{scrollbar-width:none!important}
    *::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
    html.__ms-touch,html.__ms-touch *{cursor:${cursor('rgba(120,120,128,.45)')}!important}
    html.__ms-dragging,html.__ms-dragging *{cursor:${cursor('rgba(80,80,88,.7)')}!important;user-select:none!important}`;
  html.appendChild(style);

  let touch = true;
  let recording = false;
  html.classList.add('__ms-touch');

  // --- drag to scroll, with momentum ---
  let drag = null;
  let momentum = 0;
  let suppressClick = false;

  const isScrollable = (el) => {
    const cs = getComputedStyle(el);
    return (
      (/(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
      (/(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)
    );
  };
  const scrollTarget = (el) => {
    for (; el && el !== document.body && el !== html; el = el.parentElement) {
      if (isScrollable(el)) return el;
    }
    return document.scrollingElement || html;
  };
  const stopMomentum = () => cancelAnimationFrame(momentum);
  const glide = (el, vx, vy) => {
    let last = performance.now();
    const step = (now) => {
      const dt = now - last;
      last = now;
      const before = el.scrollTop + el.scrollLeft;
      el.scrollBy(vx * dt, vy * dt);
      const decay = Math.pow(0.995, dt);
      vx *= decay;
      vy *= decay;
      // Stop at the end of the scroller too, not only when the fling dies out.
      const moved = el.scrollTop + el.scrollLeft !== before;
      if (moved && Math.abs(vx) + Math.abs(vy) > 0.02) momentum = requestAnimationFrame(step);
    };
    momentum = requestAnimationFrame(step);
  };

  const pointer = { raf: 0, data: null };
  const sendPointer = (e, down, out = false) => {
    if (!recording) return;
    pointer.data = { x: e.clientX, y: e.clientY, down, out };
    if (!pointer.raf) {
      pointer.raf = requestAnimationFrame(() => {
        pointer.raf = 0;
        post({ type: 'pointer', ...pointer.data });
      });
    }
  };

  addEventListener('mousedown', (e) => {
    sendPointer(e, true);
    if (!touch || e.button !== 0) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
    stopMomentum();
    drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), vx: 0, vy: 0, el: scrollTarget(e.target), moved: false };
  }, true);

  addEventListener('mousemove', (e) => {
    sendPointer(e, !!(e.buttons & 1));
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moved = true;
      html.classList.add('__ms-dragging');
      getSelection()?.removeAllRanges();
    }
    e.preventDefault();
    const dx = e.clientX - drag.lx;
    const dy = e.clientY - drag.ly;
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.el.scrollBy(-dx, -dy);
    drag.vx = 0.7 * (-dx / dt) + 0.3 * drag.vx;
    drag.vy = 0.7 * (-dy / dt) + 0.3 * drag.vy;
    Object.assign(drag, { lx: e.clientX, ly: e.clientY, t: now });
  }, true);

  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 300);
      // Released after a pause: no fling.
      if (performance.now() - drag.t < 80) glide(drag.el, drag.vx, drag.vy);
    }
    html.classList.remove('__ms-dragging');
    drag = null;
  };
  addEventListener('mouseup', (e) => {
    sendPointer(e, false);
    endDrag();
  }, true);
  html.addEventListener('mouseleave', (e) => {
    sendPointer(e, false, true);
    endDrag();
  });
  addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  addEventListener('dragstart', (e) => touch && e.preventDefault(), true);
  addEventListener('wheel', stopMomentum, { passive: true, capture: true });

  // --- report page state ---
  const themeColor = () => {
    const meta = [...document.querySelectorAll('meta[name="theme-color"]')].find((m) => !m.media || matchMedia(m.media).matches);
    if (meta?.content) return meta.content;
    for (const el of [document.body, html]) {
      if (!el) continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
    }
    return '#ffffff';
  };
  let lastUrl = '';
  let lastTitle = '';
  const report = () => {
    lastUrl = location.href;
    lastTitle = document.title;
    post({ type: 'nav', url: lastUrl, title: lastTitle, theme: document.body ? themeColor() : null });
  };
  const reportIfChanged = () => {
    if (location.href !== lastUrl || document.title !== lastTitle) report();
  };
  addEventListener('DOMContentLoaded', () => {
    report();
    // Title changes (SPAs) without polling.
    if (document.head) new MutationObserver(reportIfChanged).observe(document.head, { childList: true, subtree: true, characterData: true });
  });
  addEventListener('load', report);
  addEventListener('beforeunload', () => post({ type: 'loading' }));
  addEventListener('popstate', reportIfChanged);
  addEventListener('hashchange', reportIfChanged);
  window.navigation?.addEventListener('currententrychange', () => setTimeout(reportIfChanged, 0));
  // Slow safety net for history changes the events above miss.
  setInterval(reportIfChanged, 2000);

  // --- on-screen keyboard: tell the simulator when a text field gets focus ---
  const TEXT_TYPES = /^(text|email|url|search|tel|number|password)$/;
  let field = null;
  let closeTimer = 0;

  const isEditable = (el) =>
    el && ((el.tagName === 'INPUT' && TEXT_TYPES.test(el.type) && !el.readOnly && !el.disabled) ||
      (el.tagName === 'TEXTAREA' && !el.readOnly && !el.disabled) || el.isContentEditable);

  const fieldInfo = (el) => {
    const mode = (el.getAttribute('inputmode') || '').toLowerCase();
    const type = el.tagName === 'INPUT' ? el.type : 'text';
    let kind = 'text';
    if (mode === 'decimal') kind = 'decimal';
    else if (mode === 'numeric' || mode === 'tel' || type === 'tel' || type === 'number' || el.autocomplete === 'one-time-code') kind = 'number';
    else if (mode === 'email' || type === 'email') kind = 'email';
    else if (mode === 'url' || type === 'url') kind = 'url';
    else if (mode === 'search' || type === 'search') kind = 'search';
    const enter = (el.getAttribute('enterkeyhint') || '').toLowerCase();
    return { kind, enter, multiline: el.tagName === 'TEXTAREA' || el.isContentEditable };
  };

  addEventListener('focusin', (e) => {
    if (!isEditable(e.target)) return;
    clearTimeout(closeTimer);
    field = e.target;
    post({ type: 'kb-open', info: fieldInfo(field) });
  }, true);
  addEventListener('focusout', () => {
    clearTimeout(closeTimer);
    // Focus may be moving to another field, or coming back after a key click.
    closeTimer = setTimeout(() => {
      if (!isEditable(document.activeElement) || !document.hasFocus()) {
        field = null;
        post({ type: 'kb-close' });
      }
    }, 150);
  }, true);
  addEventListener('keydown', (e) => {
    // Reload shortcut inside the phone: reload just this page, not the whole simulator tab.
    if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'r' && !e.shiftKey)) {
      e.preventDefault();
      post({ type: 'reload-request' });
      return;
    }
    if (field) post({ type: 'kb-press', key: e.key });
  }, true);

  // The visible area just shrank: bring the field above the keyboard, like a phone does.
  const hidden = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > innerHeight - 8 || r.top < 0;
  };
  const revealField = () => {
    if (!field || !hidden(field)) return;
    const el = field;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Smooth scrolling can be skipped (reduced motion, background tab): make sure it landed.
    setTimeout(() => field === el && hidden(el) && el.scrollIntoView({ block: 'center', behavior: 'instant' }), 450);
  };

  const focusables = () =>
    [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')].filter((el) => isEditable(el) && el.getClientRects().length);

  // A key clicked on the simulator's keyboard.
  const typeKey = (k) => {
    if (!field) return;
    if (document.activeElement !== field) field.focus({ preventScroll: true });
    clearTimeout(closeTimer);
    if (k === 'Backspace') {
      document.execCommand('delete');
      return;
    }
    if (k !== 'Enter') {
      document.execCommand('insertText', false, k);
      return;
    }
    const { enter, multiline } = fieldInfo(field);
    if (multiline && !enter) {
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (enter === 'next') {
      const list = focusables();
      const next = list[list.indexOf(field) + 1];
      if (next) next.focus();
      else field.blur();
      return;
    }
    if (enter === 'done') {
      field.blur();
      return;
    }
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const go = field.dispatchEvent(new KeyboardEvent('keydown', init));
    field.dispatchEvent(new KeyboardEvent('keyup', init));
    if (go && field.form) field.form.requestSubmit();
  };

  addEventListener('message', (e) => {
    if (e.origin !== SIM || !e.data?.__mobileSim) return;
    const { type, value } = e.data;
    if (type === 'kb-key') typeKey(value);
    else if (type === 'kb-shown') setTimeout(revealField, 30);
    else if (type === 'back') history.back();
    else if (type === 'forward') history.forward();
    else if (type === 'reload') location.reload();
    else if (type === 'recording') recording = !!value;
    else if (type === 'sync') getSync(emitScroll).configure(value);
    else if (type === 'scroll-to') syncEngine?.apply(value);
    else if (type === 'touch') {
      touch = !!value;
      html.classList.toggle('__ms-touch', touch);
    }
  });

  post({ type: 'hello' });
})();
