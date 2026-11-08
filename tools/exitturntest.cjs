// Checks the in-VR "Exit VR" button and pinch-drag turning of the knot.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.text().startsWith('[test]')) console.log(m.text()); });
  await page.addInitScript(() => { try { delete window.XRWebGLBinding; window.XRWebGLBinding = undefined; } catch (e) {} });
  await page.goto('http://127.0.0.1:5173/?emu');
  await page.waitForFunction(() => window.knotwork && window.IWER_DEVICE, null, { timeout: 30000 });
  await page.evaluate(() => { const d = window.IWER_DEVICE; d.primaryInputMode = 'hand'; d.position.set(0, 1.25, 0); });
  await page.click('#enter', { force: true });
  await page.waitForFunction(() => !!window.world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(async () => {
    const k = window.knotwork, d = window.IWER_DEVICE;
    const raf = () => new Promise(r => window.world.session.requestAnimationFrame(() => r()));
    const wait = async n => { for (let i = 0; i < n; i++) await raf(); };
    // put the pinch point of the right hand at a world point (closed loop on the measured pinch point)
    const handTo = async (x, y, z) => {
      let tx = x, ty = y, tz = z;
      for (let it = 0; it < 10; it++) {
        await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: tx, y: ty, z: tz }, anchor: 'grasp' }); await wait(2);
        const p = k.pointers.list.get('right').pos; tx += x - p.x; ty += y - p.y; tz += z - p.z;
      }
    };
    const pinch = async v => { await d.remote.dispatch('set_select_value', { device: 'hand-right', value: v }); await wait(3); };
    const out = {};
    // --- turning: start a level, then pinch empty space beside the knot and drag
    k.startPuzzle({ strands: 3, conj: 1, name: 'T', index: 2, seed: 1034 });
    for (let i = 0; i < 400 && k.state !== 'play'; i++) await raf();
    await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: -0.6, y: 0.8, z: 0.3 }, anchor: 'grasp' });
    const c0 = k.rope.centroid(), a0 = Array.from(k.rope.p.slice(0, 3));
    const sp = k.stage.localToWorld(new k.stage.position.constructor(0.17, 0, 0.05));
    await handTo(sp.x, sp.y, sp.z); await pinch(1);
    out.turningStarted = !!k.turning;
    for (let s = 1; s <= 10; s++) { const q = k.stage.localToWorld(new k.stage.position.constructor(0.17 + s * 0.012, 0, 0.05)); await handTo(q.x, q.y, q.z); }
    await pinch(0);
    const a1 = Array.from(k.rope.p.slice(0, 3));
    out.nodeMoved = +Math.hypot(a1[0] - a0[0], a1[2] - a0[2]).toFixed(3);
    out.grabbedDuringTurn = k.rope.grabs.size;
    out.turningAfter = !!k.turning;
    // --- exit VR from the main menu
    k.toMenu(); await wait(40);
    const b = k.menu.buttons.find(b => b.label === 'Exit VR');
    out.exitButton = !!b;
    b.onPress(); await new Promise(r => setTimeout(r, 800));
    out.sessionAfterExit = !!window.world.session;
    return out;
  });
  console.log('[test]', JSON.stringify(r));
  await browser.close();
})();
