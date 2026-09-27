// End-to-end check of the listening test (Listening check -> "Record a listening test"): the easy
// piece in wait mode is played through by a simulated student, and the recording + JSON are
// offered for download.
//   npx http-server -p 8080 .   (in another terminal)
//   node e2e/listentest.mjs [outDir]
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

// fake mic: middle C (setup), then C-E-G chords (setup's chord step)
const sr = 48000;
const notes = [{ midi: 60, t: 4, dur: 0.6, vel: 0.6 }];
for (let i = 0; i < 7; i++) for (const m of [60, 64, 67]) notes.push({ midi: m, t: 5.5 + i * 1.5 + (m - 60) * 0.004, dur: 0.8, vel: 0.6 });
const wav = path.resolve(out, 'fake-mic-lt.wav');
fs.writeFileSync(wav, toWav(renderPiano(notes, { sr, length: 17 }), sr));

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL);
await page.click('#btn-start');
await page.waitForSelector('#screen-setup.active');
await page.click('#btn-setup-go');
await page.waitForFunction(() => document.querySelector('#step-c').classList.contains('done'), null, { timeout: 20000 });

await page.evaluate(() => window.__maestro.app.startListeningTest());
await page.waitForFunction(() => !document.querySelector('#prep').classList.contains('hidden') || !!window.__maestro.session(), null, { timeout: 10000 });
const info = await page.evaluate(() => {
  const p = window.__maestro.piece();
  return { title: p.title, bpm: p.bpm, bars: p.measures, notes: p.notes.length };
});
console.log('piece:', info);
if (!(await page.evaluate(() => !!window.__maestro.session()))) {
  await page.evaluate(() => window.__maestro.audio.noteOn(window.__maestro.app.prepStarts()[0], window.__maestro.audio.now(), 0.7, 'touch'));
  await page.waitForFunction(() => !!window.__maestro.session(), null, { timeout: 10000 });
}
console.log('mode:', await page.evaluate(() => window.__maestro.session().mode));

// play every group in order, a little slower than written (wait mode waits)
const played = await page.evaluate(async () => {
  const { audio } = window.__maestro;
  const s = window.__maestro.session();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let n = 0;
  for (let guard = 0; guard < 400 && !s.done; guard++) {
    const exp = s.expectedNotes(1);
    if (!exp.length) {
      await sleep(80);
      continue;
    }
    for (const x of exp) audio.noteOn(x.midi, audio.now(), 0.7, 'touch');
    n += exp.length;
    await sleep(900);
  }
  return n;
});
console.log('notes played:', played);

// the recording is offered for download in the Listening check
await page.waitForFunction(() => /Listening test recorded/.test(document.querySelector('#diag-rec')?.textContent || ''), null, { timeout: 30000 });
const links = await page.$$eval('#diag-rec a[download]', (as) => as.map((a) => a.getAttribute('download')));
console.log('files offered:', links.join(', '));
const json = await page.evaluate(async () => {
  const a = [...document.querySelectorAll('#diag-rec a[download]')].find((x) => x.getAttribute('download').endsWith('.json'));
  return a ? JSON.parse(await (await fetch(a.href)).text()) : null;
});
const exp = json && (json.expected || (json.extra && json.extra.expected));
console.log('json:', json ? `test ${json.test || (json.extra && json.extra.test)}, mode ${json.mode || (json.extra && json.extra.mode)}, ${exp ? exp.length : '?'} expected notes, ${exp ? exp.filter((e) => e.t != null).length : '?'} with times` : 'missing');
await page.screenshot({ path: path.join(out, 'listentest-done.png') });
const errors = logs.filter((l) => /error|pageerror/i.test(l));
console.log(errors.join('\n') || 'no console errors');
await browser.close();
if (!links.length || errors.length) process.exit(1);
