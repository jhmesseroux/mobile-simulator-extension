// A floating pill (the recording timer) dragged by its body, kept inside the window. Its
// position must be `fixed`, or `absolute` in a box covering the window; buttons inside still click.
export function dragPill(pill) {
  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = pill.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    pill.setPointerCapture(e.pointerId);
    pill.classList.add('dragging');
    const move = (ev) => {
      const x = Math.min(Math.max(ev.clientX - dx, 8), innerWidth - r.width - 8);
      const y = Math.min(Math.max(ev.clientY - dy, 8), innerHeight - r.height - 8);
      Object.assign(pill.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
    };
    const end = () => {
      pill.classList.remove('dragging');
      pill.removeEventListener('pointermove', move);
      pill.removeEventListener('pointerup', end);
      pill.removeEventListener('pointercancel', end);
    };
    pill.addEventListener('pointermove', move);
    pill.addEventListener('pointerup', end);
    pill.addEventListener('pointercancel', end);
  });
}
