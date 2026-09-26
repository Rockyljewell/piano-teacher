// In-browser pipeline latency: what the student actually waits for.
//
//   node tests/bench-pipeline.js            (needs the app served, default http://localhost:8090/)
//
// Headless Chromium gets a fake microphone that plays a recording with known attack times (the
// held-out upright piano when cached, else the synth). The real AudioEngine runs in the page:
// capture AudioWorklet -> MessagePort -> listener Web Worker -> Transcriber -> main thread. For
// every noteon that reaches the main thread we note the audio clock (audio.now()) and compare
// it with the attack time on the same clock. The file -> audio clock offset is estimated from
// the reported attack times (median over all notes; the transcriber's onsets are within a few
// ms). Hardware input latency is not included (a fake device has none worth measuring).
//
// Two runs: free play (no hints) and lesson (the page follows the recording and calls
// setExpected with the notes due within -0.25..+0.35 s, synchronised on the first note).
// The same audio also goes through the Transcriber offline (512-sample chunks) so the
// difference between the two is the pipeline itself (worklet chunk, worker hops, scheduling).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderPiano, toWav, rng } from './synth-piano.js';
import { render, hasInstrument } from './bench-sampler.js';
import { applyCondition, match } from './bench-listen.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000;
const LEAD = 3.0;

function testNotes() {
  const r = rng(77);
  const notes = [];
  let t = LEAD;
  // sync marker (not scored): a loud C5
  notes.push({ midi: 72, t, dur: 0.4, vel: 0.8, sync: true });
  t += 1.0;
  const push = (midis, vel = 0.6) => {
    for (const m of midis) notes.push({ midi: m, t: t + (midis.length > 1 ? (r() * 2 - 1) * 0.01 : 0), dur: 0.45, vel: vel + (r() - 0.5) * 0.1 });
    t += 0.75;
  };
  for (const m of [48, 52, 55, 60, 62, 64, 65, 67, 69, 71, 72, 76, 79, 84, 88]) push([m]);
  for (const m of [36, 40, 43, 45]) push([m]);
  for (const c of [[60, 64, 67], [57, 60, 64], [53, 57, 60, 65], [48, 55, 64], [67, 71, 74]]) push(c);
  for (const m of [59, 62, 66, 70, 74, 77]) push([m]);
  return { notes, length: t + 1.5 };
}

// The same recording through the Transcriber in Node, at the page's sample rate, in the
// worklet's 512-sample chunks: analysis + chunking only.
async function offline(audio48, notes, mode, trPath, sr) {
  const { Transcriber } = await import(pathToFileURL(trPath).href);
  let audio = audio48;
  if (sr !== SR) {
    audio = new Float32Array(Math.floor((audio48.length * sr) / SR));
    for (let i = 0; i < audio.length; i++) {
      const p = (i * SR) / sr;
      const k = Math.floor(p);
      audio[i] = k + 1 < audio48.length ? audio48[k] + (audio48[k + 1] - audio48[k]) * (p - k) : 0;
    }
  }
  const ev = [];
  let at = 0;
  const tr = new Transcriber(sr, { onNoteOn: (midi, t) => ev.push({ midi, t, at: at / sr }) });
  const canCal = typeof tr.startCalibration === 'function';
  if (canCal) tr.startCalibration();
  let cal = false,
    key = '';
  const range = [Math.min(...notes.map((n) => n.midi)), Math.max(...notes.map((n) => n.midi))];
  for (let i = 0; i + 512 <= audio.length; i += 512) {
    const t = i / sr;
    if (canCal && !cal && t > 1.2) {
      tr.finishCalibration();
      cal = true;
    }
    if (mode === 'lesson') {
      const due = [...new Set(notes.filter((n) => n.t > t - 0.25 && n.t < t + 0.35).map((n) => n.midi))];
      const k = due.join(',');
      if (k !== key && typeof tr.setExpected === 'function') {
        key = k;
        tr.setExpected(due, range);
      }
    }
    at = i + 512;
    tr.push(audio.subarray(i, i + 512), i);
  }
  return ev;
}

const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null);
  return { med: q(0.5), p90: q(0.9) };
};

export async function measurePipeline({ url = 'http://localhost:8090/', trPath = path.join(here, '../js/audio/transcriber.js') } = {}) {
  // is the app served?
  const ok = await fetch(url).then((r) => r.ok).catch(() => false);
  if (!ok) return { skipped: `app not served at ${url}` };
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
  }
  const { notes, length } = testNotes();
  const inst = hasInstrument('upright') ? 'upright' : null;
  const dry = inst ? render(inst, notes, { sr: SR, length }) : renderPiano(notes, { sr: SR, length });
  const audio = applyCondition(dry, 'stand', 3);
  const dir = path.join(here, '.cache', 'bench');
  fs.mkdirSync(dir, { recursive: true });
  const wav = path.join(dir, 'pipeline-mic.wav');
  fs.writeFileSync(wav, toWav(audio, SR));
  const scored = notes.filter((n) => !n.sync);
  const results = {};
  for (const mode of ['free', 'lesson']) {
    const browser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(url);
      const log = await page.evaluate(
        async ({ mode, notes, length, lead }) => {
          const { AudioEngine } = await import('/js/audio/audio.js');
          const a = new AudioEngine({ autoLoadPiano: false });
          await a.ensureContext();
          const events = [];
          let sync = null;
          a.on('noteon', (ev) => {
            if (ev.source !== 'mic') return;
            const now = a.now();
            events.push({ midi: ev.midi, t: ev.time, now, conf: ev.confidence });
            if (sync == null && ev.midi === 72) sync = ev.time - notes[0].t;
          });
          const t0 = a.ctx.currentTime;
          await a.startMic();
          const cal = a.calibrate(1000);
          const range = [Math.min(...notes.map((n) => n.midi)), Math.max(...notes.map((n) => n.midi))];
          if (mode === 'lesson') {
            a.setRange(range[0], range[1]);
            const tick = setInterval(() => {
              if (sync == null) return;
              const ft = a.now() - sync; // file time
              const due = [...new Set(notes.filter((n) => !n.sync && n.t > ft - 0.25 && n.t < ft + 0.35).map((n) => n.midi))];
              a.setExpected(due);
            }, 8);
            setTimeout(() => clearInterval(tick), (length + 2) * 1000);
          }
          await cal;
          await new Promise((r) => setTimeout(r, (length + 1.5) * 1000));
          return { events, mode: a.mode, sr: a.ctx.sampleRate, t0, lead };
        },
        { mode, notes, length, lead: LEAD },
      );
      // align file time -> audio clock: rough offset from the sync note, refined by the median
      const sy = log.events.find((e) => e.midi === 72);
      if (!sy) {
        results[mode] = { n: scored.length, found: 0, error: 'sync note not heard', pipeline: log.mode };
        continue;
      }
      let off = sy.t - notes[0].t;
      for (let it = 0; it < 2; it++) {
        const shifted = scored.map((n) => ({ ...n, t: n.t + off }));
        const { noteHit } = match(shifted, log.events, 0.08);
        const d = [];
        scored.forEach((n, i) => noteHit[i] >= 0 && d.push(log.events[noteHit[i]].t - n.t));
        if (d.length) off = stat(d).med;
      }
      const shifted = scored.map((n) => ({ ...n, t: n.t + off }));
      const { noteHit } = match(shifted, log.events, 0.08);
      const lat = [];
      scored.forEach((n, i) => noteHit[i] >= 0 && lat.push((log.events[noteHit[i]].now - shifted[i].t) * 1000));
      // offline: the same recording through the same Transcriber, 512-sample chunks
      const oev = await offline(audio, scored, mode, trPath, log.sr);
      const om = match(scored, oev, 0.08);
      const olat = [];
      scored.forEach((n, i) => om.noteHit[i] >= 0 && olat.push((oev[om.noteHit[i]].at - n.t) * 1000));
      const s = stat(lat),
        os2 = stat(olat);
      results[mode] = { n: scored.length, found: lat.length, med: s.med, p90: s.p90, offlineMed: os2.med, offlineP90: os2.p90, offlineFound: olat.length, pipeline: log.mode, sampleRate: log.sr };
    } finally {
      await browser.close();
    }
  }
  const pipe = Object.values(results).map((r) => r.pipeline).filter(Boolean)[0];
  return {
    piano: inst || 'synth',
    note: `Fake microphone: ${inst || 'synth'} piano, \`stand\` condition, ${scored.length} notes (singles C2–E6 and chords). Listener pipeline mode: \`${pipe}\`. Latency = audio clock when the noteon reaches the main thread minus the attack on the same clock.`,
    results,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await measurePipeline({ url: process.env.URL || 'http://localhost:8090/', trPath: process.env.TRANSCRIBER ? path.resolve(process.env.TRANSCRIBER) : undefined });
  console.log(JSON.stringify(r, null, 1));
}
