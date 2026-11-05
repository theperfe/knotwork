// Drives the app inside the IWER Quest 3 emulator with tracked hands.
// usage: node tools/xrtest.cjs <outPrefix> [levelIndex]
const { chromium } = require('playwright');
(async () => {
  const [out = '/tmp/claude-0/xr', lvl = '0'] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || t.startsWith('[test]')) console.log(m.type(), t.slice(0, 300)); });
  // headless Chromium ships a native XRWebGLBinding that rejects IWER's emulated session
  await page.addInitScript(() => { try { delete window.XRWebGLBinding; window.XRWebGLBinding = undefined; } catch (e) {} });
  await page.goto('http://127.0.0.1:5173/?emu');
  await page.waitForFunction(() => window.knotwork && window.IWER_DEVICE, null, { timeout: 30000 });
  await page.evaluate(() => { const d = window.IWER_DEVICE; d.primaryInputMode = 'hand'; d.stereoEnabled = false; d.position.set(0, 1.25, 0); });
  await page.click('#enter');
  await page.waitForFunction(() => !!window.world.session, null, { timeout: 15000 });
  await page.evaluate(() => { const d = window.IWER_DEVICE; d.primaryInputMode = 'hand'; d.position.set(0, 1.25, 0); window.knotwork.recenter(); });
  await page.waitForTimeout(1500);
  console.log('[test] inputs', await page.evaluate(() => JSON.stringify([...window.knotwork.pointers.list.values()].map(p => [p.id, p.kind, p.tracked, p.pos.toArray().map(v => +v.toFixed(3)), p.tip.toArray().map(v => +v.toFixed(3))]))));
  // helper: closed-loop move of a hand so its pinch point lands on a world target
  await page.evaluate(() => {
    const raf = () => new Promise(r => window.world.session.requestAnimationFrame(() => r()));
    window.T = {
      raf,
      async handTo(side, x, y, z, anchor = 'grasp') {
        await window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-' + side, position: { x, y, z }, anchor });
        await raf(); await raf();
      },
      async pinch(side, v) { await window.IWER_DEVICE.remote.dispatch('set_select_value', { device: 'hand-' + side, value: v }); await raf(); await raf(); },
      nodeWorld(i) { const k = window.knotwork, v = new k.stage.position.constructor(k.rope.p[i * 3], k.rope.p[i * 3 + 1], k.rope.p[i * 3 + 2]); return k.stage.localToWorld(v).toArray(); },
      tipOf(side) { const p = window.knotwork.pointers.list.get(side); return p ? { pos: p.pos.toArray(), tip: p.tip.toArray(), down: p.down, strength: p.strength } : null; },
    };
  });
  if (process.env.DBG) { console.log('[test] dbg', JSON.stringify(await page.evaluate(require('fs').readFileSync(process.env.DBG, 'utf8')))); await browser.close(); return; }
  await page.screenshot({ path: out + '-0-menu.png' });
  // poke the "Levels" button with the right index finger, then the level
  const pokeButton = async (label) => page.evaluate(async (label) => {
    const k = window.knotwork, panel = k.menu.mesh.visible ? k.menu : k.result.mesh.visible ? k.result : k.bar;
    const b = panel.buttons.find(b => b.label.includes(label)); if (!b) return 'no button ' + label;
    const lx = b.x + b.w / 2 - panel.w / 2, ly = panel.h / 2 - (b.y + b.h / 2);
    const front = panel.mesh.localToWorld(new k.stage.position.constructor(lx, ly, 0.06));
    const at = panel.mesh.localToWorld(new k.stage.position.constructor(lx, ly, -0.005));
    await window.T.handTo('right', front.x, front.y, front.z, 'index-tip');
    for (let i = 0; i < 4; i++) { const f = i / 3; await window.T.handTo('right', front.x + (at.x - front.x) * f, front.y + (at.y - front.y) * f, front.z + (at.z - front.z) * f, 'index-tip'); }
    const p = k.pointers.list.get('right'); const L = panel.local(p.tip);
    const dbg = JSON.stringify({ L: [L.x, L.y, L.z].map(v => +v.toFixed(3)), btn: [b.x, b.y, b.w, b.h], hover: panel.hover && panel.hover.label, page: k.page });
    await window.T.handTo('right', front.x, front.y, front.z + 0.1, 'index-tip');
    return 'poked ' + label + ' state=' + k.state + ' page=' + k.page + ' ' + dbg;
  }, label);
  await page.evaluate((lvl) => { const st = window.knotwork.store; for (let i = 0; i < lvl; i++) if (st.levelBest(i) == null) st.data.levels[i] = 99; window.knotwork.showMenu('main'); }, +lvl);
  console.log('[test]', await pokeButton('Levels'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '-1-levels.png' });
  const LNAMES = ['Twist', 'Double Twist', 'Figure Loop', 'Hidden Trefoil', 'Snarl', 'Hidden Eight', 'Hydra', 'Five Petals', 'Mystery', 'Gordian'];
  console.log('[test]', await pokeButton(`${+lvl + 1}. ${LNAMES[+lvl]}`));
  await page.waitForFunction(() => window.knotwork.state === 'play', null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '-2-play.png' });
  // grab node 0 with the right hand and pull it out, grab the opposite node with the left
  const r = await page.evaluate(async () => {
    const k = window.knotwork, n = k.rope.n;
    const a = window.T.nodeWorld(0), b = window.T.nodeWorld(Math.floor(n / 2));
    await window.T.handTo('right', ...a); await window.T.handTo('left', ...b);
    await window.T.pinch('right', 1); await window.T.pinch('left', 1);
    for (let i = 0; i < 4; i++) await window.T.raf();
    const grabbed = [...k.rope.grabs.keys()];
    // pull apart
    for (let i = 1; i <= 30; i++) {
      await window.T.handTo('right', a[0] + 0.004 * i, a[1] + 0.002 * i, a[2]); await window.T.handTo('left', b[0] - 0.004 * i, b[1] - 0.001 * i, b[2]);
    }
    return { grabbed, n, tension: k.tensionK, best: k.tracker.best, c0: k.c0, started: k.started };
  });
  console.log('[test] grab', JSON.stringify(r));
  await page.screenshot({ path: out + '-3-pull.png' });
  // fps estimate in emulator
  const fps = await page.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 30; i++) await window.T.raf(); return 30000 / (performance.now() - t0); });
  console.log('[test] emulator fps (swiftshader)', fps.toFixed(1));
  // force-solve check: morph rope into a circle and see if it registers as solved
  const solved = await page.evaluate(async () => {
    const k = window.knotwork; await window.T.pinch('right', 0); await window.T.pinch('left', 0);
    for (let i = 0; i < 3; i++) await window.T.raf();
    if (k.trueCrossings === 0) {
      const n = k.rope.n, R = k.rope.rest * n / (2 * Math.PI);
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; k.rope.p.set([R * Math.cos(a), 0.003 * Math.sin(3 * a), R * Math.sin(a)], i * 3); }
      k.rope.prev.set(k.rope.p);
    } else k.solve(); // a knot can't be faked into a circle: jump straight to the reveal
    for (let i = 0; i < 40 && k.state !== 'solved'; i++) await window.T.raf();
    return k.state;
  });
  console.log('[test] after circle:', solved);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: out + '-4-solved.png' });
  await browser.close();
})();
