// End-to-end smoke test in headless Chromium at iPad-landscape size. The microphone is faked
// with a synthesized piano recording, so the real capture -> worklet -> transcriber path runs.
//   npx http-server -p 8080 .   (in another terminal)
//   node e2e/smoke.mjs [outDir]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { renderPiano, toWav } from '../tests/synth-piano.js';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const out = process.argv[2] || 'e2e-out';
fs.mkdirSync(out, { recursive: true });
const URL = process.env.URL || 'http://localhost:8080/';

// Fake mic: 4 s of room noise, then middle C struck every second.
const sr = 48000;
const notes = [];
for (let i = 0; i < 12; i++) notes.push({ midi: 60, t: 4 + i, dur: 0.6, vel: 0.6 });
const wav = path.resolve(out, 'fake-mic.wav');
fs.writeFileSync(wav, toWav(renderPiano(notes, { sr, length: 17 }), sr));

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

await page.goto(URL);
await page.waitForTimeout(500);
await shot('01-home');

// Start -> mic setup -> calibration -> waits for middle C (from the fake mic).
await page.click('#btn-start');
await page.waitForSelector('#screen-setup.active');
await page.click('#btn-setup-go');
await page.waitForTimeout(2500);
await shot('02-setup');
const heardC = await page
  .waitForFunction(() => document.querySelector('#step-c').classList.contains('done'), null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
console.log('middle C detected through the fake microphone:', heardC);
if (!heardC) {
  console.log('setup message:', await page.textContent('#setup-msg'));
  await page.click('#btn-setup-skip');
}

// "Have you played before?" -> first placement test.
await page.waitForSelector('#screen-placement.active', { timeout: 8000 });
await shot('03-experience');
await page.click('.exp-option[data-exp="some"]');
await page.click('#btn-exp-go');
await page.waitForSelector('#screen-play.active', { timeout: 8000 });
await page.waitForTimeout(1500);
await shot('04-placement-prep');

// A simulated student: solid up to SKILL, shaky above it. Plays through the same input path
// as the on-screen keyboard, with a little human timing jitter.
const SKILL = Number(process.env.SKILL || 12);
await page.evaluate((skill) => {
  window.__autoplay = () => {
    const { audio } = window.__maestro;
    const s0 = window.__maestro.session();
    const level = (window.__maestro.piece() || {}).level || 1;
    const acc = level <= skill ? 0.97 : level <= skill + 3 ? 0.7 : 0.35;
    const tick = () => {
      const s = window.__maestro.session();
      if (!s || s.finished || s !== s0) return;
      for (const n of s.expectedNotes(0.05)) {
        if (n._played) continue;
        const dt = (n.beat - s.beat) * s.spb;
        if (s.mode === 'wait' || dt <= 0.01) {
          n._played = true;
          const midi = Math.random() < acc ? n.midi : n.midi + (Math.random() < 0.5 ? 1 : -2);
          const jitter = (Math.random() - 0.5) * 0.06;
          audio.noteOn(midi, audio.now() + jitter, 0.7, 'touch');
          setTimeout(() => audio.noteOff(midi, audio.now(), 'touch'), 150);
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  };
}, SKILL);

// "Get ready": the first test is started by playing its first note (the hands-free path),
// the rest with the "I'm ready" button.
async function getReady(byNote) {
  // (the fake mic's middle C can start a test by itself when it begins on middle C: that's the
  // hands-free path working, so either state is fine)
  await page.waitForFunction(() => !document.querySelector('#prep').classList.contains('hidden') || !!window.__maestro.session(), null, { timeout: 8000 });
  if (await page.evaluate(() => !!window.__maestro.session())) return;
  if (byNote) {
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const { audio } = window.__maestro;
      const first = window.__maestro.app.prepStarts();
      audio.noteOn(first[0], audio.now(), 0.7, 'touch');
      setTimeout(() => audio.noteOff(first[0], audio.now(), 'touch'), 150);
    });
  } else await page.click('#btn-prep-go', { timeout: 3000 }).catch(() => {}); // (may have just started by itself)
  await page.waitForFunction(() => !!window.__maestro.session(), null, { timeout: 8000 });
}

let tests = 0;
for (; tests < 12; tests++) {
  await getReady(tests === 0);
  if (tests === 0) console.log('first test started by playing its first note');
  await page.evaluate(() => window.__autoplay());
  if (tests === 0) {
    await page.waitForTimeout(4000);
    await shot('05-placement-playing');
  }
  await page.waitForSelector('#results:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => {
    const c = window.__maestro.coach.s;
    const list = c.placement ? c.placement.tests : c.placementHistory.at(-1).tests;
    return list.at(-1);
  });
  console.log(`test ${tests + 1}: level ${t.level} → ${t.score}% (notes ${Math.round(t.noteAcc * 100)}%, timing ${Math.round(t.timing * 100)}%) |`, (await page.textContent('#res-level')).replace(/\s+/g, ' ').trim());
  if (tests === 0) await shot('06-placement-result');
  const label = (await page.textContent('#btn-next')).trim();
  await page.click('#results', { position: { x: 20, y: 20 } }); // skip the animation
  await page.click('#btn-next');
  await page.waitForTimeout(500);
  if (/see my level/i.test(label)) break;
  await page.waitForSelector('#screen-play.active');
}
await page.waitForSelector('#screen-reveal.active', { timeout: 8000 });
await page.waitForTimeout(2500);
await shot('07-reveal');
const placed = await page.evaluate(() => window.__maestro.coach.s.level);
console.log(`placed at level ${placed} after ${tests + 1} tests (simulated skill ${SKILL})`);
await page.click('#btn-reveal-go');
await page.waitForTimeout(800);
await shot('08-after-reveal');
await page.evaluate(() => window.__maestro.app.stopPlay && window.__maestro.app.stopPlay());

// Every main screen through the navigation rail.
await page.evaluate(() => window.__maestro.app.show('home'));
await page.waitForTimeout(500);
await shot('09-home');
for (const s of ['songs', 'practice', 'progress', 'settings']) {
  await page.click(`.screen.active .rail [data-go="${s}"]`);
  await page.waitForTimeout(500);
  await shot(`10-${s}`);
}
// A song: open its sheet and start it.
await page.click('.screen.active .rail [data-go="songs"]');
await page.waitForTimeout(300);
await page.click('#song-grid > *:first-child');
await page.waitForTimeout(500);
await shot('11-song-sheet');
await page.click('#sheet-play');
await page.waitForSelector('#screen-play.active', { timeout: 8000 });
await page.waitForTimeout(3000);
await shot('12-song-play');
await page.click('#btn-exit');
await page.waitForTimeout(300);
// Free play with the fake mic.
await page.click('.screen.active .rail [data-go="free"]');
await page.waitForTimeout(2500);
await shot('13-free-play');
await page.click('#btn-exit');

const errors = logs.filter((l) => /error|pageerror/i.test(l));
console.log(errors.join('\n') || 'no console errors');
await browser.close();
if (errors.length || !heardC) process.exit(1);
