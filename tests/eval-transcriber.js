// Offline accuracy report for the transcriber on clean piano audio (additive synth piano, plus
// the Salamander grand samples when `node tests/corpus-fetch.js` has been run).
// For behaviour in room noise see tests/noise-eval.js.
import { transcribe, score, pieces, renderPiece } from './noise-eval.js';
import { loadCorpus } from './corpus-piano.js';

export { transcribe, score };

function run(name, engine, notes, sr = 48000, opts = {}) {
  const audio = renderPiece(engine, notes, { sr, ...opts });
  const ev = transcribe(audio, sr);
  const s = score(notes, ev);
  const conf = s.hitConf.reduce((a, b) => a + b, 0) / (s.hitConf.length || 1);
  console.log(
    `${name.padEnd(28)} recall ${(s.recall * 100).toFixed(1).padStart(5)}%  precision ${(s.precision * 100).toFixed(1).padStart(5)}%  onset err mean ${(s.meanErr * 1000).toFixed(1)}ms abs ${(s.absErr * 1000).toFixed(1)}ms  confidence ${conf.toFixed(2)}  cpu x${ev.speed.toFixed(1)} realtime`,
  );
  if (process.env.VERBOSE) {
    console.log('  misses', s.misses.map((n) => `${n.midi}@${n.t.toFixed(2)}`).join(' '));
    console.log('  extras', s.extras.map((n) => `${n.midi}@${n.t.toFixed(2)}`).join(' '));
  }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const P = pieces(3);
  for (const engine of loadCorpus() ? ['synth', 'sampled'] : ['synth']) {
    console.log(`\n${engine === 'synth' ? 'additive synth piano' : 'Salamander grand samples'}`);
    run('single notes A0-C8', engine, P.singles);
    run('single notes soft', engine, P.soft);
    run('triads C3-C6', engine, P.triads);
    run('bass + melody', engine, P.twohand);
    run('repeated eighths 120bpm', engine, P.repeated);
    run('scale 16ths 100bpm', engine, P.scale);
    run('detuned -30c, B x2', engine, P.triads, 48000, { tuningCents: -30, bScale: 2 });
    run('44.1kHz triads', engine, P.triads, 44100);
    run('pedal (broken chords)', engine, P.pedal, 48000, { pedal: P.pedalTimes });
    run('beginner two hands', engine, P.beginner);
  }
}
