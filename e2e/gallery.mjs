// Renders exercises from across the curriculum (for eyeballing the notation).
//   node e2e/gallery.mjs [outDir]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const out = process.argv[2] || 'e2e-out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(process.env.URL || 'http://localhost:8080/');
const cases = [
  [1, 'sight'], [6, 'sight'], [10, 'sight'], [14, 'sight'], [17, 'sight'], [19, 'sight'], [20, 'sight'],
  [22, 'sight'], [23, 'sight'], [26, 'sight'], [27, 'sight'], [33, 'sight'], [37, 'sight'], [40, 'sight'],
  [12, 'rhythm'], [16, 'scale'], [25, 'arpeggio'], [14, 'chords'], [9, 'notes'],
];
for (const [level, kind] of cases) {
  await page.evaluate(([level, kind]) => window.__maestro.run({ kind, level, mode: 'tempo', tempoFactor: 0.5, free: true, seed: 7, label: `L${level} ${kind}` }), [level, kind]);
  // skip the "get ready" step (levels 1-16), then jump the clock forward a little into the piece
  if (await page.isVisible('#btn-prep-go')) await page.click('#btn-prep-go');
  await page.waitForFunction(() => !!window.__maestro.session(), null, { timeout: 8000 });
  await page.evaluate(() => {
    const s = window.__maestro.session();
    s.startT -= (s.countIn + 1.5) * s.spb;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `L${String(level).padStart(2, '0')}-${kind}.png`) });
}
await browser.close();
