import test from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, CATEGORIES, FREE_SOURCES, songPiece, songsForLevel, getSong, parseHand, parsePitch, parseKey, handToText, _LIBRARY } from '../js/music/songs.js';
import { TIME_SIGS } from '../js/music/generator.js';
import { LEVELS } from '../js/music/curriculum.js';

const U = 48; // parser units per quarter note

// Same checks as tests/generator.test.js, plus: nothing crosses a barline.
function checkPiece(p, label) {
  assert.ok(p.notes.length > 0, `${label}: has notes`);
  for (const n of p.notes) {
    assert.ok(Number.isInteger(n.midi) && n.midi >= 21 && n.midi <= 108, `${label}: midi in range ${n.midi}`);
    assert.ok(Number.isFinite(n.beat) && n.beat >= 0 && n.beat < p.totalBeats + 1e-6, `${label}: beat ${n.beat}`);
    assert.ok(n.dur > 0, `${label}: positive duration`);
  }
  for (const staff of p.staves) {
    const evs = p.events.filter((e) => e.staff === staff).sort((a, b) => a.beat - b.beat);
    const seen = new Set();
    let pos = 0;
    for (const e of evs) {
      const k = e.beat.toFixed(4);
      if (seen.has(k)) continue;
      seen.add(k);
      assert.ok(Math.abs(e.beat - pos) < 1e-4, `${label} ${staff}: gap/overlap at ${pos} vs ${e.beat}`);
      pos = e.beat + e.dur;
      const m = Math.floor(e.beat / p.beatsPer + 1e-6);
      assert.ok(e.beat + e.dur <= (m + 1) * p.beatsPer + 1e-6, `${label} ${staff}: event at ${e.beat} crosses a barline`);
    }
    assert.ok(Math.abs(pos - p.totalBeats) < 1e-4, `${label} ${staff}: ends at ${pos} of ${p.totalBeats}`);
  }
  // Ties join equal pitches, and tied continuations are not graded again.
  const byId = new Map(p.events.map((e) => [e.id, e]));
  for (const e of p.events) {
    if (!e.tieNext) continue;
    const nx = byId.get(e.tieNext);
    assert.ok(nx && nx.tiedFrom === e.id, `${label}: tie links both ways`);
    assert.deepEqual(nx.midis, e.midis, `${label}: tie joins the same notes`);
    assert.ok(!p.notes.some((n) => n.eventId === nx.id), `${label}: tied continuation is not a new note`);
  }
  assert.equal(new Set(p.notes.map((n) => n.id)).size, p.notes.length, `${label}: note ids unique`);
}

test('the library is big enough and spans the whole curriculum', () => {
  assert.ok(SONGS.length >= 30, `${SONGS.length} songs`);
  const levels = SONGS.flatMap((s) => s.arrangements.map((a) => a.level));
  assert.equal(Math.min(...levels), 1);
  assert.ok(Math.max(...levels) >= 35);
  assert.ok(SONGS.filter((s) => s.arrangements.some((a) => a.level <= 2)).length >= 6, 'plenty of first songs');
  assert.ok(SONGS.filter((s) => s.arrangements.some((a) => a.level <= 8)).length >= 12, 'plenty of beginner songs');
  const ids = SONGS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'song ids unique');
  for (const c of CATEGORIES) assert.ok(SONGS.some((s) => s.category === c), `category ${c} is used`);
});

test('every song has complete metadata, and easier arrangements come first', () => {
  for (const s of SONGS) {
    for (const f of ['id', 'title', 'composer', 'origin', 'category', 'license', 'source', 'about']) assert.ok(s[f], `${s.id}: ${f}`);
    assert.ok(Number.isInteger(s.year), `${s.id}: year`);
    assert.ok(CATEGORIES.includes(s.category), `${s.id}: category ${s.category}`);
    assert.ok(s.arrangements.length >= 1);
    const aIds = s.arrangements.map((a) => a.id);
    assert.equal(new Set(aIds).size, aIds.length, `${s.id}: arrangement ids unique`);
    for (let i = 1; i < s.arrangements.length; i++) assert.ok(s.arrangements[i].level >= s.arrangements[i - 1].level, `${s.id}: arrangements ordered by level`);
    for (const a of s.arrangements) {
      assert.ok(a.level >= 1 && a.level <= LEVELS.length, `${s.id}/${a.id}: level`);
      assert.ok(TIME_SIGS[a.time], `${s.id}/${a.id}: time`);
      assert.ok(a.bpm >= 30 && a.bpm <= 200, `${s.id}/${a.id}: bpm`);
      assert.ok(['R', 'L', 'both'].includes(a.hands));
      assert.ok(a.key && Number.isInteger(a.key.fifths) && a.key.name, `${s.id}/${a.id}: key`);
    }
  }
});

test('every arrangement parses and every bar fills its time signature exactly', () => {
  for (const song of _LIBRARY) {
    for (const a of song.arrangements) {
      const ts = TIME_SIGS[a.time];
      const barU = Math.round(ts.beats * U);
      const pickupU = Math.round((a.pickup || 0) * U);
      let bars = null;
      for (const [h, text] of [['R', a.rh], ['L', a.lh]]) {
        if (!text) continue;
        const label = `${song.id}/${a.id} ${h}`;
        const parsed = parseHand(text, { time: a.time, pickup: a.pickup || 0, label });
        if (bars === null) bars = parsed.bars;
        assert.equal(parsed.bars, bars, `${label}: same number of bars in both hands`);
        // Sum the durations bar by bar.
        const perBar = new Array(parsed.bars).fill(0);
        for (const it of parsed.items) perBar[it.bar] += it.du;
        perBar.forEach((u, i) => assert.equal(u, i === 0 && pickupU ? pickupU : barU, `${label} bar ${i + 1}: ${u / U} beats`));
        for (const it of parsed.items) for (const m of it.midis) assert.ok(m >= 21 && m <= 108, `${label}: ${m} on the keyboard`);
      }
      // The advertised bar count matches.
      const meta = getSong(song.id).arrangements.find((x) => x.id === a.id);
      assert.equal(meta.measures, bars, `${song.id}/${a.id}: measures`);
    }
  }
});

test('songPiece builds a valid Piece for every arrangement and every hand', () => {
  for (const s of SONGS) {
    for (const a of s.arrangements) {
      const label = `${s.id}/${a.id}`;
      const p = songPiece(s.id, a.id);
      checkPiece(p, label);
      assert.equal(p.kind, 'song');
      assert.equal(p.title, s.title);
      assert.equal(p.subtitle, a.name);
      assert.equal(p.level, a.level);
      assert.equal(p.tsName, a.time);
      assert.equal(p.ts, TIME_SIGS[a.time]);
      assert.equal(p.beatsPer, TIME_SIGS[a.time].beats);
      assert.equal(p.bpm, a.bpm);
      assert.equal(p.key.fifths, a.key.fifths);
      assert.equal(p.measures, a.measures);
      assert.equal(p.totalBeats, p.measures * p.beatsPer);
      assert.ok(p.range[0] >= 21 && p.range[1] <= 108 && p.range[1] - p.range[0] >= 24);
      if (a.hands === 'both') {
        assert.deepEqual(p.staves, ['treble', 'bass']);
        for (const h of ['R', 'L']) {
          const one = songPiece(s.id, a.id, { hands: h });
          checkPiece(one, `${label} ${h}`);
          assert.deepEqual(one.staves, [h === 'R' ? 'treble' : 'bass']);
          assert.ok(one.notes.every((n) => n.hand === h));
          assert.ok(one.backing.length > 0 && one.backing.every((n) => n.hand !== h), `${label} ${h}: other hand as backing`);
        }
      } else {
        assert.deepEqual(p.staves, [a.hands === 'R' ? 'treble' : 'bass']);
        assert.equal(p.backing.length, 0);
      }
    }
  }
});

test('pickups are padded with rests and reported', () => {
  const p = songPiece('amazing-grace', 'rh');
  assert.equal(p.pickup, 1);
  assert.equal(p.startBeat, 2);
  const first = p.notes[0];
  assert.equal(first.beat, 2, 'the pickup note sits on beat 3 of the first bar');
  assert.ok(p.events.filter((e) => e.beat < 2).every((e) => e.rest && e.pickup));
  const noPickup = songPiece('twinkle-twinkle', 'rh');
  assert.equal(noPickup.pickup, 0);
  assert.equal(noPickup.startBeat, 0);
});

test('options: tempo, sections and defaults', () => {
  assert.equal(songPiece('ode-to-joy').subtitle, 'Right hand', 'first arrangement by default');
  assert.equal(songPiece('ode-to-joy', 'both', { bpm: 70 }).bpm, 70);
  assert.equal(songPiece('ode-to-joy', 'both', { tempoScale: 0.5 }).bpm, 50);
  const part = songPiece('ode-to-joy', 'both', { from: 9, to: 12 });
  checkPiece(part, 'section');
  assert.equal(part.measures, 4);
  assert.equal(part.notes.find((n) => n.hand === 'R').midi, 62, 'bar 9 starts on D4');
  const pick = songPiece('amazing-grace', 'both', { from: 0, to: 4 });
  checkPiece(pick, 'section with pickup');
  assert.equal(pick.measures, 5);
  assert.equal(pick.pickup, 1);
  const later = songPiece('amazing-grace', 'both', { from: 3, to: 6 });
  checkPiece(later, 'later section');
  assert.equal(later.pickup, 0);
  // An arrangement for one hand ignores a request for the other.
  const lh = songPiece('mary-had-a-little-lamb', 'rh', { hands: 'L' });
  assert.deepEqual(lh.staves, ['treble']);
  assert.throws(() => songPiece('no-such-song'), /Unknown song/);
  assert.throws(() => songPiece('ode-to-joy', 'nope'), /no arrangement/);
  // Fresh events every time (the renderer annotates them).
  const a = songPiece('twinkle-twinkle', 'rh');
  const b = songPiece('twinkle-twinkle', 'rh');
  assert.notEqual(a.events[0], b.events[0]);
});

test('tied notes are graded once and keep their full length', () => {
  const p = songPiece('joy-to-the-world', 'rh');
  const tie = p.events.find((e) => e.tieNext);
  assert.ok(tie, 'bar 7 D5 is tied into bar 8');
  const n = p.notes.find((x) => x.eventId === tie.id);
  assert.equal(n.dur, 3.5, 'half note tied to a dotted quarter');
});

test('songsForLevel suggests playable songs, best match first', () => {
  const l1 = songsForLevel(1);
  assert.ok(l1.length >= 3);
  for (const s of l1) assert.ok(s.recommended.level <= 1);
  assert.ok(l1.some((s) => s.id === 'ode-to-joy'));
  const l12 = songsForLevel(12);
  assert.ok(l12.length > l1.length);
  for (const s of l12) {
    assert.ok(s.recommended.level <= 12);
    assert.ok(!s.next || s.next.level > 12);
  }
  for (let i = 1; i < l12.length; i++) assert.ok(12 - l12[i].recommended.level >= 12 - l12[i - 1].recommended.level, 'closest levels first');
  assert.equal(songsForLevel(40).length, SONGS.length);
  assert.equal(songsForLevel(0).length, 0);
});

test('notation: pitches, keys, errors and round trips', () => {
  assert.deepEqual(parsePitch('C4'), { midi: 60, step: 0, alter: 0, octave: 4 });
  assert.equal(parsePitch('F#4').midi, 66);
  assert.equal(parsePitch('Bb3').midi, 58);
  assert.equal(parsePitch('Cb5').midi, 71);
  assert.equal(parsePitch('G##5').midi, 81);
  assert.equal(parsePitch('A0').midi, 21);
  assert.equal(parsePitch('H4'), null);
  assert.equal(parseKey('Bb').fifths, -2);
  assert.equal(parseKey('F#m').fifths, 3);
  assert.equal(parseKey('Em').mode, 'minor');
  // Sticky durations, dots, triplets, rests, chords, ties, fingering, repeats, comments.
  const h = parseHand('C4:q/1 D4 E4:8. F4:16 G4:q~ | G4:8t A4 B4 [C4 E4 G4]:q/135 r:h | % ; comment\n| R', { time: '4/4' });
  assert.equal(h.bars, 4);
  const u = h.items.map((i) => i.du);
  assert.deepEqual(u.slice(0, 5), [48, 48, 36, 12, 48]);
  assert.deepEqual(u.slice(5, 8), [16, 16, 16]);
  assert.equal(h.items[4].tie, true);
  assert.deepEqual(h.items[8].fingers, [1, 3, 5]);
  assert.equal(h.items[9].rest, true);
  assert.equal(h.items.filter((i) => i.bar === 2).length, 5, '% repeats the bar');
  assert.ok(h.items[h.items.length - 1].measureRest);
  // Errors carry the bar number.
  assert.throws(() => parseHand('C4:q D4 E4', { time: '4/4', label: 'x' }), /x bar 1: bar has 3 beats, expected 4/);
  assert.throws(() => parseHand('C4:w | C4:q Q4 E4 F4'), /bar 2: can't read "Q4"/);
  assert.throws(() => parseHand('C4:h~ D4:h'), /tie to a different note/);
  assert.throws(() => parseHand('C4:8t D4 C4:h.'), /triplet/);
  assert.throws(() => parseHand('A0:w | G#0:w'), /off the keyboard|bad pitch/);
  assert.throws(() => parseHand('C4:q/12 D4 E4 F4'), /fingers/);
  // Pickup bars.
  const pk = parseHand('D4:q | G4:h.', { time: '3/4', pickup: 1 });
  assert.equal(pk.items[0].u, 2 * U);
  assert.throws(() => parseHand('D4:h | G4:h.', { time: '3/4', pickup: 1 }), /pickup bar has 2 beats, expected 1/);
  // Text written from a Piece parses back to the same music.
  for (const [id, arr] of [['greensleeves', 'both'], ['fur-elise', 'both'], ['mozart-minuet-in-f', 'both'], ['the-entertainer', 'both']]) {
    const p = songPiece(id, arr);
    for (const hand of ['R', 'L']) {
      const text = handToText(p, hand);
      const again = parseHand(text, { time: p.tsName });
      const orig = p.events.filter((e) => e.hand === hand).sort((x, y) => x.beat - y.beat);
      const notes = (list) => list.filter((e) => !e.rest).map((e) => `${Math.round(e.beat * U)}:${e.midis.join('.')}`);
      assert.deepEqual(notes(again.items.map((it) => ({ beat: it.u / U, midis: it.midis, rest: it.rest }))), notes(orig), `${id} ${hand} round trip`);
    }
  }
});

test('FREE_SOURCES lists places to find more free music', () => {
  assert.ok(FREE_SOURCES.length >= 5);
  for (const s of FREE_SOURCES) {
    assert.ok(s.name && s.description && Array.isArray(s.formats) && typeof s.midi === 'boolean');
    assert.match(s.url, /^https:\/\//);
  }
  assert.ok(FREE_SOURCES.some((s) => /mutopia/i.test(s.name) && s.midi));
  assert.ok(FREE_SOURCES.some((s) => /IMSLP/.test(s.name)));
});
