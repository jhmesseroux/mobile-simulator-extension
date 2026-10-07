// On-screen keyboards (iOS, Gboard-style Android, iPad) rendered as HTML.
// Keys carry data-k: a character to type, or one of: shift, backspace, enter, space,
// layer:abc | layer:num | layer:sym, and '.com'.

// Heights in CSS px, matching the real keyboards (bottom system area included).
const HEIGHTS = {
  ios: { portrait: 336, landscape: 209 },
  android: { portrait: 316, landscape: 220 },
  ipad: { portrait: 398, landscape: 352 },
};

export const keyboardOs = (frame) => (frame === 'punch' || frame === 'tab' ? 'android' : frame === 'ipad' ? 'ipad' : 'ios');
export const keyboardHeight = (os, landscape) => HEIGHTS[os][landscape ? 'landscape' : 'portrait'];

const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const IOS_NUM = ['1234567890', '-/:;()$&@"', ".,?!'"];
const IOS_SYM = ['[]{}#%^*+=', '_\\|~<>€£¥•', ".,?!'"];
const AND_NUM = ['1234567890', '@#$_&-+()/', '*"\':;!?'];
const AND_SYM = ['~`|•√π÷×¶∆', '£¢€¥^°={}\\', '%©®™✓[]'];

const ICONS = {
  shift: '<svg viewBox="0 0 24 24"><path d="M12 4 4 12h4.5v7h7v-7H20Z"/></svg>',
  shiftOn: '<svg viewBox="0 0 24 24"><path d="M12 4 4 12h4.5v7h7v-7H20Z" fill="currentColor"/></svg>',
  backspace: '<svg viewBox="0 0 24 24"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7Z"/><path d="m12 9 6 6M18 9l-6 6"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  emoji: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/></svg>',
  enter: '<svg viewBox="0 0 24 24"><path d="M19 6v6H6m0 0 4-4m-4 4 4 4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M4 12 20 4l-6 16-3-7Z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  done: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L19 7"/></svg>',
};

const esc = (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c;
const key = (k, label = k, cls = '') => `<button class="k ${cls}" data-k="${esc(k)}" tabindex="-1">${label === k ? esc(label) : label}</button>`;
const row = (keys, cls = '') => `<div class="kr ${cls}">${keys.join('')}</div>`;

/** The return key's look: iOS shows a word, Gboard an icon. Blue when it acts (go, search, send, done). */
function enterKey(os, enter) {
  if (os === 'android') return key('enter', ICONS[enter] || ICONS.enter, 'enter action');
  const action = ['go', 'search', 'send', 'done'].includes(enter);
  const label = { go: 'go', search: 'search', send: 'send', done: 'done', next: 'next' }[enter] || 'return';
  return key('enter', label, `enter wide${action ? ' action' : ''}`);
}

function numberPad(os, decimal, enter) {
  if (os === 'android') {
    const r = (keys) => row(keys.map((k) => (k.length === 1 ? key(k) : k)));
    return [
      r(['1', '2', '3', key('-', '-', 'fn')]),
      r(['4', '5', '6', key('space', '␣', 'fn')]),
      r(['7', '8', '9', key('backspace', ICONS.backspace, 'fn')]),
      r([key(',', ',', 'fn'), '0', key('.', '.', 'fn'), enterKey(os, enter)]),
    ].join('');
  }
  const sub = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' };
  const digit = (d) => key(d, `${d}<small>${sub[d] || '&nbsp;'}</small>`, 'pad');
  return [
    row(['1', '2', '3'].map(digit), 'pad-row'),
    row(['4', '5', '6'].map(digit), 'pad-row'),
    row(['7', '8', '9'].map(digit), 'pad-row'),
    row([decimal ? key('.', '.', 'pad flat') : '<span class="k pad blank"></span>', digit('0'), key('backspace', ICONS.backspace, 'pad flat')], 'pad-row'),
  ].join('');
}

/**
 * info: { kind: 'text'|'email'|'url'|'search'|'number'|'decimal', enter: enterkeyhint or '' }
 * layer: 'abc' | 'num' | 'sym'
 */
export function renderKeyboard(os, info, layer, shift) {
  const enter = info.enter || (info.kind === 'search' ? 'search' : '');
  const isNumberPad = info.kind === 'number' || info.kind === 'decimal';
  const bottomBar = os === 'ios' ? `<div class="kb-sys"><span>${ICONS.globe}</span><span>${ICONS.mic}</span></div>` : '';
  if (isNumberPad) return `<div class="kb-rows pad">${numberPad(os, info.kind === 'decimal', enter)}</div>${bottomBar}`;

  const android = os === 'android';
  const sets = layer === 'abc' ? LETTERS : layer === 'num' ? (android ? AND_NUM : IOS_NUM) : android ? AND_SYM : IOS_SYM;
  const chars = (s) => [...s].map((c) => key(layer === 'abc' && shift ? c.toUpperCase() : c));

  const r1 = row(chars(sets[0]));
  const r2 = row(chars(sets[1]), layer === 'abc' ? 'inset' : '');
  const left = layer === 'abc'
    ? key('shift', shift ? ICONS.shiftOn : ICONS.shift, `fn shift${shift ? ' on' : ''}`)
    : key(layer === 'num' ? 'layer:sym' : 'layer:num', android ? (layer === 'num' ? '=\\<' : '?123') : layer === 'num' ? '#+=' : '123', 'fn');
  const r3 = row([left, ...chars(sets[2]), key('backspace', ICONS.backspace, 'fn')]);

  const toggle = key(layer === 'abc' ? 'layer:num' : 'layer:abc', layer === 'abc' ? (android ? '?123' : '123') : 'ABC', 'fn');
  let middle;
  if (info.kind === 'email') middle = [key('space', android ? '' : 'space', 'space'), key('@', '@', 'fn'), key('.', '.', 'fn')];
  else if (info.kind === 'url') middle = [key('/', '/', 'fn'), key('.', '.', 'fn'), key('.com', '.com', 'fn com')];
  else middle = android ? [key(',', ',', 'fn'), key('space', '', 'space'), key('.', '.', 'fn')] : [key('space', 'space', 'space')];
  const extra = android ? [] : [key('emoji', ICONS.emoji, 'fn deco')];
  const r4 = row([toggle, ...extra, ...middle, enterKey(os, enter)], 'bottom');
  return `<div class="kb-rows">${r1}${r2}${r3}${r4}</div>${bottomBar}`;
}
