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

// Placement test starts.
await page.waitForSelector('#screen-play.active', { timeout: 8000 });
await page.waitForTimeout(1500);
await shot('03-placement-countin');

// Play the piece perfectly with the computer keyboard (the "touch" input path).
const KEY = { 60: 'a', 61: 'w', 62: 's', 63: 'e', 64: 'd', 65: 'f', 66: 't', 67: 'g', 68: 'y', 69: 'h', 70: 'u', 71: 'j', 72: 'k' };
await page.evaluate(() => {
  // Expose a tiny auto-player that uses the same input path as the on-screen keyboard.
  window.__autoplay = (acc = 1) => {
    const { audio } = window.__maestro;
    const tick = () => {
      const s = window.__maestro.session();
      if (!s || s.finished) return;
      for (const n of s.expectedNotes(0.05)) {
        if (n._played) continue;
        const dt = (n.beat - s.beat) * s.spb;
        if (dt <= 0.01) {
          n._played = true;
          if (Math.random() < acc) audio.noteOn(n.midi, audio.now(), 0.7, 'touch');
          else audio.noteOn(n.midi + 1, audio.now(), 0.7, 'touch');
          setTimeout(() => audio.noteOff(n.midi, audio.now(), 'touch'), 150);
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  };
});
await page.evaluate(() => window.__autoplay(1));
await page.waitForTimeout(4000);
await shot('04-placement-playing');
await page.waitForSelector('#results:not(.hidden)', { timeout: 60000 });
await shot('05-placement-result');
console.log('result score:', await page.textContent('#res-score'), '|', await page.textContent('#res-level'));

// Continue a few placement tests with the auto-player.
for (let i = 0; i < 3; i++) {
  await page.click('#btn-next');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__autoplay(1));
  await page.waitForSelector('#results:not(.hidden)', { timeout: 90000 });
  console.log(`test ${i + 2}:`, await page.textContent('#hud-title'), '→', await page.textContent('#res-score'), '|', await page.textContent('#res-level'));
}
await shot('06-later-test-result');
await page.click('#btn-res-home');
await page.waitForTimeout(300);
await shot('07-home-after');

// Free play screen with the fake mic.
await page.click('[data-go="free"]');
await page.waitForTimeout(2500);
await shot('08-free-play');
await page.click('#btn-exit');

for (const s of ['map', 'practice', 'progress', 'settings']) {
  await page.click(`[data-go="${s}"]`);
  await page.waitForTimeout(400);
  await shot(`09-${s}`);
  await page.click(`#screen-${s} [data-go="home"]`);
}
console.log(logs.filter((l) => /error|pageerror/i.test(l)).join('\n') || 'no console errors');
await browser.close();
