const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || BASE + '/').replace(/\/$/, '');
const SD = require('os').tmpdir();
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  const txt = async (s) => (await page.textContent(s)).replace(/\s+/g, ' ').trim().slice(0, 300);
  await page.goto(BASE + '/?simulate=2026-11-03T20:00:00Z#/2026/forecasting', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card h2');
  const makeupBefore = await txt('#makeup');
  await page.click('[data-action="chamber"][data-val="ballot"]');
  await page.waitForTimeout(1500);
  console.log('ballot card:', await txt('#card .eyebrow'), '|', await txt('#card h2'));
  console.log('yes means:', (await txt('#card article p:nth-of-type(2)')).slice(0, 140));
  console.log('progress:', await txt('#card .muted.small'));
  await page.click('[data-action="b-pick"][data-val="yes"]');
  console.log('after pick:', await txt('#card .muted.small'), '| next:', await txt('#card h2'));
  await page.click('[data-action="b-later"]');
  console.log('after later:', await txt('#card .muted.small'));
  await page.click('[data-action="b-pick"][data-val="no"]');
  console.log('ballot tally:', (await txt('#makeup')).slice(0, 220));
  // chamber totals must be unchanged by ballot picks
  await page.click('[data-action="chamber"][data-val="senate"]');
  const makeupAfter = await txt('#makeup');
  const nums = (t) => (t.match(/Senate\s*\d+\s*D\s*\d+\s*R\s*\d+\s*O|House\s*\d+\s*D\s*\d+\s*R\s*\d+\s*O|Governors\s*\d+\s*D\s*\d+\s*R\s*\d+\s*O/g) || []).join(' | ');
  console.log('chamber totals before:', nums(makeupBefore));
  console.log('chamber totals after :', nums(makeupAfter), '=> unchanged:', nums(makeupBefore) === nums(makeupAfter));
  // ballot list + map
  await page.click('[data-action="chamber"][data-val="ballot"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: SD + '/shots/b-map.png' });
  await page.click('[data-action="display"][data-val="list"]'); await page.waitForTimeout(400);
  console.log('ballot list rows:', await page.locator('#listslot tbody tr').count());
  // scope opt-out
  await page.click('[data-action="clause-add"]'); await page.waitForTimeout(300);
  await page.click('[data-action="clause-ballot"]'); await page.waitForTimeout(500);
  console.log('after ballot opt-out:', await txt('#card h2'));
  await page.click('[data-action="scope-reset"]');
  // endorse mode wording
  await page.goto(BASE + '/?simulate=2026-11-03T20:00:00Z#/2026/endorsing', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card h2');
  await page.click('[data-action="chamber"][data-val="ballot"]'); await page.waitForTimeout(800);
  console.log('endorse ballot ask:', await txt('#card .q'), '|', await txt('#card .cands'));
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
