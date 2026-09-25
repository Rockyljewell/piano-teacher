import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, midiToPiece, notateSpan, estimateKey, estimateLevel } from '../js/music/midi.js';
import { TIME_SIGS } from '../js/music/generator.js';

// ---- a tiny Standard MIDI File writer (test helper) -------------------------------------------

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const text = (s) => [...new TextEncoder().encode(s)];

// events: [{t (ticks), bytes: [...] }] in any order. `running` drops repeated status bytes.
function track(events, { running = false } = {}) {
  const sorted = [...events].sort((a, b) => a.t - b.t || (a.order ?? 0) - (b.order ?? 0));
  const data = [];
  let last = 0;
  let status = null;
  for (const e of sorted) {
    data.push(...vlq(e.t - last));
    last = e.t;
    let bytes = e.bytes;
    if (running && bytes[0] < 0xf0 && bytes[0] === status) bytes = bytes.slice(1);
    else status = bytes[0] < 0xf0 ? bytes[0] : null;
    data.push(...bytes);
  }
  data.push(0, 0xff, 0x2f, 0);
  return [...text('MTrk'), ...u32(data.length), ...data];
}

function smf(format, division, tracks) {
  const bytes = [...text('MThd'), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division), ...tracks.flat()];
  return new Uint8Array(bytes).buffer;
}

const meta = (t, type, data) => ({ t, bytes: [0xff, type, ...vlq(data.length), ...data], order: -1 });
const tempo = (t, bpm) => meta(t, 0x51, [(Math.round(60e6 / bpm) >> 16) & 255, (Math.round(60e6 / bpm) >> 8) & 255, Math.round(60e6 / bpm) & 255]);
const timeSig = (t, num, den) => meta(t, 0x58, [num, Math.log2(den), 24, 8]);
const keySig = (t, fifths, minor = 0) => meta(t, 0x59, [fifths & 255, minor]);
const name = (s) => meta(0, 0x03, text(s));

// A note as on/off pairs. `offAsZero` writes note-off as note-on with velocity 0.
function note(ch, midi, on, off, { vel = 80, offAsZero = false } = {}) {
  return [
    { t: on, bytes: [0x90 | ch, midi, vel], order: 1 },
    { t: off, bytes: offAsZero ? [0x90 | ch, midi, 0] : [0x80 | ch, midi, 64], order: 0 },
  ];
}

const Q = 480; // ticks per quarter

// Right hand in G major, 3/4, with a one-beat pickup, sixteenths, one triplet beat, a tie over
// the barline and slightly human timing.
function rightHand() {
  const ev = [name('Right Hand')];
  const seq = [
    // [startBeats, durBeats, midi]
    [0, 1, 62], // pickup D4
    [1, 1, 67], [2, 0.5, 71], [2.5, 0.5, 69], [3, 1, 67], // bar 1: G B A G
    [4, 1 / 3, 72], [4 + 1 / 3, 1 / 3, 71], [4 + 2 / 3, 1 / 3, 69], [5, 0.25, 67], [5.25, 0.25, 69], [5.5, 0.25, 71], [5.75, 0.25, 72], [6, 2, 74], // bar 2 triplet + 16ths + tie
    [8, 1, 71], [9, 1, 67], // bar 3
    [10, 3, 67], // bar 4
  ];
  let jitter = 0;
  for (const [s, d, m] of seq) {
    jitter = (jitter + 7) % 11 - 5; // -5..5 ticks of "human" timing
    ev.push(...note(0, m, Math.max(0, Math.round(s * Q) + jitter), Math.round((s + d) * Q) - 12));
  }
  return ev;
}

function leftHand() {
  const ev = [name('Left Hand')];
  const chords = [
    [1, 3, [43, 50, 55]], // G2 D3 G3
    [4, 3, [48, 52, 55]], // C3 E3 G3
    [7, 3, [50, 54, 57]], // D3 F#3 A3
    [10, 3, [43, 50, 55]],
  ];
  for (const [s, d, ms] of chords) for (const m of ms) ev.push(...note(1, m, Math.round(s * Q), Math.round((s + d) * Q) - 5, { offAsZero: true }));
  // A drum hit on channel 10 must be ignored.
  ev.push(...note(9, 36, 0, 60));
  return ev;
}

function twoTrackFile() {
  const conductor = [name('Test Song'), tempo(0, 100), timeSig(0, 3, 4), keySig(0, 1)];
  return smf(1, Q, [track(conductor), track(rightHand(), { running: true }), track(leftHand())]);
}

// ---- helpers ---------------------------------------------------------------------------------

function checkPiece(p, label) {
  assert.ok(p.notes.length > 0, `${label}: has notes`);
  for (const n of p.notes) {
    assert.ok(Number.isInteger(n.midi) && n.midi >= 21 && n.midi <= 108, `${label}: midi in range ${n.midi}`);
    assert.ok(n.beat >= 0 && n.beat < p.totalBeats + 1e-6, `${label}: beat ${n.beat}`);
  }
  for (const staff of p.staves) {
    const evs = p.events.filter((e) => e.staff === staff).sort((a, b) => a.beat - b.beat);
    let pos = 0;
    const seen = new Set();
    for (const e of evs) {
      const k = e.beat.toFixed(4);
      if (seen.has(k)) continue;
      seen.add(k);
      assert.ok(Math.abs(e.beat - pos) < 1e-4, `${label} ${staff}: gap/overlap at ${pos} vs ${e.beat}`);
      pos = e.beat + e.dur;
    }
    assert.ok(Math.abs(pos - p.totalBeats) < 1e-4, `${label} ${staff}: ends at ${pos} of ${p.totalBeats}`);
    // No event crosses a barline.
    for (const e of evs) {
      const m = Math.floor(e.beat / p.beatsPer + 1e-6);
      assert.ok(e.beat + e.dur <= (m + 1) * p.beatsPer + 1e-6, `${label} ${staff}: event at ${e.beat} crosses a barline`);
    }
  }
}

// ---- tests -----------------------------------------------------------------------------------

test('parseMidi reads header, meta events, running status and note-on/velocity-0 offs', () => {
  const m = parseMidi(twoTrackFile());
  assert.equal(m.format, 1);
  assert.equal(m.division, Q);
  assert.equal(m.tracks.length, 3);
  assert.equal(m.title, 'Test Song');
  assert.equal(Math.round(m.tempos[0].bpm), 100);
  assert.deepEqual([m.timeSignatures[0].num, m.timeSignatures[0].den], [3, 4]);
  assert.deepEqual([m.keySignatures[0].fifths, m.keySignatures[0].mode], [1, 'major']);
  assert.equal(m.tracks[1].name, 'Right Hand');
  assert.equal(m.tracks[1].notes.length, 16, 'running-status track decoded fully');
  assert.equal(m.tracks[2].notes.filter((n) => n.channel !== 9).length, 12);
  for (const tr of m.tracks) for (const n of tr.notes) assert.ok(n.end > n.start, 'every note closed');
  // Uint8Array input works too.
  assert.equal(parseMidi(new Uint8Array(twoTrackFile())).tracks.length, 3);
});

test('parseMidi keeps what it can read from a truncated file', () => {
  const full = new Uint8Array(twoTrackFile());
  const cut = full.slice(0, full.length - 30);
  const m = parseMidi(cut);
  assert.equal(m.tracks.length, 3);
  assert.ok(m.tracks[2].notes.length > 0 && m.tracks[2].notes.length <= 13);
  assert.ok(midiToPiece(cut).notes.length > 0);
});

test('parseMidi rejects non-MIDI data', () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]).buffer), /MIDI/);
});

test('midiToPiece: tracks become hands, pickup, triplets, ties and key signature', () => {
  const p = midiToPiece(twoTrackFile(), { maxMeasures: 16 });
  checkPiece(p, 'two-track');
  assert.equal(p.kind, 'song');
  assert.equal(p.title, 'Test Song');
  assert.equal(p.tsName, '3/4');
  assert.equal(p.bpm, 100);
  assert.equal(p.key.fifths, 1);
  assert.deepEqual(p.staves, ['treble', 'bass']);
  assert.equal(p.handSplit, 'tracks');
  // Right hand keeps its 16 notes (the tied D5 counts once), left hand 12, drums dropped.
  assert.equal(p.notes.filter((n) => n.hand === 'R').length, 16);
  assert.equal(p.notes.filter((n) => n.hand === 'L').length, 12);
  assert.ok(p.notes.every((n) => n.midi !== 36), 'drum channel ignored');
  // The pickup is found: the first G4 lands on a downbeat.
  const g = p.notes.find((n) => n.hand === 'R' && n.midi === 67);
  assert.ok(Math.abs((g.beat % p.beatsPer)) < 1e-6, `G4 on a downbeat, got beat ${g.beat}`);
  assert.equal(p.pickup, 1, 'one-beat pickup reported');
  assert.equal(p.startBeat, 2);
  assert.ok(p.events.filter((e) => e.beat < 2 && e.hand === 'R').every((e) => e.rest && e.pickup));
  // Triplet eighths detected and written as tuplets.
  const trip = p.events.filter((e) => e.tuplet === 3 && !e.rest);
  assert.equal(trip.length, 3);
  for (const e of trip) assert.ok(Math.abs(e.dur - 1 / 3) < 1e-6);
  // Sixteenths quantized exactly.
  assert.equal(p.events.filter((e) => !e.rest && Math.abs(e.dur - 0.25) < 1e-6).length, 4);
  // The long D5 crosses a barline: written as a tie, graded as one note with its full length.
  const d5 = p.events.filter((e) => e.midis.includes(74));
  assert.equal(d5.length, 2);
  assert.equal(d5[0].tieNext, d5[1].id);
  assert.equal(d5[1].tiedFrom, d5[0].id);
  const d5note = p.notes.find((n) => n.midi === 74);
  assert.ok(Math.abs(d5note.dur - 2) < 0.3, `tied note keeps its length, got ${d5note.dur}`);
  // Left-hand chords stay chords.
  assert.ok(p.events.some((e) => e.hand === 'L' && e.midis.length === 3));
  assert.ok(p.level >= 6 && p.level <= 40);
});

test('midiToPiece: single-track piano file is split by pitch; options work', () => {
  const ev = [];
  // Bass on beats, melody above, 4/4, 2 bars, no meta events at all.
  for (let b = 0; b < 8; b++) {
    ev.push(...note(0, b % 2 ? 43 : 48, b * Q, (b + 1) * Q - 10));
    ev.push(...note(0, [72, 74, 76, 77, 79, 77, 76, 74][b], b * Q, b * Q + Q / 2 - 10));
    ev.push(...note(0, [71, 72, 74, 76, 77, 76, 74, 72][b], b * Q + Q / 2, (b + 1) * Q - 10));
  }
  const buf = smf(0, Q, [track(ev)]);
  const p = midiToPiece(buf, { title: 'Split me' });
  checkPiece(p, 'format 0');
  assert.equal(p.title, 'Split me');
  assert.equal(p.tsName, '4/4');
  assert.equal(p.bpm, 120, 'default tempo');
  assert.deepEqual(p.staves, ['treble', 'bass']);
  assert.ok(p.notes.filter((n) => n.hand === 'L').every((n) => n.midi < 60));
  assert.ok(p.notes.filter((n) => n.hand === 'R').every((n) => n.midi >= 60));
  assert.equal(p.key.fifths, 0, 'key estimated as C major');
  // A fixed split point sends everything below it to the left hand.
  const q = midiToPiece(buf, { handSplit: 75 });
  assert.ok(q.notes.filter((n) => n.hand === 'L').some((n) => n.midi === 74));
  // Eighth-note grid.
  const r = midiToPiece(buf, { quantize: 8 });
  assert.ok(r.events.every((e) => Math.abs(e.beat * 2 - Math.round(e.beat * 2)) < 1e-6));
  // maxMeasures limits the result.
  assert.equal(midiToPiece(buf, { maxMeasures: 1 }).measures, 1);
});

test('midiToPiece clips notes outside the piano and keeps single melodies in one hand', () => {
  const ev = [];
  [19, 60, 62, 64, 110].forEach((m, i) => ev.push(...note(0, m, i * Q, (i + 1) * Q)));
  const p = midiToPiece(smf(0, Q, [track(ev)]));
  checkPiece(p, 'clip');
  const ms = p.notes.map((n) => n.midi);
  assert.ok(ms.includes(31) && ms.includes(98), `octave-shifted into range: ${ms}`);
  const q = midiToPiece(smf(0, Q, [track([60, 62, 64, 65, 67].flatMap((m, i) => note(0, m, i * Q, (i + 1) * Q - 20)))]));
  assert.deepEqual(q.staves, ['treble'], 'a one-line melody stays in the right hand');
});

test('midiToPiece maps other meters: 2/2, 12/8, 9/8', () => {
  const ev = [];
  for (let i = 0; i < 12; i++) ev.push(...note(0, 60 + (i % 5), i * (Q / 2), (i + 1) * (Q / 2) - 10));
  for (const [num, den, want] of [[2, 2, '4/4'], [12, 8, '6/8'], [9, 8, '3/4'], [3, 8, '6/8'], [5, 4, '4/4']]) {
    const p = midiToPiece(smf(1, Q, [track([timeSig(0, num, den)]), track(ev)]));
    assert.equal(p.tsName, want, `${num}/${den}`);
    checkPiece(p, `${num}/${den}`);
    if (num === 9) assert.ok(p.events.some((e) => e.tuplet), '9/8 eighths become triplets in 3/4');
  }
});

test('notateSpan writes readable values', () => {
  const ts = TIME_SIGS['4/4'];
  const vals = (pos, len, t = ts) => notateSpan(pos, len, t).map((s) => [s.beat, s.dur]);
  assert.deepEqual(vals(0, 4), [[0, 4]]);
  assert.deepEqual(vals(0, 2.5), [[0, 2], [2, 0.5]]);
  assert.deepEqual(vals(1, 3), [[1, 3]]);
  assert.deepEqual(vals(3, 2), [[3, 1], [4, 1]], 'split at the barline');
  assert.deepEqual(vals(0.5, 1), [[0.5, 1]], 'syncopated quarter');
  assert.deepEqual(vals(0.5, 1.5), [[0.5, 0.5], [1, 1]]);
  const six = TIME_SIGS['6/8'];
  assert.deepEqual(vals(0, 3, six), [[0, 3]]);
  assert.deepEqual(vals(0, 2, six), [[0, 1.5], [1.5, 0.5]]);
  const trip = notateSpan(0, 1 / 3, ts, (b) => b === 0);
  assert.equal(trip[0].tuplet, 3);
});

test('estimateKey and estimateLevel', () => {
  const scale = (tonic, steps) => steps.map((s, i) => ({ midi: tonic + s, start: i, end: i + 1 }));
  assert.equal(estimateKey(scale(67, [0, 2, 4, 5, 7, 9, 11, 12, 7, 4, 0])).fifths, 1);
  const am = estimateKey(scale(57, [0, 2, 3, 5, 7, 8, 11, 12, 7, 3, 0, 0]));
  assert.equal(am.mode, 'minor');
  assert.equal(am.fifths, 0);
  const easy = midiToPiece(smf(0, Q, [track([60, 62, 64, 62, 60].flatMap((m, i) => note(0, m, i * Q, (i + 1) * Q - 20)))]));
  assert.ok(estimateLevel(easy) <= 3, `simple melody is beginner level, got ${estimateLevel(easy)}`);
});
