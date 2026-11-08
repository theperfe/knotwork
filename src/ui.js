import { Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, Vector3 } from '@iwsdk/core';

// Canvas-texture panels with hand-pokeable buttons. Everything in Knotwork's
// UI can be pressed by poking with an index finger, pinching on it, a
// controller trigger, or a mouse click.
const PX = 1400; // canvas pixels per metre
const _v = new Vector3();

export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// draw text shrunk to fit maxW
export function fitText(ctx, text, x, y, maxW, size, weight = 700) {
  let fs = size; ctx.font = `${weight} ${fs}px system-ui, Arial`;
  while (ctx.measureText(text).width > maxW && fs > 10) { fs -= 2; ctx.font = `${weight} ${fs}px system-ui, Arial`; }
  ctx.fillText(text, x, y);
}

// draw text word-wrapped to maxW; returns the y below the last line
export function wrapText(ctx, text, x, y, maxW, lineH) {
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = word; } else line = t;
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}

export class Panel {
  constructor(w, h, { bg = true } = {}) {
    this.w = w; this.h = h; this.bg = bg;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * PX); this.canvas.height = Math.round(h * PX);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new CanvasTexture(this.canvas); this.tex.colorSpace = SRGBColorSpace; this.tex.anisotropy = 4;
    this.mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }));
    this.mesh.renderOrder = 10;
    this.buttons = [];
    this.painter = null;
    this.hover = null;
  }
  // buttons: {x,y,w,h (metres from panel top-left), label, sub, onPress, accent, disabled}
  setContent(painter, buttons = []) { if (buttons.length && buttons !== this.buttons) this.shownAt = performance.now(); this.painter = painter; this.buttons = buttons; this.redraw(); }
  redraw() {
    const { ctx, canvas } = this; const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.bg) {
      rr(ctx, 4, 4, W - 8, H - 8, 36); ctx.fillStyle = 'rgba(12,16,30,0.82)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(140,210,255,0.35)'; ctx.stroke();
    }
    this.painter && this.painter(ctx, W, H, PX);
    for (const b of this.buttons) {
      const x = b.x * PX, y = b.y * PX, w = b.w * PX, h = b.h * PX, hov = this.hover === b;
      rr(ctx, x, y, w, h, Math.min(28, h / 2.6));
      ctx.fillStyle = b.disabled ? 'rgba(255,255,255,0.06)' : hov ? (b.accent || '#5fd6ff') : 'rgba(255,255,255,0.12)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = b.disabled ? 'rgba(255,255,255,0.1)' : (b.accent || 'rgba(140,220,255,0.8)'); ctx.stroke();
      ctx.fillStyle = b.disabled ? 'rgba(255,255,255,0.3)' : hov ? '#071018' : '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.min(h * 0.38, 46);
      ctx.font = `700 ${fs}px system-ui, Arial`;
      if (b.icon) {
        // arrow drawn as a shape, so it never depends on the headset's fonts
        const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * 0.24, a = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[b.icon];
        ctx.beginPath();
        for (let k = 0; k < 3; k++) { const t = a + k * Math.PI * 2 / 3; ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(t) * r, cy + Math.sin(t) * r); }
        ctx.closePath(); ctx.fill();
      } else ctx.fillText(b.label, x + w / 2, y + h / 2 - (b.sub ? fs * 0.38 : 0));
      if (b.sub) { ctx.font = `500 ${fs * 0.58}px system-ui, Arial`; ctx.globalAlpha = 0.75; ctx.fillText(b.sub, x + w / 2, y + h / 2 + fs * 0.55); ctx.globalAlpha = 1; }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    this.tex.needsUpdate = true;
  }
  // world point -> panel-local metres from top-left, plus depth in front
  local(world) {
    _v.copy(world); this.mesh.worldToLocal(_v);
    return { x: _v.x + this.w / 2, y: this.h / 2 - _v.y, z: _v.z };
  }
  hit(lx, ly) { return this.buttons.find(b => !b.disabled && lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h); }
}

// Tracks pokes/pinches/clicks across all visible panels
export class UIInput {
  constructor() { this.panels = new Set(); this.touch = new Map(); this.cool = 0; }
  add(p) { this.panels.add(p); return p; }
  update(dt, pointers, onPress) {
    this.cool -= dt;
    const hovers = new Map();
    const visible = [...this.panels].filter(p => p.mesh.visible && p.mesh.parent && p.buttons.length);
    for (const ptr of pointers.hands()) {
      for (const panel of visible) {
        const t = panel.local(ptr.tip), q = panel.local(ptr.pos);
        // poke: index tip within ~1.5 cm of the surface
        const pokeBtn = Math.abs(t.z) < 0.018 && t.z > -0.05 ? panel.hit(t.x, t.y) : null;
        // pinch: pinch point near the surface when the pinch starts
        const pinchBtn = Math.abs(q.z) < 0.05 ? panel.hit(q.x, q.y) : null;
        const b = pokeBtn || pinchBtn;
        if (b) hovers.set(panel, b);
        // a poke only counts when the fingertip arrives from in front of the
        // panel, so a panel that appears under a resting hand can't be pressed by accident
        const key = ptr.id + panel.mesh.uuid;
        const st = this.touch.get(key) || { z: 1, armed: false, btn: null };
        if (t.z > 0.022) st.armed = true;
        const ready = this.cool <= 0 && (performance.now() - (panel.shownAt || 0)) > 600;
        if (pokeBtn && st.armed && st.btn !== pokeBtn && ready) { this.fire(pokeBtn, onPress); st.armed = false; }
        else if (pinchBtn && ptr.pressed && ready) { this.fire(pinchBtn, onPress); }
        if (t.z < -0.03 || !pokeBtn) st.btn = pokeBtn; else st.btn = pokeBtn;
        st.z = t.z; this.touch.set(key, st);
      }
    }
    if (!pointers.xr) {
      const hits = pointers.ray.intersectObjects(visible.map(p => p.mesh), false);
      if (hits.length) {
        const panel = visible.find(p => p.mesh === hits[0].object), uv = hits[0].uv;
        const b = panel.hit(uv.x * panel.w, (1 - uv.y) * panel.h);
        if (b) { hovers.set(panel, b); if (pointers.mouse.pressedNow && this.cool <= 0) { this.fire(b, onPress); pointers.mouse.consumed = true; } }
      }
    }
    for (const panel of visible) {
      const h = hovers.get(panel) || null;
      if (panel.hover !== h) { panel.hover = h; panel.redraw(); }
    }
  }
  fire(b, onPress) { this.cool = 0.35; onPress && onPress(b); b.onPress && b.onPress(); }
}
