// Device picker pieces shared by the simulator page and page mode (styles: device-picker.css).

export const TAB_LABELS = { iphone: 'iPhone', android: 'Android', tablet: 'Tablets', desktop: 'Desktop', custom: 'Custom' };

export const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** One card: silhouette at scale, name, CSS size; custom devices get a delete button. */
export function deviceCard(d, selected) {
  const k = Math.min(80 / Math.max(1000, d.h), 96 / d.w);
  return `
    <button class="dev-card${selected ? ' on' : ''}" data-id="${d.id}">
      <i class="sil${d.frame === 'home' ? ' home' : ''}" style="width:${Math.round(d.w * k)}px;height:${Math.round(d.h * k)}px"></i>
      <b>${esc(d.name)}</b><span>${d.w} × ${d.h}</span>
      ${d.group === 'custom' ? `<span class="del" data-del="${d.id}" title="Delete" aria-label="Delete ${esc(d.name)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>` : ''}
    </button>`;
}
