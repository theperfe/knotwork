// usage: node tools/shot.cjs out.png [waitMs] [jsToEval]
const { chromium } = require('playwright');
(async () => {
  const [out = 'shot.png', wait = '3000', js] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() !== 'debug') console.log('console.' + m.type() + ':', m.text().slice(0, 300)); });
  page.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
  await page.goto(process.env.URL || 'http://127.0.0.1:5173/');
  await page.waitForTimeout(+wait);
  if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await page.waitForTimeout(+(process.env.AFTER || 1500)); }
  await page.screenshot({ path: out });
  await browser.close();
})();
