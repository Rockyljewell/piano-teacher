// The get-ready card and the hand guide: the card stays until the student is ready, "Keep hands
// on the keyboard" leaves the starting position on the keys while playing, and Restart and Try
// again go back through the get-ready step.
//   npx http-server -p 8080 .   (in another terminal)
//   node e2e/handguide.mjs [outDir]
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
const inPage = (fn, arg) => page.evaluate(fn, arg);
await page.goto(process.env.URL || 'http://localhost:8080/');
await page.waitForTimeout(700);

// A level 14 lesson piece in G major for both hands, where the hands move later.
await inPage(() => {
  const { coach, app } = window.__maestro;
  coach.setLevel(14);
  coach.s.micChecked = true;
  coach.setSetting('voice', false);
  coach.setSetting('keepGuide', false);
  coach.markIntroSeen(14);
  app.show('home');
  window.__maestro.run({ kind: 'sight', level: 14, mode: 'tempo', tempoFactor: 0, seed: 1, plan: { lesson: 14, total: 15 }, lesson: 14, total: 15, label: 'Play it with the beat', coachLine: 'A fresh piece at tempo.', tip: 'Read ahead and keep the beat.' });
});
await page.waitForSelector('#prep:not(.hidden)', { timeout: 8000 });
const piece = await inPage(() => ({ hands: window.__maestro.piece().prep.hands.length, moves: window.__maestro.piece().prep.outOfPosition }));
ok(piece.hands === 2 && piece.moves, 'the test piece uses both hands and the hands move later');
await shot('hand-1-get-ready');

// The card stays until the student is ready: no countdown, still there well after the old 7 s.
ok(!(await page.$('.prep-ring.on')), 'no auto-start countdown on a lesson');
await page.waitForTimeout(9000);
ok(await inPage(() => !document.querySelector('#prep').classList.contains('hidden') && !window.__maestro.session()), 'the get-ready card is still up after 9 s');

// The guide: the starting position's keys with their own fingers, for as long as a hand stays in it.
const g = await inPage(async () => {
  const m = await import('/js/ui/prep.js');
  const { coach } = window.__maestro;
  const piece = window.__maestro.piece();
  const act = { kind: 'sight', level: 14 };
  const list = (s) => (s ? [...s.keys].map(([k, v]) => `${v.hand}${k}:${v.finger ?? '-'}${v.first ? '*' : ''}`) : null);
  const r = {};
  coach.setSetting('keepGuide', false);
  r.off = m.guideDrawState(piece, act, 1, new Map());
  coach.setSetting('keepGuide', true);
  r.countIn = list(m.guideDrawState(piece, act, -4, new Map()));
  r.start = list(m.guideDrawState(piece, act, 1, new Map([[69, 'R']])));
  r.late = m.guideDrawState(piece, act, 100, new Map());
  coach.setSetting('keepGuide', false);
  return r;
});
ok(g.off === null, 'guide off: nothing kept on the keyboard');
ok(g.countIn.join() === g.start.join().replace(/\*/g, ''), 'the count-in shows the same keys as the start, nothing from later positions');
ok(['L43:5', 'L45:4', 'L47:3', 'L48:2', 'L50:1'].every((k) => g.start.some((s) => s.startsWith(k))), 'left hand fingers 5-4-3-2-1 from its starting position');
ok(['R64:1', 'R66:2', 'R67:3', 'R69:4*', 'R71:5'].every((k) => g.start.includes(k)), 'right hand fingers 1-2-3-4-5, and the key due next pulses');
ok(g.late === null, 'the guide goes once both hands have moved on');

// The toggle on the card.
ok(!!(await page.$('#prep-keep')) && !(await inPage(() => document.querySelector('#prep-keep').checked)), 'the card has the "keep hands on the keyboard" switch, off at first');
await page.click('#prep-keep');
ok(await inPage(() => window.__maestro.coach.settings.keepGuide === true), 'the switch is remembered');
await shot('hand-2-switch-on');

// Start by playing the first note: the count-in and the piece keep the finger numbers on the keys.
await inPage(() => {
  const { audio, app } = window.__maestro;
  const m = app.prepStarts()[0];
  audio.noteOn(m, audio.now(), 0.7, 'touch');
  setTimeout(() => audio.noteOff(m, audio.now(), 'touch'), 150);
});
await page.waitForFunction(() => window.__maestro.session(), null, { timeout: 15000 });
await page.waitForTimeout(700);
ok(await inPage(() => document.querySelector('#prep').classList.contains('hidden')), 'the card makes way for the piece');
await shot('hand-3-playing-with-guide');

// Pause > Restart: back to get ready.
await page.click('#btn-pause');
await page.waitForSelector('#pause-menu:not(.hidden)');
ok(await inPage(() => document.querySelector('[data-opt=keepGuide]').checked), 'the pause menu has the same switch');
await page.click('#btn-restart');
await page.waitForSelector('#prep:not(.hidden)', { timeout: 5000 });
ok(await inPage(() => !window.__maestro.session() && window.__maestro.app.prepStarts().length > 0 && document.querySelector('#pause-menu').classList.contains('hidden')), 'Restart shows the get-ready step again');
ok(await inPage(() => document.querySelector('#prep-keep').checked), 'the switch is still on');
await shot('hand-4-restart');
await page.click('#prep-keep');
await page.click('#btn-prep-go');
await page.waitForFunction(() => window.__maestro.session(), null, { timeout: 15000 });
ok(true, "I'm ready starts the piece again");

// Finish it: Try again on the results goes back to get ready too.
await inPage(() => {
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
        audio.noteOn(n.midi, audio.now(), 0.7, 'touch');
        setTimeout(() => audio.noteOff(n.midi, audio.now(), 'touch'), 150);
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
});
await page.waitForSelector('#results:not(.hidden)', { timeout: 120000 });
await page.waitForTimeout(1500);
await page.click('#btn-retry');
await page.waitForSelector('#prep:not(.hidden)', { timeout: 5000 });
ok(await inPage(() => !window.__maestro.session() && document.querySelector('#results').classList.contains('hidden')), 'Try again shows the get-ready step again');
await shot('hand-5-try-again');

const errs = logs.filter((l) => /^\[(pageerror|error)\]/.test(l));
ok(errs.length === 0, `no console errors${errs.length ? `: ${errs[0]}` : ''}`);
await browser.close();
