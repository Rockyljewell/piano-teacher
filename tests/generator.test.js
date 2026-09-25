import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, generateRhythm } from '../js/music/generator.js';
import { LEVELS } from '../js/music/curriculum.js';
import { Key, noteName } from '../js/music/theory.js';

function checkPiece(p, label) {
  assert.ok(p.notes.length > 0, `${label}: has notes`);
  for (const n of p.notes) {
    assert.ok(Number.isInteger(n.midi) && n.midi >= 21 && n.midi <= 108, `${label}: midi in range ${n.midi}`);
    assert.ok(Number.isFinite(n.beat) && n.beat >= 0 && n.beat < p.totalBeats + 1e-6, `${label}: beat ${n.beat}`);
  }
  // Every staff's events tile the piece without overlaps or gaps (per hand voice).
  for (const staff of p.staves) {
    const evs = p.events.filter((e) => e.staff === staff);
    const starts = [...new Set(evs.map((e) => e.beat.toFixed(4)))];
    let covered = 0;
    let pos = 0;
    const sorted = [...evs].sort((a, b) => a.beat - b.beat);
    const seen = new Set();
    for (const e of sorted) {
      const k = e.beat.toFixed(4);
      if (seen.has(k)) continue; // chord members / simultaneous events share a start
      seen.add(k);
      assert.ok(Math.abs(e.beat - pos) < 1e-4, `${label} ${staff}: gap/overlap at ${pos} vs ${e.beat}`);
      pos = e.beat + e.dur;
      covered += e.dur;
    }
    assert.ok(Math.abs(pos - p.totalBeats) < 1e-4, `${label} ${staff}: ends at ${pos} of ${p.totalBeats}`);
    assert.ok(starts.length > 0);
  }
}

test('all levels generate valid pieces of every kind', () => {
  for (const lv of LEVELS) {
    for (let seed = 1; seed <= 25; seed++) {
      checkPiece(generate(lv.n, { seed }), `L${lv.n} sight s${seed}`);
      if (seed <= 5) {
        checkPiece(generate(lv.n, { seed, kind: 'scale' }), `L${lv.n} scale s${seed}`);
        checkPiece(generate(lv.n, { seed, kind: 'arpeggio' }), `L${lv.n} arp s${seed}`);
        checkPiece(generate(lv.n, { seed, kind: 'chords' }), `L${lv.n} chords s${seed}`);
        checkPiece(generate(lv.n, { seed, kind: 'notes' }), `L${lv.n} notes s${seed}`);
        checkPiece(generateRhythm(lv.n, { seed }), `L${lv.n} rhythm s${seed}`);
      }
    }
  }
});

test('there are 40 levels', () => assert.equal(LEVELS.length, 40));

test('generation is deterministic per seed', () => {
  const a = generate(12, { seed: 42 });
  const b = generate(12, { seed: 42 });
  assert.deepEqual(a.notes.map((n) => [n.midi, n.beat]), b.notes.map((n) => [n.midi, n.beat]));
});

test('beginner level stays in C position with fingering', () => {
  for (let seed = 1; seed < 20; seed++) {
    const p = generate(1, { seed });
    for (const n of p.notes) assert.ok(n.midi >= 60 && n.midi <= 67 && [0, 2, 4, 5, 7].includes(n.midi % 12));
    for (const e of p.events) if (!e.rest) assert.ok(e.fingers && e.fingers[0] >= 1 && e.fingers[0] <= 5);
  }
});

test('key spelling', () => {
  assert.equal(noteName(66, new Key(1)), 'F♯4');
  assert.equal(noteName(70, new Key(-1)), 'B♭4');
  assert.equal(noteName(61, new Key(-4)), 'D♭4');
  assert.equal(noteName(60, new Key(0)), 'C4');
  assert.equal(new Key(0, 'minor').name, 'A minor');
  assert.equal(new Key(-3).name, 'E♭ major');
  assert.deepEqual(new Key(2).scalePcs(), [2, 4, 6, 7, 9, 11, 1]);
});
