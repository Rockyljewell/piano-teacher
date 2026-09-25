// Standard MIDI File import: parse SMF (format 0/1), then turn the performance data into a
// playable, readable Piece (the same shape generate() returns): notes are quantized to a
// musical grid, merged into chords, split between the hands, laid out in measures with ties
// and rests, and clipped to the piano's range.
//
// Also exports the small notation helpers songs.js shares (notateSpan, extendTies,
// estimateLevel).
import { Key } from './theory.js';
import { TIME_SIGS, finish } from './generator.js';

const EPS = 1e-6;

// ---------------------------------------------------------------------------------------------
// Parsing

function toBytes(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  throw new TypeError('parseMidi expects an ArrayBuffer or Uint8Array');
}

// Text in MIDI files is usually UTF-8 or Latin-1; some tools write UTF-16 with a BOM.
function latin1(bytes) {
  try {
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

// Track names and texts that are not titles.
const BORING_NAME = /^(track|untitled|piano|unnamed|staff|voice|control track|seq(uence)?)\s*[-:#]?\s*\d*$|creat|generat|lilypond|copyright|\(c\)|©|^at \w{3} \w{3} /i;

/**
 * Parse a Standard MIDI File.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 * @returns {{format:number, division:number, tracks:Array, tempos:Array, timeSignatures:Array,
 *   keySignatures:Array, title:string|null, durationBeats:number}}
 * Times are in ticks and in quarter-note beats (tick / division).
 */
export function parseMidi(arrayBuffer) {
  const b = toBytes(arrayBuffer);
  let pos = 0;
  const u8 = () => {
    if (pos >= b.length) throw new Error('Unexpected end of MIDI data');
    return b[pos++];
  };
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) >>> 0) + (u8() << 16) + (u8() << 8) + u8();
  const str4 = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = u8();
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    return v;
  };

  // Some files wrap the SMF in a RIFF (RMID) container.
  if (b.length > 20 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF') {
    for (let i = 12; i < b.length - 8; i++) if (b[i] === 0x4d && b[i + 1] === 0x54 && b[i + 2] === 0x68 && b[i + 3] === 0x64) { pos = i; break; }
  }
  if (b.length < 14 || str4() !== 'MThd') throw new Error('Not a MIDI file (missing MThd header)');
  const hlen = u32();
  const hstart = pos;
  const format = u16();
  const ntracks = u16();
  const div = u16();
  pos = hstart + hlen;
  let division = div;
  if (div & 0x8000) {
    // SMPTE time: ticks per second. Treat as 120 bpm so beats stay meaningful.
    const fps = 256 - (div >> 8);
    const tpf = div & 0xff;
    division = Math.max(1, Math.round((fps * tpf) / 2));
  }
  if (!division) division = 480;

  const tracks = [];
  const tempos = [];
  const timeSignatures = [];
  const keySignatures = [];
  let title = null;

  for (let t = 0; t < ntracks && pos + 8 <= b.length; t++) {
    let id = str4();
    let len = u32();
    // Skip unknown chunks.
    while (id !== 'MTrk' && pos + len + 8 <= b.length) {
      pos += len;
      id = str4();
      len = u32();
    }
    if (id !== 'MTrk') break;
    const end = Math.min(b.length, pos + len);
    const track = { index: tracks.length, name: null, instrument: null, program: null, channels: new Set(), notes: [], events: [] };
    const open = new Map(); // channel*128+midi -> [note...]
    let tick = 0;
    let status = 0;
    const closeNote = (ch, midi, at) => {
      const k = ch * 128 + midi;
      const list = open.get(k);
      if (!list || !list.length) return;
      const n = list.shift();
      n.endTick = Math.max(n.startTick, at);
    };
    try {
      while (pos < end) {
        tick += vlq();
        let st = b[pos];
        if (st & 0x80) {
          pos++;
        } else {
          st = status; // running status
          if (!st) {
            pos++;
            continue;
          }
        }
        if (st === 0xff) {
          const type = u8();
          const l = vlq();
          const data = b.subarray(pos, Math.min(end, pos + l));
          pos += l;
          track.events.push({ tick, type: 'meta', meta: type, data });
          if (type === 0x03) {
            track.name = latin1(data).trim();
          } else if (type === 0x04) {
            track.instrument = latin1(data).trim();
          } else if (type === 0x01 && title === null && tick === 0 && t === 0 && data.length && data.length < 80) {
            // First text event in the first track is often the title (LilyPond writes it here).
            const txt = latin1(data).trim();
            if (txt && !BORING_NAME.test(txt)) title = txt;
          } else if (type === 0x51 && data.length >= 3) {
            const us = (data[0] << 16) | (data[1] << 8) | data[2];
            if (us > 0) tempos.push({ tick, usPerQuarter: us, bpm: 60000000 / us });
          } else if (type === 0x58 && data.length >= 2) {
            timeSignatures.push({ tick, num: data[0], den: 2 ** data[1] });
          } else if (type === 0x59 && data.length >= 2) {
            const sf = data[0] > 127 ? data[0] - 256 : data[0];
            keySignatures.push({ tick, fifths: sf, mode: data[1] ? 'minor' : 'major' });
          } else if (type === 0x2f) {
            break;
          }
          // Meta events do not cancel running status in practice (many files rely on this).
          continue;
        }
        if (st === 0xf0 || st === 0xf7) {
          const l = vlq();
          pos += l;
          status = 0;
          continue;
        }
        if (st >= 0xf1) {
          // System common/realtime bytes do not belong in files; skip their data defensively.
          if (st === 0xf2) pos += 2;
          else if (st === 0xf3 || st === 0xf1) pos += 1;
          continue;
        }
        status = st;
        const kind = st & 0xf0;
        const ch = st & 0x0f;
        const d1 = u8();
        const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : u8();
        track.channels.add(ch);
        if (kind === 0x90 && d2 > 0) {
          const k = ch * 128 + d1;
          let list = open.get(k);
          if (!list) open.set(k, (list = []));
          // A re-strike of a sounding key ends the previous note.
          if (list.length) closeNote(ch, d1, tick);
          const n = { midi: d1, velocity: d2, channel: ch, startTick: tick, endTick: null, track: track.index };
          list.push(n);
          track.notes.push(n);
        } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
          closeNote(ch, d1, tick);
        } else if (kind === 0xc0) {
          if (track.program === null) track.program = d1;
        }
      }
    } catch {
      // A truncated or damaged track: keep what was read so far.
    }
    pos = end;
    for (const n of track.notes) if (n.endTick === null) n.endTick = Math.max(n.startTick + 1, tick);
    for (const n of track.notes) {
      n.start = n.startTick / division;
      n.end = n.endTick / division;
    }
    track.notes.sort((a, c) => a.startTick - c.startTick || a.midi - c.midi);
    tracks.push(track);
  }
  const addBeat = (x) => (x.beat = x.tick / division);
  tempos.sort((a, c) => a.tick - c.tick).forEach(addBeat);
  timeSignatures.sort((a, c) => a.tick - c.tick).forEach(addBeat);
  keySignatures.sort((a, c) => a.tick - c.tick).forEach(addBeat);
  if (!title) {
    const named = tracks.find((tr) => tr.name && !tr.notes.length) || (format === 0 ? tracks[0] : null);
    if (named && named.name && !BORING_NAME.test(named.name)) title = named.name;
  }
  let durationBeats = 0;
  for (const tr of tracks) for (const n of tr.notes) durationBeats = Math.max(durationBeats, n.end);
  return { format, division, tracks, tempos, timeSignatures, keySignatures, title, durationBeats };
}

// ---------------------------------------------------------------------------------------------
// Notation helpers (shared with songs.js)

const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;
const fmod = (a, m) => {
  const r = a - Math.floor(a / m + 1e-9) * m;
  return near(r, m) ? 0 : r;
};

// May a note of duration d start at offset r (beats from the barline)? `whole` is true when d
// covers the whole remaining note, which is when syncopated values (crossing a beat) read well.
function allowed(d, r, ts, whole) {
  const beats = ts.beats;
  const onGrid = (g) => near(fmod(r, g), 0);
  const withinBeat = (g) => Math.floor(r / g + 1e-9) === Math.floor((r + d - 1e-6) / g + 1e-9);
  if (ts.compound) {
    if (d === 3) return near(r, 0) && beats >= 3;
    if (d === 1.5) return onGrid(1.5);
    if (d === 1 || d === 0.75) return onGrid(0.5) && withinBeat(1.5);
    if (d === 0.5) return onGrid(0.5) || (onGrid(0.25) && withinBeat(1.5));
    if (d === 0.375) return onGrid(0.5) && withinBeat(1.5);
    return onGrid(d);
  }
  const half = beats === 4 ? 2 : beats;
  const crossesHalf = beats === 4 && r < 2 - EPS && r + d > 2 + EPS;
  switch (d) {
    case 4:
      return beats === 4 && near(r, 0);
    case 3:
      return near(r, 0) || (beats === 4 && near(r, 1) && whole);
    case 2:
      if (beats === 3) return onGrid(1);
      if (beats === 2) return near(r, 0);
      return onGrid(2) || (near(r, 1) && whole);
    case 1.5:
      return onGrid(1) && (!crossesHalf || whole) && r + 1.5 <= beats + EPS;
    case 1:
      return onGrid(1) || (onGrid(0.5) && whole && !crossesHalf);
    case 0.75:
      return onGrid(0.25) && withinBeat(1);
    case 0.5:
      return onGrid(0.5) || (onGrid(0.25) && withinBeat(1));
    case 0.375:
      return onGrid(0.5) && withinBeat(1);
    default:
      return onGrid(d) && (d < half || near(r, 0));
  }
}

const SIMPLE_VALUES = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125];
const COMPOUND_VALUES = [3, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125];

/**
 * Split the span [pos, pos+len) (in beats) into note values a score can show: every piece stays
 * inside one measure, uses plain or dotted values, and starts where that value may start.
 * `tripletBeat(b)` (optional) marks beats that are divided in three (eighth-note triplets).
 * Returns [{beat, dur, tuplet?}].
 */
export function notateSpan(pos, len, ts, tripletBeat = null) {
  const out = [];
  let p = pos;
  const end = pos + len;
  let guard = 0;
  while (p < end - EPS && guard++ < 1000) {
    const mStart = Math.floor(p / ts.beats + 1e-9) * ts.beats;
    const mEnd = mStart + ts.beats;
    const segEnd = Math.min(end, mEnd);
    const beatIdx = Math.floor(p + 1e-6);
    if (tripletBeat && !ts.compound && tripletBeat(beatIdx)) {
      const be = beatIdx + 1;
      const e = Math.min(segEnd, be);
      if (near(p, beatIdx) && near(e, be)) out.push({ beat: p, dur: 1 });
      else out.push({ beat: p, dur: e - p, tuplet: 3 });
      p = e;
      continue;
    }
    // Do not run into a triplet beat with a duple value.
    let limit = segEnd;
    if (tripletBeat && !ts.compound) for (let k = beatIdx + 1; k < segEnd - EPS; k++) if (tripletBeat(k)) { limit = Math.min(limit, k); break; }
    const r = p - mStart;
    const rem = limit - p;
    let d = null;
    for (const v of ts.compound ? COMPOUND_VALUES : SIMPLE_VALUES) {
      if (v > rem + EPS) continue;
      if (allowed(v, r, ts, near(v, end - p))) {
        d = v;
        break;
      }
    }
    if (d === null) {
      // Off-grid remainder (should not happen with quantized input): take it as it is.
      const g = 0.125;
      const nextGrid = Math.min(limit, mStart + (Math.floor(r / g + 1e-9) + 1) * g);
      d = Math.max(nextGrid - p, Math.min(rem, g));
    }
    out.push({ beat: p, dur: d });
    p = Math.round((p + d) * 48) / 48;
  }
  return out;
}

/** Give each struck note the full length of its tie chain (for falling notes and playback). */
export function extendTies(piece) {
  const byId = new Map(piece.events.map((e) => [e.id, e]));
  for (const n of piece.notes) {
    let e = byId.get(n.eventId);
    let dur = e.dur;
    let guard = 0;
    while (e && e.tieNext && guard++ < 64) {
      e = byId.get(e.tieNext);
      if (!e) break;
      dur += e.dur;
    }
    n.dur = dur;
  }
  return piece;
}

/**
 * Estimate the curriculum level (1-40) needed to play a piece: hands, rhythm values, key,
 * chords, range, speed and chromaticism each set a minimum level.
 */
export function estimateLevel(piece) {
  const evs = piece.events.filter((e) => !e.rest && !e.tiedFrom);
  if (!evs.length) return 1;
  let lv = 1;
  const need = (x) => (lv = Math.max(lv, x));
  const hands = new Set(evs.map((e) => e.hand));
  if (hands.size === 2) {
    // Hands together or taking turns?
    const byBeat = new Map();
    for (const e of evs) byBeat.set(e.beat.toFixed(3), (byBeat.get(e.beat.toFixed(3)) || new Set()).add(e.hand));
    const together = [...byBeat.values()].filter((s) => s.size === 2).length;
    need(together ? 6 : 4);
  } else if (hands.has('L')) need(3);
  const has = (f) => evs.some(f);
  if (has((e) => e.dur < 1 - EPS && !e.tuplet)) need(7);
  if (has((e) => near(e.dur, 1.5) || near(e.dur, 0.75))) need(12);
  if (has((e) => e.dur < 0.5 - EPS && !e.tuplet)) need(19);
  if (has((e) => e.tuplet)) need(23);
  if (has((e) => e.tieNext)) need(12);
  if (piece.tsName === '6/8') need(12);
  if (piece.tsName === '3/4') need(5);
  const f = Math.abs(piece.key.fifths);
  need([1, 8, 13, 21, 28, 28, 33, 33][f]);
  if (piece.key.mode === 'minor') need(15);
  const rh = evs.filter((e) => e.hand === 'R');
  const lh = evs.filter((e) => e.hand === 'L');
  if (rh.some((e) => e.midis.length === 2)) need(10);
  if (rh.some((e) => e.midis.length >= 3)) need(22);
  if (lh.some((e) => e.midis.length >= 3)) need(14);
  if (lh.some((e) => e.midis.length === 2)) need(12);
  const all = evs.flatMap((e) => e.midis);
  const rhN = rh.flatMap((e) => e.midis);
  if (rhN.length) {
    const span = Math.max(...rhN) - Math.min(...rhN);
    if (span > 7) need(2);
    if (span > 9) need(9);
    if (span > 14) need(13);
  }
  if (Math.max(...all) > 84 || Math.min(...all) < 38) need(18);
  if (Math.max(...all) > 93 || Math.min(...all) < 29) need(36);
  // Chromatic notes (the raised 6th and 7th of minor keys do not count).
  const pcs = piece.key.scalePcs();
  const raised = piece.key.mode === 'minor' ? [(pcs[5] + 1) % 12, (pcs[6] + 1) % 12] : [];
  const chrom = all.filter((m) => !pcs.includes(m % 12) && !raised.includes(m % 12)).length / all.length;
  if (chrom > 0.02) need(15);
  if (chrom > 0.06) need(29);
  // Wide leaps / octaves in the left hand.
  if (lh.some((e) => e.midis.length === 2 && e.midis[1] - e.midis[0] === 12)) need(31);
  // Speed: onsets per second.
  const secs = (piece.totalBeats * 60) / piece.bpm;
  const onsets = new Set(evs.map((e) => e.beat.toFixed(3))).size;
  const nps = onsets / Math.max(1, secs);
  if (nps > 2.5) need(12);
  if (nps > 3.5) need(19);
  if (nps > 5) need(27);
  if (nps > 7) need(35);
  if (nps > 9) need(39);
  return Math.max(1, Math.min(40, lv));
}

// ---------------------------------------------------------------------------------------------
// MIDI -> Piece

// Map any MIDI time signature onto one the app can show. `scale` stretches time (9/8 becomes
// 3/4 with triplets).
function mapTimeSignature(num, den) {
  const k = `${num}/${den}`;
  if (TIME_SIGS[k]) return { tsName: k, scale: 1 };
  if (k === '2/2' || k === '4/2' || k === '8/8' || k === '8/4') return { tsName: '4/4', scale: 1 };
  if (k === '3/8' || k === '12/8' || k === '12/16' || k === '6/16') return { tsName: '6/8', scale: den === 16 ? 2 : 1 };
  if (k === '9/8') return { tsName: '3/4', scale: 2 / 3 };
  if (k === '6/4' || k === '3/2') return { tsName: '3/4', scale: 1 };
  if (k === '2/8' || k === '4/8' || k === '1/4') return { tsName: '2/4', scale: 1 };
  const beats = (num * 4) / den;
  if (den >= 8 && num % 3 === 0 && num > 3) return { tsName: '6/8', scale: 1 };
  if (beats % 4 === 0) return { tsName: '4/4', scale: 1 };
  if (beats % 3 === 0) return { tsName: '3/4', scale: 1 };
  if (beats % 2 === 0) return { tsName: '2/4', scale: 1 };
  return { tsName: '4/4', scale: 1 };
}

// Krumhansl-Kessler key profiles.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function estimateKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.midi % 12] += Math.min(4, Math.max(0.25, n.end - n.start));
  const corr = (prof, tonic) => {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < 12; i++) {
      const x = hist[(i + tonic) % 12];
      const y = prof[i];
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    const cov = sxy - (sx * sy) / 12;
    const den = Math.sqrt((sxx - (sx * sx) / 12) * (syy - (sy * sy) / 12)) || 1;
    return cov / den;
  };
  let best = { r: -Infinity, fifths: 0, mode: 'major' };
  for (let t = 0; t < 12; t++) {
    for (const mode of ['major', 'minor']) {
      const r = corr(mode === 'major' ? KK_MAJOR : KK_MINOR, t);
      if (r > best.r + 1e-9) {
        const majorPc = mode === 'major' ? t : (t + 3) % 12;
        let f = (majorPc * 7) % 12;
        if (f > 6) f -= 12;
        best = { r, fifths: f, mode };
      }
    }
  }
  return new Key(best.fifths, best.mode);
}

// Choose how far the music is shifted relative to the barlines (a pickup that starts at tick
// 0): the shift that puts the most weight on downbeats wins. Each onset in the opening bars
// weighs its longest note, plus one if it is the bass (lowest note around it). Only a clearly
// better shift replaces "no pickup". Tuned on Mutopia files with known pickups.
function detectShift(notes, barLen, step = 0.25) {
  const horizon = barLen * 16;
  const early = notes.filter((n) => n.start < horizon);
  const onsets = new Map();
  for (const n of early) {
    const k = Math.round(n.start * 96);
    const o = onsets.get(k) || { t: n.start, dur: 0, low: 999 };
    o.dur = Math.max(o.dur, n.end - n.start);
    o.low = Math.min(o.low, n.midi);
    onsets.set(k, o);
  }
  const weighted = [...onsets.values()].map((o) => {
    let localLow = 999;
    for (const n of early) if (n.start < o.t + 0.5 && n.end > o.t - 0.5) localLow = Math.min(localLow, n.midi);
    return { t: o.t, w: Math.min(2, o.dur) + (o.low <= localLow && o.low < 62 ? 1 : 0) };
  });
  const score = (s) => weighted.reduce((a, o) => a + (near(fmod(o.t + s, barLen), 0, 0.03) ? o.w : 0), 0);
  const base = score(0);
  let best = 0;
  let bestScore = base;
  for (let s = step; s < barLen - EPS; s += step) {
    const sc = score(s);
    if (sc > bestScore) {
      best = s;
      bestScore = sc;
    }
  }
  return bestScore > base * 1.1 + 0.5 ? best : 0;
}

// Split notes between the hands. Tracks first (two-staff piano files), else by pitch with a
// split point that follows the music.
function splitHands(notes, tracks, handSplit) {
  if (typeof handSplit === 'number') {
    for (const n of notes) n.hand = n.midi < handSplit ? 'L' : 'R';
    return 'fixed';
  }
  const withNotes = tracks.filter((t) => notes.some((n) => n.track === t.index));
  if (withNotes.length >= 2) {
    const info = withNotes.map((t) => {
      const ns = notes.filter((n) => n.track === t.index);
      const mean = ns.reduce((a, n) => a + n.midi, 0) / ns.length;
      const nm = `${t.name || ''} ${t.instrument || ''}`.toLowerCase();
      let hint = null;
      if (/\b(left|lh|bass|lower|links|l\.?h\.?|unten)\b|\bpiano\s*2\b/.test(nm)) hint = 'L';
      if (/\b(right|rh|treble|upper|rechts|r\.?h\.?|melody|oben)\b|\bpiano\s*1\b/.test(nm)) hint = 'R';
      return { t, mean, hint, count: ns.length };
    });
    // Tracks must look like separate staves: clearly different registers or named hands.
    const means = info.map((x) => x.mean).sort((a, c) => a - c);
    const spread = means[means.length - 1] - means[0];
    if (info.every((x) => x.hint) && new Set(info.map((x) => x.hint)).size === 2) {
      for (const x of info) for (const n of notes) if (n.track === x.t.index) n.hand = x.hint;
      return 'tracks';
    }
    if (spread >= 7) {
      // Group tracks around the biggest gap in their mean pitch.
      const sorted = [...info].sort((a, c) => a.mean - c.mean);
      let gapAt = 1;
      let gap = -1;
      for (let i = 1; i < sorted.length; i++) if (sorted[i].mean - sorted[i - 1].mean > gap) { gap = sorted[i].mean - sorted[i - 1].mean; gapAt = i; }
      const lowSet = new Set(sorted.slice(0, gapAt).map((x) => x.t.index));
      for (const n of notes) n.hand = lowSet.has(n.track) ? 'L' : 'R';
      return 'tracks';
    }
  }
  // A single melodic line stays in one hand.
  const sorted = [...notes].sort((x, y) => x.start - y.start);
  let overlaps = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end - 0.05) overlaps++;
  const mids = notes.map((n) => n.midi).sort((x, y) => x - y);
  const median = mids[mids.length >> 1];
  if (overlaps < notes.length * 0.05 && mids[mids.length - 1] - mids[0] <= 24) {
    for (const n of notes) n.hand = median >= 55 ? 'R' : 'L';
    return 'single';
  }
  // Otherwise a moving split point: at each onset, the widest gap inside the chord that is
  // sounding (preferring gaps near middle C), then smoothed per two-beat window.
  const end = Math.max(...notes.map((n) => n.end));
  const win = 2;
  const nWin = Math.max(1, Math.ceil(end / win));
  const cands = Array.from({ length: nWin }, () => []);
  const starts = [...new Set(notes.map((n) => n.start.toFixed(3)))].map(Number);
  for (const t of starts) {
    const ps = [...new Set(notes.filter((n) => n.start <= t + 0.01 && n.end > t + 0.01).map((n) => n.midi))].sort((x, y) => x - y);
    if (ps.length < 2) continue;
    let best = null;
    for (let i = 1; i < ps.length; i++) {
      const gap = ps[i] - ps[i - 1];
      const mid = (ps[i] + ps[i - 1]) / 2;
      const g = gap - Math.abs(mid - 60) * 0.2;
      if (gap >= 3 && (!best || g > best.g)) best = { g, mid };
    }
    if (best) cands[Math.min(nWin - 1, Math.floor(t / win))].push(best.mid);
  }
  const split = [];
  let cur = 60;
  for (let w = 0; w < nWin; w++) {
    if (cands[w].length) {
      const c = [...cands[w]].sort((x, y) => x - y)[cands[w].length >> 1];
      cur = cur * 0.5 + Math.max(48, Math.min(72, c)) * 0.5;
    }
    split.push(cur);
  }
  const splitAt = (t) => split[Math.max(0, Math.min(nWin - 1, Math.floor(t / win)))];
  for (const n of notes) n.hand = n.midi < splitAt(n.start) ? 'L' : 'R';
  // Keep each chord playable: at most a ninth per hand, moving outer notes across if needed.
  const groups = new Map();
  for (const n of notes) {
    const k = n.start.toFixed(2);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  for (const g of groups.values()) {
    const r = g.filter((n) => n.hand === 'R').sort((a, c) => a.midi - c.midi);
    const l = g.filter((n) => n.hand === 'L').sort((a, c) => a.midi - c.midi);
    while (r.length > 1 && r[r.length - 1].midi - r[0].midi > 14 && (!l.length || r[0].midi - l[0].midi <= 14)) {
      const n = r.shift();
      n.hand = 'L';
      l.push(n);
      l.sort((a, c) => a.midi - c.midi);
    }
    while (l.length > 1 && l[l.length - 1].midi - l[0].midi > 14 && (!r.length || r[r.length - 1].midi - l[l.length - 1].midi <= 14)) {
      const n = l.pop();
      n.hand = 'R';
      r.unshift(n);
    }
  }
  return 'pitch';
}

// Per-beat triplet detection (simple meters only): a beat is in triplets when its onsets are
// clearly off the sixteenth grid but on the triplet grid.
function tripletBeats(notes, ts) {
  const set = new Set();
  if (ts.compound) return set;
  const byBeat = new Map();
  for (const n of notes) {
    const b = Math.floor(n.start + 0.04);
    if (!byBeat.has(b)) byBeat.set(b, []);
    byBeat.get(b).push(n.start - b);
  }
  for (const [b, xs] of byBeat) {
    const uniq = [...new Set(xs.map((x) => Math.round(x * 96)))].map((x) => x / 96);
    const offDuple = uniq.filter((x) => Math.abs(x - Math.round(x * 4) / 4) > 0.05);
    if (offDuple.length < 1) continue;
    const eTrip = uniq.reduce((a, x) => a + Math.abs(x - Math.round(x * 3) / 3), 0);
    const eDup = uniq.reduce((a, x) => a + Math.abs(x - Math.round(x * 4) / 4), 0);
    const onThirds = uniq.filter((x) => Math.abs(x - Math.round(x * 3) / 3) < 0.04 && Math.abs(x - Math.round(x * 3) / 3) < Math.abs(x - Math.round(x * 4) / 4)).length;
    if (onThirds >= 1 && offDuple.length >= Math.min(2, uniq.length - 1) && eTrip < eDup * 0.5) set.add(b);
  }
  return set;
}

let nextId = 5000000;

/**
 * Turn a MIDI file into a Piece.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {number} [opts.maxMeasures=64]  longest result (measures)
 * @param {'auto'|16|8} [opts.quantize='auto']  finest grid: 16ths, 8ths, or chosen from the data
 * @param {'auto'|number} [opts.handSplit='auto']  'auto' (tracks, else moving pitch split) or a
 *   MIDI note number: notes below it go to the left hand
 * @param {number} [opts.bpm]  override the file's tempo (quarter notes per minute)
 * @param {number|'auto'} [opts.pickup='auto']  beats of pickup before the first barline
 * @param {number} [opts.startMeasure=0]  skip this many measures from the start
 * @param {boolean} [opts.triplets=true]  detect eighth-note triplets
 * @param {'4/4'|'3/4'|'2/4'|'6/8'} [opts.time]  override the file's time signature
 * @param {Key} [opts.key]  override the key signature (otherwise the file's, else estimated)
 * @returns {object} a Piece (see generate()) with kind 'song', source 'midi', level (estimated),
 *   pickup and startBeat (beats of pickup / where the first note is), handSplit
 *   ('tracks'|'pitch'|'single'|'fixed')
 */
export function midiToPiece(arrayBuffer, opts = {}) {
  const midi = parseMidi(arrayBuffer);
  const maxMeasures = Math.max(1, opts.maxMeasures ?? 64);
  let notes = [];
  for (const tr of midi.tracks) for (const n of tr.notes) if (n.channel !== 9 && n.end > n.start) notes.push({ ...n });
  if (!notes.length) throw new Error('This MIDI file has no notes to play');

  // Meter: the time signature in force when the music starts.
  const first = Math.min(...notes.map((n) => n.startTick));
  const tsEv = [...midi.timeSignatures].reverse().find((t) => t.tick <= first) || midi.timeSignatures[0];
  const mapped = opts.time && TIME_SIGS[opts.time] ? { tsName: opts.time, scale: 1 } : tsEv ? mapTimeSignature(tsEv.num, tsEv.den) : { tsName: '4/4', scale: 1 };
  const tsName = mapped.tsName;
  const ts = TIME_SIGS[tsName];
  const scale = mapped.scale;
  if (scale !== 1) for (const n of notes) (n.start *= scale), (n.end *= scale);

  // Tempo: the one in force when the music starts.
  const tempoEv = [...midi.tempos].reverse().find((t) => t.tick <= first) || midi.tempos[0];
  let bpm = opts.bpm || (tempoEv ? tempoEv.bpm : 120) * scale;
  bpm = Math.max(30, Math.min(240, Math.round(bpm)));

  // Remove leading silence (whole measures), then find the pickup offset.
  const t0 = Math.min(...notes.map((n) => n.start));
  const drop = Math.floor((t0 + 0.02) / ts.beats) * ts.beats;
  if (drop > 0) for (const n of notes) (n.start -= drop), (n.end -= drop);
  let shift = 0;
  if (typeof opts.pickup === 'number') {
    shift = ((ts.beats - (opts.pickup % ts.beats)) % ts.beats) - Math.min(...notes.map((n) => n.start));
    shift = ((shift % ts.beats) + ts.beats) % ts.beats;
  } else if (near(Math.min(...notes.map((n) => n.start)), 0, 0.02)) {
    // Detect in the file's own bar length, then make the first real downbeat start a bar.
    const origBar = tsEv ? ((tsEv.num * 4) / tsEv.den) * scale : ts.beats;
    shift = detectShift(notes, origBar);
    if (shift > 0 && !near(fmod(origBar, ts.beats), 0)) {
      const firstDown = Math.ceil(shift / origBar - 1e-9) * origBar;
      shift += fmod(ts.beats - fmod(firstDown, ts.beats), ts.beats);
    }
  }
  if (shift) for (const n of notes) (n.start += shift), (n.end += shift);
  if (opts.startMeasure) {
    const cut = opts.startMeasure * ts.beats;
    notes = notes.filter((n) => n.start >= cut - 0.02).map((n) => ({ ...n, start: n.start - cut, end: n.end - cut }));
    if (!notes.length) throw new Error('No notes after the start measure');
  }

  // Clip to the piano's keys by octaves.
  for (const n of notes) {
    while (n.midi < 21) n.midi += 12;
    while (n.midi > 108) n.midi -= 12;
  }

  const handMode = splitHands(notes, midi.tracks, opts.handSplit ?? 'auto');

  // Quantize per hand.
  const grid = opts.quantize === 8 ? 0.5 : opts.quantize === 16 ? 0.25 : null;
  let duple = grid;
  if (!duple) {
    // Files written from notation sit exactly on a fine grid: keep their sixteenths. Played-in
    // files are noisy: only use sixteenths when the eighth grid clearly does not fit.
    const lattice = notes.filter((n) => Math.abs(n.start * 12 - Math.round(n.start * 12)) < 0.06).length / notes.length;
    const off8 = notes.filter((n) => Math.abs(n.start - Math.round(n.start * 2) / 2) > 0.1).length;
    duple = lattice > 0.9 || off8 / notes.length >= 0.03 ? 0.25 : 0.5;
  }
  // Quantized times are whole units of 1/48 beat (exact for sixteenths and triplets).
  const TU = 48;
  const limitU = maxMeasures * ts.beats * TU;
  const dupleU = Math.round(duple * TU);
  const hands = { R: [], L: [] };
  const trip = {};
  for (const h of ['R', 'L']) {
    const hn = notes.filter((n) => n.hand === h);
    trip[h] = opts.triplets === false ? new Set() : tripletBeats(hn, ts);
    const q = (x, isEnd) => {
      const b = Math.floor(x + (isEnd ? -0.04 : 0.04));
      if (trip[h].has(b) && x - b < 1.04) return b * TU + Math.round((x - b) * 3) * (TU / 3);
      return Math.round((x * TU) / dupleU) * dupleU;
    };
    const merged = new Map();
    for (const n of hn) {
      const su = q(n.start, false);
      let eu = q(n.end, true);
      const stepU = trip[h].has(Math.floor(su / TU)) ? TU / 3 : dupleU;
      if (eu < su + stepU) eu = su + stepU;
      if (su >= limitU) continue;
      eu = Math.min(eu, limitU);
      const k = `${su}:${n.midi}`;
      const prev = merged.get(k);
      if (prev) prev.eu = Math.max(prev.eu, eu);
      else merged.set(k, { midi: n.midi, su, eu, velocity: n.velocity });
    }
    hands[h] = [...merged.values()].sort((x, y) => x.su - y.su || x.midi - y.midi);
  }

  let lastU = 0;
  for (const h of ['R', 'L']) for (const n of hands[h]) lastU = Math.max(lastU, n.eu);
  const measures = Math.max(1, Math.min(maxMeasures, Math.ceil(lastU / (ts.beats * TU) - 1e-9)));
  const total = measures * ts.beats;

  const key = opts.key instanceof Key ? opts.key : midi.keySignatures.length ? new Key(Math.max(-7, Math.min(7, midi.keySignatures[0].fifths)), midi.keySignatures[0].mode) : estimateKey(notes);

  // One voice per hand: each chord lasts until the next onset (or its release, then a rest).
  const events = [];
  const staves = [];
  for (const h of ['R', 'L']) {
    const staff = h === 'R' ? 'treble' : 'bass';
    const hn = hands[h];
    if (!hn.length) continue;
    staves.push(staff);
    const bySu = new Map();
    for (const n of hn) (bySu.get(n.su) || bySu.set(n.su, []).get(n.su)).push(n);
    const onsets = [...bySu.keys()].sort((x, y) => x - y);
    const spans = [];
    for (let i = 0; i < onsets.length; i++) {
      const su = onsets[i];
      const nextU = i + 1 < onsets.length ? onsets[i + 1] : total * TU;
      const chord = bySu.get(su);
      const eu = Math.min(nextU, Math.max(...chord.map((n) => n.eu)));
      spans.push({ start: su / TU, end: eu / TU, midis: [...new Set(chord.map((n) => n.midi))].sort((x, y) => x - y) });
    }
    const tb = (b) => trip[h].has(b);
    let pos = 0;
    const pushRest = (from, to) => {
      for (const seg of notateSpan(from, to - from, ts, tb)) events.push({ id: nextId++, staff, hand: h, beat: seg.beat, dur: seg.dur, midis: [], rest: true, tuplet: seg.tuplet });
    };
    for (const sp of spans) {
      if (sp.start > pos + EPS) pushRest(pos, sp.start);
      const segs = notateSpan(sp.start, sp.end - sp.start, ts, tb);
      let prev = null;
      for (const seg of segs) {
        const e = { id: nextId++, staff, hand: h, beat: seg.beat, dur: seg.dur, midis: [...sp.midis], rest: false, tuplet: seg.tuplet };
        if (prev) {
          prev.tieNext = e.id;
          e.tiedFrom = prev.id;
        }
        events.push(e);
        prev = e;
      }
      pos = sp.end;
    }
    if (pos < total - EPS) pushRest(pos, total);
    // Whole-measure rests read better as one centred rest.
    for (let m = 0; m < measures; m++) {
      const inM = events.filter((e) => e.hand === h && e.beat >= m * ts.beats - EPS && e.beat < (m + 1) * ts.beats - EPS);
      if (inM.length > 1 && inM.every((e) => e.rest)) {
        for (const e of inM) events.splice(events.indexOf(e), 1);
        events.push({ id: nextId++, staff, hand: h, beat: m * ts.beats, dur: ts.beats, midis: [], rest: true, measureRest: true });
      } else if (inM.length === 1 && inM[0].rest && near(inM[0].dur, ts.beats)) inM[0].measureRest = true;
    }
  }

  // Where the music starts: a first bar that opens with rests is a pickup.
  let startBeat = 0;
  const firstNote = events.filter((e) => !e.rest).reduce((a, e) => Math.min(a, e.beat), Infinity);
  if (firstNote > EPS && firstNote < ts.beats - EPS) {
    startBeat = firstNote;
    for (const e of events) if (e.rest && e.beat < startBeat - EPS) e.pickup = true;
  }
  const piece = finish({
    kind: 'song',
    source: 'midi',
    title: opts.title || midi.title || 'Imported MIDI',
    key,
    ts,
    tsName,
    bpm,
    measures,
    beatsPer: ts.beats,
    staves: staves.length ? staves : ['treble'],
    events,
    harmony: [],
    fingers: false,
    pickup: startBeat ? ts.beats - startBeat : 0,
    startBeat,
    handSplit: handMode,
  });
  extendTies(piece);
  piece.level = estimateLevel(piece);
  return piece;
}
