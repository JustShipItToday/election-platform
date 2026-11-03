const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || BASE + '/').replace(/\/$/, '');
const fs = require('fs');
const axeSrc = fs.readFileSync('/home/user/election-platform/node_modules/axe-core/axe.min.js', 'utf8');
const B = 'http://127.0.0.1:4199/';
const routes = ['2026/forecasting', '2026/endorsing', '2026/reconcile', '2026/saved', 'about', 'status', 'blog', 'contact', 'terms'];
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const seen = new Map();
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true });
    const page = await ctx.newPage();
    for (const r of routes) {
      await page.goto(B + '#/' + r, { waitUntil: 'networkidle' });
      await page.waitForTimeout(r.includes('forecasting') || r.includes('endorsing') ? 2500 : 600);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0].target.join(' ').slice(0, 90), summary: (v.nodes[0].failureSummary || '').split('\n').slice(1, 3).join(' ').slice(0, 160) })));
      for (const v of res) { const k = scheme + '|' + v.id; const cur = seen.get(k) || { ...v, routes: [] , n: 0 }; cur.routes.push(r); cur.n = Math.max(cur.n, v.n); seen.set(k, cur); }
    }
    await ctx.close();
  }
  if (!seen.size) console.log('axe: no violations on', routes.length, 'routes x 2 themes');
  for (const [k, v] of seen) console.log(k, v.impact, `(${v.n} nodes)`, v.help, '| routes:', [...new Set(v.routes)].join(','), '| e.g.', v.sample, '|', v.summary);
  await b.close();
})();
