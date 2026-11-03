export const UA =
  'ElectiaPlatform/0.1 (educational election forecasting site; https://github.com/JustShipItToday/election-platform)';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function getText(url: string, opts: { tries?: number; accept?: string } = {}): Promise<string> {
  const tries = opts.tries ?? 7;
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: opts.accept ?? 'application/json' } });
      if (res.ok) return await res.text();
      lastErr = `HTTP ${res.status}`;
      if (res.status === 404 || res.status === 403) break;
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Math.max(2000, (Number.isFinite(ra) ? ra : 0) * 1000) * (i + 1));
    } catch (e) {
      lastErr = String(e);
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr}`);
}

export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
}

export async function getBuffer(url: string, tries = 5): Promise<Buffer> {
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastErr = `HTTP ${res.status}`;
      if (res.status === 404 || res.status === 403) break;
    } catch (e) {
      lastErr = String(e);
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`Failed to download ${url}: ${lastErr}`);
}
