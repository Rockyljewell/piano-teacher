// Dumps the app's own musical material and the room-noise simulations for training the
// listening model (tools/nn/). Run from the repo root:
//
//   node tools/nn/dump_content.mjs            -> tools/nn/.data/content.json, .data/noise/sim-*.f32
//
// content.json: { pieces: [{ src, level, kind, bpm, beatsPer, notes: [[midi, beat, dur, hand], ...] }] }
//   - generate(level, {seed, kind}) for all 40 levels and every warm-up kind, generateRhythm,
//   - every song arrangement (songPiece), both hands.
// Seeds start at 100000 so no piece equals one the listening benchmark renders (it uses small
// seeds, see tests/bench-material.js).
//
// noise: tests/noise-sim.js generators at 16 kHz with seeds >= 1000 (the benchmark and
// noise-eval.js use seeds < 100), several minutes of each type.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, generateRhythm } from '../../js/music/generator.js';
import { SONGS, songPiece } from '../../js/music/songs.js';
import { NOISES, roomTone } from '../../tests/noise-sim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '.data');
const SR = 16000;
const SEED0 = 100000;

function pack(p, src, level, kind) {
  const notes = p.notes.map((n) => [n.midi, n.beat, n.dur, n.hand === 'L' ? 1 : 0]);
  if (!notes.length) return null;
  return { src, level, kind, bpm: p.bpm, beatsPer: p.beatsPer || 4, notes };
}

function content() {
  const pieces = [];
  const kinds = ['sight', 'scale', 'arpeggio', 'chords', 'fivefinger', 'notes'];
  let fails = 0;
  for (let L = 1; L <= 40; L++) {
    for (const kind of kinds) {
      const n = kind === 'sight' ? 14 : 3;
      for (let s = 0; s < n; s++) {
        try {
          const p = generate(L, { seed: SEED0 + L * 1000 + kinds.indexOf(kind) * 100 + s, kind, tempoFactor: (s % 5) / 4 });
          const q = pack(p, 'lesson', L, kind);
          if (q) pieces.push(q);
        } catch {
          fails++;
        }
      }
    }
    for (let s = 0; s < 3; s++) {
      try {
        const q = pack(generateRhythm(L, { seed: SEED0 + 77000 + L * 10 + s }), 'rhythm', L, 'rhythm');
        if (q) pieces.push(q);
      } catch {
        fails++;
      }
    }
  }
  for (const song of SONGS) {
    for (const arr of song.arrangements || []) {
      try {
        const p = songPiece(song.id, arr.id);
        const q = pack(p, 'song', p.level || 1, song.id);
        if (q) pieces.push(q);
      } catch {
        fails++;
      }
    }
  }
  return { pieces, fails };
}

function noise() {
  const out = path.join(DATA, 'noise');
  fs.mkdirSync(out, { recursive: true });
  const kinds = { ...NOISES, room: roomTone };
  let n = 0;
  for (const [name, fn] of Object.entries(kinds)) {
    for (let i = 0; i < 4; i++) {
      const f = path.join(out, `sim-${name}-${i}.f32`);
      if (fs.existsSync(f)) continue;
      const x = fn(90, { sr: SR, seed: 1000 + i * 17 + name.length });
      fs.writeFileSync(f, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
      n++;
    }
    // tv without the talking too
    if (name === 'tv')
      for (let i = 0; i < 2; i++) {
        const f = path.join(out, `sim-tvmusic-${i}.f32`);
        if (fs.existsSync(f)) continue;
        const x = fn(90, { sr: SR, seed: 2000 + i, talk: false });
        fs.writeFileSync(f, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
        n++;
      }
  }
  return n;
}

fs.mkdirSync(DATA, { recursive: true });
const { pieces, fails } = content();
fs.writeFileSync(path.join(DATA, 'content.json'), JSON.stringify({ pieces }));
const bySrc = {};
for (const p of pieces) bySrc[p.src] = (bySrc[p.src] || 0) + 1;
console.log(`content: ${pieces.length} pieces (${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ')}), ${pieces.reduce((a, p) => a + p.notes.length, 0)} notes, ${fails} failed`);
console.log(`noise: ${noise()} new clips`);
