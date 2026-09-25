// A library of free (public-domain) music to learn, from first five-note tunes to real
// classical piano pieces, written in a compact text notation that is easy to author and
// review. songPiece() turns an arrangement into a Piece (the same shape generate() returns)
// so the stage, session and coach can play it like any exercise.
//
// Notation (one string per hand, bars separated by "|"):
//   C4:q      a note: letter, optional accidental (# ## b bb n), octave (C4 = middle C), then
//             ":" and a duration: w h q 8 16 32, optional "." (dotted) and "t" (triplet).
//             Pitches are absolute: F#4 is F sharp whatever the key signature says.
//   E4        the duration may be left out: it repeats the previous one (starts as a quarter).
//   r:h       a rest.     R  a whole-measure rest (alone in its bar).
//   [C3 E3 G3]:h   a chord.
//   G4:h~     tie into the next note of the same hand (same pitches).
//   C4:q/1    fingering (digits in the order the chord notes are written).
//   %         repeat the previous bar.        ; comment to the end of the line
// Arrangements may start with a pickup (anacrusis): `pickup: <beats>` and a short first bar;
// it is padded with rests in front so every bar of the piece is full.
// Tempo (`bpm`) is always in quarter notes per minute (6/8: dotted quarter = bpm / 1.5).
import { Key, STEP_NAMES, MAJOR_KEYS, MINOR_KEYS } from './theory.js';
import { TIME_SIGS, finish } from './generator.js';
import { notateSpan, extendTies } from './midi.js';

export const CATEGORIES = ['Kids & folk', 'Holiday', 'Hymns & ballads', 'Classical', 'Ragtime & blues'];

/**
 * Where to find more free music. `midi: true` means the site offers MIDI files that
 * midiToPiece() can import directly; otherwise it offers scores (PDF, MusicXML, ABC) to play from.
 * Licences differ from piece to piece on most sites: check each one before sharing a copy.
 */
export const FREE_SOURCES = [
  {
    name: 'Mutopia Project',
    url: 'https://www.mutopiaproject.org/',
    description: 'Over 2,000 classical pieces typeset by volunteers, each with a free MIDI file. Many are public domain, the rest Creative Commons.',
    formats: ['MIDI', 'PDF', 'LilyPond'],
    midi: true,
  },
  {
    name: 'IMSLP (Petrucci Music Library)',
    url: 'https://imslp.org/',
    description: 'The largest library of public-domain scores: scans of original editions of almost every classical piano work, plus some MIDI files.',
    formats: ['PDF', 'MIDI (some works)'],
    midi: true,
  },
  {
    name: 'Musopen',
    url: 'https://musopen.org/sheetmusic/',
    description: 'Public-domain sheet music and recordings with no copyright restrictions, easy to browse by composer and instrument.',
    formats: ['PDF', 'audio'],
    midi: false,
  },
  {
    name: 'Choral Public Domain Library (CPDL)',
    url: 'https://www.cpdl.org/',
    description: 'Free choral scores, including thousands of hymns and carols. Many pages include a MIDI file of every voice.',
    formats: ['PDF', 'MIDI', 'MusicXML'],
    midi: true,
  },
  {
    name: 'Hymnary.org',
    url: 'https://hymnary.org/',
    description: 'Hymn tunes and texts from centuries of hymnals, with MIDI files for many public-domain tunes.',
    formats: ['MIDI', 'PDF'],
    midi: true,
  },
  {
    name: 'abcnotation.com',
    url: 'https://abcnotation.com/',
    description: 'A search engine for folk tunes written in ABC notation; each tune page offers a MIDI download.',
    formats: ['ABC', 'MIDI', 'PDF'],
    midi: true,
  },
  {
    name: 'Open Goldberg Variations',
    url: 'https://www.opengoldbergvariations.org/',
    description: 'Bach\'s Goldberg Variations: a new score and recording released into the public domain (CC0).',
    formats: ['PDF', 'MuseScore', 'audio'],
    midi: false,
  },
  {
    name: 'Open Well-Tempered Clavier',
    url: 'https://welltemperedclavier.org/',
    description: 'Bach\'s Well-Tempered Clavier Book 1 as a CC0 score and recording, including the Prelude in C.',
    formats: ['PDF', 'MuseScore', 'audio'],
    midi: false,
  },
  {
    name: 'MuseScore public-domain scores',
    url: 'https://musescore.com/sheetmusic/public-domain',
    description: 'Community-made scores filtered to public-domain works. The MuseScore app can export any score to MIDI; downloads may need a free account.',
    formats: ['MuseScore', 'MIDI', 'PDF'],
    midi: true,
  },
  {
    name: 'Levy Sheet Music Collection',
    url: 'https://levysheetmusic.mse.jhu.edu/',
    description: 'Johns Hopkins\' 30,000 pieces of American popular sheet music since 1780: ragtime, marches and parlour songs (US public domain if published before 1929).',
    formats: ['PDF', 'images'],
    midi: false,
  },
];

// ---------------------------------------------------------------------------------------------
// Parser

const U = 48; // time units per quarter note (exact for 32nds, dots and triplets)
const DUR_UNITS = { w: 192, h: 96, q: 48, 1: 192, 2: 96, 4: 48, 8: 24, 16: 12, 32: 6 };
const STEP_PC = [0, 2, 4, 5, 7, 9, 11];
const ALTER = { '##': 2, '#': 1, b: -1, bb: -2, n: 0, '': 0 };
const PITCH_RE = /^([A-G])(##|#|bb|b|n)?(-?\d)$/;
const TOKEN_RE = /^(\[[^\]]*\]|[A-G](?:##|#|bb|b|n)?-?\d|r|R|%)(?::(w|h|q|1|2|4|8|16|32)(\.)?(t)?)?(?:\/([0-5]+))?(~)?$/;

export function parsePitch(s) {
  const m = PITCH_RE.exec(s);
  if (!m) return null;
  const step = STEP_NAMES.indexOf(m[1]);
  const alter = ALTER[m[2] || ''];
  const octave = +m[3];
  return { midi: (octave + 1) * 12 + STEP_PC[step] + alter, step, alter, octave };
}

// Key names like 'C', 'F#', 'Bb', 'Am', 'C#m', 'Ebm'.
export function parseKey(name) {
  const m = /^([A-G])(#|b)?(m?)$/.exec(name);
  if (!m) throw new Error(`Bad key "${name}"`);
  const minor = m[3] === 'm';
  const table = minor ? MINOR_KEYS : MAJOR_KEYS;
  const want = m[1] + (m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '');
  for (const [f, n] of Object.entries(table)) if (n === want) return new Key(+f, minor ? 'minor' : 'major');
  throw new Error(`Unknown key "${name}"`);
}

function tokenize(text) {
  const clean = text.replace(/;[^\n]*/g, ' ');
  return clean.split('|').map((bar) => bar.match(/\[[^\]]*\][^\s\[]*|[^\s\[]+/g) || []);
}

/**
 * Parse one hand of notation.
 * @param {string} text
 * @param {{time?: string, pickup?: number, label?: string}} [opts]
 * @returns {{bars: number, items: Array<{u:number, du:number, rest:boolean, measureRest?:boolean,
 *   midis:number[], spelled:object[], fingers:number[]|null, tuplet?:number, tie:boolean,
 *   bar:number}>}}  u/du are in 1/48 quarter notes from the start of the (padded) first bar.
 */
export function parseHand(text, opts = {}) {
  const ts = TIME_SIGS[opts.time || '4/4'];
  if (!ts) throw new Error(`Unsupported time signature ${opts.time}`);
  const label = opts.label || 'hand';
  const barU = Math.round(ts.beats * U);
  const pickupU = Math.round((opts.pickup || 0) * U);
  let bars = tokenize(text);
  while (bars.length && !bars[bars.length - 1].length) bars.pop();
  if (!bars.length) throw new Error(`${label}: no music`);
  const items = [];
  let last = { du: U, tuplet: false };
  let prevBar = null;
  bars.forEach((toks, bi) => {
    if (!toks.length) throw new Error(`${label} bar ${bi + 1}: empty bar`);
    if (toks.length === 1 && toks[0] === '%') {
      if (!prevBar) throw new Error(`${label} bar ${bi + 1}: nothing to repeat`);
      toks = prevBar;
    }
    prevBar = toks;
    const expect = bi === 0 && pickupU ? pickupU : barU;
    const start = bi === 0 && pickupU ? barU - pickupU : bi * barU;
    let pos = 0;
    let tripRun = 0;
    for (const raw of toks) {
      const tok = raw.replace(/~(\/[0-5]+)$/, '$1~');
      const m = TOKEN_RE.exec(tok);
      if (!m) throw new Error(`${label} bar ${bi + 1}: can't read "${raw}"`);
      const [, head, dcode, dot, trip, fing, tie] = m;
      if (head === '%') throw new Error(`${label} bar ${bi + 1}: "%" must be alone in its bar`);
      if (head === 'R') {
        if (toks.length !== 1) throw new Error(`${label} bar ${bi + 1}: "R" must be alone in its bar`);
        items.push({ u: start, du: expect, rest: true, measureRest: true, midis: [], spelled: [], fingers: null, tie: false, bar: bi });
        pos = expect;
        continue;
      }
      let du;
      let tuplet = false;
      if (dcode) {
        du = DUR_UNITS[dcode];
        if (dot) du *= 1.5;
        if (trip) {
          du = (du * 2) / 3;
          tuplet = true;
        }
        if (!Number.isInteger(du)) throw new Error(`${label} bar ${bi + 1}: duration too short in "${raw}"`);
        last = { du, tuplet };
      } else ({ du, tuplet } = last);
      let midis = [];
      let spelled = [];
      if (head !== 'r') {
        const names = head.startsWith('[') ? head.slice(1, -1).trim().split(/\s+/) : [head];
        for (const nm of names) {
          const p = parsePitch(nm);
          if (!p) throw new Error(`${label} bar ${bi + 1}: bad pitch "${nm}" in "${raw}"`);
          if (p.midi < 21 || p.midi > 108) throw new Error(`${label} bar ${bi + 1}: ${nm} is off the keyboard`);
          midis.push(p.midi);
          spelled.push({ step: p.step, alter: p.alter, octave: p.octave });
        }
      }
      let fingers = null;
      if (fing) {
        if (!midis.length) throw new Error(`${label} bar ${bi + 1}: fingering on a rest`);
        const f = [...fing].map(Number);
        if (f.length !== midis.length) throw new Error(`${label} bar ${bi + 1}: ${f.length} fingers for ${midis.length} notes in "${raw}"`);
        fingers = f.map((x) => x || null);
      }
      // Sort chord notes low to high, keeping fingering and spelling alongside.
      if (midis.length > 1) {
        const idx = midis.map((_, i) => i).sort((a, b) => midis[a] - midis[b]);
        midis = idx.map((i) => midis[i]);
        spelled = idx.map((i) => spelled[i]);
        if (fingers) fingers = idx.map((i) => fingers[i]);
        if (new Set(midis).size !== midis.length) throw new Error(`${label} bar ${bi + 1}: repeated note in chord "${raw}"`);
      }
      if (tuplet) tripRun += du;
      else if (tripRun) {
        if (tripRun % 24) throw new Error(`${label} bar ${bi + 1}: incomplete triplet group`);
        tripRun = 0;
      }
      if (tie && head === 'r') throw new Error(`${label} bar ${bi + 1}: a rest can't be tied`);
      items.push({ u: start + pos, du, rest: head === 'r', midis, spelled, fingers, tuplet: tuplet ? 3 : undefined, tie: !!tie, bar: bi });
      pos += du;
    }
    if (tripRun % 24) throw new Error(`${label} bar ${bi + 1}: incomplete triplet group`);
    if (pos !== expect) {
      const what = bi === 0 && pickupU ? 'pickup bar' : 'bar';
      throw new Error(`${label} bar ${bi + 1}: ${what} has ${pos / U} beats, expected ${expect / U}`);
    }
  });
  // Ties must join equal pitches.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.tie) continue;
    const nx = items[i + 1];
    if (!nx || nx.rest || nx.midis.join() !== it.midis.join()) throw new Error(`${label} bar ${it.bar + 1}: tie to a different note`);
  }
  return { bars: bars.length, items };
}

// ---------------------------------------------------------------------------------------------
// Serializer: Piece (or parsed events) -> notation text. Handy for turning imported MIDI into
// library entries, and for round-trip tests.

const DUR_NAMES = [
  [192, 'w'], [144, 'h.'], [96, 'h'], [72, 'q.'], [48, 'q'], [36, '8.'], [24, '8'], [18, '16.'], [12, '16'], [9, '32.'], [6, '32'],
  [64, 'ht'], [32, 'qt'], [16, '8t'], [8, '16t'], [4, '32t'],
];

function durName(du, tuplet) {
  for (const [u, n] of DUR_NAMES) if (u === du && n.endsWith('t') === !!tuplet) return n;
  for (const [u, n] of DUR_NAMES) if (u === du) return n;
  return null;
}

// Spell a note for the text notation: diatonic notes as the key has them; in minor keys the
// raised 6th and 7th as sharps/naturals; other chromatic notes follow the key's direction.
function spellName(midi, key) {
  const pc = ((midi % 12) + 12) % 12;
  let sp = key.spell(midi);
  if (!key.scalePcs().includes(pc) && key.mode === 'minor') {
    const pcs = key.scalePcs();
    if (pc === (pcs[5] + 1) % 12 || pc === (pcs[6] + 1) % 12) {
      const step = pc === (pcs[6] + 1) % 12 ? (key.tonicStep + 6) % 7 : (key.tonicStep + 5) % 7;
      const alter = key.alter[step] + 1;
      sp = { step, alter, octave: Math.floor((midi - alter - STEP_PC[step]) / 12) - 1 };
    }
  }
  const acc = sp.alter === 1 ? '#' : sp.alter === -1 ? 'b' : sp.alter === 2 ? '##' : sp.alter === -2 ? 'bb' : '';
  return `${STEP_NAMES[sp.step]}${acc}${sp.octave}`;
}

/** Write a piece's events for one hand ('R' or 'L') as notation text, one bar per "|". */
export function handToText(piece, hand) {
  const evs = piece.events.filter((e) => e.hand === hand).sort((a, b) => a.beat - b.beat);
  if (!evs.length) return '';
  const bars = [];
  let lastDur = null;
  for (let m = 0; m < piece.measures; m++) {
    const inBar = evs.filter((e) => Math.floor(e.beat / piece.beatsPer + 1e-6) === m);
    const toks = [];
    if (inBar.length === 1 && inBar[0].rest && Math.abs(inBar[0].dur - piece.beatsPer) < 1e-6) {
      bars.push('R');
      continue;
    }
    for (const e of inBar) {
      const du = Math.round(e.dur * U);
      const dn = durName(du, e.tuplet);
      if (!dn) throw new Error(`Can't write a duration of ${e.dur} beats`);
      const head = e.rest ? 'r' : e.midis.length === 1 ? spellName(e.midis[0], piece.key) : `[${e.midis.map((x) => spellName(x, piece.key)).join(' ')}]`;
      const d = dn === lastDur ? '' : `:${dn}`;
      lastDur = dn;
      const f = e.fingers && e.fingers.some(Boolean) ? `/${e.fingers.map((x) => x || 0).join('')}` : '';
      toks.push(`${head}${d}${f}${e.tieNext ? '~' : ''}`);
    }
    bars.push(toks.join(' '));
  }
  return bars.join(' | ');
}

// ---------------------------------------------------------------------------------------------
// Building pieces

let nextId = 1000000;
const parseCache = new Map();

function parseArrangement(song, arr) {
  const k = `${song.id}/${arr.id}`;
  if (parseCache.has(k)) return parseCache.get(k);
  const out = { R: null, L: null };
  const common = { time: arr.time, pickup: arr.pickup || 0 };
  if (arr.rh) out.R = parseHand(arr.rh, { ...common, label: `${k} RH` });
  if (arr.lh) out.L = parseHand(arr.lh, { ...common, label: `${k} LH` });
  if (!out.R && !out.L) throw new Error(`${k}: no music`);
  if (out.R && out.L && out.R.bars !== out.L.bars) throw new Error(`${k}: RH has ${out.R.bars} bars, LH has ${out.L.bars}`);
  out.bars = (out.R || out.L).bars;
  parseCache.set(k, out);
  return out;
}

function handEvents(parsed, hand, ts, pickup) {
  const staff = hand === 'R' ? 'treble' : 'bass';
  const evs = [];
  if (pickup) {
    for (const seg of notateSpan(0, ts.beats - pickup, ts)) evs.push({ id: nextId++, staff, hand, beat: seg.beat, dur: seg.dur, midis: [], rest: true, pickup: true });
  }
  let prev = null;
  for (const it of parsed.items) {
    const e = {
      id: nextId++,
      staff,
      hand,
      beat: it.u / U,
      dur: it.du / U,
      midis: [...it.midis],
      rest: it.rest,
    };
    if (it.measureRest) e.measureRest = true;
    if (it.tuplet) e.tuplet = it.tuplet;
    if (it.fingers) e.fingers = [...it.fingers];
    if (it.spelled.length) e.spelled = it.spelled.map((s) => ({ ...s }));
    if (prev && prev.tie) {
      const p = evs[evs.length - 1];
      p.tieNext = e.id;
      e.tiedFrom = p.id;
    }
    evs.push(e);
    prev = it;
  }
  return evs;
}

// Keep only bars from..to (1-based bar numbers as written; with a pickup, the pickup is bar 0).
function cutSection(events, from, to, beatsPer, hasPickup) {
  const first = hasPickup ? from : from - 1;
  const last = hasPickup ? to : to - 1;
  const lo = first * beatsPer - 1e-6;
  const hi = (last + 1) * beatsPer - 1e-6;
  const keep = events.filter((e) => e.beat >= lo && e.beat < hi);
  const ids = new Set(keep.map((e) => e.id));
  for (const e of keep) {
    e.beat -= first * beatsPer;
    if (e.tiedFrom && !ids.has(e.tiedFrom)) delete e.tiedFrom;
    if (e.tieNext && !ids.has(e.tieNext)) delete e.tieNext;
    if (first > 0) delete e.pickup;
  }
  return keep;
}

function songMeta(s) {
  return {
    id: s.id,
    title: s.title,
    composer: s.composer,
    year: s.year,
    origin: s.origin,
    category: s.category,
    license: s.license,
    source: s.source,
    about: s.about,
    arrangements: s.arrangements.map((a) => {
      const bars = (a.rh || a.lh).replace(/;[^\n]*/g, ' ').split('|').filter((b) => b.trim()).length;
      const key = parseKey(a.key);
      return {
        id: a.id,
        name: a.name,
        level: a.level,
        key: { fifths: key.fifths, mode: key.mode, name: key.name },
        time: a.time,
        bpm: a.bpm,
        pickup: a.pickup || 0,
        measures: bars,
        hands: a.rh && a.lh ? 'both' : a.rh ? 'R' : 'L',
        note: a.note || null,
      };
    }),
  };
}

/**
 * Build a playable Piece from a library arrangement.
 * @param {string} songId
 * @param {string} [arrangementId]  defaults to the song's first (easiest) arrangement
 * @param {object} [opts]
 * @param {number} [opts.bpm]  tempo override (quarter notes per minute)
 * @param {number} [opts.tempoScale]  multiply the arrangement's tempo (e.g. 0.7 to practise slowly)
 * @param {'both'|'R'|'L'} [opts.hands='both']  practise one hand; the other hand's notes are
 *   returned in piece.backing (not graded) so the app can play them
 * @param {number} [opts.from] @param {number} [opts.to]  play only bars from..to
 */
export function songPiece(songId, arrangementId, opts = {}) {
  const song = SONG_MAP.get(songId);
  if (!song) throw new Error(`Unknown song "${songId}"`);
  const arr = arrangementId ? song.arrangements.find((a) => a.id === arrangementId) : song.arrangements[0];
  if (!arr) throw new Error(`Song "${songId}" has no arrangement "${arrangementId}"`);
  const parsed = parseArrangement(song, arr);
  const ts = TIME_SIGS[arr.time];
  const key = parseKey(arr.key);
  const pickup = arr.pickup || 0;
  const want = opts.hands === 'R' ? ['R'] : opts.hands === 'L' ? ['L'] : ['R', 'L'];
  let hands = want.filter((h) => parsed[h]);
  if (!hands.length) hands = ['R', 'L'].filter((h) => parsed[h]);
  const other = ['R', 'L'].filter((h) => parsed[h] && !hands.includes(h));
  let events = [];
  for (const h of hands) events.push(...handEvents(parsed[h], h, ts, pickup));
  let backingEvents = [];
  for (const h of other) backingEvents.push(...handEvents(parsed[h], h, ts, pickup));
  let measures = parsed.bars;
  let from = pickup ? 0 : 1;
  if (opts.from || opts.to) {
    const firstBar = pickup ? 0 : 1;
    const lastBar = pickup ? parsed.bars - 1 : parsed.bars;
    from = Math.max(firstBar, Math.min(lastBar, Math.round(opts.from ?? firstBar)));
    const to = Math.max(from, Math.min(lastBar, Math.round(opts.to ?? lastBar)));
    events = cutSection(events, from, to, ts.beats, !!pickup);
    backingEvents = cutSection(backingEvents, from, to, ts.beats, !!pickup);
    measures = to - from + 1;
  }
  let bpm = opts.bpm || arr.bpm;
  if (opts.tempoScale) bpm *= opts.tempoScale;
  bpm = Math.max(20, Math.min(240, Math.round(bpm)));
  const staves = ['R', 'L'].filter((h) => hands.includes(h)).map((h) => (h === 'R' ? 'treble' : 'bass'));
  const startsWithPickup = pickup > 0 && from === 0;
  const piece = finish({
    kind: 'song',
    songId: song.id,
    arrangementId: arr.id,
    title: song.title,
    subtitle: arr.name,
    composer: song.composer,
    level: arr.level,
    key,
    ts,
    tsName: arr.time,
    bpm,
    measures,
    beatsPer: ts.beats,
    staves,
    events,
    harmony: [],
    fingers: events.some((e) => e.fingers),
    hands: hands.length === 2 ? 'both' : hands[0],
    pickup: startsWithPickup ? pickup : 0,
    startBeat: startsWithPickup ? ts.beats - pickup : 0,
    license: song.license,
  });
  extendTies(piece);
  // The other hand, for accompaniment playback: [{midi, beat, dur, hand}].
  const byId = new Map(backingEvents.map((e) => [e.id, e]));
  piece.backing = [];
  for (const e of backingEvents) {
    if (e.rest || e.tiedFrom) continue;
    let dur = e.dur;
    let t = e;
    while (t.tieNext && byId.get(t.tieNext)) {
      t = byId.get(t.tieNext);
      dur += t.dur;
    }
    for (const m of e.midis) piece.backing.push({ midi: m, beat: e.beat, dur, hand: e.hand });
  }
  return piece;
}

/** One song's metadata (as in SONGS), or null. */
export function getSong(id) {
  return META_MAP.get(id) || null;
}

/**
 * Songs a player at `level` can learn now: each song with at least one arrangement at or below
 * the level, plus `recommended` (the hardest such arrangement) and `next` (the easiest one
 * above the level, if any). Best matches first.
 */
export function songsForLevel(level) {
  const out = [];
  for (const s of SONGS) {
    const ok = s.arrangements.filter((a) => a.level <= level);
    if (!ok.length) continue;
    const recommended = ok.reduce((a, b) => (b.level > a.level ? b : a));
    const next = s.arrangements.filter((a) => a.level > level).sort((a, b) => a.level - b.level)[0] || null;
    out.push({ ...s, recommended, next });
  }
  out.sort((a, b) => level - a.recommended.level - (level - b.recommended.level) || a.title.localeCompare(b.title));
  return out;
}

// ---------------------------------------------------------------------------------------------
// The library

const PD_TRAD = 'Public domain: traditional melody. Arrangement written for Maestro.';
const PD_BY = (who, died) => `Public domain: ${who} died in ${died}. Arrangement written for Maestro.`;
const PD_ED = (who, died) => `Public domain: ${who} died in ${died}. Notes follow a public-domain Mutopia Project edition.`;
const MUTOPIA = (path) => `Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/${path}`;

const LIBRARY = [
  // ---- Kids & folk ------------------------------------------------------------------------
  {
    id: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    composer: 'Traditional (English street cry)',
    year: 1767,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'Street cry recorded in 1733, printed as a round in 1767; melody checked against Wikipedia "Hot Cross Buns (song)".',
    about: 'A street cry once sung by bakers selling spiced buns. Three notes, one hand: the perfect first song.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 1, key: 'C', time: '4/4', bpm: 96,
        note: 'Note values doubled so every note is a whole, half or quarter note.',
        rh: `E4:h/3 D4/2 | C4:w/1 | E4:h/3 D4/2 | C4:w/1 |
             C4:q/1 C4 C4 C4 | D4/2 D4 D4 D4 | E4:h/3 D4/2 | C4:w/1`,
      },
      {
        id: 'lh', name: 'Left hand', level: 3, key: 'C', time: '4/4', bpm: 96,
        lh: `E3:h/3 D3/4 | C3:w/5 | E3:h/3 D3/4 | C3:w/5 |
             C3:q/5 C3 C3 C3 | D3/4 D3 D3 D3 | E3:h/3 D3/4 | C3:w/5`,
      },
      {
        id: 'both', name: 'Both hands', level: 6, key: 'C', time: '4/4', bpm: 96,
        rh: `E4:h/3 D4/2 | C4:w/1 | E4:h/3 D4/2 | C4:w/1 |
             C4:q/1 C4 C4 C4 | D4/2 D4 D4 D4 | E4:h/3 D4/2 | C4:w/1`,
        lh: `C3:w/5 | C3 | C3 | C3 | C3 | G3/1 | C3:h/5 G3/1 | C3:w/5`,
      },
    ],
  },
  {
    id: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional (words: Sarah Josepha Hale)',
    year: 1830,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'Traditional American nursery song (1830).',
    about: 'Four neighbouring notes and a steady beat. Keep your thumb on middle C.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 1, key: 'C', time: '4/4', bpm: 88,
        rh: `E4:q/3 D4/2 C4/1 D4/2 | E4/3 E4 E4:h | D4:q/2 D4 D4:h | E4:q/3 G4/5 G4:h |
             E4:q/3 D4/2 C4/1 D4/2 | E4/3 E4 E4 E4 | D4/2 D4 E4/3 D4/2 | C4:w/1`,
      },
      {
        id: 'both', name: 'Both hands', level: 6, key: 'C', time: '4/4', bpm: 88,
        rh: `E4:q/3 D4/2 C4/1 D4/2 | E4/3 E4 E4:h | D4:q/2 D4 D4:h | E4:q/3 G4/5 G4:h |
             E4:q/3 D4/2 C4/1 D4/2 | E4/3 E4 E4 E4 | D4/2 D4 E4/3 D4/2 | C4:w/1`,
        lh: `C3:w/5 | C3 | G3/1 | C3/5 | C3 | C3 | G3/1 | C3/5`,
      },
    ],
  },
  {
    id: 'twinkle-twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional (French melody; words: Jane Taylor)',
    year: 1761,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'Melody "Ah! vous dirai-je, maman" (1761); checked against Wikipedia.',
    about: 'The tune Mozart wrote twelve variations on. Your pinky stretches up one key for the A.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 2, key: 'C', time: '4/4', bpm: 92,
        rh: `C4:q/1 C4 G4/5 G4 | A4 A4 G4:h | F4:q/4 F4 E4/3 E4 | D4/2 D4 C4:h/1 |
             G4:q/5 G4 F4/4 F4 | E4/3 E4 D4:h/2 | G4:q/5 G4 F4/4 F4 | E4/3 E4 D4:h/2 |
             C4:q/1 C4 G4/5 G4 | A4 A4 G4:h | F4:q/4 F4 E4/3 E4 | D4/2 D4 C4:h/1`,
      },
      {
        id: 'both', name: 'Both hands', level: 6, key: 'C', time: '4/4', bpm: 92,
        rh: `C4:q/1 C4 G4/5 G4 | A4 A4 G4:h | F4:q/4 F4 E4/3 E4 | D4/2 D4 C4:h/1 |
             G4:q/5 G4 F4/4 F4 | E4/3 E4 D4:h/2 | G4:q/5 G4 F4/4 F4 | E4/3 E4 D4:h/2 |
             C4:q/1 C4 G4/5 G4 | A4 A4 G4:h | F4:q/4 F4 E4/3 E4 | D4/2 D4 C4:h/1`,
        lh: `C3:w/5 | F3:h/2 C3/5 | F3/2 C3/5 | G3/1 C3/5 |
             C3/5 G3/1 | C3 G3 | C3 G3 | C3 G3 |
             C3:w/5 | F3:h/2 C3/5 | F3/2 C3/5 | G3/1 C3/5`,
      },
      {
        id: 'chords', name: 'Both hands with chords', level: 14, key: 'C', time: '4/4', bpm: 100,
        rh: `C4:q C4 G4 G4 | A4 A4 G4:h | F4:q F4 E4 E4 | D4 D4 C4:h |
             G4:q G4 F4 F4 | E4 E4 D4:h | G4:q G4 F4 F4 | E4 E4 D4:h |
             C4:q C4 G4 G4 | A4 A4 G4:h | F4:q F4 E4 E4 | D4 D4 C4:h`,
        lh: `[C3 E3 G3]:w | [C3 F3 A3]:h [C3 E3 G3] | [C3 F3 A3] [C3 E3 G3] | [B2 F3 G3] [C3 E3 G3] |
             [C3 E3 G3] [B2 F3 G3] | [C3 E3 G3] [B2 F3 G3] | [C3 E3 G3] [B2 F3 G3] | [C3 E3 G3] [B2 F3 G3] |
             [C3 E3 G3]:w | [C3 F3 A3]:h [C3 E3 G3] | [C3 F3 A3] [C3 E3 G3] | [B2 F3 G3] [C3 E3 G3]`,
      },
    ],
  },
  {
    id: 'lightly-row',
    title: 'Lightly Row',
    composer: 'Traditional (German: "Hänschen klein")',
    year: 1860,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'German folk song, 19th century (words: Franz Wiedemann, 1860).',
    about: 'A happy little tune that fits the five-finger C position exactly.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 2, key: 'C', time: '4/4', bpm: 100,
        rh: `G4:q/5 E4/3 E4:h | F4:q/4 D4/2 D4:h | C4:q/1 D4/2 E4/3 F4/4 | G4/5 G4 G4:h |
             G4:q/5 E4/3 E4:h | F4:q/4 D4/2 D4:h | C4:q/1 E4/3 G4/5 G4 | C4:w/1 |
             D4:q/2 D4 D4 D4 | D4 E4/3 F4:h/4 | E4:q/3 E4 E4 E4 | E4 F4/4 G4:h/5 |
             G4:q/5 E4/3 E4:h | F4:q/4 D4/2 D4:h | C4:q/1 E4/3 G4/5 G4 | C4:w/1`,
      },
      {
        id: 'both', name: 'Both hands', level: 6, key: 'C', time: '4/4', bpm: 100,
        rh: `G4:q/5 E4/3 E4:h | F4:q/4 D4/2 D4:h | C4:q/1 D4/2 E4/3 F4/4 | G4/5 G4 G4:h |
             G4:q/5 E4/3 E4:h | F4:q/4 D4/2 D4:h | C4:q/1 E4/3 G4/5 G4 | C4:w/1 |
             D4:q/2 D4 D4 D4 | D4 E4/3 F4:h/4 | E4:q/3 E4 E4 E4 | E4 F4/4 G4:h/5 |
             G4:q/5 E4/3 E4:h | F4:q/4 D4/2 D4:h | C4:q/1 E4/3 G4/5 G4 | C4:w/1`,
        lh: `C3:w/5 | G3/1 | C3/5 | C3 | C3 | G3/1 | C3:h/5 G3/1 | C3:w/5 |
             G3/1 | G3 | C3/5 | C3 | C3 | G3/1 | C3:h/5 G3/1 | C3:w/5`,
      },
    ],
  },
  {
    id: 'alle-meine-entchen',
    title: 'All My Little Ducklings',
    composer: 'Traditional (German: "Alle meine Entchen")',
    year: 1850,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'German children\'s song, 19th century; checked against German Wikipedia.',
    about: 'The first song many German children learn: walk up five notes, then peek up to A.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 2, key: 'C', time: '4/4', bpm: 92,
        note: 'Note values doubled so every note is a whole, half or quarter note.',
        rh: `C4:q/1 D4/2 E4/3 F4/4 | G4:h/5 G4 | A4:q A4 A4 A4 | G4:w/5 | A4:q A4 A4 A4 | G4:w/5 |
             F4:q/4 F4 F4 F4 | E4:h/3 E4 | D4:q/2 D4 D4 D4 | C4:w/1`,
      },
      {
        id: 'both', name: 'Both hands', level: 6, key: 'C', time: '4/4', bpm: 92,
        rh: `C4:q/1 D4/2 E4/3 F4/4 | G4:h/5 G4 | A4:q A4 A4 A4 | G4:w/5 | A4:q A4 A4 A4 | G4:w/5 |
             F4:q/4 F4 F4 F4 | E4:h/3 E4 | D4:q/2 D4 D4 D4 | C4:w/1`,
        lh: `C3:w/5 | C3 | F3/2 | C3/5 | F3/2 | C3/5 | G3/1 | C3/5 | G3/1 | C3/5`,
      },
    ],
  },
  {
    id: 'happy-birthday',
    title: 'Happy Birthday to You',
    composer: 'Mildred J. Hill (melody of "Good Morning to All")',
    year: 1893,
    origin: 'traditional',
    category: 'Kids & folk',
    license: 'Public domain: the melody was published in 1893; a US court ruling (2016) and EU copyright expiry (2017) freed the song. Arrangement written for Maestro.',
    source: 'Melody checked against the score on Wikipedia "Happy Birthday to You".',
    about: 'Everyone\'s favourite request. It starts with two quick pickup notes before the first bar.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 9, key: 'G', time: '3/4', bpm: 100, pickup: 1,
        note: 'The pickup "Hap-py" is written as two even eighth notes.',
        rh: `D4:8 D4 | E4:q D4 G4 | F#4:h D4:8 D4 | E4:q D4 A4 | G4:h D4:8 D4 |
             D5:q B4 G4 | F#4 E4 C5:8 C5 | B4:q G4 A4 | G4:h.`,
      },
      {
        id: 'both', name: 'Both hands', level: 15, key: 'G', time: '3/4', bpm: 100, pickup: 1,
        rh: `D4:8. D4:16 | E4:q D4 G4 | F#4:h D4:8. D4:16 | E4:q D4 A4 | G4:h D4:8. D4:16 |
             D5:q B4 G4 | F#4 E4 C5:8. C5:16 | B4:q G4 A4 | G4:h.`,
        lh: `r:q | [B2 D3 G3]:h. | [A2 C3 F#3] | [A2 C3 F#3] | [B2 D3 G3] |
             [B2 F3 G3] | [C3 E3 G3] | [B2 D3 G3]:q [A2 C3 F#3]:h | [B2 D3 G3]:h.`,
      },
    ],
  },
  {
    id: 'london-bridge',
    title: 'London Bridge Is Falling Down',
    composer: 'Traditional (English)',
    year: 1744,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'Traditional nursery rhyme; melody checked against Wikipedia.',
    about: 'A singing game from the 1700s. The easy version keeps every note a quarter or longer.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 2, key: 'C', time: '4/4', bpm: 100,
        note: 'The dotted rhythm of the first bar is smoothed into even quarter notes.',
        rh: `G4:q/5 A4 G4/5 F4/4 | E4/3 F4/4 G4:h/5 | D4:q/2 E4/3 F4:h/4 | E4:q/3 F4/4 G4:h/5 |
             G4:q/5 A4 G4/5 F4/4 | E4/3 F4/4 G4:h/5 | D4:h/2 G4/5 | E4:q/3 C4:h./1`,
      },
      {
        id: 'both', name: 'Both hands', level: 12, key: 'C', time: '4/4', bpm: 100,
        rh: `G4:q. A4:8 G4:q F4 | E4 F4 G4:h | D4:q E4 F4:h | E4:q F4 G4:h |
             G4:q. A4:8 G4:q F4 | E4 F4 G4:h | D4:h G4 | E4:q C4:h.`,
        lh: `[C3 G3]:w | % | [G2 D3] | [C3 G3] | % | % | [G2 D3] | [C3 G3]`,
      },
    ],
  },
  {
    id: 'au-clair-de-la-lune',
    title: 'Au clair de la lune',
    composer: 'Traditional (French)',
    year: 1780,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'Traditional French song, 18th century.',
    about: 'By the light of the moon: the right hand sings, then the left hand answers in the middle.',
    arrangements: [
      {
        id: 'turns', name: 'Hands take turns', level: 4, key: 'C', time: '4/4', bpm: 88,
        rh: `C4:q/1 C4 C4 D4/2 | E4:h/3 D4/2 | C4:q/1 E4/3 D4/2 D4 | C4:w/1 |
             C4:q/1 C4 C4 D4/2 | E4:h/3 D4/2 | C4:q/1 E4/3 D4/2 D4 | C4:w/1 |
             R | R | R | R |
             C4:q/1 C4 C4 D4/2 | E4:h/3 D4/2 | C4:q/1 E4/3 D4/2 D4 | C4:w/1`,
        lh: `R | R | R | R | R | R | R | R |
             D4:q/1 D4 D4 D4 | A3:h/4 A3 | D4:q/1 C4/2 B3/3 A3/4 | G3:w/5 |
             R | R | R | R`,
      },
    ],
  },
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    composer: 'Traditional (French)',
    year: 1780,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'Traditional round; checked against Wikipedia.',
    about: 'Are you sleeping, Brother John? Learn the tune, then play it as a round against yourself.',
    arrangements: [
      {
        id: 'turns', name: 'Hands take turns', level: 7, key: 'C', time: '4/4', bpm: 96,
        note: 'The right hand plays the tune; the left hand answers "ding, dang, dong" below middle C.',
        rh: `C4:q/1 D4/2 E4/3 C4/1 | C4/1 D4/2 E4/3 C4/1 | E4/3 F4/4 G4:h/5 | E4:q/3 F4/4 G4:h/5 |
             G4:8/5 A4 G4/5 F4/4 E4:q/3 C4/1 | G4:8/5 A4 G4/5 F4/4 E4:q/3 C4/1 | R | R`,
        lh: `R | R | R | R | R | R | C4:q/1 G3/5 C4:h/1 | C4:q/1 G3/5 C4:h/1`,
      },
      {
        id: 'rh', name: 'Right hand', level: 11, key: 'F', time: '4/4', bpm: 100,
        rh: `F4:q/1 G4/2 A4/3 F4/1 | F4/1 G4/2 A4/3 F4/1 | A4/3 Bb4/4 C5:h/5 | A4:q/3 Bb4/4 C5:h/5 |
             C5:8 D5 C5 Bb4 A4:q F4 | C5:8 D5 C5 Bb4 A4:q F4 | F4 C4 F4:h | F4:q C4 F4:h`,
      },
      {
        id: 'round', name: 'Round for two hands', level: 24, key: 'F', time: '4/4', bpm: 100,
        note: 'The left hand starts the same tune two bars later, an octave lower.',
        rh: `F4:q G4 A4 F4 | F4 G4 A4 F4 | A4 Bb4 C5:h | A4:q Bb4 C5:h |
             C5:8 D5 C5 Bb4 A4:q F4 | C5:8 D5 C5 Bb4 A4:q F4 | F4 C4 F4:h | F4:q C4 F4:h | R | R`,
        lh: `R | R | F3:q G3 A3 F3 | F3 G3 A3 F3 | A3 Bb3 C4:h | A3:q Bb3 C4:h |
             C4:8 D4 C4 Bb3 A3:q F3 | C4:8 D4 C4 Bb3 A3:q F3 | F3 C3 F3:h | F3:q C3 F3:h`,
      },
    ],
  },
  {
    id: 'row-your-boat',
    title: 'Row, Row, Row Your Boat',
    composer: 'Traditional (tune published by Eliphalet Oram Lyte)',
    year: 1881,
    origin: 'traditional',
    category: 'Kids & folk',
    license: PD_TRAD,
    source: 'Words printed 1852, today\'s tune published 1881 (Lyte died 1913); checked against Wikipedia.',
    about: 'A gentle rowing song in 6/8: feel two big beats in every bar.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 12, key: 'C', time: '6/8', bpm: 96,
        rh: `C4:q./1 C4 | C4:q/1 D4:8/2 E4:q./3 | E4:q/3 D4:8/2 E4:q/3 F4:8/4 | G4:h./5 |
             C5:8 C5 C5 G4 G4 G4 | E4 E4 E4 C4 C4 C4 | G4:q/5 F4:8/4 E4:q/3 D4:8/2 | C4:h./1`,
      },
      {
        id: 'both', name: 'Both hands', level: 13, key: 'C', time: '6/8', bpm: 96,
        rh: `C4:q. C4 | C4:q D4:8 E4:q. | E4:q D4:8 E4:q F4:8 | G4:h. |
             C5:8 C5 C5 G4 G4 G4 | E4 E4 E4 C4 C4 C4 | G4:q F4:8 E4:q D4:8 | C4:h.`,
        lh: `C3:h./5 | % | % | % | % | % | G3/1 | C3/5`,
      },
    ],
  },

  // ---- Holiday -----------------------------------------------------------------------------
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    composer: 'James Lord Pierpont (chorus as sung since the 1890s)',
    year: 1857,
    origin: 'traditional',
    category: 'Holiday',
    license: 'Public domain: Pierpont died in 1893, and the modern chorus dates from before 1898. Arrangement written for Maestro.',
    source: '"The One Horse Open Sleigh" (1857); today\'s simpler chorus is anonymous and was recorded by 1898 (Wikipedia).',
    about: 'The whole chorus sits under five fingers in C position.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 2, key: 'C', time: '4/4', bpm: 104,
        note: 'Eighth notes and dotted notes are smoothed into quarter notes.',
        rh: `E4:q/3 E4 E4:h | E4:q E4 E4:h | E4:q/3 G4/5 C4/1 D4/2 | E4:w/3 |
             F4:q/4 F4 F4 F4 | F4 E4/3 E4 E4 | E4 D4/2 D4 E4/3 | D4:h/2 G4/5 |
             E4:q/3 E4 E4:h | E4:q E4 E4:h | E4:q/3 G4/5 C4/1 D4/2 | E4:w/3 |
             F4:q/4 F4 F4 F4 | F4 E4/3 E4 E4 | G4/5 G4 F4/4 D4/2 | C4:w/1`,
      },
      {
        id: 'both', name: 'Both hands', level: 12, key: 'C', time: '4/4', bpm: 112,
        rh: `E4:q E4 E4:h | E4:q E4 E4:h | E4:q G4 C4:q. D4:8 | E4:w |
             F4:q F4 F4:q. F4:8 | F4:q E4 E4 E4:8 E4 | E4:q D4 D4 E4 | D4:h G4 |
             E4:q E4 E4:h | E4:q E4 E4:h | E4:q G4 C4:q. D4:8 | E4:w |
             F4:q F4 F4:q. F4:8 | F4:q E4 E4 E4:8 E4 | G4:q G4 F4 D4 | C4:w`,
        lh: `[C3 G3]:w | % | % | % | [F2 C3] | [C3 G3] | [D3 A3] | [G2 D3] |
             [C3 G3] | % | % | % | [F2 C3] | [C3 G3] | [G2 D3] | [C3 G3]`,
      },
    ],
  },
  {
    id: 'silent-night',
    title: 'Silent Night',
    composer: 'Franz Xaver Gruber',
    year: 1818,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_BY('Franz Xaver Gruber', 1863),
    source: 'Melody as usually sung today; checked against Wikipedia and the Mutopia Project hymn tune.',
    about: 'First sung on Christmas Eve 1818 in Oberndorf, Austria. A slow, rocking 6/8.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 14, key: 'C', time: '6/8', bpm: 76,
        rh: `G4:8. A4:16 G4:8 E4:q. | G4:8. A4:16 G4:8 E4:q. | D5:q D5:8 B4:q. | C5:q C5:8 G4:q. |
             A4:q A4:8 C5:8. B4:16 A4:8 | G4:8. A4:16 G4:8 E4:q. | A4:q A4:8 C5:8. B4:16 A4:8 | G4:8. A4:16 G4:8 E4:q. |
             D5:q D5:8 F5:8. D5:16 B4:8 | C5:q. E5:q r:8 | C5:8. G4:16 E4:8 G4:8. F4:16 D4:8 | C4:h.`,
      },
      {
        id: 'both', name: 'Both hands', level: 17, key: 'C', time: '6/8', bpm: 76,
        rh: `G4:8. A4:16 G4:8 E4:q. | G4:8. A4:16 G4:8 E4:q. | D5:q D5:8 B4:q. | C5:q C5:8 G4:q. |
             A4:q A4:8 C5:8. B4:16 A4:8 | G4:8. A4:16 G4:8 E4:q. | A4:q A4:8 C5:8. B4:16 A4:8 | G4:8. A4:16 G4:8 E4:q. |
             D5:q D5:8 F5:8. D5:16 B4:8 | C5:q. E5:q r:8 | C5:8. G4:16 E4:8 G4:8. F4:16 D4:8 | C4:h.`,
        lh: `C3:q. G3 | C3 G3 | G2 F3 | C3 G3 | F2 C3 | C3 G3 | F2 C3 | C3 G3 |
             G2 F3 | C3 G3 | C3 G2 | C3:h.`,
      },
    ],
  },
  {
    id: 'joy-to-the-world',
    title: 'Joy to the World',
    composer: 'Lowell Mason (after Handel)',
    year: 1839,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_BY('Lowell Mason', 1872),
    source: 'Tune "Antioch", The Modern Psalmist (1839); checked against Wikipedia and Mutopia.',
    about: 'It opens with a whole D major scale walking down: a great scale workout in disguise.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 16, key: 'D', time: '2/4', bpm: 84,
        rh: `D5:q C#5:8. B4:16 | A4:q. G4:8 | F#4:q E4 | D4:q. A4:8 | B4:q. B4:8 | C#5:q. C#5:8 | D5:h~ | D5:q. D5:8 |
             D5:8 C#5 B4 A4 | A4:8. G4:16 F#4:8 D5:8 | D5:8 C#5 B4 A4 | A4:8. G4:16 F#4:8 F#4:8 |
             F#4:8 F#4 F#4 F#4:16 G4 | A4:q. G4:16 F#4 | E4:8 E4 E4 E4:16 F#4 | G4:q. F#4:16 E4 |
             F#4:8 D5:q B4:8 | A4:8. G4:16 F#4:8 G4 | F#4:q E4 | D4:h`,
      },
      {
        id: 'both', name: 'Both hands', level: 19, key: 'D', time: '2/4', bpm: 84,
        rh: `D5:q C#5:8. B4:16 | A4:q. G4:8 | F#4:q E4 | D4:q. A4:8 | B4:q. B4:8 | C#5:q. C#5:8 | D5:h~ | D5:q. D5:8 |
             D5:8 C#5 B4 A4 | A4:8. G4:16 F#4:8 D5:8 | D5:8 C#5 B4 A4 | A4:8. G4:16 F#4:8 F#4:8 |
             F#4:8 F#4 F#4 F#4:16 G4 | A4:q. G4:16 F#4 | E4:8 E4 E4 E4:16 F#4 | G4:q. F#4:16 E4 |
             F#4:8 D5:q B4:8 | A4:8. G4:16 F#4:8 G4 | F#4:q E4 | D4:h`,
        lh: `D3:h | D3 | D3:q A2 | D3:h | G2 | A2 | D3 | D3 |
             D3 | D3 | D3 | D3 | D3 | D3 | A2 | A2 |
             D3:q G2 | A2:h | A2 | D3`,
      },
    ],
  },
  {
    id: 'god-rest-ye-merry-gentlemen',
    title: 'God Rest Ye Merry, Gentlemen',
    composer: 'Traditional (English)',
    year: 1827,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_TRAD,
    source: 'Traditional carol; melody and bass line checked against the SATB setting on Wikipedia.',
    about: 'A minor-key carol with a strong walking bass line.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 15, key: 'Em', time: '4/4', bpm: 100, pickup: 1,
        rh: `E4:q | E4 B4 B4 A4 | G4 F#4 E4 D4 | E4 F#4 G4 A4 | B4:h. E4:q |
             E4 B4 B4 A4 | G4 F#4 E4 D4 | E4 F#4 G4 A4 | B4:h. B4:q |
             C5 A4 B4 C5 | D5 E5 B4 A4 | G4 E4 F#4 G4 | A4:h G4:q A4 |
             B4:h C5:q B4 | B4 A4 G4 F#4 | E4:h G4:8 F#4 E4:q | A4:h G4:q A4 |
             B4 C5 D5 E5 | B4 A4 G4 F#4 | E4:h. r:q`,
      },
      {
        id: 'both', name: 'Both hands', level: 17, key: 'Em', time: '4/4', bpm: 100, pickup: 1,
        rh: `E4:q | E4 B4 B4 A4 | G4 F#4 E4 D4 | E4 F#4 G4 A4 | B4:h. E4:q |
             E4 B4 B4 A4 | G4 F#4 E4 D4 | E4 F#4 G4 A4 | B4:h. B4:q |
             C5 A4 B4 C5 | D5 E5 B4 A4 | G4 E4 F#4 G4 | A4:h G4:q A4 |
             B4:h C5:q B4 | B4 A4 G4 F#4 | E4:h G4:8 F#4 E4:q | A4:h G4:q A4 |
             B4 C5 D5 E5 | B4 A4 G4 F#4 | E4:h. r:q`,
        lh: `r:q | E3 E3 D#3 B2 | E3 B2 C3 G2 | C3 B2 E3 C3 | B2:h. E3:q |
             E3 E3 D#3 B2 | E3 B2 C3 G2 | C3 B2 E3 C3 | B2:h. E3:q |
             A3 F#3 G3 C3 | B2 C3 G2 B2 | E3 E3 D3 B2 | D3:h E3:q F#3 |
             G3:h C3:q G3 | G2 A2 B2 B2 | E3:h E3:8 E3 E3:q | D3 C3 B2 A2 |
             G2 E3 B2 C3 | G2 A2 B2 B2 | E3:h. r:q`,
      },
    ],
  },
  {
    id: 'away-in-a-manger',
    title: 'Away in a Manger',
    composer: 'James R. Murray',
    year: 1887,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_BY('James R. Murray', 1905),
    source: 'Tune "Mueller" (1887); checked against Wikipedia.',
    about: 'A lullaby carol in F major: every B is B flat.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 11, key: 'F', time: '3/4', bpm: 96, pickup: 1,
        rh: `C5:q | C5:q. Bb4:8 A4:q | A4:q. G4:8 F4:q | F4:q E4 D4 | C4:h C4:q |
             C4:q. D4:8 C4:q | C4:q G4 E4 | D4 C4 F4 | A4:h C5:q |
             C5:q. Bb4:8 A4:q | A4:q. G4:8 F4:q | F4:q E4 D4 | C4:h C4:q |
             Bb4:q. A4:8 G4:q | A4:q G4 F4 | G4 D4 E4 | F4:h r:q`,
      },
      {
        id: 'both', name: 'Both hands', level: 12, key: 'F', time: '3/4', bpm: 96, pickup: 1,
        rh: `C5:q | C5:q. Bb4:8 A4:q | A4:q. G4:8 F4:q | F4:q E4 D4 | C4:h C4:q |
             C4:q. D4:8 C4:q | C4:q G4 E4 | D4 C4 F4 | A4:h C5:q |
             C5:q. Bb4:8 A4:q | A4:q. G4:8 F4:q | F4:q E4 D4 | C4:h C4:q |
             Bb4:q. A4:8 G4:q | A4:q G4 F4 | G4 D4 E4 | F4:h r:q`,
        lh: `r:q | [F2 C3]:h. | % | [Bb2 F3]:q [C3 G3] [D3 A3] | [F2 C3]:h. | % | [C3 G3] | % | [F2 C3] |
             % | % | [Bb2 F3]:q [C3 G3] [D3 A3] | [F2 C3]:h. | [Bb2 F3] | [F2 C3] | [C3 G3] | [F2 C3]:h r:q`,
      },
    ],
  },
  {
    id: 'the-first-noel',
    title: 'The First Noel',
    composer: 'Traditional (English)',
    year: 1833,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_TRAD,
    source: MUTOPIA('Traditional/first_noel/first_noel.ly') + ' (melody and bass line).',
    about: 'A Cornish carol first printed in 1823 and 1833. The bass line comes from the hymnal setting.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 13, key: 'D', time: '3/4', bpm: 100, pickup: 1,
        rh: `F#4:8 E4 | D4:q. E4:8 F#4 G4 | A4:h B4:8 C#5 | D5:q C#5 B4 | A4:h B4:8 C#5 |
             D5:q C#5 B4 | A4 B4 C#5 | D5 A4 G4 | F#4:h F#4:8 E4 |
             D4:q. E4:8 F#4 G4 | A4:h B4:8 C#5 | D5:q C#5 B4 | A4:h B4:8 C#5 |
             D5:q C#5 B4 | A4 B4 C#5 | D5 A4 G4 | F#4:h F#4:8 E4 |
             D4:q. E4:8 F#4 G4 | A4:h D5:8 C#5 | B4:h B4:q | A4:h A4:q |
             D5 C#5 B4 | A4 B4 C#5 | D5 A4 G4 | F#4:h r:q`,
      },
      {
        id: 'both', name: 'Both hands', level: 15, key: 'D', time: '3/4', bpm: 100, pickup: 1,
        rh: `F#4:8 E4 | D4:q. E4:8 F#4 G4 | A4:h B4:8 C#5 | D5:q C#5 B4 | A4:h B4:8 C#5 |
             D5:q C#5 B4 | A4 B4 C#5 | D5 A4 G4 | F#4:h F#4:8 E4 |
             D4:q. E4:8 F#4 G4 | A4:h B4:8 C#5 | D5:q C#5 B4 | A4:h B4:8 C#5 |
             D5:q C#5 B4 | A4 B4 C#5 | D5 A4 G4 | F#4:h F#4:8 E4 |
             D4:q. E4:8 F#4 G4 | A4:h D5:8 C#5 | B4:h B4:q | A4:h A4:q |
             D5 C#5 B4 | A4 B4 C#5 | D5 A4 G4 | F#4:h r:q`,
        lh: `D3:q | D3:h B2:q | A2 A3 G3 | F#3 F#3 G3 | D3:h G3:8 G3 |
             F#3:q D3 E3 | F#3 G3 E3 | F#3:8 G3 A3:q A3 | D3:h A2:q |
             D3:h B2:8 B2 | A2:q A3 G3 | F#3 F#3 G3 | D3:h G3:8 G3 |
             F#3:q D3 E3 | F#3 G3 E3 | F#3:8 G3 A3:q A2 | D3:h A2:q |
             D3:h B2:q | F#3:h D3:q | G3:q. A3:8 B3 C#4 | D4:h C#4:q |
             B3 A3 G3 | D4 D3 E3 | F#3:8 G3 A3:q A2 | D3:h r:q`,
      },
    ],
  },
  {
    id: 'o-come-all-ye-faithful',
    title: 'O Come, All Ye Faithful',
    composer: 'John Francis Wade',
    year: 1751,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_BY('John Francis Wade', 1786),
    source: MUTOPIA('WadeJF/adeste_fideles/adeste_fideles.ly') + ' (melody and bass line).',
    about: 'Adeste Fideles. The chorus climbs three times, each time a little higher.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 12, key: 'G', time: '4/4', bpm: 96, pickup: 1,
        rh: `G4:q | G4:h D4:q G4 | A4:h D4 | B4:q A4 B4 C5 | B4:h A4:q G4 |
             G4:h F#4:q E4 | F#4 G4 A4 B4 | F#4:h E4:q. D4:8 | D4:w |
             D5:h C5:q B4 | C5:h B4 | A4:q B4 G4 A4 | F#4:q. E4:8 D4:q B4 |
             B4 A4 B4 C5 | B4:h A4:q B4 | B4 A4 B4 C5 | B4:h A4:q B4 |
             C5 B4 A4 G4 | F#4:h G4:q C5 | B4:h A4:q. G4:8 | G4:h. r:q`,
      },
      {
        id: 'both', name: 'Both hands', level: 15, key: 'G', time: '4/4', bpm: 96, pickup: 1,
        rh: `G4:q | G4:h D4:q G4 | A4:h D4 | B4:q A4 B4 C5 | B4:h A4:q G4 |
             G4:h F#4:q E4 | F#4 G4 A4 B4 | F#4:h E4:q. D4:8 | D4:w |
             D5:h C5:q B4 | C5:h B4 | A4:q B4 G4 A4 | F#4:q. E4:8 D4:q B4 |
             B4 A4 B4 C5 | B4:h A4:q B4 | B4 A4 B4 C5 | B4:h A4:q B4 |
             C5 B4 A4 G4 | F#4:h G4:q C5 | B4:h A4:q. G4:8 | G4:h. r:q`,
        lh: `G3:q | G3:h B3:q G3 | F#3:h F#3 | G3:q F#3 G3 C3 | D3:h D3:q E3 |
             E3:h D3:q A2 | D3 B2 F#2 G2 | A2:h A2:q. D3:8 | D3:w |
             B3:h A3:q G3 | A3:h G3 | F#3:q G3 E3 C3 | D3:h D3:q r |
             G2:w | G3:h D3:q G3 | G3 F#3 G3 A3 | G3:h F#3:q G3 |
             A3 G3 F#3 E3 | D3 C3 B2 C3 | D3:h D3:q. G2:8 | G2:h. r:q`,
      },
    ],
  },
  {
    id: 'good-king-wenceslas',
    title: 'Good King Wenceslas',
    composer: 'Traditional (Piae Cantiones)',
    year: 1582,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_TRAD,
    source: MUTOPIA('Anonymous/GoodKingWenceslas/GoodKingWenceslas.ly') + ' (melody; moved to G major).',
    about: 'The tune "Tempus adest floridum" from 1582, with words by J. M. Neale (1853).',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 8, key: 'G', time: '4/4', bpm: 108,
        rh: `G4:q G4 G4 A4 | G4 G4 D4:h | E4:q D4 E4 F#4 | G4:h G4 |
             G4:q G4 G4 A4 | G4 G4 D4:h | E4:q D4 E4 F#4 | G4:h G4 |
             D5:q C5 B4 A4 | B4 A4 G4:h | E4:q D4 E4 F#4 | G4:h G4 |
             D4:q D4 E4 F#4 | G4 G4 A4:h | D5:q C5 B4 A4 | G4:h C5 | G4:w`,
      },
      {
        id: 'both', name: 'Both hands', level: 12, key: 'G', time: '4/4', bpm: 108,
        rh: `G4:q G4 G4 A4 | G4 G4 D4:h | E4:q D4 E4 F#4 | G4:h G4 |
             G4:q G4 G4 A4 | G4 G4 D4:h | E4:q D4 E4 F#4 | G4:h G4 |
             D5:q C5 B4 A4 | B4 A4 G4:h | E4:q D4 E4 F#4 | G4:h G4 |
             D4:q D4 E4 F#4 | G4 G4 A4:h | D5:q C5 B4 A4 | G4:h C5 | G4:w`,
        lh: `G3:q G3 E3 F#3 | G3 C3 D3:h | C3:q B2 C3 A2 | G2:h G2 |
             G3:q G3 E3 F#3 | G3 C3 D3:h | C3:q B2 C3 A2 | G2:h G2 |
             B2:q C3 D3 D3 | G3 D3 E3:h | C3:q B2 C3 A2 | G2:h G2 |
             B2:q B2 C3 A2 | E3 E3 D3:h | B2:q C3 D3 D3 | E3:h C3 | G2:w`,
      },
    ],
  },
  {
    id: 'auld-lang-syne',
    title: 'Auld Lang Syne',
    composer: 'Traditional (Scottish; words: Robert Burns)',
    year: 1788,
    origin: 'traditional',
    category: 'Holiday',
    license: PD_TRAD,
    source: 'Traditional Scottish melody (printed 1799); checked against Wikipedia.',
    about: 'The New Year song. Long-short dotted rhythms all the way through.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 12, key: 'F', time: '4/4', bpm: 88, pickup: 1,
        rh: `C4:q | F4:q. F4:8 F4:q A4 | G4:q. F4:8 G4:q A4 | F4:q. F4:8 A4:q C5 | D5:h. D5:q |
             C5:q. A4:8 A4:q F4 | G4:q. F4:8 G4:q A4 | F4:q. D4:8 D4:q C4 | F4:h. D5:q |
             C5:q. A4:8 A4:q F4 | G4:q. F4:8 G4:q D5 | C5:q. A4:8 A4:q C5 | D5:h. D5:q |
             C5:q. A4:8 A4:q F4 | G4:q. F4:8 G4:q A4 | F4:q. D4:8 D4:q C4 | F4:h. r:q`,
      },
      {
        id: 'both', name: 'Both hands', level: 14, key: 'F', time: '4/4', bpm: 88, pickup: 1,
        rh: `C4:q | F4:q. F4:8 F4:q A4 | G4:q. F4:8 G4:q A4 | F4:q. F4:8 A4:q C5 | D5:h. D5:q |
             C5:q. A4:8 A4:q F4 | G4:q. F4:8 G4:q A4 | F4:q. D4:8 D4:q C4 | F4:h. D5:q |
             C5:q. A4:8 A4:q F4 | G4:q. F4:8 G4:q D5 | C5:q. A4:8 A4:q C5 | D5:h. D5:q |
             C5:q. A4:8 A4:q F4 | G4:q. F4:8 G4:q A4 | F4:q. D4:8 D4:q C4 | F4:h. r:q`,
        lh: `r:q | [F3 A3 C4]:w | [E3 G3 C4] | [F3 A3 C4] | [F3 Bb3 D4] |
             [F3 A3 C4] | [E3 G3 C4] | [F3 Bb3 D4]:h [E3 G3 C4] | [F3 A3 C4]:w |
             [F3 A3 C4] | [E3 G3 C4] | [F3 A3 C4] | [F3 Bb3 D4] |
             [F3 A3 C4] | [E3 G3 C4] | [F3 Bb3 D4]:h [E3 G3 C4] | [F3 A3 C4]:h. r:q`,
      },
    ],
  },

  // ---- Hymns & ballads ------------------------------------------------------------------------
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    composer: 'Traditional (tune "New Britain"; words: John Newton)',
    year: 1831,
    origin: 'hymn',
    category: 'Hymns & ballads',
    license: PD_TRAD,
    source: MUTOPIA('Anonymous/new_britain/new_britain.ly') + ' (melody and bass line).',
    about: 'The most famous American hymn tune, in a slow 3/4.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 9, key: 'G', time: '3/4', bpm: 80, pickup: 1,
        rh: `D4:q | G4:h B4:8 G4 | B4:h A4:q | G4:h E4:q | D4:h D4:q |
             G4:h B4:8 G4 | B4:h A4:q | D5:h. | B4:q D5:q. B4:8 |
             D5:8 B4 G4:h | D4:q E4:q. G4:8 | G4:8 E4 D4:h | D4:q G4:h |
             B4:8 G4 B4:h | A4:q G4:h | G4:h r:q`,
      },
      {
        id: 'both', name: 'Both hands', level: 12, key: 'G', time: '3/4', bpm: 80, pickup: 1,
        rh: `D4:q | G4:h B4:8 G4 | B4:h A4:q | G4:h E4:q | D4:h D4:q |
             G4:h B4:8 G4 | B4:h A4:q | D5:h. | B4:q D5:q. B4:8 |
             D5:8 B4 G4:h | D4:q E4:q. G4:8 | G4:8 E4 D4:h | D4:q G4:h |
             B4:8 G4 B4:h | A4:q G4:h | G4:h r:q`,
        lh: `G2:q | G2:h G2:8 B2 | D3:h D3:q | E3:h C3:q | G2:h G2:q |
             G2:h G2:8 B2 | D3:h C3:q | B2:h. | G2:q G3:h |
             G3:q B2:h | B2:q C3:q. B2:8 | C3:q G2:h | B2:q E3:h |
             D3:q D3:h | D3:q G2:h | G2:h r:q`,
      },
    ],
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional (English)',
    year: 1580,
    origin: 'traditional',
    category: 'Hymns & ballads',
    license: PD_TRAD,
    source: MUTOPIA('Traditional/GreensleevesAcc/GreensleevesAcc.ly') + ' (melody and bass pattern).',
    about: 'An Elizabethan ballad in A minor. The left hand plays a waltz: bass, chord, chord.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 13, key: 'Am', time: '3/4', bpm: 120, pickup: 1,
        rh: `A4:q | C5:h D5:q | E5:q. F5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:h A4:q | A4:q. G#4:8 A4:q | B4:h G#4:q | E4:h A4:q |
             C5:h D5:q | E5:q. F5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:q. B4:8 A4:q | G#4:q. F#4:8 G#4:q | A4:h.~ | A4:h. |
             G5:h. | G5:q. F#5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:h A4:q | A4:q. G#4:8 A4:q | B4:h G#4:q | E4:h. |
             G5:h. | G5:q. F#5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:q. B4:8 A4:q | G#4:q. F#4:8 G#4:q | A4:h.~ | A4:h.`,
      },
      {
        id: 'both', name: 'Both hands', level: 16, key: 'Am', time: '3/4', bpm: 120, pickup: 1,
        rh: `A4:q | C5:h D5:q | E5:q. F5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:h A4:q | A4:q. G#4:8 A4:q | B4:h G#4:q | E4:h A4:q |
             C5:h D5:q | E5:q. F5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:q. B4:8 A4:q | G#4:q. F#4:8 G#4:q | A4:h.~ | A4:h. |
             G5:h. | G5:q. F#5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:h A4:q | A4:q. G#4:8 A4:q | B4:h G#4:q | E4:h. |
             G5:h. | G5:q. F#5:8 E5:q | D5:h B4:q | G4:q. A4:8 B4:q |
             C5:q. B4:8 A4:q | G#4:q. F#4:8 G#4:q | A4:h.~ | A4:h.`,
        lh: `r:q | A2:q [E3 A3 C4] [E3 A3 C4] | E2 [E3 A3 C4] [E3 A3 C4] | G2 [G3 B3 D4] [G3 B3 D4] | D3 [G3 B3 D4] [G3 B3 D4] |
             F2 [F3 A3 C4] [F3 A3 C4] | C3 [F3 A3 C4] [F3 A3 C4] | E2 [E3 G#3 B3] [E3 G#3 B3] | B2 [E3 G#3 B3] [E3 G#3 B3] |
             A2 [E3 A3 C4] [E3 A3 C4] | E2 [E3 A3 C4] [E3 A3 C4] | G2 [G3 B3 D4] [G3 B3 D4] | D3 [G3 B3 D4] [G3 B3 D4] |
             F2 [F3 A3 C4] [F3 A3 C4] | E2 [E3 G#3 D4] [E3 G#3 D4] | A2 [E3 A3 C4] [E3 A3 C4] | [A2 E3 A3]:h. |
             C3:q [E3 G3 C4] [E3 G3 C4] | G2 [E3 G3 C4] [E3 G3 C4] | D3 [G3 B3 D4] [G3 B3 D4] | G2 [G3 B3 D4] [G3 B3 D4] |
             F2 [F3 A3 C4] [F3 A3 C4] | C3 [F3 A3 C4] [F3 A3 C4] | E2 [E3 G#3 D4] [E3 G#3 D4] | B2 [E3 G#3 D4] [E3 G#3 D4] |
             C3 [E3 G3 C4] [E3 G3 C4] | G2 [E3 G3 C4] [E3 G3 C4] | D3 [G3 B3 D4] [G3 B3 D4] | G2 [G3 B3 D4] [G3 B3 D4] |
             F2 [F3 A3 C4] [F3 A3 C4] | E2 [E3 G#3 D4] [E3 G#3 D4] | A2 [E3 A3 C4] [E3 A3 C4] | [A2 E3 A3]:h.`,
      },
    ],
  },
  {
    id: 'old-hundredth',
    title: 'Old Hundredth',
    composer: 'Louis Bourgeois (Genevan Psalter)',
    year: 1551,
    origin: 'hymn',
    category: 'Hymns & ballads',
    license: PD_BY('Louis Bourgeois', 1560),
    source: MUTOPIA('Anonymous/Old100-orig/Old100-orig.ly') + ' (melody in its original rhythm).',
    about: 'The Doxology, "Praise God from whom all blessings flow": each line starts and ends on a long note.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 8, key: 'G', time: '4/4', bpm: 92, pickup: 2,
        rh: `G4:h | G4:q F#4 E4 D4 | G4:h A4 | B4:h B4 | B4:q B4 A4 G4 | C5:h B4 | A4:h G4 |
             A4:q B4 A4 G4 | E4:h F#4 | G4:h D5 | B4:q G4 A4 C5 | B4:h A4 | G4:w`,
      },
      {
        id: 'both', name: 'Both hands', level: 12, key: 'G', time: '4/4', bpm: 92, pickup: 2,
        rh: `G4:h | G4:q F#4 E4 D4 | G4:h A4 | B4:h B4 | B4:q B4 A4 G4 | C5:h B4 | A4:h G4 |
             A4:q B4 A4 G4 | E4:h F#4 | G4:h D5 | B4:q G4 A4 C5 | B4:h A4 | G4:w`,
        lh: `G2:h | G2:q D3 E3 B2 | E3:h D3 | G2:h G2 | G2:q G2 D3 E3 | C3:h G2 | D3:h E3 |
             F#3:q G3 D3 B2 | C3:h A2 | G2:h B2 | E3:q B2 D3 C3 | D3:h D3 | G2:w`,
      },
    ],
  },

  // ---- Classical -------------------------------------------------------------------------------
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    year: 1824,
    origin: 'classical',
    category: 'Classical',
    license: PD_BY('Ludwig van Beethoven', 1827),
    source: 'Theme from the finale of Symphony No. 9; checked against Wikipedia and the Mutopia SATB setting.',
    about: 'The theme of Beethoven\'s Ninth Symphony, now the anthem of Europe. It fits under five fingers.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 1, key: 'C', time: '4/4', bpm: 92,
        note: 'The first two phrases, with the dotted rhythm smoothed into quarter notes.',
        rh: `E4:q/3 E4 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4 D4/2 E4/3 | E4/3 D4/2 D4:h |
             E4:q/3 E4 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4 D4/2 E4/3 | D4/2 C4/1 C4:h`,
      },
      {
        id: 'both-easy', name: 'Both hands – easy', level: 7, key: 'C', time: '4/4', bpm: 96,
        note: 'The low G in bar 12 is played by the left hand.',
        rh: `E4:q/3 E4 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4 D4/2 E4/3 | E4/3 D4/2 D4:h |
             E4:q/3 E4 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4 D4/2 E4/3 | D4/2 C4/1 C4:h |
             D4:q/2 D4 E4/3 C4/1 | D4/2 E4:8/3 F4/4 E4:q/3 C4/1 | D4/2 E4:8/3 F4/4 E4:q/3 D4/2 | C4/1 D4/2 r:h |
             E4:q/3 E4 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4 D4/2 E4/3 | D4/2 C4/1 C4:h`,
        lh: `C3:w/5 | G3/1 | C3/5 | G3/1 | C3/5 | G3/1 | C3/5 | G3:h/1 C3/5 |
             G3/1 C3/5 | G3/1 C3/5 | G3:w/1 | C3:h/5 G3/1 | C3:w/5 | G3/1 | C3/5 | G3:h/1 C3/5`,
      },
      {
        id: 'both', name: 'Both hands', level: 12, key: 'C', time: '4/4', bpm: 100,
        rh: `E4:q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:q. D4:8 D4:h |
             E4:q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:q. C4:8 C4:h |
             D4:q D4 E4 C4 | D4 E4:8 F4 E4:q C4 | D4 E4:8 F4 E4:q D4 | C4 D4 G3:h |
             E4:q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:q. C4:8 C4:h`,
        lh: `[C3 G3]:h [C3 G3] | [G2 D3] [G2 D3] | [C3 G3] [C3 G3] | [G2 D3]:w |
             [C3 G3]:h [C3 G3] | [G2 D3] [G2 D3] | [C3 G3] [C3 G3] | [G2 D3] [C3 G3] |
             [G2 D3] [C3 G3] | [G2 D3] [C3 G3] | [G2 D3]:w | [C3 G3]:h [G2 D3] |
             [C3 G3] [C3 G3] | [G2 D3] [G2 D3] | [C3 G3] [C3 G3] | [G2 D3] [C3 G3]`,
      },
    ],
  },
  {
    id: 'brahms-lullaby',
    title: 'Lullaby (Wiegenlied)',
    composer: 'Johannes Brahms',
    year: 1868,
    origin: 'classical',
    category: 'Classical',
    license: PD_BY('Johannes Brahms', 1897),
    source: MUTOPIA('BrahmsJ/O49/Wiegenlied/') + ' (melody of Op. 49 No. 4, moved to C major).',
    about: 'Guten Abend, gut\' Nacht: the most famous cradle song ever written.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 12, key: 'C', time: '3/4', bpm: 84, pickup: 1,
        rh: `E4:8 E4 | G4:q. E4:8 E4:q | G4:q r:q E4:8 G4 | C5:q B4:q. A4:8 | A4:q G4:q D4:8 E4 |
             F4:q D4:q D4:8 E4 | F4:q r:q D4:8 F4 | B4:8 A4 G4:q B4 | C5:q r:q C4:8 C4 |
             C5:h A4:8 F4 | G4:h E4:8 C4 | F4:q G4 A4 | G4:h C4:8 C4 |
             C5:h A4:8 F4 | G4:h E4:8 C4 | F4:q E4 D4 | C4:h r:q`,
      },
      {
        id: 'both', name: 'Both hands', level: 14, key: 'C', time: '3/4', bpm: 84, pickup: 1,
        rh: `E4:8 E4 | G4:q. E4:8 E4:q | G4:q r:q E4:8 G4 | C5:q B4:q. A4:8 | A4:q G4:q D4:8 E4 |
             F4:q D4:q D4:8 E4 | F4:q r:q D4:8 F4 | B4:8 A4 G4:q B4 | C5:q r:q C4:8 C4 |
             C5:h A4:8 F4 | G4:h E4:8 C4 | F4:q G4 A4 | G4:h C4:8 C4 |
             C5:h A4:8 F4 | G4:h E4:8 C4 | F4:q E4 D4 | C4:h r:q`,
        lh: `r:q | [C3 E3 G3]:h. | % | % | [B2 F3 G3] | % | % | % | [C3 E3 G3] |
             [C3 F3 A3] | [C3 E3 G3] | [B2 F3 G3] | [C3 E3 G3] | [C3 F3 A3] | [C3 E3 G3] | [B2 F3 G3] | [C3 E3 G3]`,
      },
    ],
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G',
    composer: 'Christian Petzold (once attributed to J. S. Bach)',
    year: 1725,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Christian Petzold', 1733),
    source: MUTOPIA('BachJS/BWVAnh114/anna-magdalena-04/anna-magdalena-04.ly') + ' (BWV Anh. 114).',
    about: 'From the Notebook for Anna Magdalena Bach: two voices that dance together.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand (first half)', level: 13, key: 'G', time: '3/4', bpm: 104,
        rh: `D5:q G4:8 A4 B4 C5 | D5:q G4 G4 | E5:q C5:8 D5 E5 F#5 | G5:q G4 G4 |
             C5:q D5:8 C5 B4 A4 | B4:q C5:8 B4 A4 G4 | F#4:q G4:8 A4 B4 G4 | A4:h. |
             D5:q G4:8 A4 B4 C5 | D5:q G4 G4 | E5:q C5:8 D5 E5 F#5 | G5:q G4 G4 |
             C5:q D5:8 C5 B4 A4 | B4:q C5:8 B4 A4 G4 | A4:q B4:8 A4 G4 F#4 | G4:h.`,
      },
      {
        id: 'both', name: 'Both hands', level: 17, key: 'G', time: '3/4', bpm: 104,
        rh: `D5:q G4:8 A4 B4 C5 | D5:q G4 G4 | E5:q C5:8 D5 E5 F#5 | G5:q G4 G4 |
             C5:q D5:8 C5 B4 A4 | B4:q C5:8 B4 A4 G4 | F#4:q G4:8 A4 B4 G4 | A4:h. |
             D5:q G4:8 A4 B4 C5 | D5:q G4 G4 | E5:q C5:8 D5 E5 F#5 | G5:q G4 G4 |
             C5:q D5:8 C5 B4 A4 | B4:q C5:8 B4 A4 G4 | A4:q B4:8 A4 G4 F#4 | G4:h. |
             B5:q G5:8 A5 B5 G5 | A5:q D5:8 E5 F#5 D5 | G5:q E5:8 F#5 G5 D5 | C#5:q B4:8 C#5 A4:q |
             A4:8 B4 C#5 D5 E5 F#5 | G5:q F#5 E5 | F#5 A4 C#5 | D5:h. |
             D5:q G4:8 F#4 G4:q | E5 G4:8 F#4 G4:q | D5 C5 B4 | A4:8 G4 F#4 G4 A4:q |
             D4:8 E4 F#4 G4 A4 B4 | C5:q B4 A4 | B4:8 D5 G4:q F#4 | [B3 D4 G4]:h.`,
        lh: `[G3 B3 D4]:h A3:q | B3:h. | C4 | B3 | A3 | G3 | D4:q B3 G3 | D4:q D3:8 C4 B3 A3 |
             B3:h A3:q | G3 B3 G3 | C4:h. | B3:q C4:8 B3 A3 G3 | A3:h F#3:q | G3:h B3:q | C4 D4 D3 | G3:h G2:q |
             G3:h. | F#3 | E3:q G3 E3 | A3:h A2:q | A3:h. | B3:q D4 C#4 | D4 F#3 A3 | D4 D3 C4 |
             B3 D4 B3 | C4 E4 C4 | B3 A3 G3 | D4:h r:q | D3:h F#3:q | E3 G3 F#3 | G3 B2 D3 | G3 D3 G2`,
      },
    ],
  },
  {
    id: 'mozart-minuet-in-f',
    title: 'Minuet in F, K. 2',
    composer: 'Wolfgang Amadeus Mozart',
    year: 1762,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Wolfgang Amadeus Mozart', 1791),
    source: MUTOPIA('MozartWA/KV2/menuet_k2/menuet_k2.ly'),
    about: 'Written when Mozart was six years old. Watch for the little triplet in bar 7.',
    arrangements: [
      {
        id: 'both', name: 'Both hands', level: 14, key: 'F', time: '3/4', bpm: 100,
        rh: `F5:8 A5 C5:q C5 | D5:8 F5 Bb4:q Bb4 | A4:8 C5 F4:q E4 | E4:h F4:q |
             C4:8 E4 G4:q G4 | C4:8 F4 A4:q A4 | C4:8t E4 G4 Bb4:q A4 | A4:h G4:q |
             C5:8 Eb5 A4:q A4 | Bb4:8 D5 G4:q G4 | A4:8 C5 F#4:q F#4 | F#4:h G4:q |
             Bb4:8 D5 G4:q G4 | A4:8 C5 F4:q F4 | G4:8 Bb4 E4:q E4 | E4:h F4:q |
             F5:8 A5 C5:q C5 | D5:8 F5 Bb4:q Bb4 | A4:8 C5 F4:q E4 | E4:h F4:q |
             F5:8 A5 C5:q C5 | D5:8 F5 Bb4:q Bb4 | A4:8 C5 F4:q E4 | E4:h F4:q`,
        lh: `F3:h A3:q | Bb3:h Bb3:q | C4:h C3:q | F3:q C3 F2 |
             C3:h. | C3 | C3:q E3 F3 | C4 G3 C3 |
             F#3:h. | G3 | C4:q D4 D3 | G3 D3 G2 |
             E3:h. | F3 | Bb3:q C4 C3 | F3 C3 F2 |
             A3:h. | Bb3 | C4:h C3:q | D3:h. |
             A3 | Bb3 | C4:h C3:q | F3:q C3 F2`,
      },
    ],
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    year: 1694,
    origin: 'classical',
    category: 'Classical',
    license: PD_BY('Johann Pachelbel', 1706),
    source: 'Our own piano arrangement of the ground bass and the first four violin variations; checked against the score on Wikipedia.',
    about: 'Eight bass notes repeat forever while the melody above keeps changing.',
    arrangements: [
      {
        id: 'both', name: 'Both hands', level: 16, key: 'D', time: '4/4', bpm: 66,
        rh: `R | R | F#5:q E5 D5 C#5 | B4 A4 B4 C#5 | D5 C#5 B4 A4 | G4 F#4 G4 E4 |
             D4:8 F#4 A4 G4 F#4 D4 F#4 E4 | D4 B3 D4 A4 G4 B4 A4 G4 |
             F#4 D4 E4 C#5 D5 F#5 A5 A4 | B4 G4 A4 F#4 D4 D5 D5:8. C#5:16 | [D4 F#4 A4 D5]:w`,
        lh: `D3:q A2 B2 F#2 | G2 D2 G2 A2 | D3 A2 B2 F#2 | G2 D2 G2 A2 | D3 A2 B2 F#2 | G2 D2 G2 A2 |
             D3 A2 B2 F#2 | G2 D2 G2 A2 | D3 A2 B2 F#2 | G2 D2 G2 A2 | D3:w`,
      },
    ],
  },
  {
    id: 'eine-kleine-nachtmusik',
    title: 'Eine kleine Nachtmusik',
    composer: 'Wolfgang Amadeus Mozart',
    year: 1787,
    origin: 'classical',
    category: 'Classical',
    license: PD_BY('Wolfgang Amadeus Mozart', 1791),
    source: MUTOPIA('MozartWA/KV525/eine-kleine-nachtmusik-mvt1/') + ' (first violin and bass, an octave lower).',
    about: 'The opening of Mozart\'s serenade K. 525. Both hands start in unison, like the whole orchestra.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 17, key: 'G', time: '4/4', bpm: 112,
        rh: `G4:q r:8 D4:8 G4:q r:8 D4:8 | G4:8 D4 G4 B4 D5:q r:q | C5:q r:8 A4:8 C5:q r:8 A4:8 | C5:8 A4 F#4 A4 D4:q r:q |
             G4:8 r:8 G4:q. B4:8 A4:8 G4:8 | A4:16 G4 F#4:8 F#4:q. A4:8 C5:8 F#4:8 | A4:8 G4 G4:q. B4:8 A4:8 G4:8 | A4:16 G4 F#4:8 F#4:q. A4:8 C5:8 F#4:8 |
             G4:8 G4 F#4 E4:16 F#4 G4:8 G4 A4 G4:16 A4 | B4:8 B4 C5 B4:16 C5 D5:q r:q | G4:h r:h`,
      },
      {
        id: 'both', name: 'Both hands', level: 19, key: 'G', time: '4/4', bpm: 112,
        rh: `G4:q r:8 D4:8 G4:q r:8 D4:8 | G4:8 D4 G4 B4 D5:q r:q | C5:q r:8 A4:8 C5:q r:8 A4:8 | C5:8 A4 F#4 A4 D4:q r:q |
             G4:8 r:8 G4:q. B4:8 A4:8 G4:8 | A4:16 G4 F#4:8 F#4:q. A4:8 C5:8 F#4:8 | A4:8 G4 G4:q. B4:8 A4:8 G4:8 | A4:16 G4 F#4:8 F#4:q. A4:8 C5:8 F#4:8 |
             G4:8 G4 F#4 E4:16 F#4 G4:8 G4 A4 G4:16 A4 | B4:8 B4 C5 B4:16 C5 D5:q r:q | [B3 D4 G4]:h r:h`,
        lh: `G3:q r:8 D3:8 G3:q r:8 D3:8 | G3:8 D3 G3 B3 D4:q r:q | C4:q r:8 A3:8 C4:q r:8 A3:8 | C4:8 A3 F#3 A3 D3:q r:q |
             G3:8 G3 G3 G3 G3 G3 G3 G3 | % | % | % |
             G3:8 G3 A3 A3 B3 B3 F#3 F#3 | G3:8 G3 A3 A3 B3:q r:q | G2:h r:h`,
      },
    ],
  },
  {
    id: 'hall-of-the-mountain-king',
    title: 'In the Hall of the Mountain King',
    composer: 'Edvard Grieg',
    year: 1875,
    origin: 'classical',
    category: 'Classical',
    license: PD_BY('Edvard Grieg', 1907),
    source: MUTOPIA('GriegE/O46/Dans_l_antre_du_roi_de_la_montagne/') + ' (theme checked against Grieg\'s piano version).',
    about: 'From Peer Gynt. Sneaky staccato steps that get louder and faster each time. Try speeding up!',
    arrangements: [
      {
        id: 'both', name: 'Both hands', level: 16, key: 'Bm', time: '4/4', bpm: 112,
        rh: `B3:8 C#4 D4 E4 F#4 D4 F#4:q | E#4:8 C#4 E#4:q E4:8 C4 E4:q | B3:8 C#4 D4 E4 F#4 D4 F#4 B4 | A4 F#4 D4 F#4 A4:h |
             B4:8 C#5 D5 E5 F#5 D5 F#5:q | E#5:8 C#5 E#5:q E5:8 C5 E5:q | B4:8 C#5 D5 E5 F#5 D5 F#5 B5 | A5 F#5 D5 F#5 A5:h |
             F#4:8 G#4 A#4 B4 C#5 A#4 C#5:q | D5:8 A#4 D5:q C#5:8 A#4 C#5:q | F#4:8 G#4 A#4 B4 C#5 A#4 C#5:q | D5:8 A#4 D5:q C#5:h |
             B3:8 C#4 D4 E4 F#4 D4 F#4:q | E#4:8 C#4 E#4:q E4:8 C4 E4:q | B3:8 C#4 D4 E4 F#4 D4 F#4 B4 | B4:q F#4 B3:h`,
        lh: `B2:q F#2 B2 F#2 | B2 F#2 B2 F#2 | B2 F#2 B2 F#2 | D3 A2 D3 A2 |
             B2 F#2 B2 F#2 | B2 F#2 B2 F#2 | B2 F#2 B2 F#2 | D3 A2 D3 A2 |
             F#2 C#3 F#2 C#3 | D3 A#2 F#2 C#3 | F#2 C#3 F#2 C#3 | D3 A#2 F#2 C#3 |
             B2 F#2 B2 F#2 | B2 F#2 B2 F#2 | B2 F#2 B2 F#2 | B2 F#2 B1:h`,
      },
    ],
  },
  {
    id: 'old-french-song',
    title: 'Old French Song',
    composer: 'Pyotr Ilyich Tchaikovsky',
    year: 1878,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Pyotr Ilyich Tchaikovsky', 1893),
    source: MUTOPIA('TchaikovskyPI/O39/16OldFrenchSong/16OldFrenchSong.ly') + ' (Album for the Young, Op. 39 No. 16; inner voices simplified).',
    about: 'A wistful little song in G minor from Tchaikovsky\'s Album for the Young.',
    arrangements: [
      {
        id: 'rh', name: 'Right hand', level: 16, key: 'Gm', time: '2/4', bpm: 66, pickup: 0.5,
        rh: `D4:8 | G4:8 A4 Bb4 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:8 Eb5:16 D5 C5:8 Bb4 | A4:q.~ A4:16 G4 | G4:q. D4:8 |
             G4:8 A4 Bb4 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:8 Eb5:16 D5 C5:8 Bb4 | A4:q.~ A4:16 G4 | G4:h |
             G4:q G4:8 A4 | Bb4:q. Bb4:8 | C5:q C5 | A4:q. A4:8 | D5:q. D5:8 | Eb5:8 F5:16 Eb5 D5:8 C5 | Bb4:q A4:8 G4 | [F#4 A4]:q. D4:8 |
             G4:8 A4 Bb4 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:8 Eb5:16 D5 C5:8 Bb4 | A4:q.~ A4:16 G4 | G4:h`,
      },
      {
        id: 'both', name: 'Both hands', level: 18, key: 'Gm', time: '2/4', bpm: 66, pickup: 0.5,
        rh: `D4:8 | G4:8 A4 Bb4 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:8 Eb5:16 D5 C5:8 Bb4 | A4:q.~ A4:16 G4 | G4:q. D4:8 |
             G4:8 A4 Bb4 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:8 Eb5:16 D5 C5:8 Bb4 | A4:q.~ A4:16 G4 | G4:h |
             G4:q G4:8 A4 | Bb4:q. Bb4:8 | C5:q C5 | A4:q. A4:8 | D5:q. D5:8 | Eb5:8 F5:16 Eb5 D5:8 C5 | Bb4:q A4:8 G4 | [F#4 A4]:q. D4:8 |
             G4:8 A4 Bb4 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:q. D5:8 | C5:8 D5 Eb5 C5 | D5:8 Eb5:16 D5 C5:8 Bb4 | A4:q.~ A4:16 G4 | G4:h`,
        lh: `r:8 | [G3 Bb3]:8 C4 D4 C4 | [G3 Bb3]:q G3 | Eb4 C4 | [G3 Bb3] G3 | Eb4 C4 | [G3 Bb3] G3 | [F#3 C4] D3 | [G3 Bb3] G2 |
             [G3 Bb3]:8 C4 D4 C4 | [G3 Bb3]:q G3 | Eb4 C4 | [G3 Bb3] G3 | Eb4 C4 | [G3 Bb3] G3 | [F#3 C4] D3 | [G3 Bb3]:h |
             C3:8 G3 C4 Eb4 | G2 G3 C4 Eb4 | C3 G3 C4 Eb4 | D3 A3 C4 F#4 | [G3 Bb3] D4 G4 r | [C4 Eb4 G4]:h | [D4 G4]:q r | D4 D3 |
             [G3 Bb3]:8 C4 D4 C4 | [G3 Bb3]:q G3 | Eb4 C4 | [G3 Bb3] G3 | Eb4 C4 | [G3 Bb3] G3 | [C3 G3] [D3 F#3] | [G2 D3]:h`,
      },
    ],
  },
  {
    id: 'clementi-sonatina-op36-no1',
    title: 'Sonatina in C, Op. 36 No. 1',
    composer: 'Muzio Clementi',
    year: 1797,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Muzio Clementi', 1832),
    source: MUTOPIA('ClementiM/O36/sonatina-1/sonatina-1.ly') + ' (first movement, bars 1–15).',
    about: 'The first page of the most famous piano sonatina: C major arpeggios, scales and a trip to G major.',
    arrangements: [
      {
        id: 'both', name: 'Both hands (exposition)', level: 17, key: 'C', time: '4/4', bpm: 112,
        rh: `C5:q E5:8 C5 G4:q G4 | C5:q E5:8 C5 G4:q G5 | F5:8 E5 D5 C5 B4 C5 B4 C5 | D5 C5 B4 A4 G4:q r:q |
             C5:q E5:8 C5 G4:q G4 | E5:q G5:8 E5 C5:q E5:8 C5 | D5 B4 C5 A4 B4 G4 A4 F#4 | G4 A4 B4 C5 D5 E5 F#5 G5 |
             A4:q A5 A5 A5 | B4:8 C5 D5 E5 F#5 G5 A5 B5 | C5:q C6 C6 C6 | D5:8 G5 B5 D6 C6 B5 A5 G5 |
             F#5 E5 G5 F#5 A5 G5 F#5 E5 | E5 D5 C5 B4 D5 C5 B4 A4 | G4:h r:h`,
        lh: `C3:q r:q r:h | C3:q r:q r:h | C3:q r C3 r | G2:q r G3:8 F3 E3 D3 |
             C3:q r:q r:h | C4:q r r F#3 | G3 C3 D3 D2 | G2 r r:h |
             F#3:8 D4 A3 D4 F#3 D4 A3 D4 | G3:q r:q r:h | A3:8 D4 C4 D4 A3 D4 C4 D4 | B3:q r:q r:h |
             C4:q r C3 r | D3 r D2 r | G2:8 B2 D3 G3 G2:q r:q`,
      },
    ],
  },
  {
    id: 'musette-in-d',
    title: 'Musette in D',
    composer: 'Anonymous (Anna Magdalena Bach Notebook)',
    year: 1725,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Johann Sebastian Bach', 1750),
    source: MUTOPIA('BachJS/BWVAnh126/anna-magdalena-22/anna-magdalena-22.ly') + ' (BWV Anh. 126, played da capo).',
    about: 'A musette imitates a bagpipe: the left hand bounces between octaves like a drone.',
    arrangements: [
      {
        id: 'both', name: 'Both hands', level: 22, key: 'D', time: '2/4', bpm: 96,
        rh: `A5:q G5:16 F#5 E5 D5 | A5:q G5:16 F#5 E5 D5 | F#4:16 G4 A4:8 G4 F#4 | E4 A4 F#4 D4 |
             A5:q G5:16 F#5 E5 D5 | A5:q G5:16 F#5 E5 D5 | F#4:16 G4 A4:8 G4 F#4 | E4 A4 D4:q |
             C#5:16 D5 E5:8 C#5:16 D5 E5:8 | A5 E5 E5:q | A5:8 E5 A5 E5 | D5:16 C#5 B4 A4 B4:8 E4 |
             E5 D#5 E4 D5~ | D5 C#5 A5 G#5 | E5 D#5 E4 D5~ | D5 C#5 A5 G#5 |
             E5:16 D#5 C#5 D#5 E5 D#5 C#5 D#5 | E5:8 G#4 A4 D5 | C#5:16 D5 E5:8 A4 D4 | C#4:16 D4 E4:8 A3:q |
             A5:q G5:16 F#5 E5 D5 | A5:q G5:16 F#5 E5 D5 | F#4:16 G4 A4:8 G4 F#4 | E4 A4 F#4 D4 |
             A5:q G5:16 F#5 E5 D5 | A5:q G5:16 F#5 E5 D5 | F#4:16 G4 A4:8 G4 F#4 | E4 A4 D4:q`,
        lh: `D2:8 D3 D2 D3 | % | F#3:16 G3 A3:8 G3 F#3 | E3 A3 F#3 D3 |
             D2:8 D3 D2 D3 | % | F#3:16 G3 A3:8 G3 F#3 | E3 A3 D3:q |
             A2:8 A3 A2 A3 | % | % | A2:8 A3 E2 E3 |
             E2:8 E3 E2 E3 | % | % | % |
             % | E2:8 D3 C#3 D3 | E3:q A2:8 D3 | C#3:16 D3 E3:8 A2:q |
             D2:8 D3 D2 D3 | % | F#3:16 G3 A3:8 G3 F#3 | E3 A3 F#3 D3 |
             D2:8 D3 D2 D3 | % | F#3:16 G3 A3:8 G3 F#3 | E3 A3 D3:q`,
      },
    ],
  },
  {
    id: 'prelude-in-c',
    title: 'Prelude in C, BWV 846',
    composer: 'Johann Sebastian Bach',
    year: 1722,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Johann Sebastian Bach', 1750),
    source: MUTOPIA('BachJS/BWV846/wtk1-prelude1/wtk1-prelude1.ly') + ' (Well-Tempered Clavier, Book I).',
    about: 'One broken-chord pattern, 35 bars, a whole journey of harmony. Hold the left-hand notes with the pedal.',
    arrangements: [
      {
        id: 'both', name: 'Both hands (complete)', level: 25, key: 'C', time: '4/4', bpm: 60,
        note: 'Bach\'s held bass notes are written as a tied figure; hold them with the sustain pedal.',
        rh: `
      r:8 G4:16 C5 E5 G4 C5 E5 r:8 G4:16 C5 E5 G4 C5 E5 | ; 1
      r:8 A4:16 D5 F5 A4 D5 F5 r:8 A4:16 D5 F5 A4 D5 F5 | ; 2
      r:8 G4:16 D5 F5 G4 D5 F5 r:8 G4:16 D5 F5 G4 D5 F5 | ; 3
      r:8 G4:16 C5 E5 G4 C5 E5 r:8 G4:16 C5 E5 G4 C5 E5 | ; 4
      r:8 A4:16 E5 A5 A4 E5 A5 r:8 A4:16 E5 A5 A4 E5 A5 | ; 5
      r:8 F#4:16 A4 D5 F#4 A4 D5 r:8 F#4:16 A4 D5 F#4 A4 D5 | ; 6
      r:8 G4:16 D5 G5 G4 D5 G5 r:8 G4:16 D5 G5 G4 D5 G5 | ; 7
      r:8 E4:16 G4 C5 E4 G4 C5 r:8 E4:16 G4 C5 E4 G4 C5 | ; 8
      r:8 E4:16 G4 C5 E4 G4 C5 r:8 E4:16 G4 C5 E4 G4 C5 | ; 9
      r:8 D4:16 F#4 C5 D4 F#4 C5 r:8 D4:16 F#4 C5 D4 F#4 C5 | ; 10
      r:8 D4:16 G4 B4 D4 G4 B4 r:8 D4:16 G4 B4 D4 G4 B4 | ; 11
      r:8 E4:16 G4 C#5 E4 G4 C#5 r:8 E4:16 G4 C#5 E4 G4 C#5 | ; 12
      r:8 D4:16 A4 D5 D4 A4 D5 r:8 D4:16 A4 D5 D4 A4 D5 | ; 13
      r:8 D4:16 F4 B4 D4 F4 B4 r:8 D4:16 F4 B4 D4 F4 B4 | ; 14
      r:8 C4:16 G4 C5 C4 G4 C5 r:8 C4:16 G4 C5 C4 G4 C5 | ; 15
      r:8 A3:16 C4 F4 A3 C4 F4 r:8 A3:16 C4 F4 A3 C4 F4 | ; 16
      r:8 A3:16 C4 F4 A3 C4 F4 r:8 A3:16 C4 F4 A3 C4 F4 | ; 17
      r:8 G3:16 B3 F4 G3 B3 F4 r:8 G3:16 B3 F4 G3 B3 F4 | ; 18
      r:8 G3:16 C4 E4 G3 C4 E4 r:8 G3:16 C4 E4 G3 C4 E4 | ; 19
      r:8 Bb3:16 C4 E4 Bb3 C4 E4 r:8 Bb3:16 C4 E4 Bb3 C4 E4 | ; 20
      r:8 A3:16 C4 E4 A3 C4 E4 r:8 A3:16 C4 E4 A3 C4 E4 | ; 21
      r:8 A3:16 C4 Eb4 A3 C4 Eb4 r:8 A3:16 C4 Eb4 A3 C4 Eb4 | ; 22
      r:8 B3:16 C4 D4 B3 C4 D4 r:8 B3:16 C4 D4 B3 C4 D4 | ; 23
      r:8 G3:16 B3 D4 G3 B3 D4 r:8 G3:16 B3 D4 G3 B3 D4 | ; 24
      r:8 G3:16 C4 E4 G3 C4 E4 r:8 G3:16 C4 E4 G3 C4 E4 | ; 25
      r:8 G3:16 C4 F4 G3 C4 F4 r:8 G3:16 C4 F4 G3 C4 F4 | ; 26
      r:8 G3:16 B3 F4 G3 B3 F4 r:8 G3:16 B3 F4 G3 B3 F4 | ; 27
      r:8 A3:16 C4 F#4 A3 C4 F#4 r:8 A3:16 C4 F#4 A3 C4 F#4 | ; 28
      r:8 G3:16 C4 G4 G3 C4 G4 r:8 G3:16 C4 G4 G3 C4 G4 | ; 29
      r:8 G3:16 C4 F4 G3 C4 F4 r:8 G3:16 C4 F4 G3 C4 F4 | ; 30
      r:8 G3:16 B3 F4 G3 B3 F4 r:8 G3:16 B3 F4 G3 B3 F4 | ; 31
      r:8 G3:16 Bb3 E4 G3 Bb3 E4 r:8 G3:16 Bb3 E4 G3 Bb3 E4 | ; 32
      r:8 F3:16 A3 C4 F4 C4 A3 C4 A3 F3 A3 F3 D3 F3 D3 | ; 33
      r:8 G4:16 B4 D5 F5 D5 B4 D5 B4 G4 B4 D4 F4 E4 D4 | ; 34
      [E4 G4 C5]:w | ; 35`,
        lh: `
      C4:16 E4:8.~ E4:q C4:16 E4:8.~ E4:q | ; 1
      C4:16 D4:8.~ D4:q C4:16 D4:8.~ D4:q | ; 2
      B3:16 D4:8.~ D4:q B3:16 D4:8.~ D4:q | ; 3
      C4:16 E4:8.~ E4:q C4:16 E4:8.~ E4:q | ; 4
      C4:16 E4:8.~ E4:q C4:16 E4:8.~ E4:q | ; 5
      C4:16 D4:8.~ D4:q C4:16 D4:8.~ D4:q | ; 6
      B3:16 D4:8.~ D4:q B3:16 D4:8.~ D4:q | ; 7
      B3:16 C4:8.~ C4:q B3:16 C4:8.~ C4:q | ; 8
      A3:16 C4:8.~ C4:q A3:16 C4:8.~ C4:q | ; 9
      D3:16 A3:8.~ A3:q D3:16 A3:8.~ A3:q | ; 10
      G3:16 B3:8.~ B3:q G3:16 B3:8.~ B3:q | ; 11
      G3:16 Bb3:8.~ Bb3:q G3:16 Bb3:8.~ Bb3:q | ; 12
      F3:16 A3:8.~ A3:q F3:16 A3:8.~ A3:q | ; 13
      F3:16 Ab3:8.~ Ab3:q F3:16 Ab3:8.~ Ab3:q | ; 14
      E3:16 G3:8.~ G3:q E3:16 G3:8.~ G3:q | ; 15
      E3:16 F3:8.~ F3:q E3:16 F3:8.~ F3:q | ; 16
      D3:16 F3:8.~ F3:q D3:16 F3:8.~ F3:q | ; 17
      G2:16 D3:8.~ D3:q G2:16 D3:8.~ D3:q | ; 18
      C3:16 E3:8.~ E3:q C3:16 E3:8.~ E3:q | ; 19
      C3:16 G3:8.~ G3:q C3:16 G3:8.~ G3:q | ; 20
      F2:16 F3:8.~ F3:q F2:16 F3:8.~ F3:q | ; 21
      F#2:16 C3:8.~ C3:q F#2:16 C3:8.~ C3:q | ; 22
      Ab2:16 F3:8.~ F3:q Ab2:16 F3:8.~ F3:q | ; 23
      G2:16 F3:8.~ F3:q G2:16 F3:8.~ F3:q | ; 24
      G2:16 E3:8.~ E3:q G2:16 E3:8.~ E3:q | ; 25
      G2:16 D3:8.~ D3:q G2:16 D3:8.~ D3:q | ; 26
      G2:16 D3:8.~ D3:q G2:16 D3:8.~ D3:q | ; 27
      G2:16 Eb3:8.~ Eb3:q G2:16 Eb3:8.~ Eb3:q | ; 28
      G2:16 E3:8.~ E3:q G2:16 E3:8.~ E3:q | ; 29
      G2:16 D3:8.~ D3:q G2:16 D3:8.~ D3:q | ; 30
      G2:16 D3:8.~ D3:q G2:16 D3:8.~ D3:q | ; 31
      C2:16 C3:8.~ C3:q C2:16 C3:8.~ C3:q | ; 32
      C2:16 C3:8.~ C3:h. | ; 33
      C2:16 B2:8.~ B2:h. | ; 34
      [C2 C3]:w | ; 35`,
      },
    ],
  },
  {
    id: 'fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    year: 1810,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Ludwig van Beethoven', 1827),
    source: MUTOPIA('BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly') + ' (WoO 59, opening section).',
    about: 'Written in 3/8; here two of Beethoven\'s bars make one bar of 6/8, so every note is where he put it.',
    arrangements: [
      {
        id: 'easy', name: 'Theme with easy left hand', level: 20, key: 'Am', time: '6/8', bpm: 72, pickup: 0.5,
        rh: `E5:16 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 G#4 B4 C5:8 r:16 E4 E5 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 C5 B4 A4:q E5:16 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 G#4 B4 C5:8 r:16 E4 E5 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 C5 B4 A4:q.`,
        lh: `r:8 | r:q. A2 | E2 A2 | r:q. A2 | E2 A2 | r:q. A2 | E2 A2 | r:q. A2 | E2 A2`,
      },
      {
        id: 'both', name: 'Both hands', level: 26, key: 'Am', time: '6/8', bpm: 72, pickup: 0.5,
        rh: `E5:16 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 G#4 B4 C5:8 r:16 E4 E5 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 C5 B4 A4:q E5:16 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 G#4 B4 C5:8 r:16 E4 E5 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 C5 B4 A4:8 r:16 B4 C5 D5 |
             E5:8. G4:16 F5 E5 D5:8. F4:16 E5 D5 | C5:8. E4:16 D5 C5 B4:8 r:16 E4 E5 r |
             r:16 E5 E6 r r D#5 E5:8 r:16 D#5 E5 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 G#4 B4 C5:8 r:16 E4 E5 D#5 |
             E5:16 D#5 E5 B4 D5 C5 A4:8 r:16 C4 E4 A4 | B4:8 r:16 E4 C5 B4 A4:q.`,
        lh: `r:8 |
             r:q. A2:16 E3 A3 r r:8 | E2:16 E3 G#3 r r:8 A2:16 E3 A3 r r:8 |
             r:q. A2:16 E3 A3 r r:8 | E2:16 E3 G#3 r r:8 A2:16 E3 A3 r r:8 |
             r:q. A2:16 E3 A3 r r:8 | E2:16 E3 G#3 r r:8 A2:16 E3 A3 r r:8 |
             r:q. A2:16 E3 A3 r r:8 | E2:16 E3 G#3 r r:8 A2:16 E3 A3 r r:8 |
             C3:16 G3 C4 r r:8 G2:16 G3 B3 r r:8 | A2:16 E3 A3 r r:8 E2:16 E3 E4 r r E4 |
             E5:16 r r D#5 E5 r r D#5 E5 r r:8 |
             r:q. A2:16 E3 A3 r r:8 | E2:16 E3 G#3 r r:8 A2:16 E3 A3 r r:8 |
             r:q. A2:16 E3 A3 r r:8 | E2:16 E3 G#3 r r:8 A2:16 E3 A3 r r:8`,
      },
    ],
  },
  {
    id: 'gymnopedie-no1',
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    year: 1888,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Erik Satie', 1925),
    source: MUTOPIA('SatieE/gymnopedie_1/gymnopedie_1.ly') + ' (first section).',
    about: 'Slow and dreamy. The left hand swings from a low bass note up to a soft chord.',
    arrangements: [
      {
        id: 'easy', name: 'Melody and bass', level: 18, key: 'D', time: '3/4', bpm: 66,
        rh: `R | R | R | R | r:q F#5 A5 | G5 F#5 C#5 | B4 C#5 D5 | A4:h. |
             F#4:h.~ | F#4:h.~ | F#4:h.~ | F#4:h. | r:q F#5 A5 | G5 F#5 C#5 | B4 C#5 D5 | A4:h. |
             C#5:h. | F#5 | E4:h.~ | E4:h.~ | E4:h. | A4:q B4 C5 | E5 D5 B4 | D5 C5 B4 |
             D5:h.~ | D5:h D5:q | E5 F5 G5 | A5 C5 D5 | E5 D5 B4 | D5:h.~ | D5:h D5:q |
             G5:h. | F#5 | B4:q A4 B4 | C#5 D5 E5 | C#5 D5 E5 | F#4:h. | [C4 E4 A4 C5] | [D4 F#4 A4 D5]`,
        lh: `G2:h. | D2 | G2 | D2 | G2 | D2 | G2 | D2 | G2 | D2 | G2 | D2 | G2 | D2 | G2 | D2 |
             F#2 | B1 | E2 | E2 | D2 | A1 | D2 | D2 | D2 | D2 | D2 | D2 | D2 | D2 | D2 |
             E2 | F#2 | B1 | E2 | E2 | E2 | [A2 G3] | [D2 A2 D3]`,
      },
      {
        id: 'both', name: 'Both hands', level: 27, key: 'D', time: '3/4', bpm: 66,
        rh: `R | R | R | R | r:q F#5 A5 | G5 F#5 C#5 | B4 C#5 D5 | A4:h. |
             F#4:h.~ | F#4:h.~ | F#4:h.~ | F#4:h. | r:q F#5 A5 | G5 F#5 C#5 | B4 C#5 D5 | A4:h. |
             C#5:h. | F#5 | E4:h.~ | E4:h.~ | E4:h. | A4:q B4 C5 | E5 D5 B4 | D5 C5 B4 |
             D5:h.~ | D5:h D5:q | E5 F5 G5 | A5 C5 D5 | E5 D5 B4 | D5:h.~ | D5:h D5:q |
             G5:h. | F#5 | B4:q A4 B4 | C#5 D5 E5 | C#5 D5 E5 | F#4:h. | [C4 E4 A4 C5] | [D4 F#4 A4 D5]`,
        lh: `G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h | G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h |
             G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h | G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h |
             G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h | G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h |
             G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h | G2:q [B3 D4 F#4]:h | D2:q [A3 C#4 F#4]:h |
             F#2:q [A3 C#4 F#4]:h | B1:q [B3 D4 F#4]:h | E2:q [G3 B3]:h | E2:q [B3 D4 G4]:h |
             D2:q [F3 A3 D4]:h | A1:q [A3 C4 E4]:h | D2:q [G3 B3 E4]:h | D2:q [D3 G3 B3 E4]:h |
             D2:q [C3 E3 A3 D4]:h | D2:q [C3 F#3 A3 D4]:h | D2:q [A3 C4 F4]:h | D2:q [A3 C4 E4]:h |
             D2:q [D3 G3 B3 E4]:h | D2:q [C3 E3 A3 D4]:h | D2:q [C3 F#3 A3 D4]:h |
             E2:q [B3 E4 G4]:h | F#2:q [A3 C#4 F#4]:h | B1:q [B3 D4 F#4]:h | E2:q [C#4 E4 A4]:h |
             E2:q [A3 C#4 F#4 A4]:h | E2:q [A3 D4] [B3 D4 G4] | [A2 G3]:h. | [D2 A2 D3]:h.`,
      },
    ],
  },
  {
    id: 'arabesque-burgmuller',
    title: 'Arabesque, Op. 100 No. 2',
    composer: 'Friedrich Burgmüller',
    year: 1851,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Friedrich Burgmüller', 1874),
    source: MUTOPIA('BurgmullerJFF/O100/25EF-02/25EF-02.ly') + ' (opening section and coda).',
    about: 'Quick, light sixteenth-note curls over crisp staccato chords. A favourite study piece.',
    arrangements: [
      {
        id: 'both', name: 'Both hands', level: 26, key: 'Am', time: '2/4', bpm: 120,
        rh: `R | R |
             A4:16 B4 C5 B4 A4:8 r:8 | A4:16 B4 C5 D5 E5:8 r:8 | D5:16 E5 F5 G5 A5:8 r:8 | A5:16 B5 C6 D6 E6:8 r:8 |
             r:8 E5 E5 F5 | D5:8 r:8 D5:q~ | D5:8 G5 D5 E5 | C5:8 r:8 E5:q |
             A4:16 B4 C5 B4 A4:8 r:8 | A4:16 B4 C5 D5 E5:8 r:8 | D5:16 E5 F5 G5 A5:8 r:8 | A5:16 B5 C6 D6 E6:8 r:8 |
             r:8 E5 E5 F5 | D5:8 r:8 D5:q~ | D5:8 G5 D5 E5 | C5:q C6:8 r:8 |
             D5:16 E5 F5 G5 A5:8 r:8 | A5:16 B5 C6 B5 A5:8 r:8 | D5:16 E5 F5 G5 A5:8 r:8 | E4:16 D4 C4 B3 A3:8 r:8 | [C5 A5]:h`,
        lh: `[A3 C4 E4]:q [A3 C4 E4] | % |
             % | % | [A3 D4 F4]:q [A3 D4 F4] | [A3 C4 E4]:q [A3 C4 E4] |
             [G3 C4 E4]:q [G3 C4 E4] | [G3 B3 F4]:q [G3 B3 F4] | % | [C4 E4]:8 r:8 E4:q |
             [A3 C4 E4]:q [A3 C4 E4] | % | [A3 D4 F4]:q [A3 D4 F4] | [A3 C4 E4]:q [A3 C4 E4] |
             [G3 C4 E4]:q [G3 C4 E4] | [G3 B3 F4]:q [G3 B3 F4] | % | [C4 E4]:q. r:8 |
             [A3 D4 F4]:q [A3 D4 F4] | [A3 C4 E4]:q [A3 C4 E4] | [A3 D4 F4]:q [A3 D4 F4] | E3:16 D3 C3 B2 A2:8 r:8 | [A3 E4]:h`,
      },
    ],
  },
  {
    id: 'rondo-alla-turca',
    title: 'Rondo alla Turca',
    composer: 'Wolfgang Amadeus Mozart',
    year: 1783,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Wolfgang Amadeus Mozart', 1791),
    source: MUTOPIA('MozartWA/KV331/KV331_3_RondoAllaTurca/') + ' (Sonata K. 331, finale, opening section; trill simplified).',
    about: 'The Turkish March: Mozart imitating a Janissary band, all bells and drums.',
    arrangements: [
      {
        id: 'easy', name: 'Theme (easier)', level: 24, key: 'Am', time: '2/4', bpm: 96, pickup: 1,
        rh: `B4:16 A4 G#4 A4 |
             C5:8 r D5:16 C5 B4 C5 | E5:8 r F5:16 E5 D#5 E5 | B5:16 A5 G#5 A5 B5 A5 G#5 A5 | C6:q A5:8 C6 |
             B5:8 A5 G5 A5 | B5 A5 G5 A5 | B5 A5 G5 F#5 | E5:q E5:8 F5 |
             G5:8 G5 A5:16 G5 F5 E5 | D5:8 G4 E5 F5 | G5 G5 A5:16 G5 F5 E5 | D5:q C5:8 D5 |
             E5:8 E5 F5:16 E5 D5 C5 | B4:8 E4 C5 D5 | E5 E5 F5:16 E5 D5 C5 | B4:q B4:16 A4 G#4 A4 |
             C5:8 r D5:16 C5 B4 C5 | E5:8 r F5:16 E5 D#5 E5 | B5:16 A5 G#5 A5 B5 A5 G#5 A5 | C6:8 r A5 B5 |
             C6 B5 A5 G#5 | A5 E5 F5 D5 | C5:q B4:8. A4:16 | A4:q r:q`,
        lh: `r:q |
             A3:q [C4 E4] | % | % | % |
             E3:q [B3 E4] | % | % | E3:q r |
             C3:q E3 | G3:q r | C3:q E3 | G3:q r |
             A2:q C3 | E3:q r | A2:q C3 | E3:q r |
             A3:q [C4 E4] | % | % | F3:q [A3 D#4] |
             E3:q D3 | C3:q D3 | E3:q E3 | A2:q r`,
      },
      {
        id: 'both', name: 'Both hands', level: 32, key: 'Am', time: '2/4', bpm: 108, pickup: 1,
        rh: `B4:16 A4 G#4 A4 |
             C5:8 r D5:16 C5 B4 C5 | E5:8 r F5:16 E5 D#5 E5 | B5:16 A5 G#5 A5 B5 A5 G#5 A5 | C6:q A5:8 C6 |
             B5:8 [F#5 A5] [E5 G5] [F#5 A5] | B5:8 [F#5 A5] [E5 G5] [F#5 A5] | B5:8 [F#5 A5] [E5 G5] [D#5 F#5] | E5:q [C5 E5]:8 [D5 F5] |
             [E5 G5]:8 [E5 G5] A5:16 G5 F5 E5 | [B4 D5]:8 G4 [C5 E5] [D5 F5] | [E5 G5]:8 [E5 G5] A5:16 G5 F5 E5 | [B4 D5]:q [A4 C5]:8 [B4 D5] |
             [C5 E5]:8 [C5 E5] F5:16 E5 D5 C5 | [G#4 B4]:8 E4 [A4 C5] [B4 D5] | [C5 E5]:8 [C5 E5] F5:16 E5 D5 C5 | [G#4 B4]:q B4:16 A4 G#4 A4 |
             C5:8 r D5:16 C5 B4 C5 | E5:8 r F5:16 E5 D#5 E5 | B5:16 A5 G#5 A5 B5 A5 G#5 A5 | C6:8 r A5 B5 |
             C6 B5 A5 G#5 | A5 E5 F5 D5 | C5:q B4:8. A4:16 | A4:q r:q`,
        lh: `r:q |
             A3:8 [C4 E4] [C4 E4] [C4 E4] | % | A3:8 [C4 E4] A3 [C4 E4] | A3:8 [C4 E4] [C4 E4] [C4 E4] |
             E3:8 [B3 E4] [B3 E4] [B3 E4] | % | E3:8 [B3 E4] B2 B3 | E3:q r |
             C3:8 C4 E3 E4 | G3:q r | C3:8 C4 E3 E4 | G3:q r |
             A2:8 A3 C3 C4 | E3:q r | A2:8 A3 C3 C4 | E3:q r |
             A3:8 [C4 E4] [C4 E4] [C4 E4] | % | A3:8 [C4 E4] A3 [C4 E4] | F3:8 [A3 D#4] [A3 D#4] [A3 D#4] |
             E3:8 [A3 E4] D3 [F3 B3] | C3:8 [E3 A3] D3 [F3 B3] | [E3 A3]:8 [E3 A3] [E3 G#3] [E3 G#3] | [A2 A3]:q r`,
      },
    ],
  },
  {
    id: 'chopin-prelude-e-minor',
    title: 'Prelude in E minor, Op. 28 No. 4',
    composer: 'Frédéric Chopin',
    year: 1839,
    origin: 'classical',
    category: 'Classical',
    license: PD_ED('Frédéric Chopin', 1849),
    source: MUTOPIA('ChopinFF/O28/Chop-28-4/Chop-28-4.ly') + ' (complete; grace notes omitted).',
    about: 'A long, sighing melody over slowly sinking chords. Every chord changes by just one note.',
    arrangements: [
      {
        id: 'both', name: 'Both hands (complete)', level: 30, key: 'Em', time: '4/4', bpm: 50, pickup: 1,
        rh: `B3:8. B4:16 |
             B4:h. C5:q | B4:h. C5:q | B4:h. C5:q | B4:h. Bb4:q |
             A4:h. B4:q | A4:h. B4:q | A4:h. B4:8. A4:16 | A4:h. G#4:q~ |
             G#4:q A4:8 B4 D5 C5 E4 A4 | F#4:h. A4:q | F#4:h. A4:q | G4:8 F#4 C4 B3 D#4 F#4 D5:8t C5 B4 |
             B4:h. C5:q | B4:h. C5:q | B4:h. C5:q | B4:8. A#4:16 A#4:q G##5 F#5:8. E5:16 |
             E5:8 D#5 C6 D#5 D#5 E5 G5 B4 | D5:8 C5 E5:8t E4 A4 F#4:q. A4:8 | F#4:h. A4:q | F#4:h.~ F#4:8. E4:16 |
             E4:h. F#4:q | E4:h. F#4:q | E4:h r:h | [E3 F#3 B3 E4]:h [D#3 F#3 B3 D#4] | [E3 G3 B3 E4]:w`,
        lh: `r:q |
             [G3 B3 E4]:8 [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] |
             [F#3 A3 E4] [F#3 A3 E4] [F#3 A3 E4] [F#3 A3 E4] [F#3 A3 D#4] [F#3 A3 D#4] [F#3 A3 D#4] [F#3 A3 D#4] |
             [F3 A3 D#4] [F3 A3 D#4] [F3 A3 D#4] [F3 A3 D#4] [F3 A3 D4] [F3 A3 D4] [F3 G#3 D4] [F3 G#3 D4] |
             [E3 G#3 D4] [E3 G#3 D4] [E3 G#3 D4] [E3 G#3 D4] [E3 G3 D4] [E3 G3 D4] [E3 G3 C#4] [E3 G3 C#4] |
             [E3 G3 C4] [E3 G3 C4] [E3 G3 C4] [E3 G3 C4] [E3 F#3 C4] [E3 F#3 C4] [E3 F#3 C4] [E3 F#3 C4] |
             [E3 F#3 C4] [E3 F#3 C4] [E3 F#3 C4] [E3 F#3 C4] [D#3 F#3 C4] [D#3 F#3 C4] [D#3 F#3 C4] [D#3 F#3 C4] |
             [D3 F#3 C4] [D3 F#3 C4] [D3 F#3 C4] [D3 F#3 C4] [D3 F#3 C4] [D3 F#3 C4] [D3 F#3 C4] [D3 F#3 C4] |
             [D3 F3 C4] [D3 F3 C4] [D3 F3 C4] [D3 F3 C4] [D3 F3 B3] [D3 F3 B3] [D3 F3 B3] [D3 F3 B3] |
             [C3 E3 B3] [C3 E3 B3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] |
             [B2 E3 A3] [B2 E3 A3] [B2 D#3 A3] [B2 D#3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] |
             [B2 D#3 A3] [B2 D#3 A3] [B2 D#3 A3] [B2 D#3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] |
             [B2 D#3 A3]:q r:q r:h |
             [G3 B3 E4]:8 [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] |
             [F#3 A3 E4] [F#3 A3 E4] [F#3 A3 E4] [F#3 A3 E4] [F3 A3 D#4] [F3 A3 D#4] [F3 A3 D#4] [F3 A3 D#4] |
             [F3 G#3 D#4] [F3 G#3 D#4] [F3 G#3 D4] [F3 G#3 D4] [E3 G#3 D4] [E3 G#3 D4] [E3 G#3 D4] [E3 G#3 D4] |
             [E3 G3 D4] [E3 G3 D4] [E3 G3 C#4] [E3 G3 C#4] [C#3 E3 A#3] [C#3 E3 A#3] [C3 E3 A3] [C3 E3 A3] |
             [B1 B2] [A3 C4 F#4 A4] [A3 C4 F#4 A4] [A3 C4 F#4 A4] [G3 B3 D#4 F#4] [G3 B3 E4] [G3 B3 E4] [G3 B3 E4] |
             [A3 C4 E4] [A3 C4 E4] A2 [E3 F#3 C4] [B2 E3 B3] [B2 E3 B3] [C3 E3 A3] [C3 E3 A3] |
             [B2 E3 B3] [B2 E3 B3] [B2 E3 B3] [B2 E3 B3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] [C3 E3 A3] |
             [B2 E3 B3] [B2 E3 B3] [B2 E3 B3] [B2 E3 B3] [B2 D#3 B3] [B2 D#3 B3] [B2 D#3 A3] [B2 D#3 A3] |
             [C3 G3] [C3 G3] [C3 G3] [C3 G3] [C3 Bb3] [C3 Bb3] [C3 E3 A3] [C3 E3 A3] |
             [B2 E3 A3] [B2 E3 A3] [B2 E3 G#3] [B2 E3 G#3] [B2 E3 G3] [B2 E3 G3] [B2 E3 G3] [B2 E3 G3] |
             [Bb2 C3 G3]:h r:h | [B1 B2]:h [B1 B2] | [E1 E2]:w`,
      },
    ],
  },

  // ---- Ragtime & blues ----------------------------------------------------------------------
  {
    id: 'maestro-blues',
    title: 'Maestro Blues',
    composer: 'Maestro (original)',
    year: 2026,
    origin: 'original',
    category: 'Ragtime & blues',
    license: 'Original composition written for Maestro; same license as this project.',
    source: 'Written for this app.',
    about: 'A 12-bar blues in C. The E flat against E natural is the "blue note".',
    arrangements: [
      {
        id: 'easy', name: 'Both hands – easy', level: 20, key: 'C', time: '4/4', bpm: 96,
        rh: `G4:8 A4 C5 Eb5 E5:q C5 | Eb5:q C5:8 A4 C5:h | G4:8 A4 C5 Eb5 E5:q C5 | Bb4 G4 E4:h |
             C5:8 Eb5 F5 Ab5 A5:q F5 | Eb5:q C5:8 A4 F4:h | G4:8 A4 C5 Eb5 E5:q C5 | Bb4 A4 G4:h |
             D5:8 F5 G5:q F5:8 D5 B4:q | C5:8 Eb5 F5:q Eb5:8 C5 A4:q | G4:8 A4 C5 Eb5 E5:q C5 | D5 B4 C5:h`,
        lh: `C3:h C3 | F2 F2 | C3 C3 | C3 C3 | F2 F2 | F2 F2 | C3 C3 | C3 C3 | G2 G2 | F2 F2 | C3 C3 | G2 C3`,
      },
      {
        id: 'both', name: 'Both hands – walking bass', level: 32, key: 'C', time: '4/4', bpm: 112,
        rh: `G4:8 A4 C5 Eb5 E5:q C5 | Eb5:q C5:8 A4 C5:h | G4:8 A4 C5 Eb5 E5:q C5 | Bb4 G4 E4:h |
             C5:8 Eb5 F5 Ab5 A5:q F5 | Eb5:q C5:8 A4 F4:h | G4:8 A4 C5 Eb5 E5:q C5 | Bb4 A4 G4:h |
             D5:8 F5 G5:q F5:8 D5 B4:q | C5:8 Eb5 F5:q Eb5:8 C5 A4:q | G4:8 A4 C5 Eb5 E5:q C5 | D5 B4 C5:h`,
        lh: `C3:q E3 G3 A3 | F2 A2 C3 Eb3 | C3 E3 G3 A3 | Bb3 A3 G3 E3 |
             F2 A2 C3 D3 | Eb3 D3 C3 A2 | C3 E3 G3 A3 | C3 E3 G3 F#3 |
             G2 B2 D3 F3 | F2 A2 C3 Eb3 | C3 E3 G3 A3 | G2 B2 C3:h`,
      },
    ],
  },
  {
    id: 'the-entertainer',
    title: 'The Entertainer',
    composer: 'Scott Joplin',
    year: 1902,
    origin: 'ragtime',
    category: 'Ragtime & blues',
    license: PD_ED('Scott Joplin', 1917),
    source: MUTOPIA('JoplinS/entertainer/entertainer.ly') + ' (introduction and first strain).',
    about: 'Joplin\'s famous rag. "Not fast": ragtime should never be played fast, he wrote.',
    arrangements: [
      {
        id: 'theme', name: 'Theme with easy left hand', level: 21, key: 'C', time: '2/4', bpm: 70, pickup: 0.5,
        note: 'The high part of the tune is brought down an octave and the left hand plays one bass note and one chord per bar.',
        rh: `D4:16 D#4 |
             E4:16 C5:8 E4:16 C5:8 E4:16 C5~ | C5:q~ C5:16 C5 D5 D#5 | E5:16 C5 D5 E5~ E5 B4 D5:8 | C5:q. D4:16 D#4 |
             E4:16 C5:8 E4:16 C5:8 E4:16 C5~ | C5:q. A4:16 G4 | F#4:16 A4 C5 E5~ E5 D5 C5 A4 | D5:q. D4:16 D#4 |
             E4:16 C5:8 E4:16 C5:8 E4:16 C5~ | C5:q~ C5:16 C5 D5 D#5 | E5:16 C5 D5 E5~ E5 B4 D5:8 | C5:q. C5:16 D5 |
             E5:16 C5 D5 E5~ E5 C5 D5 C5 | E5:16 C5 D5 E5~ E5 C5 D5 C5 | E5:16 C5 D5 E5~ E5 B4 D5:8 | C5:h`,
        lh: `r:8 |
             C3:q [E3 G3 C4] | F2 [F3 A3 C4] | G2 [F3 G3 B3] | C3 [E3 G3 C4] |
             C3 [E3 G3 C4] | F2 [F3 A3 C4] | D3 [F#3 A3 C4] | G2 [G3 B3] |
             C3 [E3 G3 C4] | F2 [F3 A3 C4] | G2 [F3 G3 B3] | C3 [E3 G3 C4] |
             C3 [G3 C4 E4] | A2 [A3 C4 F4] | G2 [F3 G3 B3] | C3:h`,
      },
      {
        id: 'both', name: 'Both hands', level: 35, key: 'C', time: '2/4', bpm: 72,
        rh: `[D5 D6]:16 [E5 E6] [C5 C6] [A4 A5]~ [A4 A5] [B4 B5] [G4 G5]:8 | D5:16 E5 C5 A4~ A4 B4 G4:8 | D4:16 E4 C4 r r:q | r:q [G4 B4 D5 G5]:8 D4:16 D#4 |
             E4:16 C5:8 E4:16 C5:8 E4:16 C5~ | C5:q~ C5:16 [C5 E5 C6] [D5 F5 D6] [D#5 F#5 D#6] |
             [E5 G5 E6]:16 [C5 E5 C6] [D5 F5 D6] [E5 G5 E6]~ [E5 G5 E6] [B4 D5 B5] [D5 F5 D6]:8 | [C5 E5 C6]:q. D4:16 D#4 |
             E4:16 C5:8 E4:16 C5:8 E4:16 C5~ | C5:q. [A4 C5 A5]:16 [G4 C5 G5] |
             [F#4 C5 F#5]:16 [A4 A5] [C5 C6] [E5 E6]~ [E5 E6] [D5 D6] [C5 C6] [A4 A5] | [D5 F5 D6]:q. D4:16 D#4 |
             E4:16 C5:8 E4:16 C5:8 E4:16 C5~ | C5:q~ C5:16 [C5 E5 C6] [D5 F5 D6] [D#5 F#5 D#6] |
             [E5 G5 E6]:16 [C5 E5 C6] [D5 F5 D6] [E5 G5 E6]~ [E5 G5 E6] [B4 D5 B5] [D5 F5 D6]:8 | [C5 E5 C6]:q. [C5 C6]:16 [D5 D6] |
             [E5 E6]:16 [C5 C6] [D5 D6] [E5 E6]~ [E5 E6] [C5 C6] [D5 D6] [C5 C6] | [E5 E6]:16 [C5 C6] [D5 D6] [E5 E6]~ [E5 E6] [C5 C6] [D5 D6] [C5 C6] |
             [E5 G5 E6]:16 [C5 E5 C6] [D5 F5 D6] [E5 G5 E6]~ [E5 G5 E6] [B4 D5 B5] [D5 F5 D6]:8 | [C5 E5 C6]:q. r:8`,
        lh: `R | D4:16 E4 C4 A3~ A3 B3 G3:8 | D3:16 E3 C3 [A2 A3]~ [A2 A3] [B2 B3] [A2 A3] [G#2 G#3] | [G2 G3]:8 r [G1 G2] [G3 B3] |
             C3:8 [E3 G3 C4] [G2 G3] [G3 Bb3 C4] | [F2 F3] [A3 C4] [E2 E3] [G3 C4] |
             G2 [E3 G3 C4] G2 [F3 G3 B3] | C3 [E3 G3 C4] [E3 G3 C4] [G3 B3] |
             C3 [E3 G3 C4] [G2 G3] [G3 Bb3 C4] | [F2 F3] [A3 C4] [E2 E3] [D#2 D#3] |
             [D2 D3] [D3 F#3 A3 C4] D3 [F#3 A3 C4] | [G3 B3] [G2 G3] [A2 A3] [B2 B3] |
             C3 [E3 G3 C4] [G2 G3] [G3 Bb3 C4] | [F2 F3] [A3 C4] [E2 E3] [G3 C4] |
             G2 [E3 G3 C4] G2 [F3 G3 B3] | C3 [E3 G3 C4] [G3 C4 E4] r |
             [C3 C4] [G3 C4 E4] [Bb2 Bb3] [G3 C4 E4] | [A2 A3] [A3 C4 F4] [Ab2 Ab3] [Ab3 C4 F4] |
             [G2 G3] [G3 C4 E4] G2 [G3 B3] | [C3 G3 C4] r r:q`,
      },
    ],
  },
  {
    id: 'maple-leaf-rag',
    title: 'Maple Leaf Rag',
    composer: 'Scott Joplin',
    year: 1899,
    origin: 'ragtime',
    category: 'Ragtime & blues',
    license: PD_ED('Scott Joplin', 1917),
    source: MUTOPIA('JoplinS/maple/maple.ly') + ' (first strain; the right hand\'s dip into the bass in bar 7 is given to the left hand).',
    about: 'The rag that made Joplin famous: syncopated octaves over a striding left hand.',
    arrangements: [
      {
        id: 'both', name: 'Both hands (first strain)', level: 39, key: 'Ab', time: '2/4', bpm: 84, pickup: 0.5,
        rh: `r:8 |
             r:16 Ab4 [Eb4 Eb5] Ab4 C5 [Eb4 Eb5]:8 G4:16 | [Eb4 Eb5]:16 G4 Bb4 [Eb4 Eb5]~ [Eb4 Eb5]:q |
             r:16 Ab4 [Eb4 Eb5] Ab4 C5 [Eb4 Eb5]:8 G4:16 | [Eb4 Eb5]:16 G4 Bb4 [Eb4 Eb5]~ [Eb4 Eb5]:8 r:16 [Eb4 Eb5] |
             r:16 Ab4 Cb5 [Fb4 Fb5] r [Eb4 Eb5] r [Eb4 Eb5] | r:16 Ab4 Cb5 [Fb4 Fb5] r [Eb4 Eb5] r:8 |
             R | r:16 Ab4 Cb5 Ab5 r Ab5 Cb6 Ab6 |
             [Ab5 Ab6]:8 [Ab5 Ab6] [Ab5 Ab6] [Ab5 Ab6]:16 [Ab5 Ab6]~ | [Ab5 Ab6]:16 Eb6 F6 C6 Eb6 [Ab5 F6]:8 [Fb5 Ab5]:16~ |
             [Fb5 Ab5]:16 Bb5 [Fb5 Cb6] Ab5 Bb5 [Eb5 C6]:8 Ab5:16 | [Eb5 C6]:16 Ab5 [Eb5 Bb5]:8 [Eb5 Ab5] r:16 [Ab4 Ab5]~ |
             [Ab4 Ab5]:8 [Ab4 Ab5] [Ab4 Ab5] [Ab4 Ab5]:16 [Ab4 Ab5]~ | [Ab4 Ab5]:16 Eb5 [Ab4 F5] C5 Eb5 [Ab4 F5]:8 [Fb4 Ab4]:16~ |
             [Fb4 Ab4]:16 Bb4 [Fb4 Cb5] Ab4 Bb4 [Eb4 C5]:8 Ab4:16 | [Eb4 C5]:16 Ab4 [Eb4 Bb4]:8 [Eb4 Ab4] r`,
        lh: `[Eb2 Eb3]:8 |
             [Ab2 Ab3]:8 [Eb3 Ab3 C4] [Eb3 Ab3 C4] [A2 A3] | [Bb2 Bb3] [Eb3 G3 Db4] [Eb3 G3 Db4] [Eb2 Eb3] |
             [Ab2 Ab3] [Eb3 Ab3 C4] [Eb3 Ab3 C4] [A2 A3] | [Bb2 Bb3] [Eb3 G3 Db4] [Eb3 G3 Db4] [Eb2 Eb3] |
             [Fb2 Fb3]:q [Eb2 Eb3]:8 [Eb2 Eb3] | [Fb2 Fb3]:q [Eb2 Eb3]:8 r |
             Ab1:16 Ab2 Cb3 Ab3 Ab2 Ab3 Cb4 Ab4 | Ab3:8 r Ab4 r |
             [D4 F4 Ab4 Cb5] [D4 F4 Ab4 Cb5] [D4 F4 Ab4 Cb5] [D4 F4 Ab4 Cb5] | [Eb4 Ab4 C5] [Eb4 Ab4 C5] [Eb4 Ab4 C5] [Eb4 Ab4 C5] |
             [Fb4 Ab4 Cb5] [Fb4 Ab4 Cb5] [Eb4 Ab4 C5] [Eb4 Ab4 C5] | [Eb4 Ab4 C5] [Eb4 G4 Db5] [Ab4 C5] r |
             [D3 F3 Ab3 Cb4] [D3 F3 Ab3 Cb4] [D3 F3 Ab3 Cb4] [D3 F3 Ab3 Cb4] | [Eb3 Ab3 C4] [Eb3 Ab3 C4] [Eb3 Ab3 C4] [Eb3 Ab3 C4] |
             [Fb3 Ab3 Cb4] [Fb3 Ab3 Cb4] [Eb3 Ab3 C4] [Eb3 Ab3 C4] | [Eb3 Ab3 C4] [Eb3 G3 Db4] [Ab3 C4] r`,
      },
    ],
  },
];

const SONG_MAP = new Map(LIBRARY.map((s) => [s.id, s]));
export const SONGS = LIBRARY.map(songMeta);
const META_MAP = new Map(SONGS.map((s) => [s.id, s]));

export { LIBRARY as _LIBRARY };
