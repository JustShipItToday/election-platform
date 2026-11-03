const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || BASE + '/').replace(/\/$/, '');
const SD = require('os').tmpdir();
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  const T = '?simulate=2026-11-03T20:00:00Z';
  await page.goto(BASE + '' + T + '#/2026/forecasting', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card h2');
  await page.click('[data-action="rule-polling"]'); await page.waitForTimeout(500);
  // endorse: pick the second candidate for the first 6 senate races, first candidate for 6 more
  await page.goto(BASE + '' + T + '#/2026/endorsing', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card h2');
  for (let i = 0; i < 12; i++) { await page.click(`.cands .cand:nth-child(${i % 2 === 0 ? 2 : 1}) .pickbtn`); await page.waitForTimeout(120); }
  await page.evaluate(() => (location.hash = '#/2026/reconcile'));
  await page.waitForSelector('#recmap'); await page.waitForTimeout(2500);
  const txt = async (s) => (await page.textContent(s)).replace(/\s+/g, ' ').trim().slice(0, 240);
  console.log('summary:', await txt('.reconcile .summary'));
  console.log('labels same/diff/forecastOnly/wantOnly:', JSON.stringify(await page.evaluate(() => { const c = {}; document.querySelectorAll('.state-label').forEach((e) => { if (e.style.display !== 'none' && e.textContent) c[e.textContent] = (c[e.textContent] || 0) + 1; }); return c; })));
  await page.screenshot({ path: SD + '/shots/rec.png', fullPage: false });
  await page.click('[data-action="rec-chamber"][data-val="house"]'); await page.waitForTimeout(3000);
  console.log('house view ok, errors:', JSON.stringify(errs));
  await b.close();
})();
