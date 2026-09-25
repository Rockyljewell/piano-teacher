// "Get ready" metadata: every piece says where the hands go and what to play first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, generateRhythm, buildPrep } from '../js/music/generator.js';
import { songPiece, SONGS } from '../js/music/songs.js';
import { midiToPiece } from '../js/music/midi.js';
import { LEVELS } from '../js/music/curriculum.js';
import { noteName, findableName, spokenName, middleCRelative } from '../js/music/theory.js';

const words = (s) => s.trim().split(/\s+/).length;

function checkPrep(p, label) {
  const P = p.prep;
  assert.ok(P, `${label}: has prep`);
  assert.ok(Array.isArray(P.hands) && P.hands.length >= 1, `${label}: hands`);
  assert.ok(typeof P.say === 'string' && P.say.length > 0 && words(P.say) <= 16, `${label}: say "${P.say}"`);
  assert.ok(typeof P.text === 'string' && P.text.length >= P.say.length * 0.6, `${label}: text`);
  assert.ok(!/[♯♭]/.test(P.say), `${label}: spoken line uses words for sharps and flats: "${P.say}"`);
  assert.equal(typeof P.outOfPosition, 'boolean');
  for (const h of P.hands) {
    assert.ok(h.hand === 'R' || h.hand === 'L');
    assert.ok(h.position.lo <= h.position.hi, `${label}: position`);
    assert.ok(Number.isInteger(h.anchor.midi) && typeof h.anchor.name === 'string', `${label}: anchor`);
    assert.ok(h.anchor.finger == null || (h.anchor.finger >= 1 && h.anchor.finger <= 5), `${label}: anchor finger`);
  }
  for (const f of P.first) {
    assert.ok(f.midis.length >= 1 && f.names.length === f.midis.length, `${label}: first notes`);
    const evs = p.events.filter((e) => (e.hand || 'R') === f.hand && !e.rest && e.midis.length);
    const firstBeat = Math.min(...evs.map((e) => e.beat));
    assert.equal(f.beat, firstBeat, `${label}: first beat`);
    if (!p.rhythmOnly) assert.deepEqual([...f.midis].sort((a, b) => a - b), [...evs.find((e) => e.beat === firstBeat).midis].sort((a, b) => a - b));
    f.names.forEach((n, i) => assert.equal(n, noteName(f.midis[i], p.key)));
  }
}

test('every generated exercise carries prep (sight, warm-ups, rhythm, placement)', () => {
  for (const lv of LEVELS) {
    for (let seed = 1; seed <= 4; seed++) {
      checkPrep(generate(lv.n, { seed }), `L${lv.n} sight s${seed}`);
      for (const kind of ['notes', 'fivefinger', 'scale', 'chords', 'arpeggio']) checkPrep(generate(lv.n, { seed, kind }), `L${lv.n} ${kind} s${seed}`);
      checkPrep(generateRhythm(lv.n, { seed }), `L${lv.n} rhythm s${seed}`);
      checkPrep(generate(lv.n, { seed, bothHands: true, measures: 4, tempoFactor: 0.1 }), `L${lv.n} placement s${seed}`);
    }
  }
});

test('beginner prep names the position the way a beginner finds it', () => {
  const l1 = generate(1, { seed: 1 }).prep;
  assert.equal(l1.hands[0].anchor.midi, 60);
  assert.equal(l1.hands[0].anchor.finger, 1);
  assert.match(l1.say, /Right thumb on middle C/);
  assert.match(l1.text, /middle C \(C4\)/);
  const l3 = generate(3, { seed: 1 }).prep;
  assert.deepEqual(l3.hands[0].position, { lo: 48, hi: 55 });
  assert.equal(l3.hands[0].anchor.finger, 5);
  assert.match(l3.say, /Left pinky on the C below middle C/);
  assert.match(l3.text, /C3 \(the C below middle C\)/);
  const l6 = generate(6, { seed: 1 }).prep;
  assert.equal(l6.say, 'Right thumb on middle C. Left pinky on the C below.');
  const l8 = generate(8, { seed: 2 }).prep;
  assert.match(l8.text, /G4 \(the G above middle C\)/);
  assert.match(l8.text, /F♯2/);
  assert.equal(l8.outOfPosition, false);
});

test('rhythm drill prep: any key, with a suggested key under the hand', () => {
  const r3 = generateRhythm(3, { seed: 1 });
  assert.equal(r3.prep.anyKey, true);
  assert.deepEqual(r3.suggestKey, { midi: 48, name: 'C3', hand: 'L', finger: 5, text: 'Any key works: only your rhythm counts. Try C3 (the C below middle C) with your left pinky.', say: 'Any key works. Try the C below middle C with your left pinky.' });
  assert.equal(r3.prep.hands[0].anchor.midi, 48);
  assert.ok(r3.range[0] <= 48 && r3.range[1] >= 60, 'keyboard shows C3 and middle C');
});

test('later levels: prep gives the first note and finger, spelled for the key', () => {
  let flats = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const p = generate(16, { seed });
    const P = p.prep;
    assert.ok(P.first.every((f) => f.fingers.length === f.midis.length));
    if (p.key.fifths < 0 && P.first.some((f) => f.names.some((n) => n.includes('♭')))) {
      flats++;
      assert.match(P.say, /flat/);
    }
    assert.ok(P.first.every((f) => f.names.every((n) => !n.includes('♯') || p.key.fifths > 0)), 'sharps only in sharp keys');
  }
  assert.ok(flats > 0);
});

test('songs and MIDI imports carry prep', () => {
  for (const song of SONGS) for (const a of song.arrangements) checkPrep(songPiece(song.id, a.id), `${song.id}/${a.id}`);
  // A small MIDI file: C major scale up, one track.
  const vlq = (n) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const data = [];
  [60, 62, 64, 65, 67, 65, 64, 62, 60].forEach((m, i) => data.push(...vlq(i ? 0 : 0), 0x90, m, 80, ...vlq(480), 0x80, m, 0));
  data.push(0, 0xff, 0x2f, 0);
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const bytes = [...'MThd'].map((c) => c.charCodeAt(0)).concat(u32(6), [0, 0, 0, 1, 1, 224], [...'MTrk'].map((c) => c.charCodeAt(0)), u32(data.length), data);
  const p = midiToPiece(new Uint8Array(bytes).buffer);
  checkPrep(p, 'midi');
  assert.equal(p.prep.level, p.level);
  assert.equal(p.prep.first[0].midis[0], 60);
});

test('buildPrep works on a bare piece and never throws inside finish()', () => {
  const p = generate(5, { seed: 3 });
  const again = buildPrep(p, { level: 5 });
  assert.equal(again.say.length > 0, true);
});

test('note names for beginners are relative to middle C', () => {
  assert.equal(middleCRelative(48), 'the C below middle C');
  assert.equal(middleCRelative(67), 'the G above middle C');
  assert.equal(middleCRelative(43), 'the second G below middle C');
  assert.equal(findableName(60, undefined, 12), 'middle C (C4)');
  assert.equal(findableName(55, undefined, 3), 'G3 (the G below middle C)');
  assert.equal(spokenName(66, undefined, 12), 'F sharp');
});
