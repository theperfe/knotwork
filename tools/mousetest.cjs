const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.knotwork, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // click the Daily Knot button on the menu
  const btn = await page.evaluate(() => {
    const k = window.knotwork, b = k.menu.buttons[0];
    const v = k.menu.mesh.localToWorld(new k.stage.position.constructor(b.x + b.w / 2 - k.menu.w / 2, k.menu.h / 2 - (b.y + b.h / 2), 0)).project(window.world.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  });
  await page.mouse.move(btn[0], btn[1]); await page.waitForTimeout(300); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => window.knotwork.state === 'play', null, { timeout: 20000 });
  // drag a rope node
  const pt = await page.evaluate(() => {
    const k = window.knotwork, v = k.stage.localToWorld(new k.stage.position.constructor(k.rope.p[0], k.rope.p[1], k.rope.p[2])).project(window.world.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  });
  await page.mouse.move(pt[0], pt[1]); await page.mouse.down();
  for (let i = 0; i < 20; i++) { await page.mouse.move(pt[0] + i * 8, pt[1] - i * 4); await page.waitForTimeout(30); }
  const st = await page.evaluate(() => ({ grabs: [...window.knotwork.rope.grabs.keys()], started: window.knotwork.started, state: window.knotwork.state, spec: window.knotwork.spec.name }));
  await page.screenshot({ path: '/tmp/claude-0/mouse.png' });
  await page.mouse.up();
  console.log(JSON.stringify(st));
  await browser.close();
})();
