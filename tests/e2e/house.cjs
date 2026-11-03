const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || BASE + '/').replace(/\/$/, '');
const SD = require('os').tmpdir();
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  const txt = async (s) => (await page.textContent(s)).replace(/\s+/g, ' ').trim().slice(0, 260);
  await page.goto(BASE + '/?simulate=2026-11-03T20:00:00Z#/2026/forecasting', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card h2');
  console.log('scope text:', await txt('.scope-text'));
  await page.click('[data-action="chamber"][data-val="house"]');
  await page.waitForTimeout(3500);
  await page.click('[data-action="rule-polling"]');
  await page.waitForTimeout(2500);
  console.log('toast:', await txt('#toast'));
  console.log('card:', await txt('#card h2'), '|', await txt('#card .muted'));
  console.log('makeup House:', (await txt('#makeup')).slice(0, 400));
  await page.screenshot({ path: SD + '/shots/h-map.png' });
  // zoom into Texas-ish to see labels
  await page.mouse.move(700, 450); for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(150); }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SD + '/shots/h-zoom.png' });
  // list + search
  await page.click('[data-action="display"][data-val="list"]');
  await page.waitForSelector('#vlist tbody tr');
  const rows0 = await page.locator('#vlist tbody tr').count();
  console.log('list DOM rows at top (virtualized):', rows0, '| header:', await txt('#listslot .muted.small'));
  await page.evaluate(() => { document.getElementById('vlist').scrollTop = 200 * 44; });
  await page.waitForTimeout(400);
  console.log('after scroll first visible row:', await txt('#vlist tbody tr:nth-child(2) th'));
  await page.fill('#listq', 'texas'); await page.waitForTimeout(400);
  console.log('search texas:', await txt('#listslot .muted.small'), '|', await txt('#vlist tbody tr:first-child th'));
  await page.click('#vlist [data-action="focus"]'); await page.waitForTimeout(600);
  console.log('opened:', await txt('#card h2'), '|', await txt('#card .muted'));
  await page.screenshot({ path: SD + '/shots/h-list.png' });
  // endorse mode house
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
