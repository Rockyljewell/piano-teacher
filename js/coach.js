// The coach: placement test, lesson planning, mastery and progress tracking (persisted in
// localStorage so the student picks up exactly where they left off).
import { LEVELS, MAX_LEVEL, levelInfo } from './music/curriculum.js';
import { noteName, spokenPc } from './music/theory.js';
import { musicalOffset } from './game/engine.js';
import { songsForLevel } from './music/songs.js';
import { generate } from './music/generator.js';
import * as P from './placement.js';

const STORE = 'maestro.progress.v1'; // (the key stays; the data inside carries its own version)
const VERSION = 2;
export const PASS_SCORE = 75;

// ---- progression --------------------------------------------------------------------------
// Every level is a lesson plan (lessonPlan): meet the idea, learn pieces step by step in wait
// mode, play them with the beat, rhythm drills, warm-ups, a song, a look back at the level
// before, and a level check. Moving up takes working through the plan AND passing the check at
// tempo. Mastery (0-100, shown as stars on finished levels) grows slowly and only from playing
// with the beat: wait mode is for learning.
export const PROGRESSION = {
  checkPass: 80, // the level check: this score at tempo...
  checkMaxLoops: 1, // ...with at most this many bars played again
  minDone: 12, // plan activities completed (not skipped) before the level check
  retryBelow: 60, // a piece below this at tempo is learned in wait mode, then tried again
  placementHeadStart: 20, // mastery for a level placement put you in (from level 2)
  gain: [[90, 10], [80, 7], [70, 4], [60, 2]], // tempo pieces: score -> mastery
  loss: -2, // tempo piece below the lowest band
  waitGain: [[90, 1]], // wait mode: next to nothing
  checkBonus: 15,
};

// XP pays for work done: the notes played correctly, measured against a typical piece at the
// level (so a short warm-up earns less than a full piece), worth more when played well. Wait mode
// earns a third and no star bonus.
export const XP_RULES = { full: 12, maxWork: 1.25, perStar: 2, waitFactor: 1 / 3 };
export const XP_MAX = Math.round(XP_RULES.full * XP_RULES.maxWork + 3 * XP_RULES.perStar);
const typical = new Map();
export function typicalNotes(level = 1) {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
  if (!typical.has(L)) {
    let n = 12;
    try {
      const c = [1, 2, 3].map((seed) => generate(L, { seed: 9000 + seed }).notes.length).sort((a, b) => a - b);
      n = Math.max(4, c[1]);
    } catch {
      /* keep the default */
    }
    typical.set(L, n);
  }
  return typical.get(L);
}
export function xpFor(result, level = result.level || 1) {
  const R = XP_RULES;
  const hits = Math.max(0, result.hits || 0);
  const work = Math.min(R.maxWork, hits / typicalNotes(level));
  const q = 0.5 + (0.5 * Math.max(0, Math.min(100, result.score || 0))) / 100;
  let xp = R.full * work * q;
  if (result.mode === 'wait') xp *= R.waitFactor;
  else xp += (result.stars || 0) * R.perStar * Math.min(1, work);
  return Math.max(1, Math.round(xp));
}

// Automatic microphone-delay correction. A steady offset in every note (tight spread, both
// hands agreeing, the same across pieces) is input latency, not the player. The measured
// offset plus the current setting ("raw") does not depend on the setting, so moving part of
// the way toward the median of recent raw offsets converges without oscillating.
export const AUTO_LATENCY = {
  minNotes: 10, // timed notes in the piece
  minAcc: 0.75, // only pieces played reasonably accurately
  maxIqr: 80, // ms: only tight timing is evidence of a device delay
  handsAgree: 40, // ms: both hands must show the same offset
  window: 3, // recent pieces considered
  minPieces: 2, // consistent pieces needed before moving
  maxSpread: 60, // ms: recent raw offsets must agree
  deadband: 15, // ms: close enough, leave it
  fraction: 0.5, // move this part of the way
  maxStep: 40, // ms per piece
  min: -50,
  max: 250,
};

function medianOf(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const HAND = { R: 'right', L: 'left' };

export const DEFAULT_SETTINGS = {
  showStaff: true,
  showFalling: true,
  showNames: 'auto',
  showFingers: true,
  showHints: true,
  metronome: 'countin', // 'countin' | 'always' | 'off'
  sensitivity: 1,
  latencyMs: 0,
  autoLatency: true, // learn the microphone delay from steady playing (see Coach.autoLatency)
  prep: true, // "get ready" step before each exercise (js/ui/prep.js)
  autoAdvance: true,
  lookaheadSec: 3,
  dailyGoal: 50, // XP (about 10-12 lesson activities)
  repeatBars: true, // bar loop: a missed bar is played again before moving on (engine LOOP_RULES)
  voice: true,
  sounds: true,
  noteColors: 'auto', // colour-coded notes for beginners
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Warm-ups that fit the level: note reading and five-finger patterns while the hands stay in
// one position (thumb-under scales only from level 16, which teaches them), chords from the
// left-hand-chords level (14), arpeggios from level 25.
export const WARMUP_LABEL = {
  notes: 'Warm-up: note reading', fivefinger: 'Warm-up: five-finger pattern', scale: 'Warm-up: scale', chords: 'Warm-up: chords', arpeggio: 'Warm-up: arpeggio',
};
export function warmupKinds(level) {
  if (level <= 2) return ['notes', 'fivefinger'];
  if (level < 14) return ['fivefinger', 'notes'];
  if (level < 16) return ['fivefinger', 'chords', 'notes'];
  const k = ['scale', 'chords'];
  if (level >= 25) k.push('arpeggio');
  return k;
}

// The lesson plan of a level: 15 steps. `same` replays the piece of the step before (learn it in
// wait mode, then play it with the beat). Song steps fall back to a sight-reading piece when no
// song fits the level.
export function lessonPlan(level) {
  const wk = warmupKinds(level);
  const S = (type, extra = {}) => ({ type, ...extra });
  return [
    S('intro'),
    S('warmup', { warm: wk[0] }),
    S('learn'),
    S('play', { same: true }),
    S('rhythm'),
    level > 1 ? S('review') : S('practice'),
    S('learn'),
    S('play', { same: true }),
    S('warmup', { warm: wk[1 % wk.length] }),
    S('song-learn'),
    S('song-play', { same: true }),
    S('rhythm'),
    S('practice'),
    S('practice'),
    S('check'),
  ];
}

// What each kind of step is for, in Pip's words (shown before it starts).
const STEP_LINE = {
  warmup: 'A quick warm-up to wake up your fingers.',
  learn: 'Wait mode waits for you: find each note, then play it. No rush.',
  play: 'The same piece again, now with the beat. Keep going even if you slip.',
  rhythm: 'Only the timing counts here. Any key works.',
  review: 'A quick look back at the level before, to keep it fresh.',
  'song-learn': 'A real song! Learn it step by step first.',
  'song-play': 'Now the song with the beat.',
  practice: 'A fresh piece at tempo. Read ahead and keep the beat.',
  check: 'Play it with the beat. Score 80% to move up.',
  extra: 'A little more practice before the level check.',
  retry: "Let's learn this one step by step, then try it again.",
};

function freshPlan() {
  return { step: 0, done: 0, skipped: 0, seeds: {}, song: null, checks: 0, checkFails: 0, extra: 0 };
}

export class Coach {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.s = this._load();
  }

  _fresh() {
    return {
      placed: false,
      level: 1,
      mastery: {},
      tempo: {},
      counter: {},
      fails: {},
      seenIntro: {},
      retry: null,
      history: [],
      stats: { seconds: 0, pieces: 0, notes: 0 },
      streak: { last: null, days: 0 },
      settings: { ...DEFAULT_SETTINGS },
      placement: null,
      version: VERSION,
      plan: {},
    };
  }

  _load() {
    try {
      const raw = this.storage && this.storage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        const f = this._fresh();
        return Coach.migrate({ ...f, ...s, version: s.version || 1, settings: { ...f.settings, ...(s.settings || {}) }, stats: { ...f.stats, ...(s.stats || {}) } });
      }
    } catch {
      /* corrupted or unavailable storage */
    }
    return this._fresh();
  }

  // Older saves (version 1) had a 5-slot cycle and a mastery-only level-up. Keep the level, XP,
  // stars and history; start the current level's lesson plan about as far along as its mastery
  // was (the old mastery bar filled about twice as fast).
  static migrate(s) {
    if (!s.plan || typeof s.plan !== 'object') s.plan = {};
    for (const k of ['mastery', 'tempo', 'counter', 'fails', 'seenIntro']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    if (!Array.isArray(s.history)) s.history = [];
    if ((s.version || 1) < 2) {
      const L = s.level;
      if (s.placed && !s.plan[L]) {
        const p = freshPlan();
        const checkAt = lessonPlan(L).length - 1;
        if (s.seenIntro[L]) {
          p.step = Math.max(1, Math.min(checkAt - 1, Math.round(((s.mastery[L] || 0) / 100) * checkAt)));
          p.done = p.step;
        }
        s.plan[L] = p;
      }
      if (s.retry && s.retry.level !== L) s.retry = null;
      s.version = VERSION;
    }
    for (const [k, p] of Object.entries(s.plan)) s.plan[k] = { ...freshPlan(), ...(p || {}) };
    return s;
  }

  save() {
    try {
      this.storage && this.storage.setItem(STORE, JSON.stringify(this.s));
    } catch {
      /* storage full or blocked */
    }
  }

  reset() {
    const settings = this.s.settings;
    this.s = this._fresh();
    this.s.settings = settings;
    this.save();
  }

  get level() {
    return this.s.level;
  }

  get settings() {
    return this.s.settings;
  }

  setSetting(k, v) {
    this.s.settings[k] = v;
    this.save();
  }

  mastery(level = this.s.level) {
    return this.s.mastery[level] || 0;
  }

  // Where in the level's tempo range to play (0 = slowest). Beginners start at the slowest.
  tempoFactor(level = this.s.level) {
    return this.s.tempo[level] ?? (level <= 8 ? 0 : 0.25);
  }

  // ---- songs ------------------------------------------------------------------------------
  songKey(songId, arrangementId) {
    return `${songId}/${arrangementId}`;
  }

  songRecord(songId, arrangementId) {
    return (this.s.songs || {})[this.songKey(songId, arrangementId)] || null;
  }

  recordSong(songId, arrangementId, result) {
    if (!this.s.songs) this.s.songs = {};
    const k = this.songKey(songId, arrangementId);
    const r = this.s.songs[k] || { best: 0, stars: 0, plays: 0 };
    r.plays++;
    r.best = Math.max(r.best, result.score);
    r.stars = Math.max(r.stars, result.stars);
    r.last = Date.now();
    this.s.songs[k] = r;
    this.save();
    return r;
  }

  showNames(level = this.s.level) {
    const v = this.s.settings.showNames;
    return v === 'auto' ? level <= 4 : !!v;
  }

  // ---- placement --------------------------------------------------------------------------
  // Adaptive, both-hands placement test (see placement.js). `experience` is the answer to
  // "Have you played piano before?" and only sets the starting point.
  startPlacement(experience = 'little') {
    this.s.placement = { experience, post: P.prior(experience), tests: [], current: null };
    this.s.placement.current = P.nextLevel(this.s.placement.post, []);
    this.save();
    return this.placementActivity();
  }

  placementActivity() {
    const p = this.s.placement;
    if (!p) return null;
    const n = p.tests.length;
    return {
      kind: 'sight', level: p.current, mode: 'tempo', placement: true, bothHands: true,
      measures: 4, tempoFactor: 0.1,
      label: `Test ${n + 1}`,
      testIndex: n + 1,
      estTotal: P.estimatedTotal(p.post, p.tests),
      estimate: P.estimate(p.post),
    };
  }

  // Returns {done:false, next, passed, direction, estimate} or {done:true, level, tests, estimate}.
  placementResult(result) {
    const p = this.s.placement;
    const level = p.current;
    p.tests.push({ level, score: result.score, noteAcc: result.noteAcc, timing: result.timing, perHand: result.perHand });
    p.post = P.update(p.post, level, result.score);
    const estimate = P.estimate(p.post);
    if (P.shouldStop(p.post, p.tests)) {
      const final = P.finalLevel(p.post);
      this.s.placed = true;
      this.s.level = final;
      this.s.placementHistory = [...(this.s.placementHistory || []), { t: Date.now(), experience: p.experience, tests: p.tests, level: final }].slice(-5);
      // A small head start on a level the student has already shown they can handle; the lesson
      // plan starts at its beginning.
      if (final >= 2) this.s.mastery[final] = Math.max(this.s.mastery[final] || 0, PROGRESSION.placementHeadStart);
      this.s.plan[final] = freshPlan();
      this.s.retry = null;
      const tests = p.tests;
      this.s.placement = null;
      this.save();
      return { done: true, level: final, tests, estimate };
    }
    p.current = P.nextLevel(p.post, p.tests);
    this.save();
    const direction = p.current > level ? 'harder' : p.current < level ? 'easier' : 'same';
    return { done: false, next: this.placementActivity(), passed: result.score >= PASS_SCORE, direction, estimate };
  }

  // Place the student at a level directly (skipping or overriding the placement test).
  setLevel(level) {
    this.s.level = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
    this.s.placed = true;
    this.s.placement = null;
    this.s.plan[this.s.level] = freshPlan();
    this.s.retry = null;
    this.save();
  }

  // ---- lessons ----------------------------------------------------------------------------
  _plan(level = this.s.level) {
    if (!this.s.plan[level]) this.s.plan[level] = freshPlan();
    return this.s.plan[level];
  }

  // Where the student is in a level's plan: {lesson, total, step, done, steps, checkFails, next}.
  planStatus(level = this.s.level) {
    const steps = lessonPlan(level);
    const p = this._plan(level);
    const step = Math.min(p.step, steps.length - 1);
    const next = level === this.s.level ? this.nextActivity() : null;
    return {
      level, step, lesson: step + 1, total: steps.length, done: p.done, steps: steps.map((x) => x.type), checkFails: p.checkFails,
      atCheck: steps[step].type === 'check', extra: !!(next && (next.retry || next.extra)), next,
      minDone: PROGRESSION.minDone,
    };
  }

  // A concept reminder from the level (Pip's line and tips), rotating through the plan.
  tipFor(level, i = 0) {
    const lv = levelInfo(level);
    const pool = [lv.say, ...(lv.tips || [])].filter(Boolean);
    return pool.length ? pool[i % pool.length] : '';
  }

  // A song from the library that fits the level (its arrangement is at most this level and not
  // far below it), preferring ones the student has not had in a lesson yet.
  lessonSong(level) {
    const cands = songsForLevel(level).filter((x) => x.recommended.level >= Math.max(1, level - 6));
    if (!cands.length) return null;
    const had = new Set(Object.values(this.s.plan).map((p) => p && p.song && p.song.songId).filter(Boolean));
    const played = new Set(Object.keys(this.s.songs || {}).map((k) => k.split('/')[0]));
    const pick = cands.find((x) => !had.has(x.id) && !played.has(x.id)) || cands.find((x) => !had.has(x.id)) || cands[0];
    const a = pick.recommended;
    const first = a.pickup ? 0 : 1;
    const last = a.pickup ? a.measures - 1 : a.measures;
    // A long song: its first eight bars make the lesson.
    const to = a.measures > 12 ? first + 7 : last;
    return { songId: pick.id, arrangementId: a.id, title: pick.title, bpm: a.bpm, hands: a.hands, from: first, to, section: to < last };
  }

  _songActivity(level, song, mode, tf) {
    const lv = levelInfo(level);
    const f = Math.max(0, Math.min(1, tf));
    const want = lv.bpm ? lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * f : song.bpm;
    const tempoScale = Math.max(0.5, Math.min(1, want / song.bpm));
    const what = song.section ? `${song.title} (first part)` : song.title;
    return {
      kind: 'song', level, mode, songId: song.songId, arrangementId: song.arrangementId, hands: 'both', tempoScale, from: song.from, to: song.to, section: !!song.section,
      label: mode === 'wait' ? `Song: learn ${what}` : `Song: ${what}`,
    };
  }

  // What should the student do next at their level?
  nextActivity() {
    const level = this.s.level;
    const steps = lessonPlan(level);
    const p = this._plan(level);
    if (p.step === 0 && !this.s.seenIntro[level]) return { kind: 'intro', level, plan: { level, step: 0 }, lesson: 1, total: steps.length, label: `New idea: ${levelInfo(level).title}` };
    if (p.step === 0) p.step = 1;
    const i = Math.min(p.step, steps.length - 1);
    const st = steps[i];
    const tf = this.tempoFactor(level);
    const base = { level, plan: { level, step: i }, lesson: i + 1, total: steps.length, tip: this.tipFor(level, i) };
    if (this.s.retry && this.s.retry.level === level) {
      const r = this.s.retry;
      const learn = r.mode === 'wait';
      const act = r.song ? this._songActivity(level, r.song, r.mode, tf) : { kind: 'sight', level, mode: r.mode, seed: r.seed, tempoFactor: tf };
      return {
        ...base, ...act, retry: true, coachLine: learn ? STEP_LINE.retry : 'Now with the beat again. You know this one!',
        label: learn ? `Learn it step by step${r.check ? ' (level check piece)' : ''}` : `Try it again at tempo${r.check ? ' (level check piece)' : ''}`,
      };
    }
    switch (st.type) {
      case 'warmup': {
        const kind = st.warm;
        return { ...base, kind, mode: kind === 'notes' ? 'wait' : 'tempo', tempoFactor: tf, label: WARMUP_LABEL[kind], coachLine: STEP_LINE.warmup };
      }
      case 'learn':
        return { ...base, kind: 'sight', mode: 'wait', tempoFactor: tf, label: 'Learn a new piece (wait mode)', coachLine: STEP_LINE.learn };
      case 'play': {
        const seed = p.seeds[i - 1];
        return { ...base, kind: 'sight', mode: 'tempo', seed, tempoFactor: tf, label: seed != null ? 'Play it with the beat' : 'Sight-reading', coachLine: STEP_LINE.play };
      }
      case 'rhythm':
        return { ...base, kind: 'rhythm', mode: 'tempo', tempoFactor: tf, label: 'Rhythm drill (any key)', coachLine: STEP_LINE.rhythm };
      case 'review': {
        const prev = level - 1;
        return { ...base, kind: 'sight', level: prev, mode: 'tempo', tempoFactor: this.tempoFactor(prev), review: true, label: `Review: Level ${prev}`, coachLine: STEP_LINE.review };
      }
      case 'song-learn':
      case 'song-play': {
        if (!p.song) {
          p.song = this.lessonSong(level) || { none: true };
          this.save();
        }
        const learn = st.type === 'song-learn';
        if (p.song.none) {
          if (learn) return { ...base, kind: 'sight', mode: 'wait', tempoFactor: tf, label: 'Learn a new piece (wait mode)', coachLine: STEP_LINE.learn };
          const seed = p.seeds[i - 1];
          return { ...base, kind: 'sight', mode: 'tempo', seed, tempoFactor: tf, label: 'Play it with the beat', coachLine: STEP_LINE.play };
        }
        return { ...base, ...this._songActivity(level, p.song, learn ? 'wait' : 'tempo', tf), coachLine: STEP_LINE[st.type] };
      }
      case 'check': {
        if (p.done < PROGRESSION.minDone) {
          const left = PROGRESSION.minDone - p.done;
          return { ...base, kind: 'sight', mode: 'tempo', tempoFactor: tf, extra: true, label: `Extra practice (${left} more before the level check)`, coachLine: STEP_LINE.extra };
        }
        const next = level < MAX_LEVEL ? `Score ${PROGRESSION.checkPass}% to unlock Level ${level + 1}.` : `Score ${PROGRESSION.checkPass}% to finish the course!`;
        return { ...base, kind: 'sight', mode: 'tempo', tempoFactor: tf, check: true, label: 'Level check', coachLine: `Play it with the beat. ${next}` };
      }
      default:
        return { ...base, kind: 'sight', mode: 'tempo', tempoFactor: tf, label: 'Practice piece', coachLine: STEP_LINE.practice };
    }
  }

  markIntroSeen(level) {
    this.s.seenIntro[level] = true;
    const p = this._plan(level);
    if (p.step === 0) {
      p.step = 1;
      p.done++;
    }
    this.save();
  }

  // "Skip this one": move past a plan step without counting it (the level check can't be
  // skipped: a new check piece comes instead). A skipped retry is dropped.
  skip(activity, piece) {
    const s = this.s;
    if (!activity || !activity.plan || activity.plan.level !== s.level) return;
    const p = this._plan(s.level);
    if (activity.retry) {
      s.retry = null;
    } else if (!activity.extra && !activity.check && activity.plan.step === p.step) {
      if (piece && piece.seed != null) p.seeds[p.step] = piece.seed;
      p.step = Math.min(p.step + 1, lessonPlan(s.level).length - 1);
      p.skipped++;
    }
    this.save();
  }

  // Automatic microphone-delay correction after a tempo-mode result (see AUTO_LATENCY).
  // Returns {from, to, target, pieces} when the setting moved, else null.
  autoLatency(result, activity = {}) {
    const st = this.s.settings;
    const A = AUTO_LATENCY;
    if (st.autoLatency === false || !result || result.mode !== 'tempo' || activity.demo) return null;
    const n = (result.errs || []).length;
    if (n < A.minNotes || (result.noteAcc ?? 0) < A.minAcc || !(result.iqrMs <= A.maxIqr)) return null;
    const ph = result.perHand || {};
    if (ph.R && ph.L && ph.R.timed >= 4 && ph.L.timed >= 4 && Math.abs((ph.R.medianErrMs ?? ph.R.meanErrMs) - (ph.L.medianErrMs ?? ph.L.meanErrMs)) > A.handsAgree) return null;
    const cur = st.latencyMs || 0;
    const L = this.s.latency || (this.s.latency = { samples: [], moves: [] });
    L.samples.push({ t: Date.now(), raw: Math.round(result.medianErrMs + cur), iqr: result.iqrMs, n, bpm: result.bpm });
    if (L.samples.length > 12) L.samples.splice(0, L.samples.length - 12);
    const recent = L.samples.slice(-A.window).map((x) => x.raw);
    let move = null;
    if (recent.length >= A.minPieces && Math.max(...recent) - Math.min(...recent) <= A.maxSpread) {
      const target = medianOf(recent);
      const gap = target - cur;
      if (Math.abs(gap) >= A.deadband) {
        let step = Math.max(-A.maxStep, Math.min(A.maxStep, gap * A.fraction));
        // Damp a change of direction (never ping-pong around the target).
        const last = L.moves[L.moves.length - 1];
        if (last && Math.sign(last.to - last.from) !== Math.sign(step)) step *= 0.5;
        const next = Math.max(A.min, Math.min(A.max, Math.round((cur + step) / 5) * 5));
        if (next !== cur) {
          st.latencyMs = next;
          move = { from: cur, to: next, target: Math.round(target), pieces: recent.length };
          L.moves.push({ t: Date.now(), from: cur, to: next, target: Math.round(target) });
          if (L.moves.length > 20) L.moves.splice(0, L.moves.length - 20);
        }
      }
    }
    this.save();
    return move;
  }

  // Record a finished activity. Returns feedback for the results screen.
  record(activity, piece, result, seconds) {
    const s = this.s;
    const level = activity.level;
    const latency = this.autoLatency(result, activity);
    s.stats.seconds += seconds;
    s.stats.pieces += 1;
    s.stats.notes += result.hits;
    const d = today();
    if (s.streak.last !== d) {
      const y = new Date(Date.now() - 86400000);
      const yd = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
      s.streak.days = s.streak.last === yd ? s.streak.days + 1 : 1;
      s.streak.last = d;
    }
    s.history.push({ t: Date.now(), level, kind: activity.kind, mode: result.mode, score: result.score, bpm: piece.bpm, placement: !!activity.placement, loops: result.loopCount || 0, check: !!activity.check });
    if (s.history.length > 500) s.history.splice(0, s.history.length - 500);

    // XP: pays for the work done (see xpFor).
    const xp = xpFor(result, level);
    s.xp = (s.xp || 0) + xp;
    if (!s.daily || s.daily.date !== d) s.daily = { date: d, xp: 0 };
    const before = s.daily.xp;
    s.daily.xp += xp;
    const goal = s.settings.dailyGoal || 50;
    const out = { levelUp: false, levelDown: false, gain: 0, xp, goalReached: before < goal && s.daily.xp >= goal, latency };
    if (activity.placement || activity.free) {
      this.save();
      return out;
    }
    const sc = result.score;
    const tempo = result.mode === 'tempo';
    const cur = s.level;
    const inPlan = !!(activity.plan && activity.plan.level === cur);
    const sightLike = activity.kind === 'sight';

    // Mastery grows slowly, and only from playing with the beat.
    const G = PROGRESSION;
    let gain = 0;
    if (tempo) {
      const band = G.gain.find(([min]) => sc >= min);
      gain = band ? band[1] : G.loss;
    } else {
      const band = G.waitGain.find(([min]) => sc >= min);
      gain = band ? band[1] : 0;
    }
    if (!sightLike || activity.review) gain = gain > 0 ? Math.round(gain / 2) : 0;
    if (gain > 0 && (result.loopCount || 0) >= 2) gain = Math.round(gain / 2); // not solid yet
    if (level === cur || inPlan) {
      s.mastery[cur] = Math.max(0, Math.min(100, (s.mastery[cur] || 0) + gain));
      out.gain = gain;
    }

    // Tempo adapts to how comfortable the student is.
    if (tempo && level === cur && (activity.kind === 'sight' || activity.kind === 'rhythm')) {
      let tf = this.tempoFactor(level);
      if (sc >= 92) tf += 0.15;
      else if (sc >= 80) tf += 0.07;
      else if (sc < 65) tf -= 0.15;
      s.tempo[level] = Math.max(-0.5, Math.min(1.3, tf));
    }

    if (tempo && sightLike && level === cur) {
      s.fails[level] = sc < 50 ? (s.fails[level] || 0) + 1 : 0;
    }

    // The lesson plan.
    if (inPlan) this._advance(activity, piece, result, out);

    if (out.checkPassed) {
      s.mastery[cur] = Math.min(100, (s.mastery[cur] || 0) + G.checkBonus);
      out.gain += G.checkBonus;
      s.retry = null;
      if (cur < MAX_LEVEL) {
        s.level = cur + 1;
        out.levelUp = true;
        out.newLevel = s.level;
        if (!s.plan[s.level] || s.plan[s.level].step >= lessonPlan(s.level).length - 1) s.plan[s.level] = freshPlan();
      } else {
        // The whole course is done: the last level's plan starts over for more practice.
        out.courseDone = true;
        s.plan[cur] = { ...freshPlan(), step: 1, done: 1 };
      }
    } else if ((level === cur || inPlan) && (s.fails[cur] || 0) >= 3 && cur > 1 && (s.mastery[cur] || 0) < 20) {
      s.fails[cur] = 0;
      s.level = cur - 1;
      s.retry = null;
      // Back through the easier level's pieces (its introduction is already known).
      s.plan[s.level] = { ...freshPlan(), step: 1, done: 1 };
      out.levelDown = true;
      out.newLevel = s.level;
    }
    out.plan = null;
    if (inPlan) {
      // Where the student is now (in the new level after a level change).
      const st = this.planStatus(s.level);
      out.plan = { level: s.level, lesson: st.lesson, total: st.total, done: st.done, steps: st.steps, next: st.next && st.next.label, nextKind: st.next && st.next.kind, extra: st.extra, atCheck: st.atCheck };
    }
    this.save();
    return out;
  }

  // Move through the plan after a lesson activity (record() calls this).
  _advance(activity, piece, result, out) {
    const s = this.s;
    const L = s.level;
    const p = this._plan(L);
    const steps = lessonPlan(L);
    const sc = result.score;
    const tempo = result.mode === 'tempo';
    const G = PROGRESSION;
    const retryable = activity.kind === 'sight' || activity.kind === 'song';
    const songOf = () => (activity.kind === 'song' ? { songId: activity.songId, arrangementId: activity.arrangementId, title: p.song && p.song.title, bpm: piece && piece.bpm / (activity.tempoScale || 1), from: activity.from, to: activity.to, section: p.song && p.song.section } : null);
    if (activity.retry) {
      // Extra practice on a piece that was hard: wait mode, then at tempo again.
      p.extra++;
      if (s.retry && s.retry.level === L) {
        if (s.retry.mode === 'wait') s.retry = { ...s.retry, mode: 'tempo' };
        else s.retry = null;
      }
    } else if (activity.extra) {
      p.done++;
      p.extra++;
    } else if (activity.check && activity.plan.step === p.step) {
      p.checks++;
      const loops = result.loopCount || 0;
      const passed = tempo && sc >= G.checkPass && loops <= G.checkMaxLoops;
      out.check = { passed, score: sc, need: G.checkPass, loops, tooManyLoops: tempo && sc >= G.checkPass && loops > G.checkMaxLoops };
      if (passed) out.checkPassed = true;
      else {
        p.checkFails++;
        // Learn the check piece step by step, try it at tempo, then a fresh check.
        s.retry = { level: L, seed: piece && piece.seed, mode: 'wait', check: true };
      }
    } else if (activity.plan.step === p.step && steps[p.step] && steps[p.step].type !== 'check') {
      if (piece && piece.seed != null) p.seeds[p.step] = piece.seed;
      p.step = Math.min(p.step + 1, steps.length - 1);
      p.done++;
      // Struggling at tempo: learn the same piece in wait mode, then try it again.
      if (tempo && retryable && !activity.review && sc < G.retryBelow) s.retry = { level: L, seed: piece && piece.seed, mode: 'wait', song: songOf() };
    }
  }

  // What to say after a piece: a headline, one spoken line (Pip) and up to three short tips
  // that say what to fix: the bar with most slips, the notes missed most (spelled for the
  // key), the weaker hand, rushing or dragging, key-signature slips, wait-mode wrong tries.
  // `out` is what record() returned (for the latency note).
  review(piece, result, activity = {}, out = {}) {
    const r = result;
    const key = piece && piece.key;
    const tempo = r.mode === 'tempo';
    const cands = [];
    const add = (prio, text, sayText) => cands.push({ prio, text, say: sayText || null });
    const headline =
      r.score >= 95 ? 'Outstanding! Clean notes and steady rhythm.'
      : r.score >= 85 ? 'Great playing!'
      : r.score >= 70 ? 'Good work. A few more run-throughs and you\'ll own it.'
      : r.score >= 50 ? 'Keep going. Accuracy first, speed later.'
      : 'That one was tough. Let\'s slow it down and learn it step by step.';
    const name = (m) => (key ? noteName(m, key) : String(m));
    const sayNote = (m) => (key ? spokenPc(m, key) : String(m));

    // Bars played again (bar loop): name them, kindly.
    const loops = r.loops || [];
    if (loops.length) {
      const bars = (list) => (list.length === 1 ? `Bar ${list[0].bar}` : `Bars ${list.slice(0, -1).map((l) => l.bar).join(', ')} and ${list.at(-1).bar}`);
      const stuck = loops.filter((l) => l.gaveUp);
      const learned = loops.filter((l) => l.learned && l.passed);
      const got = loops.filter((l) => l.passed && !l.learned);
      if (stuck.length) add(95, `${bars(stuck)} still ${stuck.length > 1 ? 'need' : 'needs'} work. Learn ${stuck.length > 1 ? 'them' : 'it'} in wait mode, then try with the beat.`, `${bars(stuck)} still ${stuck.length > 1 ? 'need' : 'needs'} a little work.`);
      if (learned.length) add(90, `You learned ${bars(learned).toLowerCase()} step by step. Next time, try ${learned.length > 1 ? 'them' : 'it'} with the beat.`, null);
      if (got.length) {
        const most = Math.max(...got.map((l) => l.tries));
        add(94, `${bars(got)} needed ${most > 2 ? 'a few tries' : 'a second try'}, and you got ${got.length > 1 ? 'them' : 'it'}! Play ${got.length > 1 ? 'them' : 'it'} once more slowly next time.`, `${bars(got)} took practice, and you got ${got.length > 1 ? 'them' : 'it'}!`);
      }
    }
    // Key-signature slips: the clearest single fix.
    if (r.sigSlips && r.sigSlips.length) {
      const k = r.sigSlips[0];
      add(92, `Remember the key signature: every ${k.letter} is ${k.name}.`, `Remember, every ${k.letter} is ${k.name.replace('♯', ' sharp').replace('♭', ' flat')}.`);
    }
    // The bar(s) with most slips.
    const wb = (r.worstBars || []).filter((b) => b.problems >= 1);
    if (wb.length && r.score < 97) {
      const b = wb.length > 1 && wb[1].problems >= wb[0].problems - 1 ? wb.slice(0, 2) : wb.slice(0, 1);
      const where = b.length === 2 ? `Bars ${b[0].bar} and ${b[1].bar}` : `Bar ${b[0].bar}`;
      const fix = tempo ? (r.score < 80 ? 'Try it in wait mode, then at tempo.' : 'Play it slowly once, then at tempo.') : 'Play it once more on its own.';
      add(78 + Math.min(10, b[0].problems), `${where} had the most slips. ${fix}`, `${where} ${b.length === 2 ? 'need' : 'needs'} a little work.`);
    }
    // Notes missed most.
    const missed = (r.missedByMidi || []).filter(([, c]) => c >= 2);
    const missCount = (r.missedByMidi || []).reduce((a, [, c]) => a + c, 0);
    if (missed.length || (missCount >= 2 && r.missedByMidi.length)) {
      const top = (missed.length ? missed : r.missedByMidi).slice(0, 2).map(([m]) => m);
      add(70 + Math.min(12, missCount), `Watch out for ${top.map(name).join(' and ')}: ${top.length > 1 ? 'they were' : 'it was'} missed most.`, `Watch out for ${[...new Set(top.map(sayNote))].join(' and ')}.`);
    }
    // The weaker hand.
    if (r.weakHand && r.perHand && r.perHand[r.weakHand]) {
      const h = r.weakHand;
      const ph = r.perHand[h];
      add(76, `Your ${HAND[h]} hand missed ${ph.total - ph.hits} of ${ph.total} notes. Give it a solo run.`, `Give your ${HAND[h]} hand some extra practice.`);
    }
    // Wait mode: wrong tries and long pauses.
    if (!tempo && r.waitStats) {
      const w = r.waitStats;
      if (w.wrongTries) add(66, `${w.wrongTries} wrong key${w.wrongTries > 1 ? 's' : ''} on the way. Find the note on the staff first, then play.`, 'Look first, then play.');
      if (w.slowGroups >= 2) add(56, `A few long pauses. Read the next note while you play this one.`, 'Try reading one note ahead.');
      if (!w.wrongTries && !w.slowGroups) add(20, 'Every note found first time!', 'Every note first time!');
      if (r.score >= 90) add(35, 'Ready for it at tempo? Turn Wait off and play along with the beat.', null);
    }
    // Rushing or dragging (unless the microphone delay was just corrected for it).
    if (tempo && r.tendency && !(out && out.latency)) {
      const m = Math.abs(r.medianErrMs);
      const mus = musicalOffset(m, r.bpm || 60);
      if (r.tendency === 'rush') add(60 + Math.min(15, m / 10), `You rushed a little: about ${m} ms early (${mus}). Wait for the beat.`, 'Try not to rush.');
      else if (r.tendency === 'drag') add(60 + Math.min(15, m / 10), `You were a little behind the beat: about ${m} ms late (${mus}). Look one note ahead.`, 'Stay right with the beat.');
      else if (r.tendency === 'uneven') add(52, 'Your timing wobbled a bit. Count along out loud.', 'Count along out loud.');
      else if (r.timing >= 0.9) add(15, 'Your timing was right on the beat.', 'Right on the beat!');
    }
    if (tempo && r.extras > Math.max(2, r.total * 0.15)) add(58, 'I heard quite a few extra notes. Keep your fingers close to their keys.', 'Aim carefully.');
    if (out && out.latency) add(40, `I adjusted for your microphone's delay (now ${out.latency.to} ms), so your timing reads true.`, null);
    cands.sort((a, b) => b.prio - a.prio);
    const tips = cands.slice(0, 3).map((c) => c.text);
    const focus = cands.find((c) => c.say);
    const praise = r.score >= 95 ? 'Brilliant!' : r.score >= 85 ? 'Great job!' : r.score >= 70 ? 'Nice work.' : 'Good try.';
    const speak = r.score >= 95 || !focus ? `${r.score} percent. ${praise}` : `${r.score} percent. ${focus.say}`;
    return { headline, speak, tips };
  }

  // Human feedback from a result: [headline, ...tips] (kept for older callers).
  feedback(piece, result) {
    const rv = this.review(piece, result);
    return [rv.headline, ...rv.tips];
  }

  summary() {
    const s = this.s;
    const recent = s.history.filter((h) => !h.placement).slice(-20);
    const avg = recent.length ? Math.round(recent.reduce((a, h) => a + h.score, 0) / recent.length) : 0;
    const d = today();
    const todayXp = s.daily && s.daily.date === d ? s.daily.xp : 0;
    return {
      level: s.level, info: levelInfo(s.level), mastery: this.mastery(), avg, stats: s.stats, streak: s.streak.days, history: s.history, levels: LEVELS,
      xp: s.xp || 0, todayXp, dailyGoal: s.settings.dailyGoal || 50, plan: s.placed ? this.planStatus() : null,
    };
  }
}
