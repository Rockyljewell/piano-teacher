// Screenshots of the key lessons at iPad size: the G major lesson (hand position, the scale up and
// down for each hand, the chords), the demo lighting the fingers, the guided practice that follows
// (get-ready card and the stage with the dashed ring where the thumb tucks under) and the Keys
// section of Practice.
//   npx http-server -p 8080 .   (in another terminal)
//   node e2e/keylesson.mjs [outDir]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || 'e2e-out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (n) => page.screenshot({ path: path.join(out, `${n}.png`) });
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok: ${msg}`);
};
await page.goto(process.env.URL || 'http://localhost:8080/');
await page.waitForTimeout(700);

// A student arriving at level 8 (G position): the key lesson comes right after the level intro.
await page.evaluate(() => {
  const { coach, app } = window.__maestro;
  coach.setLevel(8);
  coach.s.micChecked = true;
  coach.setSetting('voice', false);
  coach.markIntroSeen(8);
  app.show('home');
});
await page.waitForTimeout(800);
const next = await page.evaluate(() => window.__maestro.coach.nextActivity());
ok(next.kind === 'keylesson' && next.key.f === 1, 'the next activity is the G major key lesson');
await page.evaluate(() => window.__maestro.app.runActivity(window.__maestro.coach.nextActivity()));
await page.waitForTimeout(1500);
await shot('key-1-position');
await page.click('[data-tab="scale"]');
await page.waitForTimeout(700);
ok((await page.textContent('#key-seq')).includes('thumb tucks under'), 'right hand going up: the thumb tucks under');
await shot('key-2-scale-right-up');
await page.click('[data-dir="down"]');
await page.waitForTimeout(700);
ok((await page.textContent('#key-seq')).includes('crosses over'), 'right hand coming down: finger 3 crosses over');
await shot('key-3-scale-right-down');
await page.click('[data-hand="L"]');
await page.waitForTimeout(700);
await shot('key-4-scale-left-down');
await page.click('[data-dir="up"]');
await page.click('#btn-key-hear');
await page.waitForTimeout(1700);
ok((await page.$$('.seq-f.on')).length === 1, 'the demo lights one finger at a time');
await shot('key-5-demo-lit');
await page.click('#btn-key-hear');
await page.click('[data-tab="chords"]');
await page.waitForTimeout(700);
ok((await page.$$('.key-chord')).length === 4, 'four chords: I IV V I');
await shot('key-6-chords');

// "Let's practise": the scale with each hand, then the chords.
await page.click('#btn-key-next');
await page.waitForSelector('#prep:not(.hidden)', { timeout: 10000 });
await page.waitForTimeout(400);
ok((await page.textContent('#prep')).includes('dashed ring'), 'the get-ready card says where the thumb moves');
await shot('key-7-prep');
await page.click('#btn-prep-go');
await page.waitForTimeout(5200);
await shot('key-8-stage-ring');
const flow = await page.evaluate(() => window.__maestro.coach.s.keyFlow);
ok(flow && flow.i === 0, 'practice step 1 of 3 is running');

// The Keys section of Practice.
await page.evaluate(() => window.__maestro.app.show('practice'));
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('#screen-practice .scroller').scrollTo(0, 9999));
await page.waitForTimeout(400);
ok((await page.$$('.key-pick')).length === 24, 'the Keys section lists 24 keys');
await shot('key-9-practice-keys');
const errors = logs.filter((l) => /pageerror|\[error\]/.test(l) && !/favicon|getUserMedia|Permission/.test(l));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
if (errors.length) process.exit(1);
