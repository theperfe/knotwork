// Enter VR, exit, enter again; report errors, tone mapping and hand state.
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '/tmp/claude-0/re';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  let errs = 0;
  page.on('console', m => { const t = m.text(); if (m.type() === 'error') { if (errs++ < 5) console.log('console.error', t.slice(0, 300)); } else if (t.startsWith('[test]')) console.log(t); });
  await page.addInitScript(() => { try { delete window.XRWebGLBinding; window.XRWebGLBinding = undefined; } catch (e) {} });
  await page.goto('http://127.0.0.1:5173/?emu');
  await page.waitForFunction(() => window.knotwork && window.IWER_DEVICE, null, { timeout: 30000 });
  console.log('[test] toneMapping', await page.evaluate(() => [window.world.renderer.toneMapping, window.world.renderer.toneMappingExposure]));
  for (let round = 1; round <= 2; round++) {
    await page.evaluate(() => { const d = window.IWER_DEVICE; d.primaryInputMode = 'hand'; d.position.set(0, 1.25, 0); });
    await page.click('#enter', { force: true });
    await page.waitForFunction(() => !!window.world.session, null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    console.log('[test] round', round, await page.evaluate(() => JSON.stringify({ hands: window.knotwork.pointers.hands().map(p => [p.id, p.joints && +p.joints[0].toFixed(3)]), stage: window.knotwork.stage.position.toArray().map(v => +v.toFixed(2)) })));
    await page.screenshot({ path: `${out}-${round}.png` });
    await page.evaluate(() => window.world.session.end());
    await page.waitForFunction(() => !window.world.session, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}-${round}-out.png` });
  }
  console.log('[test] errors', errs);
  await browser.close();
})();
