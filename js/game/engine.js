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

// Bar loop ("repeat bars I miss"), for lessons and practice. In tempo mode a bar the student
// fails is stopped at its end and played again after a lead-in (about 4 s, ending with a one-bar
// count-in; the notes before the bar are cleared away), until it passes; after a few failed tries the app offers to slow that bar down or learn it in wait
// mode. In wait mode several wrong tries at one spot start the bar again (the app plays it
// first, then counts the student in). A bar's notes count once they are played correctly; the
// loops are reported in result().loops.
export const LOOP_RULES = {
  failFraction: 0.5, // a bar fails with at least this share of its notes missed or wrong...
  missRun: 2, // ...or this many missed notes (a chord counts once) in a row
  offerAfter: 3, // failed tries of one bar before offering "slower" or "learn it"
  slowScale: 0.75, // tempo of a slowed bar
  slowTries: 2, // failed slow tries before moving on anyway
  waitWrong: 3, // wait mode: wrong tries at one spot before the bar starts again
  waitRestarts: 2, // wait mode: restarts per bar
  leadIn: 4, // s: the playhead jumps back this far before a bar played again (at least a bar)
};

export class Session {
  constructor(piece, { mode = 'tempo', clock, latency = 0, countInBeats, onEvent, level, profile, scoring, minWrongConfidence = 0.55, barLoop = false } = {}) {
    this.piece = piece;
    this.mode = piece.waitOnly ? 'wait' : mode;
    this.clock = clock; // () => seconds (audio clock)
    this.latency = latency; // seconds to subtract from heard note times
    this.baseSpb = 60 / piece.bpm;
    this.spb = this.baseSpb;
    this.tempoScale = 1;
    // Bar loop state (see LOOP_RULES).
    this.barLoop = !!barLoop;
    this.loops = new Map(); // bar -> {bar, fails, passed, slowed, slowFails, learned, gaveUp, restarts, mode}
    this.rewinds = 0; // times the playhead jumped back to a bar line
    this.replays = 0; // times a bar was played again (the loops)
    this.loopWrong = 0; // wrong notes in tries that were played again (not counted in the score)
    this.barChecked = 0; // tempo mode: bars up to this one have been judged
    this.lead = null; // {from, to}: the short count-in before a bar played again
    this.held = false; // waiting for the student to choose (slower / learn it / keep going)
    this.offer = null; // {bar} while held
    this.barWait = null; // {bar, from, to}: one bar learned in wait mode inside a tempo session
    this.barNotes = new Map();
    this.activeLoop = null; // the bar being played again (tempo mode)
    this.leadEnd = null;
    this.clearBefore = null; // notes before this beat are no longer shown (a bar played again)
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
    this._computeWindows();
    this.lo = Math.min(...piece.notes.map((n) => n.midi));
    this.hi = Math.max(...piece.notes.map((n) => n.midi));
  }

  // Per-note match window: the profile's "ok" window, but never so wide that it reaches
  // halfway to the next note of the same pitch (or of any pitch in rhythm drills).
  _computeWindows() {
    const piece = this.piece;
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
  }

  // The mechanics in force right now: a tempo session learning one bar in wait mode waits.
  get playMode() {
    return this.mode === 'wait' || this.barWait ? 'wait' : 'tempo';
  }

  // Current tempo (a slowed bar plays slower than the piece).
  get bpm() {
    return 60 / this.spb;
  }

  // ---- bars ---------------------------------------------------------------------------------
  get beatsPerBar() {
    return this.piece.beatsPer || 4;
  }

  barOf(beat) {
    return Math.floor(beat / this.beatsPerBar + 1e-9) + 1; // as the play screen counts
  }

  barStart(bar) {
    return (bar - 1) * this.beatsPerBar;
  }

  barEnd(bar) {
    return Math.min(bar * this.beatsPerBar, Math.max(this.piece.totalBeats, this.barStart(bar) + 1e-6));
  }

  get lastBar() {
    return this.barOf(Math.max(0, this.piece.totalBeats - 1e-6));
  }

  notesInBar(bar) {
    if (!this.barNotes.has(bar)) {
      const a = this.barStart(bar) - 1e-6;
      const b = bar * this.beatsPerBar - 1e-6;
      this.barNotes.set(bar, this.piece.notes.filter((n) => n.beat >= a && n.beat < b));
    }
    return this.barNotes.get(bar);
  }

  // The bar being played again, for the play screen: {bar, attempt, slowed, learning} or null.
  get loopInfo() {
    const bar = this.barWait ? this.barWait.bar : this.lead ? this.barOf(this.lead.to) : this.offer ? this.offer.bar : this.activeLoop;
    const rec = bar && this.loops.get(bar);
    if (!rec || rec.passed || rec.gaveUp) return null;
    return { bar, attempt: rec.fails + (this.offer ? 0 : 1), held: !!this.offer, slowed: rec.slowed, learning: !!this.barWait, from: this.barStart(bar), to: this.barEnd(bar), mode: rec.mode };
  }

  // Did the student fail this bar? Missed or wrong on at least half its notes, or two misses in a
  // row. Wrong keys usually replace a missed note, so a bar's problems are the larger of the two.
  judgeBar(bar) {
    const notes = this.notesInBar(bar);
    if (!notes.length) return { pass: true, n: 0, missed: 0, wrong: 0, hit: 0, played: 0 };
    const R = LOOP_RULES;
    const from = this.barStart(bar);
    const to = bar * this.beatsPerBar;
    let missed = 0,
      hit = 0;
    const groups = new Map();
    for (const n of notes) {
      const st = this.status.get(n.id);
      if (st && st.s === 'miss') missed++;
      else if (st && st.s === 'hit') hit++;
      const k = n.beat.toFixed(4);
      groups.set(k, (groups.get(k) || false) || !!(st && st.s === 'miss'));
    }
    let run = 0,
      maxRun = 0;
    for (const k of [...groups.keys()].sort((a, b) => a - b)) {
      run = groups.get(k) ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
    const wrong = this.wrong.filter((w) => w.beat >= from - 0.5 && w.beat < to).length;
    const bad = Math.min(notes.length, Math.max(missed, wrong));
    const byShare = bad >= Math.ceil(notes.length * R.failFraction - 1e-9);
    const byRun = maxRun >= R.missRun;
    const pass = !(byShare || byRun);
    return { pass, n: notes.length, missed, wrong, hit, played: hit + wrong, reason: pass ? null : byRun && !byShare ? 'run' : missed >= wrong ? 'missed' : 'wrong' };
  }

  _loopRec(bar, mode = 'tempo') {
    if (!this.loops.has(bar)) this.loops.set(bar, { bar, fails: 0, passed: false, slowed: false, slowFails: 0, learned: false, gaveUp: false, restarts: 0, mode });
    return this.loops.get(bar);
  }

  _setTempoScale(f) {
    if (this.tempoScale === f) return;
    const t = this.clock();
    this.tempoScale = f;
    this.spb = this.baseSpb / f;
    this._computeWindows();
    this.startT = t - this.beat * this.spb;
    this.onEvent({ type: 'tempo', bpm: Math.round(this.bpm), scale: f });
  }

  // Start again at beat `from` (a bar line) after a pause and a one-bar count-in (_countIn):
  // everything from there on is forgotten, and wrong notes of the try being repeated no longer
  // count.
  _rewind(from) {
    const t = this.clock();
    for (const n of this.piece.notes) if (n.beat >= from - 1e-6) this.status.delete(n.id);
    const keep = [];
    for (const w of this.wrong) {
      if (w.beat >= from - 0.5) {
        this.loopWrong++;
        this.extras = Math.max(0, this.extras - 1);
      } else keep.push(w);
    }
    this.wrong = keep;
    Object.assign(this.octaveRun, { dir: 0, count: 0, warned: false });
    this._countIn(from);
    this.startT = t - this.beat * this.spb;
    this.lastT = t;
    this.lastBeatInt = Math.floor(this.beat) - 1;
    this.barChecked = Math.max(0, this.barOf(from) - 1);
    this.groupIdx = this.groups.findIndex((g) => g.beat >= from - 1e-6);
    if (this.groupIdx < 0) this.groupIdx = this.groups.length;
    this.rewinds++;
  }

  // The playhead jumps back to about LOOP_RULES.leadIn seconds before beat `from` (a bar line):
  // the notes before it are cleared away (clearBefore), so the bar comes closer through an empty
  // stretch - quiet at first ('beat' events with .rest), then a one-bar count-in (.lead, then .go
  // on the bar line). Notes played before the count-in ends are ignored.
  _countIn(from) {
    const k = this.beatsPerBar;
    const total = Math.max(k, Math.round(LOOP_RULES.leadIn / this.spb));
    this.beat = from - total;
    this.lead = { rest: from - total, from: from - k, to: from };
    this.leadEnd = null;
    this.clearBefore = from;
  }

  // Tempo mode: judge each bar once its notes are decided and the playhead has left it.
  _checkBars() {
    while (this.barChecked < this.lastBar && !this.held) {
      const bar = this.barChecked + 1;
      const notes = this.notesInBar(bar);
      if (this.beat < this.barEnd(bar)) return;
      if (notes.some((n) => !this.status.has(n.id))) return; // (a note's window is still open)
      const v = this.judgeBar(bar);
      this.barChecked = bar;
      const rec = this.loops.get(bar);
      if (v.pass) {
        if (rec && !rec.passed && !rec.gaveUp) {
          rec.passed = true;
          this.activeLoop = null;
          this.onEvent({ type: 'bar-pass', bar, tries: rec.fails + 1, slowed: rec.slowed });
          if (this.tempoScale !== 1) {
            // Passed slowly: back up to speed from the next bar, with a count-in.
            this._setTempoScale(1);
            if (bar < this.lastBar) {
              this._rewind(this.barStart(bar + 1));
              return;
            }
          }
        }
        continue;
      }
      const r = this._loopRec(bar);
      r.fails++;
      this.activeLoop = bar;
      if (r.slowed) r.slowFails++;
      if (r.slowed && r.slowFails >= LOOP_RULES.slowTries) {
        // Enough for now: carry on (at tempo) and come back to it another time.
        r.gaveUp = true;
        this.activeLoop = null;
        this._setTempoScale(1);
        this.onEvent({ type: 'bar-move-on', bar, tries: r.fails });
        if (bar < this.lastBar) this._rewind(this.barStart(bar + 1));
        return;
      }
      if (!r.slowed && r.fails >= LOOP_RULES.offerAfter) {
        this.held = true;
        this.offer = { bar, played: v.played > 0 };
        this.onEvent({ type: 'loop-offer', bar, tries: r.fails, played: v.played > 0 });
        return;
      }
      this._rewind(this.barStart(bar));
      this.replays++;
      this.onEvent({ type: 'loop', bar, attempt: r.fails + 1, reason: v.reason, missed: v.missed, wrong: v.wrong, n: v.n, slowed: r.slowed, mode: 'tempo' });
      return;
    }
  }

  // The student's answer to a 'loop-offer': 'slower' (the bar again at LOOP_RULES.slowScale),
  // 'learn' (the bar in wait mode, then on at tempo) or 'continue' (move on).
  chooseLoop(choice) {
    const o = this.offer;
    if (!o || this.finished) return;
    this.offer = null;
    this.held = false;
    const rec = this._loopRec(o.bar);
    const from = this.barStart(o.bar);
    if (choice === 'slower') {
      rec.slowed = true;
      this._setTempoScale(LOOP_RULES.slowScale);
      this._rewind(from);
      this.replays++;
      this.onEvent({ type: 'loop', bar: o.bar, attempt: rec.fails + 1, slowed: true, mode: 'tempo' });
    } else if (choice === 'learn') {
      rec.learned = true;
      this._rewind(from);
      this.barWait = { bar: o.bar, from, to: o.bar * this.beatsPerBar };
      this.replays++;
      this.onEvent({ type: 'loop', bar: o.bar, attempt: rec.fails + 1, learning: true, mode: 'wait' });
    } else {
      rec.gaveUp = true;
      this.activeLoop = null;
      this.onEvent({ type: 'bar-move-on', bar: o.bar, tries: rec.fails });
      if (o.bar < this.lastBar) this._rewind(this.barStart(o.bar + 1));
      else {
        const t = this.clock();
        this.lastT = t;
        this.startT = t - this.beat * this.spb;
      }
    }
  }

  // Freeze the clock without losing the place (e.g. while the app plays a bar to the student).
  hold() {
    this.held = true;
  }

  release() {
    if (!this.held || this.offer) return;
    this.held = false;
    const t = this.clock();
    this.lastT = t;
    this.startT = t - this.beat * this.spb;
    const wl = this.waitLog.get(this.groupIdx);
    if (wl) wl.dueT = null;
  }

  // Wait mode: too many wrong tries at one spot. The bar starts again (the notes found so far in
  // it are played again), and the app may play it first. Returns the loop event or null.
  _restartWaitBar(wl) {
    const g = this.waitGroup;
    if (!g) return null;
    const bar = this.barOf(Math.max(0, g.beat));
    const rec = this._loopRec(bar, 'wait');
    if (wl.wrong < (wl.loopAt ?? LOOP_RULES.waitWrong) || rec.restarts >= LOOP_RULES.waitRestarts) return null;
    rec.restarts++;
    rec.fails++;
    wl.loopAt = wl.wrong + LOOP_RULES.waitWrong;
    wl.dueT = null;
    const stuck = this.groupIdx;
    const from = this.barStart(bar);
    const t = this.clock();
    for (const n of this.piece.notes) if (n.beat >= from - 1e-6 && n.beat <= g.beat + 1e-6) this.status.delete(n.id);
    for (const i of [...this.waitLog.keys()]) if (i !== stuck && this.groups[i] && this.groups[i].beat >= from - 1e-6 && this.groups[i].beat <= g.beat + 1e-6) this.waitLog.delete(i);
    this.groupIdx = this.groups.findIndex((x) => x.beat >= from - 1e-6);
    this._countIn(from);
    this.lastT = t;
    this.startT = t - this.beat * this.spb;
    this.lastBeatInt = Math.floor(this.beat) - 1;
    this.rewinds++;
    this.replays++;
    this.activeLoop = bar;
    return { type: 'loop', bar, attempt: rec.fails + 1, mode: 'wait', from, to: bar * this.beatsPerBar, expected: g.notes.map((n) => n.midi) };
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
    if (this.playMode === 'tempo') return (t - this.startT) / this.spb;
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
    if (!this.started || this.finished || this.paused || this.held) return;
    const t = this.clock();
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    if (this.playMode === 'tempo') {
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
      if (this.lead && this.beat >= this.lead.to) this.lead = null;
      if (this.barLoop && this.mode === 'tempo') {
        this._checkBars();
        if (this.held) return;
      }
    } else {
      if (this.lead && this.beat >= this.lead.to) this.lead = null;
      let next = this.beat + dt / this.spb;
      // Skip over groups already satisfied.
      while (this.groupIdx < this.groups.length && this._groupDone(this.groups[this.groupIdx])) this.groupIdx++;
      const bw = this.barWait;
      if (bw && (this.groupIdx >= this.groups.length || this.groups[this.groupIdx].beat >= bw.to - 1e-6)) {
        // The bar learned in wait mode is done: on at tempo from the next bar, after a count-in.
        this.barWait = null;
        const rec = this._loopRec(bw.bar);
        rec.passed = true;
        this.activeLoop = null;
        this.onEvent({ type: 'bar-pass', bar: bw.bar, tries: rec.fails + 1, learned: true });
        if (bw.bar < this.lastBar) this._rewind(bw.to);
        else {
          this.barChecked = bw.bar;
          this.beat = Math.max(this.beat, this.piece.totalBeats);
          this.startT = t - this.beat * this.spb;
        }
        return;
      }
      // Wait mode: a bar started again is done once the playhead waits beyond it.
      const al = this.mode === 'wait' && this.activeLoop;
      if (al && (this.groupIdx >= this.groups.length || this.groups[this.groupIdx].beat >= al * this.beatsPerBar - 1e-6)) {
        const rec = this._loopRec(al, 'wait');
        rec.passed = true;
        this.activeLoop = null;
        this.onEvent({ type: 'bar-pass', bar: al, tries: rec.fails + 1, mode: 'wait' });
      }
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
      const ev = { type: 'beat', beat: bi };
      // The count-in before a bar played again: how many beats to go, then "go".
      if (this.lead && bi < Math.floor(this.lead.from)) ev.rest = true; // (the pause before it)
      else if (this.lead && bi >= Math.floor(this.lead.from) && bi < this.lead.to) {
        ev.lead = Math.round(this.lead.to - bi);
        this.leadEnd = this.lead.to;
      } else if (this.leadEnd != null && bi >= this.leadEnd) {
        ev.go = bi === this.leadEnd;
        this.leadEnd = null;
      }
      this.onEvent(ev);
    }
    const done = this.mode === 'tempo' ? !this.barLoop || this.barChecked >= this.lastBar : this.groupIdx >= this.groups.length;
    if (this.beat >= this.piece.totalBeats + 0.25 && done && !this.barWait) {
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
    if (this.held) return out;
    if (this.playMode === 'wait') {
      if (this.lead && this.beat < this.lead.to - 0.5) return out; // (counting in: not yet)
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
    if (!this.started || this.finished || this.paused || this.held) return null;
    const tt = t - this.latency;
    const beat = this.beatAtTime(tt);
    if (beat < -0.5) return null; // during count-in
    if (this.lead && beat < this.lead.to - 0.5) return null; // during the count-in before a bar again
    const rhythm = this.piece.rhythmOnly || anyPitch;
    const waiting = this.playMode === 'wait';
    let res = null;
    if (waiting) {
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
          // (a bar learned in wait mode inside a tempo piece counts, but not as on the beat)
          const grade = this.barWait || wl.wrong >= 2 ? 'ok' : wl.wrong === 1 ? 'good' : slow ? 'great' : 'perfect';
          this.status.set(cand.id, { s: 'hit', err: 0, grade, t: tt, group: this.groupIdx, learned: !!this.barWait });
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
    let restart = null;
    if (!res) {
      // Wait mode: the right next note, just played before the playhead got there, is not wrong.
      const early = waiting && this.waitGroup && this.waitGroup.notes.some((n) => n.midi === midi && !this.status.has(n.id));
      if (rhythm || early || this._isGhost(midi, tt, confidence)) {
        this.ignored++;
        return null;
      }
      // (wrong keys while learning a bar in wait mode don't cost the tempo piece anything)
      if (this.barWait) this.loopWrong++;
      else {
        this.extras++;
        this.wrong.push({ midi, beat, t: tt });
      }
      res = { type: 'wrong', midi, beat };
      if (waiting && this.waitGroup) {
        // One try = one press (a chord or a quick re-strike within 0.25 s counts once).
        const wl = this._waitLog(this.groupIdx);
        if (tt - wl.lastWrongT > 0.25) wl.wrong++;
        wl.lastWrongT = tt;
        res.wait = true;
        res.expected = this.waitGroup.notes.filter((n) => !this.status.has(n.id)).map((n) => n.midi);
        if (this.barLoop && this.mode === 'wait') restart = this._restartWaitBar(wl);
      }
    }
    this.onEvent(res);
    if (restart) this.onEvent(restart);
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
        if (tempo && !st.learned) {
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
      ...this._loopSummary(),
    };
  }

  // Bars played again (bar loop): which, how many tries, and how each ended.
  _loopSummary() {
    const loops = [...this.loops.values()]
      .filter((r) => r.fails > 0)
      .map((r) => {
        const notes = this.notesInBar(r.bar);
        const clean = notes.length > 0 && notes.every((n) => (this.status.get(n.id) || {}).s === 'hit');
        const passed = r.passed || (!r.gaveUp && clean);
        return { bar: r.bar, tries: r.fails + (passed ? 1 : 0), passed, slowed: r.slowed, learned: r.learned, gaveUp: r.gaveUp, mode: r.mode };
      })
      .sort((a, b) => a.bar - b.bar);
    return { loops, loopCount: this.replays, loopWrong: this.loopWrong };
  }
}
