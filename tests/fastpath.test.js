// The listener's fast path: notes are decided at the attack (short windows over what the attack
// added), not ~0.1-0.3 s later. Synthesized piano, so these run everywhere; the listening
// benchmark (npm run bench) measures the same on real and held-out pianos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Transcriber } from '../js/audio/transcriber.js';
import { renderPiano, rng } from './synth-piano.js';
import { score } from './noise-eval.js';

const sr = 48000;
const CHUNK = 256; // what the capture worklet sends

// Run the transcriber like the app: calibrate on the first 0.4 s, 256-sample chunks, optional
// lesson hints (notes due within -0.25..+0.35 s and the piece's range). Each event also records
// how much audio existed when it was reported (`at`).
function listen(audio, notes, { lesson = false } = {}) {
  const events = [];
  let at = 0;
  const tr = new Transcriber(sr, { onNoteOn: (midi, t, vel, info) => events.push({ midi, t, at, conf: info.confidence, restrike: info.restrike }) });
  const range = [Math.min(...notes.map((n) => n.midi)), Math.max(...notes.map((n) => n.midi))];
  tr.startCalibration();
  let cal = false,
    key = '';
  for (let i = 0; i + CHUNK <= audio.length; i += CHUNK) {
    const t = i / sr;
    if (!cal && t > 0.4) {
      tr.finishCalibration();
      cal = true;
    }
    if (lesson) {
      const due = [...new Set(notes.filter((n) => n.t > t - 0.25 && n.t < t + 0.35).map((n) => n.midi))];
      const k = due.join(',');
      if (k !== key) {
        key = k;
        tr.setExpected(due, range);
      }
    }
    at = (i + CHUNK) / sr;
    tr.push(audio.subarray(i, i + CHUNK), i);
  }
  return { events, tr };
}

// report latency (s) of every matched note
function latencies(notes, events) {
  const used = new Set();
  const out = [];
  for (const n of notes) {
    let best = -1,
      bd = 0.08;
    events.forEach((e, i) => {
      if (used.has(i) || e.midi !== n.midi) return;
      const d = Math.abs(e.t - n.t);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      out.push(events[best].at - n.t);
    }
  }
  return out.sort((a, b) => a - b);
}
const median = (a) => a[a.length >> 1];

function lessonMaterial() {
  const r = rng(31);
  const notes = [];
  let t = 0.8;
  // a melody with a few chords and octaves, mid register, like the app's early levels
  for (let i = 0; i < 24; i++) {
    const m = 60 + [0, 2, 4, 5, 7, 9, 7, 5][Math.floor(r() * 8)];
    if (i % 6 === 5) for (const iv of [0, 4, 7]) notes.push({ midi: m - 12 + iv, t: t + (r() - 0.5) * 0.02, dur: 0.5, vel: 0.6, g: i });
    else if (i % 6 === 2) for (const iv of [0, 12]) notes.push({ midi: m - 12 + iv, t: t + (r() - 0.5) * 0.02, dur: 0.4, vel: 0.6, g: i });
    else notes.push({ midi: m, t, dur: 0.4, vel: 0.5 + r() * 0.3, g: i });
    t += 0.55;
  }
  return notes;
}

test('lesson hints: notes are reported within ~40 ms of the attack, chords and octaves complete', () => {
  const notes = lessonMaterial();
  const audio = renderPiano(notes, { sr });
  const { events, tr } = listen(audio, notes, { lesson: true });
  const s = score(notes, events);
  assert.ok(s.recall >= 0.95, `recall ${s.recall} misses ${s.misses.map((n) => n.midi + '@' + n.t.toFixed(2))}`);
  assert.ok(s.precision >= 0.93, `precision ${s.precision} extras ${s.extras.map((e) => e.midi + '@' + e.t.toFixed(2))}`);
  const lat = latencies(notes, events);
  assert.ok(median(lat) <= 0.04, `median report latency ${(median(lat) * 1000).toFixed(0)} ms`);
  // every note of every chord / octave
  const groups = new Map();
  notes.forEach((n) => (groups.get(n.g) || groups.set(n.g, []).get(n.g)).push(n));
  const hit = (n) => events.some((e) => e.midi === n.midi && Math.abs(e.t - n.t) <= 0.08);
  const chords = [...groups.values()].filter((g) => g.length > 1);
  const complete = chords.filter((g) => g.every(hit)).length;
  assert.ok(complete >= chords.length - 1, `${complete}/${chords.length} chords complete`);
  assert.ok(tr.stats.fast > notes.length * 0.7, `fast path decided ${tr.stats.fast} of ${notes.length}`);
});

test('free play: once the piano is heard, clear notes are reported within ~60 ms', () => {
  const r = rng(32);
  const notes = [];
  for (let i = 0; i < 30; i++) notes.push({ midi: 55 + Math.floor(r() * 24), t: 0.8 + i * 0.45, dur: 0.35, vel: 0.5 + r() * 0.3 });
  const audio = renderPiano(notes, { sr });
  const { events } = listen(audio, notes);
  const s = score(notes, events);
  assert.ok(s.recall >= 0.93 && s.precision >= 0.9, `recall ${s.recall} precision ${s.precision}`);
  const lat = latencies(notes.slice(3), events);
  assert.ok(median(lat) <= 0.06, `median report latency ${(median(lat) * 1000).toFixed(0)} ms`);
});

test('repeated notes and repeated chords are each reported, with lesson hints', () => {
  const notes = [];
  let t = 0.8;
  for (let i = 0; i < 8; i++) {
    notes.push({ midi: 67, t, dur: 0.1, vel: 0.6 });
    t += 0.14;
  }
  t += 0.5;
  for (let i = 0; i < 4; i++) {
    for (const m of [60, 64, 67]) notes.push({ midi: m, t, dur: 0.25, vel: 0.6 });
    t += 0.3;
  }
  const audio = renderPiano(notes, { sr });
  const s = score(notes, listen(audio, notes, { lesson: true }).events);
  assert.ok(s.recall >= 0.85, `recall ${s.recall} misses ${s.misses.map((n) => n.midi + '@' + n.t.toFixed(2))}`);
  assert.ok(s.precision >= 0.9, `precision ${s.precision}`);
});

test('the fast path never reports an unexpected note before it knows how loud the piano is', () => {
  // a single clear note from silence in free play goes through the long-window path
  const notes = [{ midi: 64, t: 1, dur: 0.5, vel: 0.7 }];
  const audio = renderPiano(notes, { sr, length: 2 });
  const { events, tr } = listen(audio, notes);
  assert.equal(events.length, 1);
  assert.ok(!tr.stats.fast, 'first note decided by the long window');
  assert.ok(events[0].at - 1 >= 0.06, `reported after ${((events[0].at - 1) * 1000).toFixed(0)} ms`);
});
