// A single play-through of a piece: owns the musical clock (count-in, tempo or wait mode),
// matches heard notes against the score and produces a graded result with detailed timing
// feedback (how early or late, by how many milliseconds).

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
  constructor(piece, { mode = 'tempo', clock, latency = 0, countInBeats, onEvent, level, profile, minWrongConfidence = 0.55 } = {}) {
    this.piece = piece;
    this.mode = piece.waitOnly ? 'wait' : mode;
    this.clock = clock; // () => seconds (audio clock)
    this.latency = latency; // seconds to subtract from heard note times
    this.spb = 60 / piece.bpm;
    this.countIn = countInBeats ?? piece.beatsPer;
    this.onEvent = onEvent || (() => {});
    this.level = level ?? piece.level ?? 1;
    this.profile = profile || timingProfile(this.level);
    this.minWrongConfidence = minWrongConfidence;
    this.status = new Map(); // noteId -> {s: 'hit'|'miss', err, grade, t}
    this.wrong = []; // counted wrong notes {midi, beat, t}
    this.ignored = 0; // unexpected notes not counted (low confidence / ghosts)
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
      if (g && next > g.beat) next = g.beat;
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
        const cand = g.notes.find((n) => !this.status.has(n.id) && (rhythm || n.midi === midi));
        if (cand && this.beat >= g.beat - 1) {
          this.status.set(cand.id, { s: 'hit', err: 0, grade: 'perfect', t: tt });
          res = { type: 'hit', note: cand, grade: 'perfect', err: 0, errMs: 0, timing: 'on', label: 'Nice!' };
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
      if (best) {
        const grade = gradeFor(bestErr, this.profile);
        const errMs = Math.round(bestErr * 1000);
        this.status.set(best.id, { s: 'hit', err: bestErr, grade, t: tt });
        res = {
          type: 'hit', note: best, grade, err: bestErr, errMs,
          timing: grade === 'perfect' ? 'on' : errMs < 0 ? 'early' : 'late',
          label: timingLabel(grade, errMs),
        };
      }
    }
    if (!res) {
      if (rhythm || this._isGhost(midi, tt, confidence)) {
        this.ignored++;
        return null;
      }
      this.extras++;
      this.wrong.push({ midi, beat, t: tt });
      res = { type: 'wrong', midi, beat };
    }
    this.onEvent(res);
    return res;
  }

  result() {
    const notes = this.piece.notes;
    const total = notes.length || 1;
    const tempo = this.mode === 'tempo';
    let hits = 0,
      credit = 0;
    const errs = [];
    const detail = [];
    const byGrade = { perfect: 0, great: 0, good: 0, ok: 0 };
    const missedByMidi = new Map();
    const hands = {};
    for (const n of notes) {
      const h = n.hand || 'R';
      if (!hands[h]) hands[h] = { hits: 0, total: 0, errs: [] };
      hands[h].total++;
      const st = this.status.get(n.id);
      if (st && st.s === 'hit') {
        hits++;
        hands[h].hits++;
        credit += GRADE_CREDIT[st.grade] ?? 1;
        byGrade[st.grade] = (byGrade[st.grade] || 0) + 1;
        if (tempo) {
          errs.push(st.err * 1000);
          hands[h].errs.push(st.err * 1000);
          detail.push({ beat: n.beat, midi: n.midi, hand: h, errMs: Math.round(st.err * 1000), grade: st.grade });
        }
      } else missedByMidi.set(n.midi, (missedByMidi.get(n.midi) || 0) + 1);
    }
    const noteAcc = hits / total;
    const timing = tempo ? (hits ? credit / hits : 0) : 1;
    // Wrong notes cost less for beginners (they are still finding the keys).
    const penaltyScale = this.level <= 8 ? 0.2 : this.level <= 16 ? 0.28 : 0.35;
    const extraPenalty = Math.min(0.25, (this.extras / total) * penaltyScale);
    const score = Math.max(0, Math.round(100 * (noteAcc * (tempo ? 0.6 + 0.4 * timing : 1) - extraPenalty)));
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
      perHand[h] = { hits: v.hits, total: v.total, acc: v.total ? v.hits / v.total : 0, meanErrMs: v.errs.length ? Math.round(v.errs.reduce((a, b) => a + b, 0) / v.errs.length) : 0 };
    }
    // A consistent offset with a tight spread suggests input latency rather than the player.
    const suggestedLatencyMs = errs.length >= 8 && Math.abs(medianErrMs) > 50 && iqrMs < 110 ? Math.round(medianErrMs / 5) * 5 : 0;
    let timingSummary = '';
    if (tempo && errs.length >= 3) {
      const m = Math.round(medianErrMs);
      if (Math.abs(m) <= p.perfect * 0.5) timingSummary = `Right on the beat: on average ${Math.abs(m)} ms ${m < 0 ? 'early' : 'late'}.`;
      else timingSummary = `On average you played ${Math.abs(m)} ms ${m < 0 ? 'early' : 'late'} (${musicalOffset(m, this.piece.bpm)}).`;
    }
    const stars = score >= 95 ? 3 : score >= 85 ? 2 : score >= 70 ? 1 : 0;
    return {
      score, stars, hits, total, noteAcc, timing, extras: this.extras, ignored: this.ignored, byGrade,
      mode: this.mode, bpm: this.piece.bpm, level: this.level, profile: p,
      meanErr: meanErrMs / 1000, meanErrMs: Math.round(meanErrMs), medianErrMs: Math.round(medianErrMs), iqrMs: Math.round(iqrMs),
      early, late, onTime, errs: detail, histogram: { binMs, fromMs: -span, bins },
      perHand, suggestedLatencyMs, timingSummary,
      missedByMidi: [...missedByMidi.entries()].sort((a, b) => b[1] - a[1]),
    };
  }
}
