// The coach: placement test, lesson planning, mastery and progress tracking (persisted in
// localStorage so the student picks up exactly where they left off).
import { LEVELS, MAX_LEVEL, levelInfo } from './music/curriculum.js';
import { noteName } from './music/theory.js';
import * as P from './placement.js';

const STORE = 'maestro.progress.v1';
export const PASS_SCORE = 75;

export const DEFAULT_SETTINGS = {
  showStaff: true,
  showFalling: true,
  showNames: 'auto',
  showFingers: true,
  showHints: true,
  metronome: 'countin', // 'countin' | 'always' | 'off'
  sensitivity: 1,
  latencyMs: 0,
  autoAdvance: true,
  lookaheadSec: 3,
  dailyGoal: 50, // XP
  voice: true,
  sounds: true,
  noteColors: 'auto', // colour-coded notes for beginners
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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
    };
  }

  _load() {
    try {
      const raw = this.storage && this.storage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        const f = this._fresh();
        return { ...f, ...s, settings: { ...f.settings, ...(s.settings || {}) }, stats: { ...f.stats, ...(s.stats || {}) } };
      }
    } catch {
      /* corrupted or unavailable storage */
    }
    return this._fresh();
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
      // A small head start on a level the student has already shown they can handle.
      if (final >= 2) this.s.mastery[final] = Math.max(this.s.mastery[final] || 0, 30);
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
    this.save();
  }

  // ---- lessons ----------------------------------------------------------------------------
  // What should the student do next at their level?
  nextActivity() {
    const level = this.s.level;
    const lv = levelInfo(level);
    if (!this.s.seenIntro[level]) return { kind: 'intro', level };
    if (this.s.retry && this.s.retry.level === level) {
      const r = this.s.retry;
      return { kind: 'sight', level, mode: r.mode, seed: r.seed, tempoFactor: this.tempoFactor(level), label: r.mode === 'wait' ? 'Learn it step by step' : 'Try it again at tempo' };
    }
    const i = this.s.counter[level] || 0;
    const plan = ['warmup', 'sight', 'rhythm', 'sight', 'sight'];
    const slot = plan[i % plan.length];
    const tf = this.tempoFactor(level);
    if (slot === 'warmup') {
      let kind = 'notes';
      if (level >= 9) {
        const opts = ['scale'];
        if (level >= 14) opts.push('chords');
        if (level >= 25) opts.push('arpeggio');
        kind = opts[Math.floor(i / plan.length) % opts.length];
      }
      return { kind, level, mode: kind === 'notes' ? 'wait' : 'tempo', tempoFactor: tf, label: kind === 'notes' ? 'Warm-up: note reading' : `Warm-up: ${kind}` };
    }
    if (slot === 'rhythm') return { kind: 'rhythm', level, mode: 'tempo', tempoFactor: tf, label: 'Rhythm drill (any key)' };
    // Very first piece at a beginner level: learn in wait mode.
    const firstAtLevel = !this.s.history.some((h) => h.level === level && h.kind === 'sight');
    const mode = firstAtLevel && level <= 4 ? 'wait' : 'tempo';
    return { kind: 'sight', level, mode, tempoFactor: tf, label: mode === 'wait' ? 'Sight-reading (learn mode)' : 'Sight-reading' };
  }

  markIntroSeen(level) {
    this.s.seenIntro[level] = true;
    this.save();
  }

  // Record a finished activity. Returns feedback for the results screen.
  record(activity, piece, result, seconds) {
    const s = this.s;
    const level = activity.level;
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
    s.history.push({ t: Date.now(), level, kind: activity.kind, mode: result.mode, score: result.score, bpm: piece.bpm, placement: !!activity.placement });
    if (s.history.length > 500) s.history.splice(0, s.history.length - 500);

    // XP: every exercise earns some, good ones earn more.
    const xp = Math.max(1, Math.round(result.score / 10)) + (result.stars || 0) * 3;
    s.xp = (s.xp || 0) + xp;
    if (!s.daily || s.daily.date !== d) s.daily = { date: d, xp: 0 };
    const before = s.daily.xp;
    s.daily.xp += xp;
    const goal = s.settings.dailyGoal || 50;
    const out = { levelUp: false, levelDown: false, gain: 0, xp, goalReached: before < goal && s.daily.xp >= goal };
    if (activity.placement || activity.free) {
      this.save();
      return out;
    }
    // Lesson-plan position advances (unless we're doing a retry).
    if (!activity.retry && !(s.retry && s.retry.level === level)) s.counter[level] = (s.counter[level] || 0) + 1;

    const sc = result.score;
    const tempo = result.mode === 'tempo';
    let gain = 0;
    if (tempo) gain = sc >= 90 ? 34 : sc >= 80 ? 25 : sc >= 70 ? 15 : sc >= 60 ? 8 : -5;
    else gain = sc >= 90 ? 8 : sc >= 70 ? 4 : 0;
    if (activity.kind !== 'sight') gain = gain > 0 ? Math.round(gain / 2) : 0;
    if (level === s.level) {
      s.mastery[level] = Math.max(0, Math.min(100, (s.mastery[level] || 0) + gain));
      out.gain = gain;
    }

    // Tempo adapts to how comfortable the student is.
    if (tempo && (activity.kind === 'sight' || activity.kind === 'rhythm')) {
      let tf = this.tempoFactor(level);
      if (sc >= 92) tf += 0.15;
      else if (sc >= 80) tf += 0.07;
      else if (sc < 65) tf -= 0.15;
      s.tempo[level] = Math.max(-0.5, Math.min(1.3, tf));
    }

    // Struggling at tempo -> learn the same piece in wait mode, then retry it at tempo.
    if (activity.kind === 'sight') {
      if (s.retry && s.retry.level === level) {
        if (s.retry.mode === 'wait') s.retry = { level, seed: piece.seed, mode: 'tempo' };
        else s.retry = null;
      } else if (tempo && sc < 60) s.retry = { level, seed: piece.seed, mode: 'wait' };
    }

    if (tempo && activity.kind === 'sight') {
      s.fails[level] = sc < 50 ? (s.fails[level] || 0) + 1 : 0;
    }

    if (level === s.level && s.mastery[level] >= 100 && s.level < MAX_LEVEL) {
      s.level += 1;
      s.retry = null;
      out.levelUp = true;
      out.newLevel = s.level;
    } else if (level === s.level && (s.fails[level] || 0) >= 3 && s.level > 1 && (s.mastery[level] || 0) < 20) {
      s.fails[level] = 0;
      s.level -= 1;
      s.retry = null;
      out.levelDown = true;
      out.newLevel = s.level;
    }
    this.save();
    return out;
  }

  // Human feedback from a result.
  feedback(piece, result) {
    const tips = [];
    const r = result;
    if (r.score >= 95) tips.push('Outstanding! Clean notes and steady rhythm.');
    else if (r.score >= 85) tips.push('Great playing!');
    else if (r.score >= 70) tips.push('Good work. A few more run-throughs and you\'ll own it.');
    else if (r.score >= 50) tips.push('Keep going. Accuracy first, speed later.');
    else tips.push('That one was tough. Let\'s slow it down and learn it step by step.');
    if (r.mode === 'tempo' && r.hits >= 4) {
      const ms = Math.round(r.meanErr * 1000);
      if (ms > 45) tips.push(`You tend to play a little late (about ${ms} ms). Look ahead to the next note.`);
      else if (ms < -45) tips.push(`You tend to rush (about ${-ms} ms early). Feel the beat and wait for it.`);
      else if (r.timing >= 0.9) tips.push('Your timing is right on the beat.');
    }
    if (r.missedByMidi.length) {
      const names = r.missedByMidi.slice(0, 3).map(([m]) => noteName(m, piece.key));
      tips.push(`Most missed: ${names.join(', ')}.`);
    }
    if (r.extras > Math.max(2, r.total * 0.15)) tips.push('I heard quite a few extra notes. Take a breath and aim carefully.');
    return tips;
  }

  summary() {
    const s = this.s;
    const recent = s.history.filter((h) => !h.placement).slice(-20);
    const avg = recent.length ? Math.round(recent.reduce((a, h) => a + h.score, 0) / recent.length) : 0;
    const d = today();
    const todayXp = s.daily && s.daily.date === d ? s.daily.xp : 0;
    return {
      level: s.level, info: levelInfo(s.level), mastery: this.mastery(), avg, stats: s.stats, streak: s.streak.days, history: s.history, levels: LEVELS,
      xp: s.xp || 0, todayXp, dailyGoal: s.settings.dailyGoal || 50,
    };
  }
}
