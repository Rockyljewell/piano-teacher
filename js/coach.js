// The coach: placement test, lesson planning, mastery and progress tracking (persisted in
// localStorage so the student picks up exactly where they left off).
import { LEVELS, MAX_LEVEL, levelInfo } from './music/curriculum.js';
import { noteName, spokenPc } from './music/theory.js';
import { musicalOffset } from './game/engine.js';
import * as P from './placement.js';

const STORE = 'maestro.progress.v1';
export const PASS_SCORE = 75;

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
  dailyGoal: 50, // XP
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
      const kind = warmupKinds(level)[Math.floor(i / plan.length) % warmupKinds(level).length];
      return { kind, level, mode: kind === 'notes' ? 'wait' : 'tempo', tempoFactor: tf, label: WARMUP_LABEL[kind] };
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
    s.history.push({ t: Date.now(), level, kind: activity.kind, mode: result.mode, score: result.score, bpm: piece.bpm, placement: !!activity.placement });
    if (s.history.length > 500) s.history.splice(0, s.history.length - 500);

    // XP: every exercise earns some, good ones earn more.
    const xp = Math.max(1, Math.round(result.score / 10)) + (result.stars || 0) * 3;
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
      xp: s.xp || 0, todayXp, dailyGoal: s.settings.dailyGoal || 50,
    };
  }
}
