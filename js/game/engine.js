// A single play-through of a piece: owns the musical clock (count-in, tempo or wait mode),
// matches heard notes against the score and produces a graded result.

export const GRADES = [
  { name: 'perfect', ms: 60, credit: 1 },
  { name: 'great', ms: 110, credit: 0.9 },
  { name: 'good', ms: 170, credit: 0.7 },
  { name: 'ok', ms: 260, credit: 0.45 },
];

export class Session {
  constructor(piece, { mode = 'tempo', clock, latency = 0, countInBeats, onEvent } = {}) {
    this.piece = piece;
    this.mode = piece.waitOnly ? 'wait' : mode;
    this.clock = clock; // () => seconds (audio clock)
    this.latency = latency; // seconds to subtract from heard note times
    this.spb = 60 / piece.bpm;
    this.countIn = countInBeats ?? piece.beatsPer;
    this.onEvent = onEvent || (() => {});
    this.status = new Map(); // noteId -> {s: 'hit'|'miss', err, grade}
    this.wrong = []; // {midi, beat, t}
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
    // Timing window (seconds) scales with tempo, clamped.
    this.window = Math.max(0.14, Math.min(0.28, this.spb * 0.4));
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
      // Mark notes that have passed their window as missed.
      for (const n of this.piece.notes) {
        if (this.status.has(n.id)) continue;
        if ((this.beat - n.beat) * this.spb > this.window + 0.05) {
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

  // A note (or, for rhythm drills, any attack) was heard at audio time t.
  noteOn(midi, t, { anyPitch = false } = {}) {
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
          this.status.set(cand.id, { s: 'hit', err: 0, grade: 'perfect' });
          res = { type: 'hit', note: cand, grade: 'perfect', err: 0 };
        }
      }
    } else {
      let best = null,
        bestErr = Infinity;
      for (const n of this.piece.notes) {
        if (this.status.has(n.id)) continue;
        if (!rhythm && n.midi !== midi) continue;
        const err = (beat - n.beat) * this.spb;
        if (Math.abs(err) <= this.window && Math.abs(err) < Math.abs(bestErr)) {
          best = n;
          bestErr = err;
        }
      }
      if (best) {
        const grade = GRADES.find((g) => Math.abs(bestErr) * 1000 <= g.ms) || GRADES[GRADES.length - 1];
        this.status.set(best.id, { s: 'hit', err: bestErr, grade: grade.name });
        res = { type: 'hit', note: best, grade: grade.name, err: bestErr };
      }
    }
    if (!res) {
      // Ignore a re-detection of a note that was just hit correctly (same key within 150 ms).
      const recentSame = [...this.status.entries()].some(([id, st]) => st.s === 'hit' && id.endsWith(`:${midi}`) && st.t !== undefined && Math.abs(st.t - tt) < 0.15);
      if (!recentSame) {
        this.extras++;
        this.wrong.push({ midi, beat, t: tt });
        res = { type: 'wrong', midi, beat };
      }
    } else {
      this.status.get(res.note.id).t = tt;
    }
    if (res) this.onEvent(res);
    return res;
  }

  result() {
    const notes = this.piece.notes;
    const total = notes.length || 1;
    let hits = 0,
      credit = 0;
    const errs = [];
    const byGrade = { perfect: 0, great: 0, good: 0, ok: 0 };
    const missedByMidi = new Map();
    for (const n of notes) {
      const st = this.status.get(n.id);
      if (st && st.s === 'hit') {
        hits++;
        const g = GRADES.find((x) => x.name === st.grade);
        credit += g ? g.credit : 1;
        byGrade[st.grade] = (byGrade[st.grade] || 0) + 1;
        if (this.mode === 'tempo') errs.push(st.err);
      } else missedByMidi.set(n.midi, (missedByMidi.get(n.midi) || 0) + 1);
    }
    const noteAcc = hits / total;
    const timing = this.mode === 'tempo' ? (hits ? credit / hits : 0) : 1;
    const extraPenalty = Math.min(0.25, (this.extras / total) * 0.35);
    const score = Math.max(0, Math.round(100 * (noteAcc * (this.mode === 'tempo' ? 0.65 + 0.35 * timing : 1) - extraPenalty)));
    const meanErr = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
    const early = errs.filter((e) => e < -0.06).length;
    const late = errs.filter((e) => e > 0.06).length;
    const stars = score >= 95 ? 3 : score >= 85 ? 2 : score >= 70 ? 1 : 0;
    return {
      score, stars, hits, total, noteAcc, timing, extras: this.extras, meanErr, early, late, byGrade,
      mode: this.mode, bpm: this.piece.bpm, missedByMidi: [...missedByMidi.entries()].sort((a, b) => b[1] - a[1]),
    };
  }
}
