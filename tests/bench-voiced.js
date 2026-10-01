// Free-play chords with a realistic dynamic spread: the hand's weak finger plays the top note
// 5-20 dB softer than the thumb side. The listening benchmark's chords vary by only a few dB, so
// it cannot show what happens to a soft third or fourth note (real recording, 2026-09-30: the G4
// of C-E-G, 11-21 dB below the others, was missed at 4 of 8 chord attacks).
//
//   node tests/bench-voiced.js                  upright + ydp, stand, hybrid
//   ENGINE=dsp|hybrid|/path/module.js  INST=upright,ydp,salamander  COND=stand|close|stand+talk
//   GAIN_DB=-25 FLOOR_DB=-80   quiet piano (as in bench-listen.js)     JSON=out.json
//
// Material: 3-note (root, first and second inversion; major, minor), 4-note and both-hands
// (left-hand root + fifth, right-hand triad) chords, struck 2.2 s apart and held 0.6 s. The
// loudest note is the lowest or second lowest; the top note is `top` x as loud (a velocity
// factor: amplitude goes as vel^1.7, so 0.5 is about -10 dB and 0.3 about -17 dB).
// Scored on the attack only (note-on within 80 ms), per chord note by its role and by how far
// below the loudest note of its chord it sounds, plus extras per minute.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render, hasInstrument } from './bench-sampler.js';
import { applyCondition, listen, match } from './bench-listen.js';
import { rng } from './synth-piano.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000;
const ENGINES = { dsp: '../js/audio/transcriber.js', hybrid: '../js/audio/nn/hybrid-transcriber.js' };

const SHAPES = {
  3: [[0, 4, 7], [0, 3, 7], [0, 5, 9], [0, 3, 8], [0, 4, 9], [0, 5, 8]],
  4: [[0, 4, 7, 12], [0, 4, 7, 10], [0, 3, 7, 10], [0, 4, 7, 11]],
  5: [[-12, -5, 0, 4, 7], [-12, -7, 0, 3, 7], [-24, -17, 0, 4, 7]], // left hand root + fifth, right hand triad
};

export function voicedMaterial(size, seed, count = 24) {
  const r = rng(seed);
  const notes = [];
  let t = 1.0;
  for (let g = 0; g < count; g++) {
    const shape = SHAPES[size][g % SHAPES[size].length];
    const root = 55 + Math.floor(r() * 13); // G3 .. F#4 (the right-hand triad's root)
    const top = 0.3 + r() * 0.4; // the weak finger
    const base = 0.7 + r() * 0.15;
    shape.forEach((x, i) => {
      const isTop = i === shape.length - 1;
      const w = isTop ? top : i === 0 ? 0.95 + r() * 0.1 : 0.75 + r() * 0.25;
      notes.push({ midi: root + x, t: t + r() * 0.012, tn: t, dur: 0.6, vel: base * w, g });
    });
    t += 2.2;
  }
  return { name: `voiced${size}`, notes, length: t + 1 };
}

export async function loadEngine(spec) {
  const file = ENGINES[spec] ? path.join(here, ENGINES[spec]) : path.resolve(spec);
  return (await import(pathToFileURL(file).href)).Transcriber;
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

// Score one rendered material: per-note hits by role / level below the loudest note of the chord.
export function scoreVoiced(mat, audio, Transcriber) {
  const { events } = listen(Transcriber, audio, mat, 'free', 256);
  const { noteHit, evUsed } = match(mat.notes, events);
  const out = { n: 0, hit: 0, chords: 0, whole: 0, byRole: {}, byDrop: {}, extras: events.filter((e, j) => !evUsed[j] && e.conf >= 0.55).length, sec: audio.length / SR };
  const groups = new Map();
  mat.notes.forEach((n, i) => (groups.get(n.g) || groups.set(n.g, []).get(n.g)).push([n, i]));
  const amp = (n) => n.vel ** 1.7;
  for (const grp of groups.values()) {
    const loudest = Math.max(...grp.map(([n]) => amp(n)));
    const sorted = [...grp].sort((a, b) => a[0].midi - b[0].midi);
    let whole = true;
    sorted.forEach(([n, i], k) => {
      const role = k === sorted.length - 1 ? 'top' : k === 0 ? 'lowest' : 'inner';
      const drop = -20 * Math.log10(amp(n) / loudest);
      const band = drop < 3 ? '0-3 dB' : drop < 8 ? '3-8 dB' : drop < 14 ? '8-14 dB' : '>14 dB';
      const hit = noteHit[i] >= 0;
      for (const [map, key] of [[out.byRole, role], [out.byDrop, band]]) {
        const x = (map[key] ||= { n: 0, hit: 0 });
        x.n++;
        if (hit) x.hit++;
      }
      out.n++;
      if (hit) out.hit++;
      else whole = false;
    });
    out.chords++;
    if (whole) out.whole++;
  }
  return out;
}

export function addVoiced(a, b) {
  for (const k of ['n', 'hit', 'chords', 'whole', 'extras', 'sec']) a[k] = (a[k] || 0) + b[k];
  for (const key of ['byRole', 'byDrop'])
    for (const [r, v] of Object.entries(b[key])) {
      const x = ((a[key] ||= {})[r] ||= { n: 0, hit: 0 });
      x.n += v.n;
      x.hit += v.hit;
    }
  return a;
}

async function main() {
  const engine = process.env.ENGINE || 'hybrid';
  const Transcriber = await loadEngine(engine);
  const insts = (process.env.INST || 'upright,ydp').split(',').filter((i) => hasInstrument(i));
  const cond = process.env.COND || 'stand';
  console.log(`voiced chords, free play: engine ${engine}, ${insts.join('+')}, ${cond}${process.env.GAIN_DB ? `, level ${process.env.GAIN_DB} dB` : ''}`);
  console.log('size      notes heard   whole chord | top note   inner   lowest | by drop below loudest: 0-3 dB   3-8   8-14   >14 | extras/min');
  const all = {};
  for (const size of [3, 4, 5]) {
    const tot = {};
    for (const inst of insts) {
      const mat = voicedMaterial(size, 300 + size);
      const dry = render(inst, mat.notes, { sr: SR, seed: 7, pedal: false, length: mat.length });
      addVoiced(tot, scoreVoiced(mat, applyCondition(dry, cond, 1), Transcriber));
    }
    all[size] = tot;
    const R = (k) => (tot.byRole[k] ? pct(tot.byRole[k].hit, tot.byRole[k].n) : '–');
    const D = (k) => (tot.byDrop[k] ? pct(tot.byDrop[k].hit, tot.byDrop[k].n) : '–');
    console.log(
      `${size === 5 ? '5-6 note' : `${size}-note  `}  ${pct(tot.hit, tot.n).padStart(8)}   ${pct(tot.whole, tot.chords).padStart(10)} | ${R('top').padStart(8)} ${R('inner').padStart(7)} ${R('lowest').padStart(8)} |                       ${D('0-3 dB').padStart(6)} ${D('3-8 dB').padStart(5)} ${D('8-14 dB').padStart(6)} ${D('>14 dB').padStart(5)} | ${(tot.extras / (tot.sec / 60)).toFixed(0)}`,
    );
  }
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(all, null, 1));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
