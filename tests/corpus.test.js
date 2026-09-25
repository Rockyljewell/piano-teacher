// Listening tests on real recordings: the Salamander grand piano samples (CC-BY 3.0) and
// public-domain speech / 1920s radio music. They need `node tests/corpus-fetch.js` (downloads
// ~8 MB into tests/.cache/) and are skipped when the cache is missing, e.g. offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus } from './corpus-piano.js';
import { runParallel } from './noise-eval.js';

const have = !!loadCorpus();
const skip = have ? false : 'corpus not cached (run: node tests/corpus-fetch.js)';

let res;
async function results() {
  if (!res) {
    const jobs = [
      // score-informed, as in the practice screens (the listener knows which notes are due)
      { key: 'singles', kind: 'piano', engine: 'sampled', piece: 'singles', expect: true },
      { key: 'triads', kind: 'piano', engine: 'sampled', piece: 'triads', expect: true },
      { key: 'beginner', kind: 'piano', engine: 'sampled', piece: 'beginner', expect: true },
      { key: 'twohand', kind: 'piano', engine: 'sampled', piece: 'twohand', expect: true },
      // no prior (free play / wrong notes)
      { key: 'repeated', kind: 'piano', engine: 'sampled', piece: 'repeated' },
      { key: 'beginnerFree', kind: 'piano', engine: 'sampled', piece: 'beginner' },
      { key: 'dynamics', kind: 'piano', engine: 'sampled', piece: 'dynamics' },
      { key: 'speech10', kind: 'piano', engine: 'sampled', piece: 'beginner', noise: 'real-speech', snr: 10, expect: true },
      { key: 'radio10', kind: 'piano', engine: 'sampled', piece: 'beginner', noise: 'real-radio', snr: 10, expect: true },
      { key: 'realSpeech', kind: 'noise', noise: 'real-speech', level: 'realistic', sec: 60, seed: 2 },
      { key: 'realRadio', kind: 'noise', noise: 'real-radio', level: 'realistic', sec: 60, seed: 2 },
      { key: 'pauseSpeech', kind: 'pause', noise: 'real-speech', level: 'realistic', sec: 40, seed: 4 },
    ];
    const out = await runParallel(jobs);
    res = {};
    jobs.forEach((j, i) => (res[j.key] = out[i]));
  }
  return res;
}

const ok = (r) => assert.ok(!r.error, r.error);

test('real grand piano, score-informed: single notes >= 90%, triads >= 90%, lessons >= 93%', { skip }, async () => {
  const r = await results();
  for (const k of ['singles', 'triads', 'beginner', 'twohand']) ok(r[k]);
  // singles: the deep-bass chromatic run (A#0-G1, each under the still-ringing previous key) is a
  // known limitation - see the report in noise-eval.js
  assert.ok(r.singles.recall >= 0.9, `singles ${r.singles.recall} ${r.singles.misses.join(' ')}`);
  assert.ok(r.triads.recall >= 0.9, `triads ${r.triads.recall} ${r.triads.misses.join(' ')}`);
  assert.ok(r.beginner.recall >= 0.93, `beginner ${r.beginner.recall} ${r.beginner.misses.join(' ')}`);
  assert.ok(r.twohand.recall >= 0.9, `twohand ${r.twohand.recall} ${r.twohand.misses.join(' ')}`);
  for (const k of ['singles', 'triads', 'beginner']) assert.ok(r[k].precision >= 0.93, `${k} precision ${r[k].precision} ${r[k].extraList.join(' ')}`);
});

test('real grand piano without a score: repeated notes, soft and loud', { skip }, async () => {
  const r = await results();
  ok(r.repeated);
  assert.ok(r.repeated.recall >= 0.85, `repeated ${r.repeated.recall} ${r.repeated.misses.join(' ')}`);
  assert.ok(r.beginnerFree.recall >= 0.85, `beginner ${r.beginnerFree.recall}`);
  assert.ok(r.dynamics.recall >= 0.9, `dynamics ${r.dynamics.recall} ${r.dynamics.misses.join(' ')}`);
  assert.ok(r.beginnerFree.absErr < 0.01, `onset error ${r.beginnerFree.absErr}`);
});

test('real piano through real speech / radio at 10 dB SNR', { skip }, async () => {
  const r = await results();
  ok(r.speech10);
  assert.ok(r.speech10.recall >= 0.85, `speech ${r.speech10.recall}`);
  assert.ok(r.radio10.recall >= 0.8, `radio ${r.radio10.recall}`);
  assert.ok(r.speech10.precision >= 0.88 && r.radio10.precision >= 0.88, `precision ${r.speech10.precision} ${r.radio10.precision}`);
});

test('real speech and radio alone produce (almost) no notes', { skip }, async () => {
  const r = await results();
  ok(r.realSpeech);
  assert.ok(r.realSpeech.fpmConf <= 3, `speech: ${r.realSpeech.fpmConf}/min ${r.realSpeech.notes.join(' ')}`);
  assert.ok(r.realRadio.fpmConf <= 4, `radio: ${r.realRadio.fpmConf}/min ${r.realRadio.notes.join(' ')}`);
  assert.ok(r.pauseSpeech.fpm <= 1.5, `pause: ${r.pauseSpeech.fpm}/min ${r.pauseSpeech.notes.join(' ')}`);
});
