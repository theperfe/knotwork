// Records demo footage from the Quest 3 emulator, frame by frame on a virtual
// clock (3 physics ticks of 1/72 s per 24 fps video frame = real time).
// Hands are driven through IWER's remote API, so every grab goes through the
// game's real pinch detection. Moves are chosen live; nothing is faked.
// usage: node tools/demo.cjs <outDir> <segment>   segments: intro | twist | trefoil | daily
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const [outDir = '/tmp/claude-0/demo', segment = 'twist'] = process.argv.slice(2);
  const dir = `${outDir}/${segment}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { const t = m.text(); if (t.startsWith('[demo]')) console.log(t); });
  await page.addInitScript(() => { try { delete window.XRWebGLBinding; window.XRWebGLBinding = undefined; } catch (e) {} });
  await page.goto('http://127.0.0.1:5173/?emu');
  await page.waitForFunction(() => window.knotwork && window.IWER_DEVICE, null, { timeout: 30000 });
  await page.addStyleTag({ content: `
    #cap{pointer-events:none;position:fixed;left:0;right:0;bottom:46px;text-align:center;color:#fff;font:600 30px system-ui,Arial;text-shadow:0 2px 16px #000;z-index:2147483646;transition:opacity .3s}
    #cap small{display:block;font-size:19px;font-weight:400;opacity:.75;margin-top:6px}
    #tag{position:fixed;top:18px;left:22px;color:#fff;opacity:.55;font:500 13px system-ui;letter-spacing:2px;text-transform:uppercase;z-index:99}
    #title{pointer-events:none;position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;z-index:2147483647;background:radial-gradient(ellipse at center,rgba(5,6,12,.55),rgba(5,6,12,.95));transition:opacity .4s}
    #title h1{font:800 92px system-ui,Arial;letter-spacing:8px;margin:0}#title p{font:400 26px system-ui;opacity:.8;margin:12px 0 0}#title .s{font:500 15px system-ui;letter-spacing:3px;text-transform:uppercase;opacity:.55;margin-top:26px}` });
  await page.evaluate(() => {
    for (const id of ['cap', 'tag', 'title']) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); }
    document.getElementById('tag').textContent = 'Recorded in the Meta Quest 3 emulator (IWER) · hand tracking';
    document.getElementById('title').style.opacity = 0;
    const d = window.IWER_DEVICE; d.primaryInputMode = 'hand';
  });
  await page.click('#enter');
  await page.waitForFunction(() => !!window.world.session, null, { timeout: 15000 });
  await page.addStyleTag({ content: '#overlay{display:none!important}' });
  await page.evaluate(async () => {
    const d = window.IWER_DEVICE; d.primaryInputMode = 'hand';
    const raf = () => new Promise(r => window.world.session.requestAnimationFrame(() => r()));
    const clock = window.KNOTWORK_CLOCK = { dt: 1 / 72, pending: false };
    const k = window.knotwork, V = k.stage.position.constructor;
    const dispatch = (m, p) => d.remote.dispatch(m, p);
    await dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { x: -0.1045, y: 0, z: 0, w: 0.9945 } }).catch(() => {});
    console.log('[demo] setup: before head');
    for (let i = 0; i < 3; i++) await raf();
    const hands = { right: [0.26, 0.86, -0.2], left: [-0.26, 0.86, -0.2] };
    const T = window.T = {
      raf, k, V, hands, ticks: 0,
      async tick() { clock.pending = true; await raf(); if (clock.pending) await raf(); this.ticks++; },
      async setHand(side, p, anchor = 'grasp') { hands[side] = p.slice(); await dispatch('set_transform', { device: 'hand-' + side, position: { x: p[0], y: p[1], z: p[2] }, anchor }); },
      async pinch(side, v) { await dispatch('set_select_value', { device: 'hand-' + side, value: v }); },
      world(local) { return k.stage.localToWorld(new V(...local)).toArray(); },
      node(i) { return this.world([k.rope.p[i * 3], k.rope.p[i * 3 + 1], k.rope.p[i * 3 + 2]]); },
      cap(html) { const c = document.getElementById('cap'); c.innerHTML = html || ''; c.style.opacity = html ? 1 : 0; },
      title(html) { const t = document.getElementById('title'); if (html) t.innerHTML = html; t.style.opacity = html ? 1 : 0; },
      // move hands smoothly to targets over n ticks
      async glide(targets, n, anchor) {
        const from = { right: hands.right.slice(), left: hands.left.slice() };
        for (let s = 1; s <= n; s++) {
          const e = s / n, q = e * e * (3 - 2 * e);
          for (const side of Object.keys(targets)) { const a = from[side], b = targets[side]; await this.setHand(side, a.map((v, i) => v + (b[i] - v) * q), anchor && anchor[side]); }
          await this.tick();
        }
      },
      async idle(n) { for (let i = 0; i < n; i++) await this.tick(); },
      async poke(panel, label) {
        const b = panel.buttons.find(b => b.label.includes(label));
        const lx = b.x + b.w / 2 - panel.w / 2, ly = panel.h / 2 - (b.y + b.h / 2);
        const front = panel.mesh.localToWorld(new V(lx, ly, 0.05)).toArray(), at = panel.mesh.localToWorld(new V(lx, ly, -0.004)).toArray();
        await this.glide({ right: front }, 30, { right: 'index-tip' });
        await this.glide({ right: at }, 8, { right: 'index-tip' });
        await this.glide({ right: front }, 8, { right: 'index-tip' });
        await this.glide({ right: [0.26, 0.86, -0.2] }, 24);
      },
      // one two-handed move: reach two rope points, pinch, pull apart, release
      async move(a, b, pull, lift) {
        const n = k.rope.n;
        await this.glide({ right: this.node(a), left: this.node(b) }, 36);
        // home in (the rope drifts a little while the hands travel)
        for (let s = 0; s < 6; s++) { await this.setHand('right', this.node(a)); await this.setHand('left', this.node(b)); await this.tick(); }
        await this.pinch('right', 1); await this.pinch('left', 1); await this.idle(4);
        const pa = this.node(a), pb = this.node(b), c = pa.map((v, i) => (v + pb[i]) / 2);
        const dir = pa.map((v, i) => v - pb[i]), dl = Math.hypot(...dir) || 1; dir.forEach((v, i) => dir[i] = v / dl);
        for (let s = 1; s <= 80; s++) {
          const e = s / 80;
          await this.setHand('right', c.map((v, i) => v + dir[i] * (dl / 2 + pull * e) + (i === 1 ? lift * Math.sin(e * Math.PI) : 0)));
          await this.setHand('left', c.map((v, i) => v - dir[i] * (dl / 2 + pull * e) - (i === 1 ? lift * Math.sin(e * Math.PI) : 0)));
          await this.tick();
        }
        await this.pinch('right', 0); await this.pinch('left', 0);
        await this.glide({ right: [hands.right[0] + 0.04, hands.right[1] - 0.06, hands.right[2] + 0.08], left: [hands.left[0] - 0.04, hands.left[1] - 0.06, hands.left[2] + 0.08] }, 30);
        await this.idle(30);
      },
      async solveByMoves(maxMoves, seed) {
        let r = seed;
        const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
        for (let m = 0; m < maxMoves && k.state === 'play'; m++) {
          const n = k.rope.n, a = Math.floor(rnd() * n), b = (a + Math.floor(n * (0.3 + rnd() * 0.4))) % n;
          // right hand takes whichever point is further right, as a person would
          const ra = this.node(a), rb = this.node(b);
          const [A, B] = ra[0] >= rb[0] ? [a, b] : [b, a];
          await this.move(A, B, 0.04 + rnd() * 0.09, (rnd() - 0.5) * 0.1);
          console.log('[demo] move', m, 'state', k.state, 'best', k.tracker.best, 'target', k.target);
        }
        for (let i = 0; i < 90 && k.state === 'play'; i++) await this.tick();
        return k.state;
      },
    };
    console.log('[demo] setup: head set'); for (let i = 0; i < 3; i++) await T.tick(); k.recenter(); await T.tick(); await T.tick(); await T.setHand('right', hands.right); await T.setHand('left', hands.left); await T.tick();
  });

  // frame pump: the script runs in the page; we screenshot every 3 ticks
  let frame = 0, lastTick = 0;
  const shoot = async () => { await page.screenshot({ path: `${dir}/f${String(frame++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 90 }); };
  const run = async (fnSrc) => {
    await page.evaluate(`window.__job = (async () => { ${fnSrc} })(); window.__done = false; window.__job.then(r => { window.__done = true; window.__res = r; }, e => { window.__done = true; window.__res = 'ERR ' + e.message; });`);
    // pause the job between video frames: hook tick to wait for the recorder
    while (!(await page.evaluate('window.__done'))) {
      const t = await page.evaluate('window.T.ticks');
      if (t - lastTick >= 3) { lastTick = t; await shoot(); }
      else await page.waitForTimeout(5);
    }
    return page.evaluate('window.__res');
  };
  // make tick() wait for the recorder whenever a frame is due
  await page.evaluate(() => {
    const T = window.T, orig = T.tick.bind(T);
    window.__gate = 0;
    T.tick = async function () { await orig(); if (this.ticks % 3 === 0) { window.__want = this.ticks; while (window.__shot !== this.ticks) await new Promise(r => setTimeout(r, 2)); } };
  });
  const shootGate = async () => { const w = await page.evaluate('window.__want'); await shoot(); await page.evaluate(`window.__shot = ${w}`); };
  const runGated = async (src) => {
    await page.evaluate(`window.__done = false; (async () => { ${src} })().then(r => { window.__done = true; window.__res = r; }, e => { window.__done = true; window.__res = 'ERR ' + e.message + e.stack; }); 0;`);
    let last = 0, polls = 0;
    while (true) {
      const [done, want, ticks, res] = await page.evaluate('[window.__done, window.__want, window.T.ticks, window.__res]');
      if (++polls % 500 === 0) console.log('[demo] poll', done, want, ticks, res);
      if (want && want !== last) { last = want; await shootGate(); }
      else if (done) break;
      else await page.waitForTimeout(3);
    }
    return page.evaluate('window.__res');
  };

  console.log('[demo] setup done');
  const scripts = {
    intro: `const T = window.T, k = T.k;
      T.title('<h1>KNOTWORK</h1><p>Untangle real rope with your bare hands</p><div class="s">Hands-only · WebXR on Meta Quest</div>');
      await T.idle(150); T.title(''); await T.idle(12);
      T.cap('Every tangle is real rope<small>Strands are solid: they can’t pass through each other</small>');
      await T.idle(110);
      T.cap('Poke a button, or pinch it<small>Fully usable with hands, end to end</small>');
      await T.poke(k.menu, 'Levels'); await T.idle(20);
      await T.poke(k.menu, '1. Twist'); return k.state;`,
    twist: `const T = window.T, k = T.k;
      if (k.state !== 'tying' && k.state !== 'play') k.startPuzzle({ name: 'Twist', strands: 2, conj: 0, index: 0, seed: 1000 });
      T.cap('Each puzzle is tied by the physics itself<small>A braid that is secretly a plain loop</small>');
      await T.idle(84);
      T.cap('Pinch two points and pull<small>Orange glow shows strands pressing on each other</small>');
      const r = await T.solveByMoves(10, 7);
      T.cap(''); await T.idle(130); return r;`,
    trefoil: `const T = window.T, k = T.k;
      k.startPuzzle({ name: 'Hidden Trefoil', strands: 3, conj: 2, knot: 'trefoil', index: 3, seed: 1051 });
      T.cap('Some tangles hide a real knot<small>No amount of pulling can undo it, only simplify it</small>');
      await T.idle(84);
      T.cap('Simplify it to its fewest crossings…');
      const r = await T.solveByMoves(14, 3);
      T.cap('…and Knotwork names the knot you found'); await T.idle(150); T.cap(''); return r;`,
    daily: `const T = window.T, k = T.k;
      k.toMenu(); await T.idle(30);
      T.cap('A new knot every day<small>Keep your streak going</small>'); await T.idle(120);
      T.title('<h1>KNOTWORK</h1><p>Real rope. Real knots. No passing through.</p><div class="s">Seated · hands-only · 5 minutes a day</div>');
      await T.idle(130); return 'ok';`,
  };
  for (const seg of segment.split(',')) {
    console.log('[demo] segment', seg);
    const res = await runGated(scripts[seg]);
    console.log('[demo] result', seg, res, 'frames', frame);
  }
  await browser.close();
})();
