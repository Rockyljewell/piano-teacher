// A single play-through of a piece: owns the musical clock (count-in, tempo or wait mode),
// matches heard notes against the score and produces a graded result with detailed timing
// feedback (how early or late, by how many milliseconds) and what to work on (which bars,
// which notes, which hand, rushing or dragging).
import { noteName, STEP_NAMES } from '../music/theory.js';

// Timing windows (ms) by curriculum level. Beginners get generous windows; they tighten as
// the student advances. A note is "on time" inside `perfect`; the match window is `ok`.
// How long after a note's window closes before calling it missed (listener report delay).
const REPORT_GRACE = 0.15;

export const TIMING_PROFILES = [
  { upTo: 8, name: 'Beginner', perfect: 110, great: 190, good: 290, ok: 400 },
  { upTo: 16, name: 'Elementary', perfect: 90, great: 160, good: 240, ok: 330 },
  { upTo: 26, name: 'Intermediate', perfect: 70, great: 130, good: 200, ok: 280 },
  { upTo: 34, name: 'Advanced', perfect: 55, great: 105, good: 165, ok: 235 },
  { upTo: 99, name: 'Master', perfect: 45, great: 90, good: 140, ok: 200 },
];

export const GRADE_CREDIT = { perfect: 1, great: 0.9, good: 0.75, ok: 0.5 };
// Kept for backwards compatibility (v1 fixed windows).
export const GRADES = ['perfect', 'great', 'good', 'ok'].map((name) => ({ name, ms: TIMING_PROFILES[2][name], credit: GRADE_CREDIT[name] }));

export function timingProfile(level = 1) {
  return TIMING_PROFILES.find((p) => level <= p.upTo) || TIMING_PROFILES[TIMING_PROFILES.length - 1];
}

// Grade a signed timing error (seconds, + = late) against a profile.
export function gradeFor(errSec, profile) {
  const ms = Math.abs(errSec) * 1000;
  if (ms <= profile.perfect) return 'perfect';
  if (ms <= profile.great) return 'great';
  if (ms <= profile.good) return 'good';
  return 'ok';
}

// Human label for a hit: "Perfect", "Great · 70 ms late", "Early · 150 ms".
export function timingLabel(grade, errMs) {
  if (grade === 'perfect') return 'Perfect';
  const dir = errMs < 0 ? 'early' : 'late';
  const abs = Math.abs(Math.round(errMs));
  if (grade === 'great') return `Great · ${abs} ms ${dir}`;
  return `${dir === 'early' ? 'Early' : 'Late'} · ${abs} ms`;
}

// Describe an offset in musical terms at a tempo ("about a sixteenth note").
export function musicalOffset(ms, bpm) {
  const beats = Math.abs(ms) / (60000 / bpm);
  const table = [
    [0.09, 'a tiny bit'],
    [0.18, 'about a thirty-second note'],
    [0.37, 'about a sixteenth note'],
    [0.7, 'about an eighth note'],
    [1.4, 'about a whole beat'],
    [Infinity, 'more than a beat'],
  ];
  return table.find(([lim]) => beats <= lim)[1];
}

// How a level is scored. Beginners are graded mostly on finding the right keys; the weight of
// timing grows with the level. Extra notes cost little at first. Wait mode grades accuracy:
// a wrong key while waiting costs part of that note's credit, a long pause a little more.
export function scoringFor(level = 1) {
  const L = level;
  return {
    timingWeight: L <= 4 ? 0.2 : L <= 8 ? 0.25 : L <= 16 ? 0.35 : L <= 26 ? 0.45 : 0.5,
    extraScale: L <= 4 ? 0.1 : L <= 8 ? 0.15 : L <= 16 ? 0.25 : 0.35,
    extraCap: L <= 8 ? 0.12 : L <= 16 ? 0.2 : 0.25,
    wait: {
      oneWrong: L <= 8 ? 0.8 : L <= 16 ? 0.7 : 0.65, // credit after one wrong try
      manyWrong: L <= 8 ? 0.6 : L <= 16 ? 0.5 : 0.45, // after two or more
      graceBeats: L <= 8 ? 2 : L <= 16 ? 1.5 : 1, // pause allowed before it counts
      perBeat: 0.03, // credit lost per beat of pause beyond the grace
      maxHesitation: L <= 8 ? 0.1 : L <= 16 ? 0.15 : 0.2,
    },
  };
}

// A chord counts more than a single note, but not once per note: a triad is worth 1.5 notes,
// and each of its keys earns its share (partial credit when some keys are right).
export function eventWeight(n) {
  return Math.min(2, 1 + 0.25 * Math.max(0, n - 1));
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(a, q) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (pos - lo);
}

// Intervals (semitones above a played note) at which the listener may report a ghost partial.
const GHOST_INTERVALS = new Set([12, 19, 24, 28, 31]);

export class Session {
  constructor(piece, { mode = 'tempo', clock, latency = 0, countInBeats, onEvent, level, profile, scoring, minWrongConfidence = 0.55 } = {}) {
    this.piece = piece;
    this.mode = piece.waitOnly ? 'wait' : mode;
    this.clock = clock; // () => seconds (audio clock)
    this.latency = latency; // seconds to subtract from heard note times
    this.spb = 60 / piece.bpm;
    this.countIn = countInBeats ?? piece.beatsPer;
    this.onEvent = onEvent || (() => {});
    this.level = level ?? piece.level ?? 1;
    this.profile = profile || timingProfile(this.level);
    this.scoring = scoring || scoringFor(this.level);
    this.minWrongConfidence = minWrongConfidence;
    this.waitLog = new Map(); // wait mode: groupIdx -> {wrong, lastWrongT, dueT, hesBeats}
    this.status = new Map(); // noteId -> {s: 'hit'|'miss', err, grade, t}
    this.wrong = []; // counted wrong notes {midi, beat, t}
    this.ignored = 0; // unexpected notes not counted (low confidence / ghosts)
    // Octave slips: a note heard exactly an octave from the one expected is usually the
    // microphone (the octave shares its partials), so it counts. Several in a row in the same
    // direction are the hand in the wrong octave: those count as wrong and the student is told.
    this.octaveRun = { dir: 0, count: 0, warned: false };
    this.octaveForgiven = 0;
    this.extras = 0;
    this.started = false;
    this.finished = false;
    this.paused = false;
    // Notes grouped by start time (chords / simultaneous hands).
    const groups = new Map();
    for (const n of piece.notes) {
      const k = n.beat.toFixed(4);
      if (!groups.has(k)) groups.set(k, { beat: n.beat, notes: [] });
      groups.get(k).notes.push(n);
    }
    this.groups = [...groups.values()].sort((a, b) => a.beat - b.beat);
    this.groupIdx = 0;
    // Per-note match window: the profile's "ok" window, but never so wide that it reaches
    // halfway to the next note of the same pitch (or of any pitch in rhythm drills).
    this.windowOf = new Map();
    const okSec = this.profile.ok / 1000;
    const byKey = new Map();
    for (const n of piece.notes) {
      const k = piece.rhythmOnly ? 'any' : n.midi;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(n);
    }
    for (const list of byKey.values()) {
      list.sort((a, b) => a.beat - b.beat);
      list.forEach((n, i) => {
        let gap = Infinity;
        if (i > 0) gap = Math.min(gap, n.beat - list[i - 1].beat);
        if (i < list.length - 1) gap = Math.min(gap, list[i + 1].beat - n.beat);
        const w = Math.max(0.09, Math.min(okSec, gap * this.spb * 0.5));
        this.windowOf.set(n.id, gap > 1e-6 ? w : okSec);
      });
    }
    // Largest window, for "has this note passed" checks.
    this.window = okSec;
    this.lo = Math.min(...piece.notes.map((n) => n.midi));
    this.hi = Math.max(...piece.notes.map((n) => n.midi));
  }

  start() {
    const t = this.clock();
    this.started = true;
    this.beat = -this.countIn;
    this.lastT = t;
    this.startT = t + this.countIn * this.spb; // time of beat 0 in tempo mode
    this.lastBeatInt = Math.floor(this.beat) - 1;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    const t = this.clock();
    this.lastT = t;
    // A pause is not hesitation: the wait clock restarts when the playhead is back at the group.
    const wl = this.waitLog.get(this.groupIdx);
    if (wl) wl.dueT = null;
    // Restart tempo clock from where we were (with a one-measure count-in).
    const back = Math.max(-this.countIn, this.beat - this.piece.beatsPer);
    this.beat = back;
    this.startT = t - back * this.spb;
  }

  // Beat position of an audio-clock time.
  beatAtTime(t) {
    if (this.mode === 'tempo') return (t - this.startT) / this.spb;
    return this.beat - (this.lastT - t) / this.spb;
  }

  timeOfBeat(beat) {
    return this.startT + beat * this.spb;
  }

  // The group we are waiting on (wait mode).
  get waitGroup() {
    return this.groups[this.groupIdx];
  }

  update() {
    if (!this.started || this.finished || this.paused) return;
    const t = this.clock();
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    if (this.mode === 'tempo') {
      this.beat = (t - this.startT) / this.spb;
      // Mark notes that have passed their window as missed. The listener reports a note
      // ~70-150 ms after its attack (timestamped at the attack), so wait that long first.
      for (const n of this.piece.notes) {
        if (this.status.has(n.id)) continue;
        if ((this.beat - n.beat) * this.spb > (this.windowOf.get(n.id) ?? this.window) + REPORT_GRACE) {
          this.status.set(n.id, { s: 'miss' });
          this.onEvent({ type: 'miss', note: n });
        }
      }
    } else {
      let next = this.beat + dt / this.spb;
      // Skip over groups already satisfied.
      while (this.groupIdx < this.groups.length && this._groupDone(this.groups[this.groupIdx])) this.groupIdx++;
      const g = this.groups[this.groupIdx];
      if (g && next >= g.beat - 1e-9) {
        next = g.beat;
        const wl = this._waitLog(this.groupIdx);
        if (wl.dueT == null) wl.dueT = t; // the playhead reached this group: waiting starts
      }
      this.beat = next;
      // keep startT consistent so beatAtTime works for display
      this.startT = t - this.beat * this.spb;
    }
    const bi = Math.floor(this.beat);
    if (bi !== this.lastBeatInt) {
      this.lastBeatInt = bi;
      this.onEvent({ type: 'beat', beat: bi });
    }
    if (this.beat >= this.piece.totalBeats + 0.25 && (this.mode === 'tempo' || this.groupIdx >= this.groups.length)) {
      this.finished = true;
      this.onEvent({ type: 'finish', result: this.result() });
    }
  }

  _groupDone(g) {
    return g.notes.every((n) => this.status.has(n.id));
  }

  _waitLog(i) {
    if (!this.waitLog.has(i)) this.waitLog.set(i, { wrong: 0, lastWrongT: -Infinity, dueT: null, hesBeats: 0 });
    return this.waitLog.get(i);
  }

  // Wait mode: credit for a group from its wrong tries and hesitation (see scoringFor).
  _waitCredit(i) {
    const w = this.scoring.wait;
    const wl = this.waitLog.get(i);
    if (!wl) return 1;
    const base = wl.wrong >= 2 ? w.manyWrong : wl.wrong === 1 ? w.oneWrong : 1;
    const hes = i === 0 ? 0 : Math.min(w.maxHesitation, Math.max(0, wl.hesBeats - w.graceBeats) * w.perBeat);
    return base * (1 - hes);
  }

  // Notes the listener should expect right now (for detection priors and key hints).
  expectedNotes(aheadBeats = 1) {
    const out = [];
    if (this.mode === 'wait') {
      const g = this.waitGroup;
      if (g) for (const n of g.notes) if (!this.status.has(n.id)) out.push(n);
      return out;
    }
    for (const n of this.piece.notes) {
      if (this.status.has(n.id)) continue;
      if (n.beat >= this.beat - 0.3 && n.beat <= this.beat + aheadBeats) out.push(n);
    }
    return out;
  }

  // Is an unexpected note likely a listening artefact rather than a real wrong key?
  _isGhost(midi, tt, confidence) {
    if (confidence < this.minWrongConfidence) return true;
    // Far outside the piece's range: almost certainly room noise, not the student.
    if (midi < this.lo - 7 || midi > this.hi + 7) return true;
    for (const [id, st] of this.status) {
      if (st.s !== 'hit' || st.t === undefined || Math.abs(st.t - tt) > 0.3) continue;
      const m = +id.slice(id.lastIndexOf(':') + 1);
      // Re-detection of a key just played, a partial of it, or a split semitone detection.
      if (m === midi && Math.abs(st.t - tt) < 0.2) return true;
      if (GHOST_INTERVALS.has(midi - m)) return true;
      if (Math.abs(midi - m) === 1 && Math.abs(st.t - tt) < 0.06 && confidence < 0.85) return true;
    }
    return false;
  }

  // A note (or, for rhythm drills, any attack) was heard at audio time t.
  // opts.confidence (0..1) comes from the listener; touch/MIDI input is always 1.
  // Is a note heard an octave away from `n` a microphone slip (forgive) or the hand in the wrong
  // octave (the third in a row in the same direction)? Emits a coaching event on the latter.
  _octaveSlip(midi, n) {
    const dir = Math.sign(midi - n.midi);
    const run = this.octaveRun;
    if (run.dir === dir) run.count++;
    else Object.assign(run, { dir, count: 1, warned: false });
    if (run.count < 3) {
      this.octaveForgiven++;
      return true;
    }
    if (!run.warned) {
      run.warned = true;
      this.onEvent({ type: 'octave', dir, midi, expected: n.midi });
    }
    return false;
  }

  noteOn(midi, t, { anyPitch = false, confidence = 1 } = {}) {
    if (!this.started || this.finished || this.paused) return null;
    const tt = t - this.latency;
    const beat = this.beatAtTime(tt);
    if (beat < -0.5) return null; // during count-in
    const rhythm = this.piece.rhythmOnly || anyPitch;
    let res = null;
    if (this.mode === 'wait') {
      const g = this.waitGroup;
      if (g) {
        let cand = g.notes.find((n) => !this.status.has(n.id) && (rhythm || n.midi === midi));
        let octave = false;
        if (!cand && !rhythm && !g.notes.some((n) => n.midi === midi)) {
          const o = g.notes.find((n) => !this.status.has(n.id) && Math.abs(n.midi - midi) === 12);
          if (o && this.beat >= g.beat - 1 && this._octaveSlip(midi, o)) (cand = o), (octave = true);
        } else if (cand && !rhythm) this.octaveRun.count = 0;
        if (cand && this.beat >= g.beat - 1) {
          const wl = this._waitLog(this.groupIdx);
          if (wl.dueT != null) wl.hesBeats = Math.max(wl.hesBeats, (tt - wl.dueT) / this.spb);
          const slow = this.groupIdx > 0 && wl.hesBeats > this.scoring.wait.graceBeats;
          const grade = wl.wrong >= 2 ? 'ok' : wl.wrong === 1 ? 'good' : slow ? 'great' : 'perfect';
          this.status.set(cand.id, { s: 'hit', err: 0, grade, t: tt, group: this.groupIdx });
          const label = grade === 'perfect' ? 'Nice!' : grade === 'great' ? 'Got it' : 'Found it!';
          res = { type: 'hit', note: cand, grade, err: 0, errMs: 0, timing: 'on', label, wait: true, tries: wl.wrong + 1, octave };
        }
      }
    } else {
      let best = null,
        bestErr = Infinity;
      for (const n of this.piece.notes) {
        if (this.status.has(n.id)) continue;
        if (!rhythm && n.midi !== midi) continue;
        const err = (beat - n.beat) * this.spb;
        if (Math.abs(err) <= (this.windowOf.get(n.id) ?? this.window) && Math.abs(err) < Math.abs(bestErr)) {
          best = n;
          bestErr = err;
        }
      }
      let octave = false;
      if (best && !rhythm) this.octaveRun.count = 0;
      if (!best && !rhythm) {
        // No exact match: an unplayed note an octave away, due now, and no note of this pitch
        // expected anywhere near (then it would be a real extra note)?
        let ob = null,
          oe = Infinity;
        for (const n of this.piece.notes) {
          if (this.status.has(n.id) || Math.abs(n.midi - midi) !== 12) continue;
          const err = (beat - n.beat) * this.spb;
          if (Math.abs(err) <= (this.windowOf.get(n.id) ?? this.window) && Math.abs(err) < Math.abs(oe)) (ob = n), (oe = err);
        }
        const samePitchNear = ob && this.piece.notes.some((n) => n.midi === midi && Math.abs(n.beat - beat) < 2);
        if (ob && !samePitchNear && this._octaveSlip(midi, ob)) (best = ob), (bestErr = oe), (octave = true);
      }
      if (best) {
        const grade = gradeFor(bestErr, this.profile);
        const errMs = Math.round(bestErr * 1000);
        this.status.set(best.id, { s: 'hit', err: bestErr, grade, t: tt, octave });
        res = {
          type: 'hit', note: best, grade, err: bestErr, errMs,
          timing: grade === 'perfect' ? 'on' : errMs < 0 ? 'early' : 'late',
          label: timingLabel(grade, errMs),
          octave,
        };
      }
    }
    if (!res) {
      // Wait mode: the right next note, just played before the playhead got there, is not wrong.
      const early = this.mode === 'wait' && this.waitGroup && this.waitGroup.notes.some((n) => n.midi === midi && !this.status.has(n.id));
      if (rhythm || early || this._isGhost(midi, tt, confidence)) {
        this.ignored++;
        return null;
      }
      this.extras++;
      this.wrong.push({ midi, beat, t: tt });
      res = { type: 'wrong', midi, beat };
      if (this.mode === 'wait' && this.waitGroup) {
        // One try = one press (a chord or a quick re-strike within 0.25 s counts once).
        const wl = this._waitLog(this.groupIdx);
        if (tt - wl.lastWrongT > 0.25) wl.wrong++;
        wl.lastWrongT = tt;
        res.wait = true;
        res.expected = this.waitGroup.notes.filter((n) => !this.status.has(n.id)).map((n) => n.midi);
      }
    }
    this.onEvent(res);
    return res;
  }

  result() {
    const piece = this.piece;
    const notes = piece.notes;
    const total = notes.length || 1;
    const tempo = this.mode === 'tempo';
    const sc = this.scoring;
    const beatsPer = piece.beatsPer || 4;
    let hits = 0,
      credit = 0;
    const errs = [];
    const detail = [];
    const byGrade = { perfect: 0, great: 0, good: 0, ok: 0 };
    const missedByMidi = new Map();
    const hands = {};
    const bars = new Map();
    const barOf = (beat) => Math.floor(beat / beatsPer + 1e-9) + 1; // as the play screen counts
    const bar = (b) => {
      if (!bars.has(b)) bars.set(b, { bar: b, total: 0, hits: 0, missed: 0, wrong: 0 });
      return bars.get(b);
    };
    // Per event (a note or a chord of one hand): weight and credit.
    const events = new Map();
    for (const n of notes) {
      const h = n.hand || 'R';
      if (!hands[h]) hands[h] = { hits: 0, total: 0, errs: [], w: 0, got: 0 };
      hands[h].total++;
      const B = bar(barOf(n.beat));
      B.total++;
      const st = this.status.get(n.id);
      const k = n.eventId ?? n.id;
      if (!events.has(k)) events.set(k, { hand: h, n: 0, hit: 0, credit: 0 });
      const ev = events.get(k);
      ev.n++;
      if (st && st.s === 'hit') {
        hits++;
        hands[h].hits++;
        B.hits++;
        const c = tempo ? GRADE_CREDIT[st.grade] ?? 1 : this._waitCredit(st.group ?? 0);
        credit += c;
        ev.hit++;
        ev.credit += c;
        byGrade[st.grade] = (byGrade[st.grade] || 0) + 1;
        if (tempo) {
          errs.push(st.err * 1000);
          hands[h].errs.push(st.err * 1000);
          detail.push({ beat: n.beat, midi: n.midi, hand: h, errMs: Math.round(st.err * 1000), grade: st.grade });
        }
      } else {
        missedByMidi.set(n.midi, (missedByMidi.get(n.midi) || 0) + 1);
        B.missed++;
      }
    }
    for (const w of this.wrong) if (w.beat >= -0.5) bar(Math.max(1, barOf(Math.max(0, w.beat)))).wrong++;
    const wt = sc.timingWeight;
    for (const ev of events.values()) {
      const w = eventWeight(ev.n);
      const frac = ev.hit / ev.n;
      const q = ev.hit ? ev.credit / ev.hit : 0; // timing quality (tempo) or wait credit
      const H = hands[ev.hand];
      H.w += w;
      H.got += w * frac;
      H.score = (H.score || 0) + w * frac * (tempo ? 1 - wt + wt * q : q);
    }
    // When both hands play, each counts for at least a third: a left hand of a few long notes
    // or chords can't be skipped for a good score.
    const hs = Object.values(hands).filter((h) => h.w > 0);
    const wAll = hs.reduce((a, h) => a + h.w, 0);
    let shares = hs.map((h) => h.w / (wAll || 1));
    if (hs.length === 2) {
      const lo = Math.min(...shares);
      if (lo < 1 / 3) shares = shares.map((x) => (x === lo ? 1 / 3 : 2 / 3));
    }
    let wSum = 0,
      accSum = 0,
      scoreSum = 0;
    hs.forEach((h, i) => {
      wSum += shares[i];
      accSum += (shares[i] * h.got) / h.w;
      scoreSum += (shares[i] * h.score) / h.w;
    });
    const noteAcc = hits / total;
    const noteCredit = wSum ? accSum / wSum : 0;
    const timing = hits ? credit / hits : tempo ? 0 : 1;
    // Wrong notes: in tempo mode a mild penalty (milder for beginners, who are still finding
    // the keys); in wait mode they already cost the note they were aimed at.
    const extraPenalty = tempo ? Math.min(sc.extraCap, (this.extras / total) * sc.extraScale) : 0;
    const score = Math.max(0, Math.min(100, Math.round(100 * ((wSum ? scoreSum / wSum : 0) - extraPenalty))));
    const p = this.profile;
    const meanErrMs = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
    const medianErrMs = median(errs);
    const iqrMs = quantile(errs, 0.75) - quantile(errs, 0.25);
    const early = errs.filter((e) => e < -p.perfect).length;
    const late = errs.filter((e) => e > p.perfect).length;
    const onTime = errs.length - early - late;
    // Histogram of timing errors, 20 ms bins across the match window.
    const binMs = 20;
    const span = Math.ceil(p.ok / binMs) * binMs;
    const bins = new Array((2 * span) / binMs).fill(0);
    for (const e of errs) bins[Math.max(0, Math.min(bins.length - 1, Math.floor((e + span) / binMs)))]++;
    const perHand = {};
    for (const [h, v] of Object.entries(hands)) {
      perHand[h] = {
        hits: v.hits, total: v.total, acc: v.total ? v.hits / v.total : 0, credit: v.w ? v.got / v.w : 0,
        meanErrMs: v.errs.length ? Math.round(v.errs.reduce((a, b) => a + b, 0) / v.errs.length) : 0,
        medianErrMs: Math.round(median(v.errs)), timed: v.errs.length,
      };
    }
    // A consistent offset with a tight spread suggests input latency rather than the player.
    const suggestedLatencyMs = errs.length >= 8 && Math.abs(medianErrMs) > 50 && iqrMs < 110 ? Math.round(medianErrMs / 5) * 5 : 0;
    let timingSummary = '';
    if (tempo && errs.length >= 3) {
      const m = Math.round(medianErrMs);
      if (Math.abs(m) <= p.perfect * 0.5) timingSummary = `Right on the beat: on average ${Math.abs(m)} ms ${m < 0 ? 'early' : 'late'}.`;
      else timingSummary = `On average you played ${Math.abs(m)} ms ${m < 0 ? 'early' : 'late'} (${musicalOffset(m, piece.bpm)}).`;
    }
    const stars = score >= 95 ? 3 : score >= 85 ? 2 : score >= 70 ? 1 : 0;

    // ---- what to work on -----------------------------------------------------------------
    const barList = [...bars.values()].sort((a, b) => a.bar - b.bar);
    const problems = (b) => b.missed + b.wrong;
    const minProblems = total <= 16 ? 1 : 2;
    const worstBars = barList.filter((b) => problems(b) >= minProblems).sort((a, b) => problems(b) - problems(a) || a.bar - b.bar).slice(0, 2).map((b) => ({ ...b, problems: problems(b) }));
    // The weaker hand, when both play and one clearly misses more.
    let weakHand = null;
    if (perHand.R && perHand.L && perHand.R.total >= 3 && perHand.L.total >= 3) {
      const [a, b] = [perHand.R.acc, perHand.L.acc];
      if (Math.abs(a - b) >= 0.15 && Math.min(a, b) < 0.9) weakHand = a < b ? 'R' : 'L';
    }
    // Rushing or dragging (the median, so a couple of stray notes don't decide it).
    let tendency = null;
    if (tempo && errs.length >= 6) {
      const thr = Math.max(35, p.perfect * 0.5);
      tendency = medianErrMs <= -thr ? 'rush' : medianErrMs >= thr ? 'drag' : iqrMs > p.good ? 'uneven' : 'steady';
    }
    // Key-signature slips: the natural note played where the key signature asks for ♯ or ♭.
    const slips = new Map();
    const key = piece.key;
    if (key && key.fifths) {
      for (const w of this.wrong) {
        const n = notes.find((x) => Math.abs(x.beat - w.beat) <= 0.75 && Math.abs(x.midi - w.midi) === 1 && key.spell(x.midi).alter !== 0 && w.midi === x.midi - key.spell(x.midi).alter);
        if (!n) continue;
        const sp = key.spell(n.midi);
        const k = STEP_NAMES[sp.step];
        slips.set(k, { letter: k, name: noteName(n.midi, key).replace(/-?\d+$/, ''), count: (slips.get(k)?.count || 0) + 1 });
      }
    }
    let waitStats = null;
    if (!tempo) {
      let wrongTries = 0,
        slow = 0;
      for (const [i, wl] of this.waitLog) {
        wrongTries += wl.wrong;
        if (i > 0 && wl.hesBeats > sc.wait.graceBeats) slow++;
      }
      waitStats = { groups: this.groups.length, wrongTries, slowGroups: slow, cleanGroups: this.groups.length - [...this.waitLog.values()].filter((w) => w.wrong > 0).length };
    }
    return {
      score, stars, hits, total, noteAcc, noteCredit, timing, extras: this.extras, ignored: this.ignored, octaveForgiven: this.octaveForgiven, byGrade,
      mode: this.mode, bpm: piece.bpm, level: this.level, profile: p,
      weights: { timing: tempo ? wt : 0, extraPenalty: Math.round(extraPenalty * 1000) / 1000 },
      meanErr: meanErrMs / 1000, meanErrMs: Math.round(meanErrMs), medianErrMs: Math.round(medianErrMs), iqrMs: Math.round(iqrMs),
      early, late, onTime, errs: detail, histogram: { binMs, fromMs: -span, bins },
      perHand, suggestedLatencyMs, timingSummary,
      missedByMidi: [...missedByMidi.entries()].sort((a, b) => b[1] - a[1]),
      bars: barList, worstBars, weakHand, tendency, sigSlips: [...slips.values()].sort((a, b) => b.count - a.count), waitStats,
    };
  }
}
