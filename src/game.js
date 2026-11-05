import {
  createSystem, Group, Vector3, Mesh, SphereGeometry, MeshBasicMaterial, TorusGeometry, Points, BufferGeometry,
  BufferAttribute, PointsMaterial, AdditiveBlending, Color, HemisphereLight, DirectionalLight, Fog,
} from '@iwsdk/core';
import { makePuzzle, ROPE_RADIUS } from './puzzle.js';
import { LEVELS, dailySpec, KNOTS } from './braid.js';
import { TangleTracker, crossings } from './topology.js';
import { KnotView } from './knotview.js';
import { Pointers, rayToPlane } from './input.js';
import { Panel, UIInput } from './ui.js';
import { Sound } from './audio.js';
import { store, fmt } from './store.js';

const GRAB_RANGE = 0.045;
const SOLVE_HOLD = 0.35;
const _v = new Vector3(), _w = new Vector3();

export class GameSystem extends createSystem({}) {
  init() {
    const world = this.world;
    window.knotwork = this; // handy for tests and the demo recorder
    this.sound = new Sound();
    this.pointers = new Pointers(world);
    this.ui = new UIInput();
    this.stage = new Group(); this.scene.add(this.stage);
    this.buildEnvironment();
    this.anchor = new Vector3(0, 1.18, -0.42);
    this.placed = false;
    this.state = 'menu';
    this.today = Math.floor(Date.now() / 86400000);
    this.daily = dailySpec(new Date());

    // panels
    this.hud = this.ui.add(new Panel(0.34, 0.085));
    this.hud.mesh.position.set(0, 0.235, -0.06); this.stage.add(this.hud.mesh);
    this.bar = this.ui.add(new Panel(0.3, 0.06, { bg: false }));
    this.bar.mesh.position.set(-0.25, -0.17, 0.03); this.bar.mesh.rotation.set(-0.45, 0.5, 0); this.stage.add(this.bar.mesh);
    this.menu = this.ui.add(new Panel(0.42, 0.36));
    this.menu.mesh.position.set(0, -0.075, -0.02); this.stage.add(this.menu.mesh);
    this.result = this.ui.add(new Panel(0.4, 0.22));
    this.result.mesh.position.set(0, 0.26, -0.04); this.stage.add(this.result.mesh);

    // pinch cursors + grab target ring
    this.cursors = new Map();
    this.ring = new Mesh(new TorusGeometry(ROPE_RADIUS * 2.4, 0.0016, 6, 24), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthTest: false }));
    this.ring.renderOrder = 20; this.stage.add(this.ring);
    this.ring2 = this.ring.clone(); this.ring2.material = this.ring.material.clone(); this.stage.add(this.ring2);

    // solve burst
    const N = 420; this.burstVel = new Float32Array(N * 3);
    const bg = new BufferGeometry(); bg.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3));
    this.burst = new Points(bg, new PointsMaterial({ color: 0xffe08a, size: 0.006, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.burst.frustumCulled = false; this.stage.add(this.burst);

    this.showMenu();
    this.startPuzzle({ ...this.daily, daily: true }, { preview: true });

    this.cleanupFuncs.push(world.visibilityState.subscribe(() => {}));
    document.addEventListener('pointerdown', () => this.sound.start(), { once: true });
  }

  buildEnvironment() {
    const scene = this.scene;
    scene.background = new Color(0x05060c);
    scene.fog = new Fog(0x05060c, 4, 14);
    scene.add(new HemisphereLight(0xbfd8ff, 0x201828, 1.4));
    const key = new DirectionalLight(0xffffff, 1.6); key.position.set(0.4, 2.5, 1.2); scene.add(key);
    const rim = new DirectionalLight(0x88aaff, 0.8); rim.position.set(-1, 0.5, -2); scene.add(rim);
    // stars
    const n = 1400, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new Vector3().randomDirection().multiplyScalar(7 + Math.random() * 5); p.set([v.x, Math.abs(v.y) * 0.9 + 0.2, v.z], i * 3); }
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(p, 3));
    scene.add(new Points(g, new PointsMaterial({ color: 0x8fa2ff, size: 0.03, transparent: true, opacity: 0.55, depthWrite: false })));
    // floor halo
    const fg = new BufferGeometry(), fp = [];
    for (let r = 0.5; r < 4.5; r += 0.5) for (let i = 0; i < 128; i++) { const a = (i / 128) * Math.PI * 2; fp.push(r * Math.cos(a), 0, r * Math.sin(a)); }
    fg.setAttribute('position', new BufferAttribute(new Float32Array(fp), 3));
    scene.add(new Points(fg, new PointsMaterial({ color: 0x33507a, size: 0.012, transparent: true, opacity: 0.6 })));
  }

  // ---------- puzzle lifecycle ----------
  startPuzzle(spec, { preview = false } = {}) {
    this.spec = spec;
    const { rope, crossings: c0, frames, target } = makePuzzle(spec, { record: true });
    this.rope = rope; this.c0 = Math.max(1, c0); this.target = target ? target + 1 : 0; this.trueCrossings = target; this.knot = KNOTS[spec.knot || 'unknot']; this.tieFrames = frames; this.finalP = rope.p.slice();
    if (this.view) this.view.dispose();
    this.view = new KnotView(this.stage, rope.n, rope.r);
    this.view.mesh.position.set(0, 0, 0);
    this.held = new Float32Array(rope.n);
    this.tracker = new TangleTracker();
    this.tieT = 0; this.tieSteps = 0; this.elapsed = 0; this.started = false; this.solveHold = 0; this.solvedT = 0;
    this.bestSeen = Infinity; this.preview = preview;
    for (const id of [...rope.grabs.keys()]) rope.release(id);
    this.burst.material.opacity = 0;
    this.state = preview ? 'menu' : 'tying';
    if (!preview) { this.menu.mesh.visible = false; this.result.mesh.visible = false; this.showHud(); this.showBar(); }
  }

  finishTying() {
    const rope = this.rope;
    rope.pressure = 0.02; rope.noise = 0; rope.prev.set(rope.p);
    this.state = this.preview ? 'menu' : 'play';
    this.showHud();
  }

  solve() {
    this.state = 'solved'; this.solvedT = 0;
    for (const id of [...this.rope.grabs.keys()]) this.rope.release(id);
    // morph target: a circle in the zero-crossing plane, nodes in order
    const rope = this.rope, n = rope.n, c = rope.centroid();
    const d = new Vector3(...this.tracker.bestDir).normalize();
    const e1 = new Vector3(1, 0, 0); if (Math.abs(d.x) > 0.9) e1.set(0, 1, 0);
    e1.sub(d.clone().multiplyScalar(e1.dot(d))).normalize(); const e2 = d.clone().cross(e1);
    let area = 0; const uv = [];
    for (let i = 0; i < n; i++) { _v.fromArray(rope.p, i * 3).sub(_w.set(...c)); uv.push([_v.dot(e1), _v.dot(e2)]); }
    for (let i = 0; i < n; i++) { const a = uv[i], b = uv[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const dirSign = area >= 0 ? 1 : -1, th0 = Math.atan2(uv[0][1], uv[0][0]);
    const R = (rope.rest * n) / (Math.PI * 2);
    this.from = rope.p.slice(); this.to = new Float32Array(n * 3);
    this.morph = this.target === 0;
    for (let i = 0; i < n; i++) {
      const th = th0 + dirSign * (i / n) * Math.PI * 2;
      _v.set(...c).addScaledVector(e1, R * Math.cos(th)).addScaledVector(e2, R * Math.sin(th));
      this.to.set([_v.x, _v.y, _v.z], i * 3);
    }
    const pos = this.burst.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const th = (i / pos.count) * Math.PI * 2;
      _v.set(...c).addScaledVector(e1, R * Math.cos(th)).addScaledVector(e2, R * Math.sin(th));
      pos.setXYZ(i, _v.x, _v.y, _v.z);
      _w.copy(_v).sub(new Vector3(...c)).normalize().multiplyScalar(0.12 + Math.random() * 0.25).addScaledVector(d, (Math.random() - 0.5) * 0.15);
      this.burstVel.set([_w.x, _w.y, _w.z], i * 3);
    }
    pos.needsUpdate = true;
    this.sound.solved(); this.sound.tension(0);
    const t = this.elapsed;
    let line2 = '';
    if (this.spec.daily) { const s = store.solveDaily(this.today, t); line2 = `Streak: ${s} day${s === 1 ? '' : 's'} · come back tomorrow for a new knot`; }
    else { store.solveLevel(this.spec.index, t); line2 = `Best: ${fmt(store.levelBest(this.spec.index))}`; }
    this.lastResult = { t, line2 };
    setTimeout(() => this.showResult(), 1300);
  }

  // ---------- UI content ----------
  showHud() {
    const s = this.spec, st = this.state;
    const left = Number.isFinite(this.bestSeen) ? this.bestSeen : this.c0;
    const prog = this.c0 > this.target ? 1 - (Math.min(left, this.c0) - this.target) / (this.c0 - this.target) : 0;
    this.hud.mesh.visible = !this.preview && st !== 'menu';
    this.hud.setContent((ctx, W, H) => {
      ctx.fillStyle = '#8fe3ff'; ctx.font = '700 28px system-ui, Arial';
      ctx.fillText(s.daily ? `DAILY KNOT #${s.number}` : `LEVEL ${s.index + 1} · ${s.name.toUpperCase()}`, 34, 52);
      ctx.fillStyle = '#fff'; ctx.font = '700 46px system-ui, Arial'; ctx.textAlign = 'right';
      ctx.fillText(fmt(this.elapsed), W - 34, 62); ctx.textAlign = 'left';
      ctx.font = '500 24px system-ui, Arial'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      const msg = st === 'tying' ? 'Tying your knot…' : st === 'solved' ? 'Free!' : !this.started ? (s.index === 0 && !s.daily ? 'Pinch the rope and pull it loose' : 'Pinch and pull. Strands are solid.') : this.target ? `Crossings: ${left} · a real knot hides inside` : `Crossings left: ${left}`;
      ctx.fillText(msg, 34, 100);
      // progress bar
      const bx = 34, by = 106, bw = W - 68, bh = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, H - 18, bw, 6);
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#ff3aa0'); g.addColorStop(1, '#2fd8ff');
      ctx.fillStyle = g; ctx.fillRect(bx, H - 18, bw * (st === 'solved' ? 1 : prog), 6);
    });
  }
  showBar() {
    this.bar.mesh.visible = true;
    this.bar.setContent(null, [
      { x: 0.0, y: 0.005, w: 0.09, h: 0.05, label: 'Menu', onPress: () => this.toMenu() },
      { x: 0.1, y: 0.005, w: 0.09, h: 0.05, label: 'Retie', onPress: () => this.startPuzzle({ ...this.spec }) },
      { x: 0.2, y: 0.005, w: 0.09, h: 0.05, label: 'Center', onPress: () => this.recenter() },
    ]);
  }
  toMenu() {
    this.result.mesh.visible = false; this.hud.mesh.visible = false; this.bar.mesh.visible = false;
    this.showMenu(); this.startPuzzle({ ...this.daily, daily: true }, { preview: true });
  }
  showMenu(page = 'main') {
    this.menu.mesh.visible = true; this.page = page;
    const d = this.daily, done = store.dailyDone(this.today), streak = store.streak(this.today);
    if (page === 'main') {
      this.menu.setContent((ctx, W) => {
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '800 76px system-ui, Arial'; ctx.fillText('KNOTWORK', W / 2, 110);
        ctx.font = '500 26px system-ui, Arial'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('Real rope. Real knots. No passing through.', W / 2, 170);
        ctx.font = '500 24px system-ui, Arial'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText('Poke a button, or pinch it', W / 2, 470);
        ctx.textAlign = 'left';
      }, [
        { x: 0.04, y: 0.15, w: 0.34, h: 0.07, label: `Daily Knot #${d.number}`, sub: done ? `Solved in ${fmt(store.data.daily.best[this.today])} · streak ${streak}` : streak ? `Streak ${streak} · keep it going` : 'A new knot every day', accent: '#ffd36b', onPress: () => this.startPuzzle({ ...d, daily: true }) },
        { x: 0.04, y: 0.235, w: 0.16, h: 0.06, label: 'Levels', onPress: () => this.showMenu('levels') },
        { x: 0.22, y: 0.235, w: 0.16, h: 0.06, label: 'How to play', onPress: () => this.showMenu('help') },
      ]);
    } else if (page === 'levels') {
      const btns = LEVELS.map((L, i) => {
        const col = i % 2, row = Math.floor(i / 2), best = store.levelBest(i), open = store.unlocked(i);
        return { x: 0.04 + col * 0.175, y: 0.065 + row * 0.048, w: 0.165, h: 0.042, label: `${i + 1}. ${L.name}`, sub: best != null ? `best ${fmt(best)}` : open ? 'new' : 'locked', disabled: !open, onPress: () => this.startPuzzle({ ...L, index: i, seed: 1000 + i * 17 }) };
      });
      btns.push({ x: 0.04, y: 0.315, w: 0.1, h: 0.033, label: 'Back', onPress: () => this.showMenu('main') });
      this.menu.setContent((ctx, W) => { ctx.fillStyle = '#8fe3ff'; ctx.font = '700 36px system-ui, Arial'; ctx.fillText('LEVELS', 56, 70); }, btns);
    } else {
      this.menu.setContent((ctx, W) => {
        ctx.fillStyle = '#8fe3ff'; ctx.font = '700 36px system-ui, Arial'; ctx.fillText('HOW TO PLAY', 56, 70);
        ctx.fillStyle = '#fff'; ctx.font = '500 25px system-ui, Arial';
        ['Pinch the rope with thumb and index finger,', 'then pull, lift and slide strands around each other.', 'Strands are solid: they can’t pass through.', '', 'Some tangles are secretly a plain loop: free them', 'until, from some angle, no strand crosses another.', '', 'Others hide a real knot. Those can only be simplified.', 'Get it to its fewest crossings and we’ll name it.'].forEach((l, i) => ctx.fillText(l, 56, 130 + i * 40));
      }, [{ x: 0.04, y: 0.31, w: 0.1, h: 0.035, label: 'Back', onPress: () => this.showMenu('main') }]);
    }
  }
  showResult() {
    if (this.state !== 'solved') return;
    const r = this.lastResult, s = this.spec;
    this.hud.mesh.visible = false; this.result.mesh.visible = true;
    const next = !s.daily && s.index + 1 < LEVELS.length ? s.index + 1 : null;
    this.result.setContent((ctx, W) => {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 32px system-ui, Arial'; ctx.fillText(s.daily ? `DAILY KNOT #${s.number}` : s.name.toUpperCase(), W / 2, 56);
      const K = this.knot;
      ctx.fillStyle = '#fff'; ctx.font = '800 66px system-ui, Arial';
      ctx.fillText(K.crossings ? `It's a ${K.name} (${K.symbol})` : `Free in ${fmt(r.t)}`, W / 2, 130);
      if (K.crossings) { ctx.font = '600 28px system-ui, Arial'; ctx.fillStyle = '#9fe8ff'; ctx.fillText(`Found in ${fmt(r.t)}. No amount of pulling gets it below ${K.crossings} crossings.`, W / 2, 172); }
      ctx.font = '500 24px system-ui, Arial'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(r.line2, W / 2, this.knot.crossings ? 208 : 180);
      ctx.textAlign = 'left';
    }, [
      ...(next != null ? [{ x: 0.045, y: 0.165, w: 0.145, h: 0.045, label: 'Next level', accent: '#ffd36b', onPress: () => this.startPuzzle({ ...LEVELS[next], index: next, seed: 1000 + next * 17 }) }] : []),
      { x: next != null ? 0.21 : 0.1275, y: 0.165, w: 0.145, h: 0.045, label: 'Menu', onPress: () => this.toMenu() },
    ]);
  }

  recenter() { this.placed = false; }

  place() {
    const cam = this.world.camera;
    cam.getWorldPosition(_v);
    const fwd = cam.getWorldDirection(_w).setY(0); if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    if (this.pointers.xr) {
      this.anchor.copy(_v).addScaledVector(fwd, 0.42); this.anchor.y = _v.y - 0.13;
      this.stage.position.copy(this.anchor);
      this.stage.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
      this.placed = true;
    } else {
      this.stage.position.copy(this.anchor); this.stage.rotation.set(0, 0, 0); this.placed = true;
      this.orbit = this.orbit || { yaw: 0, pitch: 0.12, dist: 0.62 };
    }
  }

  // ---------- frame ----------
  update(dt) {
    dt = Math.min(dt, 1 / 30);
    const xrNow = !!this.world.session;
    if (xrNow !== this.wasXR) { this.wasXR = xrNow; this.placed = false; if (xrNow) this.sound.start(); }
    if (!this.placed) this.place();
    this.pointers.update(this.xrFrame);
    if (!this.pointers.xr) this.updateDesktopCamera();
    this.ui.update(dt, this.pointers, () => this.sound.click());

    const rope = this.rope;
    if (this.state === 'tying' || (this.state === 'menu' && this.tieFrames)) {
      // replay the recorded tying simulation (it really happened, collisions and all)
      this.tieT += dt;
      const f = this.tieFrames, k = Math.min(f.length - 1, this.tieT * 30);
      const a = f[Math.floor(k)], b = f[Math.min(f.length - 1, Math.floor(k) + 1)], u = k - Math.floor(k);
      for (let i = 0; i < rope.p.length; i++) rope.p[i] = a[i] + (b[i] - a[i]) * u;
      if (k >= f.length - 1) { rope.p.set(this.finalP); this.tieFrames = null; this.finishTying(); }
    } else if (this.state === 'play') {
      this.handleGrabs();
      rope.step(dt);
      if (this.started) this.elapsed += dt;
      const { best } = this.tracker.update(rope.p, rope.n, 2);
      if (best < this.bestSeen) { if (Number.isFinite(this.bestSeen) && this.started) this.sound.progress(true); this.bestSeen = best; }
      else if (best > this.bestSeen + 2) this.bestSeen = best; // got more tangled
      if (best <= this.target && crossings(rope.p, rope.n, this.tracker.bestDir, this.target + 1) <= this.target) this.solveHold += dt; else this.solveHold = 0;
      if (this.solveHold > SOLVE_HOLD && this.started) this.solve();
      // tension feedback
      let maxS = 0; for (let i = 0; i < rope.n; i++) maxS = Math.max(maxS, rope.dist(i, (i + 1) % rope.n) / rope.rest - 1);
      this.tensionK = Math.min(1, maxS / 0.06);
      this.sound.tension(rope.grabs.size ? this.tensionK : 0);
      this.hudTimer = (this.hudTimer || 0) + dt; if (this.hudTimer > 0.25) { this.hudTimer = 0; this.showHud(); }
    } else if (this.state === 'menu') {
      // preview knot gently turns
      const a = dt * 0.35, c = Math.cos(a), s = Math.sin(a);
      for (let i = 0; i < rope.n; i++) { const x = rope.p[i * 3], z = rope.p[i * 3 + 2]; rope.p[i * 3] = x * c - z * s; rope.p[i * 3 + 2] = x * s + z * c; }
    } else if (this.state === 'solved') {
      this.solvedT += dt;
      if (this.morph) {
        const k = Math.min(1, this.solvedT / 1.1), e = k * k * (3 - 2 * k);
        for (let i = 0; i < rope.p.length; i++) rope.p[i] = this.from[i] + (this.to[i] - this.from[i]) * e;
      } else { rope.pressure = 0.35; rope.step(dt); } // a real knot: let it relax into its true shape
      const pos = this.burst.geometry.attributes.position, bt = this.solvedT;
      if (bt < 2.2) { for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + this.burstVel[i * 3] * dt, pos.getY(i) + this.burstVel[i * 3 + 1] * dt, pos.getZ(i) + this.burstVel[i * 3 + 2] * dt); pos.needsUpdate = true; }
      this.burst.material.opacity = Math.max(0, 1 - bt / 2.0);
    }
    // visuals
    for (let i = 0; i < rope.n; i++) this.held[i] *= 0.85;
    for (const g of rope.grabs.values()) for (let k = -4; k <= 4; k++) this.held[(g.i + k + rope.n) % rope.n] = Math.max(this.held[(g.i + k + rope.n) % rope.n], Math.exp(-k * k / 6));
    const left = Number.isFinite(this.bestSeen) ? this.bestSeen : this.c0;
    const tangle = this.state === 'solved' ? 0 : this.state === 'play' ? Math.min(1, Math.max(0, left - this.target) / Math.max(1, this.c0 - this.target)) : 1;
    this.t = (this.t || 0) + dt;
    this.view.update(rope.p, { tangle, contact: rope.contact, held: this.held, solvedK: this.state === 'solved' ? Math.min(1, this.solvedT * 1.5) * 0.6 : 0, pulse: this.t });
    this.view.visible = !(this.state === 'menu' && this.page !== 'main');
    const showMenuKnot = this.state === 'menu';
    if (showMenuKnot) { this.view.mesh.position.set(0, 0.2, -0.12); this.view.glow.position.copy(this.view.mesh.position); }
    else { this.view.mesh.position.set(0, 0, 0); this.view.glow.position.set(0, 0, 0); }
  }

  handleGrabs() {
    const rope = this.rope, ptrs = this.pointers;
    const items = ptrs.xr ? ptrs.hands() : [];
    let ringI = [-1, -1], ri = 0;
    for (const p of items) {
      const local = this.stage.worldToLocal(_v.copy(p.pos)).toArray();
      const cur = this.cursor(p.id); cur.visible = true; cur.position.fromArray(local);
      const g = rope.grabs.get(p.id);
      if (g) {
        rope.moveGrab(p.id, local); cur.material.color.set(0xffffff);
        // the rope can't stretch: if the hand gets far ahead of a taut strand, it slips out
        const o = g.i * 3, gap = Math.hypot(rope.p[o] - local[0], rope.p[o + 1] - local[1], rope.p[o + 2] - local[2]);
        if (gap > 0.09) { rope.release(p.id); this.sound.release(); continue; }
      }
      else {
        const i = rope.nearest(local, GRAB_RANGE);
        cur.material.color.set(i >= 0 ? 0x9fe8ff : 0x506070);
        if (i >= 0 && ri < 2) ringI[ri++] = i;
        if (p.pressed && i >= 0 && !this.uiNear(p)) this.grabNode(p.id, i, local);
      }
      if (p.released && g) { rope.release(p.id); this.sound.release(); }
    }
    for (const [id, c] of this.cursors) if (!items.find(p => p.id === id)) c.visible = false;
    // mouse (browser preview)
    if (!ptrs.xr) {
      const m = ptrs.mouse;
      if (m.pressedNow && !m.consumed && m.button === 0) {
        // nearest node to the mouse ray
        const ray = ptrs.ray.ray; let best = -1, bd = 0.02 * 0.02;
        for (let i = 0; i < rope.n; i++) {
          _v.fromArray(rope.p, i * 3); this.stage.localToWorld(_v);
          const d = ray.distanceSqToPoint(_v); if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) { _v.fromArray(rope.p, best * 3); this.grabNode('mouse', best, _v.toArray()); this.mouseDepthPoint = this.stage.localToWorld(_v.clone()); }
      }
      if (rope.grabs.has('mouse')) {
        if (!m.down) { rope.release('mouse'); this.sound.release(); }
        else {
          if (m.wheelNow) this.mouseDepthPoint.addScaledVector(this.world.camera.getWorldDirection(_w), -m.wheelNow * 0.0004);
          const wp = rayToPlane(ptrs.ray, this.world.camera, this.mouseDepthPoint, new Vector3());
          rope.moveGrab('mouse', this.stage.worldToLocal(wp).toArray());
        }
      }
      ptrs.mouse.consumed = false;
    }
    [this.ring, this.ring2].forEach((r, k) => {
      const i = ringI[k]; r.material.opacity = i >= 0 ? 0.8 : 0;
      if (i >= 0) { r.position.fromArray(rope.p, i * 3); r.lookAt(this.stage.worldToLocal(this.world.camera.getWorldPosition(_w))); }
    });
  }
  grabNode(id, i, target) {
    this.rope.grab(id, i, target);
    this.sound.grab(i, this.rope.n);
    if (!this.started) { this.started = true; this.showHud(); }
  }
  uiNear(p) {
    for (const panel of [this.bar]) { if (!panel.mesh.visible) continue; const q = panel.local(p.pos); if (Math.abs(q.z) < 0.05 && panel.hit(q.x, q.y)) return true; }
    return false;
  }
  cursor(id) {
    let c = this.cursors.get(id);
    if (!c) { c = new Mesh(new SphereGeometry(0.0045, 12, 8), new MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, depthTest: false })); c.renderOrder = 21; this.stage.add(c); this.cursors.set(id, c); }
    return c;
  }
  updateDesktopCamera() {
    const o = this.orbit; if (!o) return;
    const m = this.pointers.mouse;
    if (m.down && (m.button === 2 || (m.button === 0 && !this.rope.grabs.has('mouse') && !this.menu.hover))) { o.yaw -= m.dxNow * 0.006; o.pitch = Math.max(-1.2, Math.min(1.2, o.pitch + m.dyNow * 0.006)); }
    if (!this.rope.grabs.has('mouse') && m.wheelNow) o.dist = Math.max(0.3, Math.min(1.4, o.dist * (1 + m.wheelNow * 0.001)));
    const cam = this.world.camera, t = this.anchor;
    cam.position.set(t.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), t.y + o.dist * Math.sin(o.pitch), t.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch));
    cam.lookAt(t);
  }
}
