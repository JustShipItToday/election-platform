const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || BASE + '/').replace(/\/$/, '');
const SD = require('os').tmpdir();
const B = BASE + '/';
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  const txt = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim().slice(0, 220);

  // ---- OPEN phase: tour, endorse, reconcile, freeze, saved ----
  await page.goto(B + '?simulate=2026-11-03T20:00:00Z#/2026/forecasting', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card h2');
  await page.click('[data-action="tour-open"]');
  console.log('tour step1:', await txt('#tour .tourbox h2'));
  await page.click('[data-action="tour-next"]'); await page.click('[data-action="tour-next"]');
  console.log('tour step3:', await txt('#tour .tourbox h2'));
  await page.click('[data-action="tour-skip"]');
  console.log('tour closed:', !(await page.isVisible('#tour')), 'prompt gone:', !(await page.isVisible('.tourprompt')));
  // forecast: call two, then freeze a forecast map
  await page.click('.cands .cand:first-child .pickbtn');
  await page.click('.cands .cand:nth-child(2) .pickbtn');
  await page.click('[data-action="open-freeze"]');
  await page.fill('#fz-name', 'Rehearsal forecast'); await page.fill('#fz-notes', 'two calls');
  await page.click('.freeze button[type=submit]');
  await page.waitForTimeout(500);
  console.log('freeze toast:', await txt('#toast'));
  // endorse: different pick than forecast for race 1
  await page.goto(B + '?simulate=2026-11-03T20:00:00Z#/2026/endorsing', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card h2');
  console.log('endorse question:', await txt('.q'));
  await page.click('.cands .cand:nth-child(2) .pickbtn');
  console.log('endorse progress:', await txt('#card .muted.small'));
  // reconcile
  await page.evaluate(() => (location.hash = '#/2026/reconcile'));
  await page.waitForSelector('.reconcile');
  console.log('reconcile:', await txt('.reconcile .summary'));
  // saved
  await page.evaluate(() => (location.hash = '#/2026/saved'));
  await page.waitForSelector('.maplist');
  console.log('saved list:', await txt('.maplist'));
  await page.screenshot({ path: SD + '/shots/saved.png' });
  await page.click('.maplist a.btn');
  await page.waitForSelector('.detail');
  console.log('saved detail:', await txt('.detail h1'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SD + '/shots/saved-detail.png' });

  // ---- CLOSED phase (same browser profile keeps IndexedDB) ----
  await page.goto(B + '?simulate=2026-11-04T10:30:00Z#/2026/forecasting', { waitUntil: 'networkidle' });
  await page.waitForSelector('.closed');
  console.log('closed page:', await txt('.closed h1'));
  console.log('banner closed:', await txt('#banner'));
  console.log('write controls in DOM:', await page.locator('[data-action="pick"], [data-action="later"]').count());
  await page.screenshot({ path: SD + '/shots/closed.png' });
  await page.goto(B + '?simulate=2026-11-04T10:30:00Z#/2026/saved', { waitUntil: 'networkidle' });
  await page.waitForSelector('.maplist');
  console.log('saved still listed after close:', await txt('.maplist'), '| delete buttons:', await page.locator('[data-action="saved-delete"]').count());
  await page.click('.maplist a.btn'); await page.waitForSelector('.detail');
  console.log('detail opens after close:', await txt('.detail h1'));

  // ---- RESULTS phase ----
  await page.goto(B + '?simulate=2026-11-04T15:00:00Z#/2026/results', { waitUntil: 'networkidle' });
  await page.waitForSelector('.results');
  console.log('results nav present:', await page.locator('a[href="#/2026/results"]').count());
  console.log('results summary:', await txt('.results .summary'));
  await page.screenshot({ path: SD + '/shots/results.png' });
  // pages
  for (const r of ['about', 'blog', 'contact', 'terms']) {
    await page.goto(B + '?simulate=2026-11-03T20:00:00Z#/' + r, { waitUntil: 'networkidle' });
    await page.waitForSelector('.page');
    console.log(r + ':', await txt('.page h1'));
  }
  await page.screenshot({ path: SD + '/shots/terms.png' });
  await page.goto(B + '?simulate=2026-11-03T20:00:00Z#/about', { waitUntil: 'networkidle' });
  await page.screenshot({ path: SD + '/shots/about.png' });
  console.log('errors:', JSON.stringify(errs));
  await browser.close();
})();
