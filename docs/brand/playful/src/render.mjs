// Renders docs/brand/playful/*.html to PNG at iPad landscape 1180x820 (deviceScaleFactor 1).
//   NODE_USE_ENV_PROXY=1 node docs/brand/playful/src/render.mjs [names...]
// Google Fonts requests are fulfilled from Node (which trusts the environment's CA bundle) and cached.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..');
const cache = process.env.FONT_CACHE || join(tmpdir(), 'maestro-font-cache');
mkdirSync(cache, { recursive: true });
const only = process.argv.slice(2);
const SKIP = new Set(['index', 'sounds']); // gallery and interactive sound page are not mockups
const pages = readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).filter((n) => !SKIP.has(n));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
  const url = route.request().url();
  const key = join(cache, createHash('sha1').update(url).digest('hex'));
  let body, type;
  if (existsSync(key)) {
    const meta = JSON.parse(readFileSync(key + '.json', 'utf8'));
    body = readFileSync(key); type = meta.type;
  } else {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    body = Buffer.from(await res.arrayBuffer()); type = res.headers.get('content-type') || 'application/octet-stream';
    writeFileSync(key, body); writeFileSync(key + '.json', JSON.stringify({ type }));
  }
  await route.fulfill({ status: 200, body, headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
});
for (const name of pages) {
  if (only.length && !only.includes(name)) continue;
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(dir, name + '.html')).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const tall = await page.evaluate(() => document.body.classList.contains('tall'));
  await page.screenshot({ path: join(dir, name + '.png'), fullPage: tall });
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  console.log('rendered', name + '.png', 'fonts:', [...new Set(loaded)].join(', '));
  await page.close();
}
await browser.close();
