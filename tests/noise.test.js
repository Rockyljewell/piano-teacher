// The listener must not hear notes in room noise, and must still hear the piano through it.
// Uses the synthetic noise models (tests/noise-sim.js) and the additive synth piano, so it runs
// offline; see corpus.test.js for the same checks on real recordings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runParallel, NOISE_TYPES, transcribe } from './noise-eval.js';
import { Transcriber } from '../js/audio/transcriber.js';
import { renderPiano } from './synth-piano.js';
import { speech, mixInto, gainDb } from './noise-sim.js';

const SEC = 40;
// False note-ons per minute allowed on noise alone at a realistic level (all detections), and at a
// loud level for the ones the practice engine would count as wrong notes (confidence >= 0.55).
// TV music (in-tune sung notes, plucked bass) and ringing glasses (single sustained sine tones in
// the top octaves) are genuinely piano-like; their limits document the current state (v1 heard
// ~440 and ~20 notes/min) - the practice engine additionally ignores notes far outside the piece.
const LIMITS = {
  speech: [1.5, 3],
  claps: [1, 2],
  taps: [1.5, 3],
  footsteps: [1.5, 3],
  hum: [1, 2],
  bark: [1.5, 3],
  typing: [1, 2],
  tv: [35, 30],
  dishes: [18, 20],
};

let noiseRes;
async function noiseResults() {
  if (!noiseRes) {
    const jobs = [];
    for (const noise of NOISE_TYPES) {
      jobs.push({ kind: 'noise', noise, level: 'realistic', sec: SEC, seed: 5 });
      jobs.push({ kind: 'noise', noise, level: 'loud', sec: SEC, seed: 6 });
    }
    // while the student pauses (the listener knows how loud the piano is)
    for (const noise of ['speech', 'tv', 'taps', 'claps']) jobs.push({ kind: 'pause', noise, level: 'realistic', sec: 30, seed: 7, engine: 'synth' });
    const res = await runParallel(jobs);
    noiseRes = {};
    jobs.forEach((j, i) => ((noiseRes[j.noise] ||= {})[j.kind === 'pause' ? 'pause' : j.level] = res[i]));
  }
  return noiseRes;
}

for (const noise of NOISE_TYPES) {
  test(`no notes from ${noise}`, async () => {
    const r = (await noiseResults())[noise];
    const [maxFpm, maxLoud] = LIMITS[noise];
    assert.ok(!r.realistic.error, r.realistic.error);
    assert.ok(r.realistic.fpm <= maxFpm, `${noise} realistic: ${r.realistic.fpm.toFixed(1)} false notes/min: ${r.realistic.notes.join(' ')}`);
    assert.ok(r.loud.fpmConf <= maxLoud, `${noise} loud: ${r.loud.fpmConf.toFixed(1)} confident false notes/min: ${r.loud.notes.join(' ')}`);
  });
}

test('almost no notes from the room while the student pauses', async () => {
  const r = await noiseResults();
  for (const noise of ['speech', 'tv', 'taps', 'claps']) {
    const p = r[noise].pause;
    assert.ok(!p.error, p.error);
    assert.ok(p.fpm <= (noise === 'tv' ? 6 : 2), `${noise}: ${p.fpm.toFixed(1)}/min ${p.notes.join(' ')}`);
  }
});

let pianoRes;
async function pianoResults() {
  if (!pianoRes) {
    const base = { kind: 'piano', engine: 'synth', piece: 'beginner', expect: true };
    const jobs = [
      { ...base, key: 'clean' },
      ...['speech', 'tv', 'claps', 'taps', 'dishes', 'bark'].map((noise) => ({ ...base, noise, snr: 10, key: noise })),
      { ...base, noise: 'hum', snr: 10, key: 'hum' },
      { kind: 'piano', engine: 'synth', piece: 'beginner', key: 'free' },
      { kind: 'piano', engine: 'synth', piece: 'beginner', noise: 'speech', snr: 10, key: 'freeSpeech' },
    ];
    const res = await runParallel(jobs);
    pianoRes = {};
    jobs.forEach((j, i) => (pianoRes[j.key] = res[i]));
  }
  return pianoRes;
}

test('lesson notes are still heard through room noise at 10 dB SNR', async () => {
  const r = await pianoResults();
  for (const k of ['clean', 'speech', 'tv', 'claps', 'taps', 'dishes', 'bark', 'hum']) {
    const v = r[k];
    assert.ok(!v.error, v.error);
    const minRecall = k === 'clean' ? 0.95 : k === 'hum' ? 0.8 : 0.9;
    assert.ok(v.recall >= minRecall, `${k}: recall ${v.recall.toFixed(3)} misses ${v.misses.join(' ')}`);
    assert.ok(v.precision >= 0.84, `${k}: precision ${v.precision.toFixed(3)} extras ${v.extraList.join(' ')}`);
    assert.ok(v.absErr < 0.012, `${k}: onset error ${v.absErr}`);
  }
});

test('free play (no score) still works, also with talking in the room', async () => {
  const r = await pianoResults();
  assert.ok(r.free.recall >= 0.83 && r.free.precision >= 0.87, `free ${r.free.recall} ${r.free.precision}`);
  assert.ok(r.freeSpeech.recall >= 0.78 && r.freeSpeech.precision >= 0.85, `free+speech ${r.freeSpeech.recall} ${r.freeSpeech.precision}`);
});

test('onNoteOn reports confidence and restrike info', () => {
  const notes = [60, 60, 64].map((m, i) => ({ midi: m, t: 0.6 + i * 0.4, dur: 0.3, vel: 0.6 }));
  const audio = renderPiano(notes, { sr: 48000 });
  const infos = [];
  const tr = new Transcriber(48000, { onNoteOn: (m, t, v, info) => infos.push({ m, t, v, info }) });
  for (let i = 0; i + 128 <= audio.length; i += 128) tr.push(audio.subarray(i, i + 128), i);
  assert.deepEqual(
    infos.map((e) => e.m),
    [60, 60, 64],
    JSON.stringify(infos),
  );
  for (const e of infos) {
    assert.ok(e.info && e.info.confidence >= 0.5 && e.info.confidence <= 1, JSON.stringify(e));
    assert.equal(typeof e.info.restrike, 'boolean');
    assert.ok(e.v > 0 && e.v <= 1);
  }
  assert.ok(Math.abs(infos[1].t - 1.0) < 0.02, `repeated note time ${infos[1].t}`);
  assert.ok(tr.noiseLevel < -60, `noise level ${tr.noiseLevel}`);
  assert.ok(tr.pianoLevel > -60, `piano level ${tr.pianoLevel}`);
});

test('strictness trades sensitivity for noise immunity', () => {
  const x = speech(30, { seed: 77 });
  const audio = new Float32Array(x.length + 48000);
  mixInto(audio, x, gainDb(-6) * 0.13, 48000);
  const count = (opts) => transcribe(audio, 48000, opts, { calibTo: 0.8 }).length;
  const lax = count({ strictness: 0 });
  const strict = count({ noisyRoom: true });
  assert.ok(strict <= lax, `noisyRoom ${strict} > strictness 0 ${lax}`);
  assert.ok(strict <= 1, `noisyRoom still hears ${strict} notes in loud speech`);
});

test('setExpected / setRange / reset keep working', () => {
  const tr = new Transcriber(44100, {});
  tr.setExpected([60, 64], [48, 72]);
  assert.deepEqual(tr.range, [48, 72]);
  tr.setRange(null);
  assert.equal(tr.range, null);
  tr.setStrictness(2);
  assert.equal(tr.strictness, 1);
  tr.setStrictness(0.3);
  tr.setNoisyRoom(true);
  assert.equal(tr.strictness, 0.85);
  tr.setNoisyRoom(false);
  assert.equal(tr.strictness, 0.3);
  tr.reset();
  assert.equal(tr.active.size, 0);
});
