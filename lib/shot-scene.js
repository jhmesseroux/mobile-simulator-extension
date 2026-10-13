// The device drawn for screenshot exports (frame, base, screen capture), shared by the
// simulator's screenshot dialog and page mode. `finish` is a FINISHES id.

import { finishColors } from './devices.js';

// The device body for exports: metal rim in the current finish, highlight, black glass.
export function drawFrame(ctx, box, g, unit, finish) {
  const { a, b, angle } = finishColors(finish);
  const rim = g.rim * unit;
  const radius = g.radius * unit;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const along = () => ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  const shape = (inset, r) => {
    ctx.beginPath();
    ctx.roundRect(box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2, Math.max(0, r));
  };

  const metal = along();
  metal.addColorStop(0, a);
  metal.addColorStop(1, b);
  ctx.fillStyle = metal;
  shape(0, radius);
  ctx.fill();
  const shine = along();
  shine.addColorStop(0, 'rgba(255,255,255,.4)');
  shine.addColorStop(0.22, 'rgba(255,255,255,0)');
  shine.addColorStop(0.78, 'rgba(255,255,255,0)');
  shine.addColorStop(1, 'rgba(255,255,255,.2)');
  ctx.fillStyle = shine;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.33)';
  ctx.lineWidth = 0.75 * unit;
  shape(0.375 * unit, radius - 0.375 * unit);
  ctx.stroke();
  ctx.fillStyle = '#000';
  shape(rim, radius - rim);
  ctx.fill();
}

// Laptop deck or monitor stand under a desktop's screen, in the frame's finish.
export function drawBase(ctx, box, g, unit, finish) {
  const { a, b } = finishColors(finish);
  const metal = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  metal.addColorStop(0, a);
  metal.addColorStop(1, b);
  ctx.fillStyle = metal;
  ctx.beginPath();
  if (g.base === 'laptop') {
    // Deck as wide as the lid, with a notch to open it.
    ctx.roundRect(box.x, box.y, box.w, box.h, [0, 0, box.h * 0.6, box.h * 0.6]);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.roundRect(box.x + box.w * 0.42, box.y, box.w * 0.16, box.h * 0.32, [0, 0, 6 * unit, 6 * unit]);
    ctx.fill();
  } else {
    // Neck, then the foot.
    const neckW = box.w * 0.14;
    ctx.rect(box.x + (box.w - neckW) / 2, box.y, neckW, box.h * 0.82);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(box.x + box.w * 0.3, box.y + box.h * 0.82, box.w * 0.4, box.h * 0.18, 8 * unit);
    ctx.fill();
  }
}

// Layout items + draw callback for screenshots, from the captured screens.
/** captures: [{ canvas, g }] (screen capture + geometry). Returns { items, draw } for paint(). */
export function shotScene(captures, opts, finish) {
  const items = captures.map(({ g }) =>
    opts.frame ? { w: g.outerW, h: g.outerH + g.baseH, radius: g.base ? 0 : g.radius } : { w: g.w, h: g.h, radius: g.screenRadius },
  );
  const draw = (ctx, box, i) => {
    const { canvas, g } = captures[i];
    const unit = box.w / items[i].w;
    let screen = box;
    if (opts.frame) {
      drawFrame(ctx, { x: box.x, y: box.y, w: box.w, h: g.outerH * unit }, g, unit, finish);
      if (g.base) drawBase(ctx, { x: box.x, y: box.y + g.outerH * unit, w: box.w, h: g.baseH * unit }, g, unit, finish);
      screen = { x: box.x + g.bezel[3] * unit, y: box.y + g.bezel[0] * unit, w: g.w * unit, h: g.h * unit };
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(screen.x, screen.y, screen.w, screen.h, g.screenRadius * unit);
    ctx.clip();
    ctx.drawImage(canvas, screen.x, screen.y, screen.w, screen.h);
    ctx.restore();
  };
  return { items, draw };
}
