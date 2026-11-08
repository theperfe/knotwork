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
    // --- bar buttons: turn, tilt and zoom move the pivot, not the rope
    k.startPuzzle({ strands: 3, conj: 1, name: 'T', index: 2, seed: 1034 });
    for (let i = 0; i < 400 && k.state !== 'play'; i++) await raf();
    const press = label => { const b = k.bar.buttons.find(b => (b.label || b.icon) === label); b.onPress(); return !!b; };
    const p0 = Array.from(k.rope.p.slice(0, 3));
    press('right'); press('down'); press('+'); press('+');
    await wait(60);
    out.rotDeg = +(2 * Math.acos(Math.min(1, Math.abs(k.pivot.quaternion.w))) * 180 / Math.PI).toFixed(1);
    out.scale = +k.pivot.scale.x.toFixed(2);
    out.ropeUnmoved = Math.hypot(...Array.from(k.rope.p.slice(0, 3)).map((v, i) => v - p0[i])) < 0.02;
    out.barLabels = k.bar.buttons.map(b => b.label || b.icon).join(',');
    out.menuHasExit = (k.toMenu(), k.menu.buttons.some(b => b.label === 'Exit VR'));
    k.startPuzzle({ strands: 2, conj: 0, name: 'T', index: 0, seed: 1000 });
    out.scaleKeptRotReset = [+k.pivot.scale.x.toFixed(2), +k.pivot.quaternion.w.toFixed(2)];
    k.bar.buttons.find(b => b.label === 'Exit VR').onPress(); await new Promise(r => setTimeout(r, 800));
    out.sessionAfterExit = !!window.world.session;
    return out;
  });
  console.log('[test]', JSON.stringify(r));
  await browser.close();
})();
