// Screenshots of the lesson flow at iPad size: home with the lesson plan, a lesson tip, a bar
// loop in tempo mode, the "slower / step by step" offer, a bar learned in wait mode, results with
// the bars practised, a failed level check, and a wait-mode bar restart.
//   npx http-server -p 8080 .   (in another terminal)
//   node e2e/lessons.mjs [outDir]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || 'e2e-out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (n) => page.screenshot({ path: path.join(out, `${n}.png`) });
await page.goto(process.env.URL || 'http://localhost:8080/');
await page.waitForTimeout(600);
// A student at level 6, lesson 7 of 15.
await page.evaluate(() => {
  const { coach } = window.__maestro;
  coach.setLevel(6);
  coach.s.micChecked = true;
  coach.setSetting('voice', false);
  coach.markIntroSeen(6);
  for (let i = 0; i < 5; i++) {
    const a = coach.nextActivity();
    coach.record(a, { seed: 50 + i, bpm: 70 }, { score: 90, mode: a.mode, hits: 14, stars: a.mode === 'wait' ? 0 : 2 }, 30);
  }
  window.__maestro.app.show('progress');
  window.__maestro.app.show('home');
});
await page.waitForTimeout(1500);
await shot('L1-home');
// Open the current node's card.
await page.click('#path-nodes .node.current');
await page.waitForTimeout(500);
await shot('L2-home-node');
await page.evaluate(() => window.__maestro.app.show('home'));
// A lesson piece at tempo; the student misses bar 2 at first.
await page.evaluate(() => {
  const { coach } = window.__maestro;
  coach.setSetting('prep', false);
  const a = { ...coach.nextActivity() };
  window.__maestro.run(a.mode === 'tempo' && a.kind === 'sight' ? a : { kind: 'sight', level: 6, mode: 'tempo', tempoFactor: 0, seed: 11, plan: a.plan, lesson: a.lesson, total: a.total, label: 'Play it with the beat', coachLine: 'The same piece again, now with the beat.', tip: 'Keep your fingers curved.' });
});
await page.waitForFunction(() => !!window.__maestro.session(), null, { timeout: 8000 });
await page.waitForTimeout(700);
await shot('L3-lesson-start-tip');
await page.evaluate((missTries) => {
  const { audio } = window.__maestro;
  const s0 = window.__maestro.session();
  const done = new Set();
  window.__skipBar = 2;
  window.__missTries = missTries;
  const tick = () => {
    const s = window.__maestro.session();
    if (!s || s.finished || s !== s0) return;
    for (const n of s.expectedNotes(0.05)) {
      const key = `${n.id}@${s.rewinds}`;
      if (done.has(key)) continue;
      const dt = (n.beat - s.beat) * s.spb;
      if (s.playMode === 'wait' || dt <= 0.01) {
        done.add(key);
        const bar = s.barOf(n.beat);
        const rec = s.loops.get(bar);
        if (bar === window.__skipBar && (!rec || rec.fails < window.__missTries) && s.playMode === 'tempo') continue;
        audio.noteOn(n.midi, audio.now(), 0.7, 'touch');
        setTimeout(() => audio.noteOff(n.midi, audio.now(), 'touch'), 150);
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}, 1);
await page.waitForFunction(() => { const s = window.__maestro.session(); return s && s.lead; }, null, { timeout: 60000 });
await page.waitForTimeout(900);
await shot('L4-bar-loop');
await page.waitForSelector('#results:not(.hidden)', { timeout: 90000 });
await page.waitForTimeout(3500);
await shot('L5-results-loop');
// The offer after three tries.
await page.evaluate(() => {
  const { coach } = window.__maestro;
  window.__maestro.app.stopPlay();
  window.__maestro.run({ kind: 'sight', level: 6, mode: 'tempo', tempoFactor: 0, seed: 12, label: 'Practice piece', free: true });
});
await page.waitForFunction(() => !!window.__maestro.session(), null, { timeout: 8000 });
await page.evaluate(() => {
  const { audio } = window.__maestro;
  const s0 = window.__maestro.session();
  const done = new Set();
  const tick = () => {
    const s = window.__maestro.session();
    if (!s || s.finished || s !== s0) return;
    for (const n of s.expectedNotes(0.05)) {
      const key = `${n.id}@${s.rewinds}`;
      if (done.has(key)) continue;
      if (s.playMode === 'wait' || (n.beat - s.beat) * s.spb <= 0.01) {
        done.add(key);
        if (s.barOf(n.beat) === 2) { audio.noteOn(n.midi + 1, audio.now(), 0.7, 'touch'); setTimeout(() => audio.noteOff(n.midi + 1, audio.now(), 'touch'), 150); continue; }
        audio.noteOn(n.midi, audio.now(), 0.7, 'touch');
        setTimeout(() => audio.noteOff(n.midi, audio.now(), 'touch'), 150);
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
});
await page.waitForFunction(() => { const s = window.__maestro.session(); return s && s.offer; }, null, { timeout: 90000 });
await page.waitForTimeout(700);
await shot('L6-loop-offer');
await page.click('#coach-card [data-loop="learn"]');
await page.waitForTimeout(1200);
await shot('L7-learn-bar');
// Level check result (failed) on the results screen.
await page.evaluate(() => {
  window.__maestro.app.stopPlay();
  const { coach } = window.__maestro;
  while (!coach.nextActivity().check) { const a = coach.nextActivity(); coach.record(a, { seed: 3, bpm: 70 }, { score: 90, mode: a.mode, hits: 14, stars: 1 }, 30); }
  window.__maestro.run(coach.nextActivity());
});
await page.waitForFunction(() => !!window.__maestro.session(), null, { timeout: 8000 });
await page.evaluate(() => {
  const s = window.__maestro.session();
  s.finished = true;
  window.__maestro.app.finishPiece({ ...s.result(), score: 72, stars: 1, hits: 20, total: 26, loops: [{ bar: 3, tries: 2, passed: true }], loopCount: 1 });
});
await page.waitForTimeout(3500);
await shot('L8-results-check');
// Wait mode: three wrong tries at one spot -> the bar starts again, played first.
await page.evaluate(() => {
  window.__maestro.app.stopPlay();
  window.__maestro.run({ kind: 'sight', level: 6, mode: 'wait', tempoFactor: 0, seed: 13, label: 'Learn a new piece (wait mode)', free: true });
});
await page.waitForFunction(() => !!window.__maestro.session(), null, { timeout: 8000 });
await page.evaluate(async () => {
  const { audio } = window.__maestro;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = async (m) => { audio.noteOn(m, audio.now(), 0.7, 'touch'); await sleep(120); audio.noteOff(m, audio.now(), 'touch'); await sleep(350); };
  await sleep(1500);
  for (let k = 0; k < 40; k++) {
    const s = window.__maestro.session();
    const g = s.waitGroup;
    if (!g) break;
    if (s.barOf(g.beat) === 2 && g.beat > s.barStart(2)) { for (let i = 0; i < 3; i++) await press(g.notes[0].midi + 1); break; }
    for (const n of g.notes) await press(n.midi);
  }
});
await page.waitForTimeout(900);
await shot('L9-wait-bar-restart');
await page.waitForFunction(() => { const s = window.__maestro.session(); return s && !s.held; }, null, { timeout: 20000 });
await page.waitForTimeout(600);
await shot('L10-wait-after-demo');
const errors = logs.filter((l) => /error|pageerror/i.test(l));
console.log(errors.join('\n') || 'no console errors');
await browser.close();
