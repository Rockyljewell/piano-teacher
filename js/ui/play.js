// The play screen: builds the exercise, runs the graded session, draws the stage, handles the
// HUD (pause, tempo, wait mode, listen), the status strip (mic + bar progress), touch/keyboard
// input and free play.
import { $, $$, S, app, audio, coach, stage, show, screen, sfx, stopVoice } from './core.js';
import { Session } from '../game/engine.js';
import { generate, generateRhythm } from '../music/generator.js';
import { songPiece } from '../music/songs.js';
import { levelInfo } from '../music/curriculum.js';
import { noteName, chordName, Key } from '../music/theory.js';
import { icon, pip } from './brand.js';
import { wantsPrep, enterPrep, cancelPrep, prepNote, prepDrawState, placePrep } from './prep.js';

// Grade colours (docs/brand/playful/spec.md): Perfect = sun, Great = mint, early = blue, late = orange.
export const GRADE_COLORS = { perfect: '#FFC23D', great: '#20C07A', early: '#2F9BFF', late: '#FF9A2E', wrong: '#FF5A6A' };
export function gradeColor(grade, errMs = 0) {
  if (grade === 'perfect') return GRADE_COLORS.perfect;
  if (grade === 'great') return GRADE_COLORS.great;
  return errMs < 0 ? GRADE_COLORS.early : GRADE_COLORS.late;
}

export function buildPiece(act) {
  if (act.piece) return act.piece;
  if (act.kind === 'song') return songPiece(act.songId, act.arrangementId, { hands: act.hands || 'both', tempoScale: act.tempoScale || 1 });
  const opts = { kind: act.kind, seed: act.seed, measures: act.measures, tempoFactor: act.tempoFactor, bpm: act.bpm, bothHands: act.bothHands };
  return act.kind === 'rhythm' ? generateRhythm(act.level, opts) : generate(act.level, opts);
}

export function runActivity(act) {
  clearTimeout(S.autoTimer);
  stopVoice();
  if (!act) return show('home');
  if (act.kind === 'intro') return app.showIntro(act.level);
  let piece;
  try {
    piece = buildPiece(act);
  } catch (err) {
    console.error(err);
    return show('home');
  }
  S.activity = act;
  play(piece, act);
}
app.runActivity = runActivity;

export function stageOptions(level) {
  const st = coach.settings;
  return {
    showStaff: st.showStaff,
    showFalling: st.showFalling,
    showNames: coach.showNames(level),
    showFingers: st.showFingers,
    showHints: st.showHints,
    noteColors: st.noteColors === 'auto' ? level <= 16 : !!st.noteColors,
  };
}

function modeLabel(act) {
  if (act.placement) return 'Placement';
  if (act.kind === 'song') return 'Song';
  if (act.kind === 'import') return 'Imported';
  return act.free ? 'Practice' : 'Lesson';
}

function cueHtml(dir) {
  if (!dir) return '';
  const [cls, ic, text] = dir === 'harder' ? ['harder', 'up', 'A bit harder'] : dir === 'easier' ? ['easier', 'down', 'A bit easier'] : ['same', 'retry', 'One more like that'];
  return `<span class="cue ${cls}"><span class="arrow">${icon(ic, 15)}</span>${text}</span>`;
}

function placementProgress(act) {
  const n = act.testIndex || 1;
  const total = Math.max(n, act.estTotal || n);
  let segs = '';
  for (let i = 1; i <= total; i++) segs += `<i class="${i < n ? 'done' : i === n ? 'cur' : i > total - 2 && i > n ? 'maybe' : ''}"></i>`;
  return `<div class="hp-row"><b>Test ${n} <span>of ~${total}</span></b>${cueHtml(S.placementCue)}</div><div class="segs">${segs}</div>`;
}

export function play(piece, act) {
  stopPlay(true);
  S.free = false;
  $('#screen-play').classList.remove('free');
  $('#screen-play').classList.toggle('placement', !!act.placement);
  S.piece = piece;
  $('#free-display').classList.add('hidden');
  $('#results').classList.add('hidden');
  $('#pause-menu').classList.add('hidden');
  show('play');
  const level = act.level ?? piece.level ?? 1;
  stage.setOptions(stageOptions(level));
  stage.setPiece(piece);
  requestAnimationFrame(() => resizeStage());
  const lv = levelInfo(level);
  let title = act.label || piece.title;
  if (act.kind === 'song') title = piece.title;
  $('#hud-title').textContent = act.placement ? 'Find my level' : title;
  const bits = act.placement ? ['Both hands', piece.key.name, piece.tsName] : [modeLabel(act)];
  if (!act.placement) {
    if (act.kind === 'song') bits.push(piece.subtitle || '', piece.composer || '');
    else bits.push(`Level ${lv.n} · ${lv.title}`);
    bits.push(piece.key.name, piece.tsName);
  }
  $('#hud-sub').textContent = bits.filter(Boolean).join(' · ');
  // Placement progress: "Test 3 of ~7" + harder/easier cue.
  const prog = $('#hud-progress');
  if (act.placement) {
    prog.classList.remove('hidden');
    prog.innerHTML = placementProgress(act);
  } else prog.classList.add('hidden');
  const mode = act.mode || 'tempo';
  if (wantsPrep(piece, act)) {
    enterPrep(piece, act, mode);
    loop();
  } else startSession(mode);
  if (act.placement) {
    const line = S.placementCue === 'harder' ? "Nice! Here's a trickier one." : S.placementCue === 'easier' ? "Let's try an easier one." : 'Play what you can. Both hands!';
    flash(line, 'info', 3200);
  }
  if (act.demoFirst) startDemo();
  acquireWakeLock();
}
app.play = play;

function resizeStage() {
  stage.resize();
  placeStrip();
  placePrep();
}
app.stageLayout = () => stage.L;

function placeStrip() {
  const L = stage.L;
  const strip = $('#status-strip');
  if (!L || !L.strip) return;
  strip.style.top = `${Math.round(L.strip.y + (L.strip.h - 36) / 2)}px`;
  // the count-in sits in the middle of the falling-notes lane
  if (L.fall && L.fall.h > 200) $('#countdown').style.top = `${Math.round(L.fall.y + L.fall.h * 0.46)}px`;
  else $('#countdown').style.top = '';
}

export function startSession(mode) {
  const piece = S.piece;
  cancelPrep();
  if (S.session) S.session.finished = true;
  S.combo = 0;
  S.bestCombo = 0;
  S.judged = 0;
  S.credit = 0;
  S.lastKind.clear();
  S.scheduledTicks.clear();
  S.timingRecent = [];
  S.timingLast = '';
  S.lastTap = -1;
  S.expKey = null;
  // Tell the listener the piece's range: stray sounds far outside it need more evidence.
  if (piece.rhythmOnly || !piece.notes.length) audio.setRange(null);
  else audio.setRange(Math.min(...piece.notes.map((n) => n.midi)), Math.max(...piece.notes.map((n) => n.midi)));
  stage.clearFx && stage.clearFx();
  $('#results').classList.add('hidden');
  $('#pause-menu').classList.add('hidden');
  $('#hud-score').textContent = '–';
  $('#hud-combo').textContent = '0';
  $('#hud-bpm').textContent = String(piece.bpm);
  const m = $('#btn-mode');
  m.classList.toggle('on', mode === 'wait');
  m.setAttribute('aria-checked', String(mode === 'wait'));
  m.classList.toggle('hidden', !!piece.waitOnly);
  $('#hud-beats').innerHTML = Array.from({ length: piece.ts.num > 4 ? 2 : piece.beatsPer }, () => '<i></i>').join('');
  const level = S.activity ? S.activity.level ?? piece.level : piece.level;
  const session = new Session(piece, {
    mode,
    level: level || 1,
    clock: () => audio.now(),
    latency: coach.settings.latencyMs / 1000,
    onEvent: onSessionEvent,
  });
  S.session = session;
  S.startedAt = audio.now();
  session.start();
  if (app.listenTestStart) app.listenTestStart(session, piece, S.activity); // (records the mic for the listening test)
  sfx('countin');
  loop();
}
app.startSession = startSession;

function scheduleTicks() {
  const s = S.session;
  if (!s || !audio.synth || s.paused || S.demo) return;
  const met = coach.settings.metronome;
  if (met === 'off') return;
  const now = audio.now();
  const piece = S.piece;
  const beatUnit = piece.ts.compound ? 1.5 : 1;
  for (let k = Math.ceil(s.beat / beatUnit - 1e-6); k * beatUnit < s.beat + 1.5; k++) {
    const b = k * beatUnit;
    if (b >= 0 && (met !== 'always' || s.mode !== 'tempo')) continue;
    if (b >= piece.totalBeats) continue;
    const t = s.timeOfBeat(b);
    if (t < now - 0.01 || t > now + 0.2) continue;
    const key = b.toFixed(3);
    if (S.scheduledTicks.has(key)) continue;
    S.scheduledTicks.add(key);
    const inBar = (((b % piece.beatsPer) + piece.beatsPer) % piece.beatsPer) < 1e-6;
    audio.synth.tick(Math.max(audio.ctx.currentTime, t - audio.now() + audio.ctx.currentTime), inBar);
  }
}

function onSessionEvent(ev) {
  if (S.demo) {
    if (ev.type === 'finish') endDemo();
    return;
  }
  if (ev.type === 'hit') {
    S.combo++;
    S.bestCombo = Math.max(S.bestCombo, S.combo);
    S.judged++;
    S.credit += ev.grade === 'perfect' ? 1 : ev.grade === 'great' ? 0.9 : ev.grade === 'good' ? 0.75 : 0.5;
    S.lastKind.set(ev.note.midi, { kind: 'good', t: performance.now() });
    // Wait mode has no timing: colour by how cleanly the note was found, not early/late.
    const col = ev.wait ? (ev.grade === 'perfect' ? GRADE_COLORS.perfect : ev.grade === 'great' ? GRADE_COLORS.great : '#6F4BF2') : gradeColor(ev.grade, ev.errMs);
    stage.burst(ev.note.midi, col, ev.grade === 'perfect' ? 10 : 7, { grade: ev.grade });
    stage.land(ev.note, col, { grade: ev.grade });
    stage.ring(ev.note.eventId, ev.note.midi, col);
    stage.chip(ev.note.midi, ev.label, col, { grade: ev.grade, errMs: ev.errMs, eventId: ev.note.eventId });
    sfx(ev.grade === 'perfect' ? 'perfect' : 'hit');
    if (S.combo > 0 && S.combo % 10 === 0) {
      sfx('combo', { level: Math.min(8, S.combo / 10) });
      comboFlash(S.combo);
      stage.sweep();
    }
    if (S.session.mode === 'tempo') {
      S.timingRecent.push({ errMs: ev.errMs, t: performance.now(), color: col });
      if (S.timingRecent.length > 12) S.timingRecent.shift();
      S.timingLast = ev.grade === 'perfect' ? `on time (${ev.errMs >= 0 ? '+' : ''}${ev.errMs} ms)` : `${Math.abs(ev.errMs)} ms ${ev.errMs < 0 ? 'early' : 'late'}`;
    }
  } else if (ev.type === 'miss') {
    S.combo = 0;
    S.judged++;
    if (!S.piece.rhythmOnly) stage.miss(ev.note.midi);
  } else if (ev.type === 'wrong') {
    S.combo = 0;
    S.lastKind.set(ev.midi, { kind: 'bad', t: performance.now() });
    const want = ev.wait && ev.expected && ev.expected.length ? ` · try ${noteName(ev.expected[0], S.piece.key)}` : '';
    stage.chip(ev.midi, `Oops · ${noteName(ev.midi, S.piece.key)}${want}`, GRADE_COLORS.wrong, { grade: 'wrong' });
    sfx('wrong');
  } else if (ev.type === 'octave') {
    // The hand is in the wrong octave (not a one-off microphone slip): say so, kindly.
    S.combo = 0;
    const high = ev.dir > 0;
    flash(`${icon(high ? 'down' : 'up', 18)} One octave too ${high ? 'high' : 'low'}: move your hand ${high ? 'down' : 'up'} to ${noteName(ev.expected, S.piece.key)}`, 'info', 3600);
  } else if (ev.type === 'beat') {
    const dots = $$('#hud-beats i');
    const unit = S.piece.ts.compound ? 1.5 : 1;
    const idx = Math.floor((((ev.beat % S.piece.beatsPer) + S.piece.beatsPer) % S.piece.beatsPer) / unit);
    dots.forEach((d, i) => {
      d.classList.toggle('on', i === idx);
      d.classList.toggle('first', i === 0);
    });
    // Count-in: the number sits in a ring that closes over one beat; "Go!" on beat 1.
    const cd = $('#countdown');
    if (ev.beat < 0) {
      cd.style.setProperty('--beat', `${Math.max(0.25, S.session.spb * (S.piece.ts.compound ? 1.5 : 1)).toFixed(3)}s`);
      cd.innerHTML = `<b>${-ev.beat}</b>`;
      cd.classList.remove('pulse', 'go');
      void cd.offsetWidth;
      cd.classList.add('pulse');
    } else if (ev.beat === 0 && S.session.countIn > 0 && S.session.mode === 'tempo' && !S.demo) {
      cd.innerHTML = '<b>Go!</b>';
      cd.classList.remove('pulse');
      void cd.offsetWidth;
      cd.classList.add('pulse', 'go');
      clearTimeout(S.goTimer);
      S.goTimer = setTimeout(() => {
        if (cd.classList.contains('go')) cd.innerHTML = '';
        cd.classList.remove('go');
      }, 520);
    } else if (!cd.classList.contains('go')) cd.innerHTML = '';
  } else if (ev.type === 'finish') {
    // A short flourish across the keys, then the results.
    const result = ev.result;
    const piece = S.piece;
    if (app.listenTestFinish && S.activity && S.activity.listenTest) app.listenTestFinish(result);
    stage.finale();
    clearTimeout(S.finishTimer);
    S.finishTimer = setTimeout(() => {
      if (S.screen === 'play' && S.piece === piece) app.finishPiece(result);
    }, stage.reduced ? 150 : 650);
  }
  const c = $('#hud-combo');
  c.textContent = String(S.combo);
  c.parentElement.classList.toggle('hot', S.combo >= 10);
  if (S.judged) $('#hud-score').textContent = `${Math.round((100 * S.credit) / S.judged)}%`;
}

// A short message in the middle of the status strip.
export function flash(text, kind = '', ms = 2200) {
  const el = $('#feedback-pop');
  el.className = `feedback-pop ${kind}`;
  el.innerHTML = text;
  void el.offsetWidth;
  el.classList.add('show');
  el.style.animationDuration = `${ms}ms`;
}
// (When it has played, drop the class: a hidden screen that is shown again would replay it.)
$('#feedback-pop').addEventListener('animationend', (e) => {
  if (e.target.id === 'feedback-pop') e.target.classList.remove('show');
});

app.flash = flash;

function comboFlash(n) {
  flash(`${icon('flame', 20)} ${n} in a row!`);
  const c = $('#hud-combo').parentElement;
  c.classList.remove('bump');
  void c.offsetWidth;
  c.classList.add('bump');
}

// Audio events -> session
audio.on('noteon', (ev) => {
  if (S.free) {
    S.history.push({ midi: ev.midi, on: ev.time, off: null });
    if (S.history.length > 400) S.history.shift();
    return;
  }
  if (S.prep) {
    prepNote(ev);
    return;
  }
  if (!S.session || S.demo || !S.piece) return;
  if (S.piece.rhythmOnly) {
    // Rhythm drills: any key counts as a tap. Use notes, not raw onsets (speech and claps
    // make onsets), and treat the notes of one chord as a single tap.
    if (ev.time - S.lastTap < 0.08) return;
    S.lastTap = ev.time;
    S.session.noteOn(0, ev.time, { anyPitch: true, confidence: ev.confidence ?? 1 });
    return;
  }
  S.session.noteOn(ev.midi, ev.time, { confidence: ev.confidence ?? 1 });
});
audio.on('noteoff', (ev) => {
  if (!S.free) return;
  for (let i = S.history.length - 1; i >= 0; i--)
    if (S.history[i].midi === ev.midi && S.history[i].off === null) {
      S.history[i].off = ev.time;
      break;
    }
});

// Mic indicator: live level bars; "Not listening" while Maestro itself makes sound.
let micHeld = false;
let heldWhy = '';
audio.on('hold', (ev) => {
  micHeld = !!(ev && ev.held);
  const r = ev && ev.reasons ? [...(ev.reasons instanceof Map ? ev.reasons.keys() : ev.reasons)].map(String) : [];
  heldWhy = r.some((x) => x.includes('voice')) ? 'talk' : r.some((x) => x.includes('demo')) ? 'play' : '';
});
const LV_SHAPE = [0.55, 1, 0.8, 0.4];
function micDot() {
  const md = $('#mic-dot');
  const lvl = Math.min(1, audio.level * 8);
  const on = audio.micOn;
  md.classList.toggle('on', on && !micHeld && !listenDown);
  md.classList.toggle('held', on && micHeld && !listenDown);
  md.classList.toggle('lost', !!listenDown);
  const label = listenDown
    ? 'Mic stopped · tap to check'
    : !on
      ? 'On-screen keys'
      : micHeld
        ? heldWhy === 'talk'
          ? 'Not listening while I talk'
          : heldWhy === 'play'
            ? 'Not listening while I play'
            : 'Listening paused'
        : 'Listening';
  const lab = md.querySelector('.mic-label');
  if (lab.textContent !== label) lab.textContent = label;
  const bars = md.querySelectorAll('.lv i');
  bars.forEach((b, i) => (b.style.height = `${Math.round(4 + (on && !micHeld ? lvl : 0) * 12 * LV_SHAPE[i])}px`));
  md.style.setProperty('--lvl', lvl.toFixed(2));
  audio.level *= 0.9;
}

// ---- listening health -----------------------------------------------------------------------
// If iOS stops the audio engine or the microphone mid-lesson (a call, Siri, another app, the
// voice), grading would freeze or count misses. Pause instead, and ask for a tap: a tap is what
// lets Safari resume audio and re-open the microphone.
let listenDown = null; // the failed health state, or null
let lostTimer = 0;
let pausedForHealth = false;
function lostReason(ev) {
  const r = `${(ev && ev.reason) || ''} ${(ev && ev.context) || ''} ${(ev && ev.mic) || ''}`.toLowerCase();
  if (/interrupt|suspend|stall|clock|context/.test(r)) return "Something paused the iPad's sound, like a call, Siri or another app. Tap and we'll carry on.";
  return "The microphone stopped sending sound. Tap and I'll switch it back on.";
}
function showLost() {
  if (!listenDown || S.screen !== 'play') return;
  $('#lost-why').textContent = lostReason(listenDown);
  $('#pause-menu').classList.add('hidden');
  $('#listen-lost').classList.remove('hidden');
}
function healthDown(ev) {
  listenDown = ev;
  if (S.screen !== 'play') return;
  if (S.session && !S.session.finished && !S.session.paused && !S.demo) {
    S.session.pause();
    pausedForHealth = true;
  }
  clearTimeout(lostTimer);
  // Give automatic recovery a moment unless only a tap can fix it.
  if (ev.needsGesture) showLost();
  else lostTimer = setTimeout(showLost, 1500);
}
function healthUp() {
  clearTimeout(lostTimer);
  const shown = !$('#listen-lost').classList.contains('hidden');
  listenDown = null;
  $('#listen-lost').classList.add('hidden');
  if (pausedForHealth && S.session && S.session.paused && !S.session.finished && $('#pause-menu').classList.contains('hidden')) {
    S.scheduledTicks.clear();
    S.session.resume();
    if (shown) flash('Listening again. Here we go!', 'info', 1800);
  }
  pausedForHealth = false;
}
audio.on('health', (ev) => {
  if (!ev || ev.reason === 'page-hidden') return; // (leaving the app already pauses the lesson)
  if (ev.ok) healthUp();
  // (micOn turns false the moment the mic dies, so ask whether we *want* the mic.)
  else if ((audio.micWanted && !S.listenSkipped) || /context|clock|stall|interrupt|suspend/.test(`${ev.reason || ''} ${ev.context || ''}`)) healthDown(ev);
});
app.listenLost = (ev) => healthDown({ ...ev, needsGesture: true });
$('#btn-lost-fix').addEventListener('click', async () => {
  const btn = $('#btn-lost-fix');
  // Call recover() inside the tap itself: iOS only resumes audio / opens the mic on a gesture.
  const p = typeof audio.recover === 'function' ? audio.recover() : audio.ensureContext().then(() => ({ ok: true }));
  btn.disabled = true;
  btn.textContent = 'Starting…';
  let h = null;
  try {
    h = await p;
  } catch {
    h = { ok: false };
  }
  btn.disabled = false;
  btn.textContent = 'Tap to start listening again';
  if (!h || h.ok !== false) healthUp();
  else $('#lost-why').textContent = 'Still no sound from the microphone. Try the Listening check, or close and reopen Maestro.';
});
$('#btn-lost-check').addEventListener('click', () => {
  if (app.openDiagnostics) app.openDiagnostics();
});
$('#btn-lost-keys').addEventListener('click', () => {
  S.listenSkipped = true;
  listenDown = null;
  healthUp();
});
// The mic chip opens the Listening check (pausing the lesson first).
$('#mic-dot').addEventListener('click', () => {
  if (!app.openDiagnostics) return;
  if (S.session && !S.session.finished && !S.session.paused && !S.demo && !S.free) pause();
  app.openDiagnostics();
});

function barProgress() {
  const s = S.session;
  const p = S.piece;
  if (!s || !p) return;
  const total = p.measures || Math.ceil(p.totalBeats / p.beatsPer);
  const beat = Math.max(0, s.beat);
  const bar = Math.min(total, Math.floor(beat / p.beatsPer) + 1);
  const label = s.beat < 0 ? `${total} bar${total === 1 ? '' : 's'}` : `Bar ${bar} of ${total}`;
  const el = $('#bar-label');
  if (el.textContent !== label) el.textContent = label;
  $('#bar-fill').style.width = `${Math.max(0, Math.min(100, (100 * beat) / Math.max(1, p.totalBeats)))}%`;
}

export function loop() {
  cancelAnimationFrame(S.raf);
  let lastStrip = -1;
  const frame = () => {
    S.raf = requestAnimationFrame(frame);
    if (S.screen !== 'play') return;
    if (stage.L && stage.L.strip && stage.L.strip.y !== lastStrip) {
      lastStrip = stage.L.strip.y;
      placeStrip();
    }
    if (S.free) return drawFree();
    if (S.prep) return drawPrep();
    const s = S.session;
    if (!s) return;
    s.update();
    scheduleTicks();
    const expected = s.expectedNotes(1);
    const expKey = expected.map((n) => n.midi).join(',');
    if (expKey !== S.expKey) {
      S.expKey = expKey; // (the listener runs in a worker: only tell it about changes)
      audio.setExpected(expected.map((n) => n.midi));
    }
    const hints = new Map();
    const soon = s.mode === 'wait' ? expected : expected.filter((n) => n.beat - s.beat < 0.6);
    for (const n of soon) hints.set(n.midi, n.hand);
    const heard = new Map();
    const nowP = performance.now();
    for (const [m] of audio.heard) {
      const lk = S.lastKind.get(m);
      heard.set(m, { kind: lk && nowP - lk.t < 1500 ? lk.kind : 'neutral' });
    }
    const waitEvents = new Set();
    if (s.mode === 'wait' && s.waitGroup) for (const n of s.waitGroup.notes) waitEvents.add(n.eventId);
    const now = audio.now();
    const wrongMarks = s.wrong.filter((w) => now - w.t < 2.5).map((w) => ({ ...w, age: now - w.t }));
    stage.draw({
      nowBeat: s.beat,
      status: s.status,
      hints,
      heard,
      waitMode: s.mode === 'wait',
      waitEvents,
      wrongMarks,
      lookaheadSec: coach.settings.lookaheadSec,
      timingMeter: s.mode === 'tempo' && !S.piece.waitOnly && !S.demo ? { profile: s.profile, recent: S.timingRecent, last: S.timingLast } : null,
      streak: S.demo ? 0 : S.combo,
    });
    micDot();
    barProgress();
  };
  S.raf = requestAnimationFrame(frame);
}

// Getting ready: the piece waits at the start of the count-in while the keyboard shows the
// hand position.
function drawPrep() {
  const heard = new Map();
  for (const [m] of audio.heard) heard.set(m, { kind: 'neutral' });
  stage.draw({
    nowBeat: -S.piece.beatsPer,
    status: new Map(),
    hints: new Map(),
    heard,
    prep: prepDrawState(),
    lookaheadSec: coach.settings.lookaheadSec,
  });
  micDot();
  const total = S.piece.measures || Math.ceil(S.piece.totalBeats / S.piece.beatsPer);
  const label = `${total} bar${total === 1 ? '' : 's'}`;
  const el = $('#bar-label');
  if (el.textContent !== label) el.textContent = label;
  $('#bar-fill').style.width = '0%';
}

export function stopPlay(keepScreen) {
  cancelPrep();
  S.expKey = null;
  cancelAnimationFrame(S.raf);
  clearTimeout(S.autoTimer);
  clearTimeout(S.demoTimer);
  if (S.session) S.session.finished = true;
  S.session = null;
  audio.setExpected([]);
  audio.setRange(null);
  if (S.demoHandle) S.demoHandle.stop();
  S.demoHandle = null;
  S.demo = false;
  if (audio.synth) audio.synth.stopAll();
  clearTimeout(S.finishTimer);
  clearTimeout(S.goTimer);
  $('#countdown').innerHTML = '';
  $('#countdown').classList.remove('go', 'pulse');
  $('#feedback-pop').classList.remove('show');
  if (!keepScreen) releaseWakeLock();
}
app.stopPlay = stopPlay;

// ---- HUD controls -------------------------------------------------------------------------
$('#btn-exit').addEventListener('click', () => {
  sfx('tap');
  stopPlay();
  show('home');
});
function pause() {
  if (!S.session || S.free || S.session.finished) return;
  S.session.pause();
  fillViewMenu();
  $('#pause-menu').classList.remove('hidden');
  sfx('tap');
}
$('#btn-pause').addEventListener('click', pause);
$('#btn-resume').addEventListener('click', () => {
  $('#pause-menu').classList.add('hidden');
  S.scheduledTicks.clear();
  S.session.resume();
});
$('#btn-restart').addEventListener('click', () => startSession(S.session.mode));
$('#btn-skip').addEventListener('click', () => {
  $('#pause-menu').classList.add('hidden');
  const act = S.activity;
  if (act && act.placement) {
    // Skipping a placement test counts as not being able to play it.
    S.session.finished = true;
    app.finishPiece({ ...S.session.result(), score: 0 });
  } else if (act && (act.free || act.kind === 'song' || act.kind === 'import')) {
    stopPlay();
    show(act.kind === 'song' || act.kind === 'import' ? 'songs' : 'home');
  } else runActivity(coach.nextActivity());
});
$('#btn-quit').addEventListener('click', () => {
  $('#pause-menu').classList.add('hidden');
  stopPlay();
  show('home');
});
$('#btn-mode').addEventListener('click', () => {
  if (!S.session || S.piece.waitOnly) return;
  sfx('toggle', { on: S.session.mode !== 'wait' });
  startSession(S.session.mode === 'wait' ? 'tempo' : 'wait');
});
function changeTempo(d) {
  if (!S.piece) return;
  S.piece.bpm = Math.max(30, Math.min(200, S.piece.bpm + d));
  sfx('tap');
  startSession(S.session ? S.session.mode : 'tempo');
}
$('#btn-tempo-down').addEventListener('click', () => changeTempo(-5));
$('#btn-tempo-up').addEventListener('click', () => changeTempo(5));

// Demo ("Listen" / "Hear it first"): the piano plays the piece while the playhead moves. The
// engine schedules with lookahead and keeps the mic held until the sound has decayed.
async function startDemo() {
  if (!S.piece) return;
  const mode = S.session ? S.session.mode : S.prep ? S.prep.mode : S.activity?.mode || 'tempo';
  cancelPrep();
  await audio.ensureContext();
  startSession('tempo');
  S.demo = true;
  S.demoMode = mode;
  const s = S.session;
  if (S.demoHandle) S.demoHandle.stop();
  S.demoHandle = typeof audio.playDemo === 'function' ? audio.playDemo(S.piece, { timeOfBeat: (b) => s.timeOfBeat(b) }) : null;
  flash(`${icon('speaker', 18)} Listen first…`, 'info', 3000);
}
app.startDemo = startDemo;
$('#btn-listen').addEventListener('click', () => {
  sfx('tap');
  startDemo();
});
function endDemo() {
  S.demo = false;
  const h = S.demoHandle;
  const restart = () => {
    S.demoHandle = null;
    if (S.screen === 'play' && S.piece && !S.demo) startSession(S.demoMode || 'tempo');
  };
  if (h && h.done) Promise.race([h.done, new Promise((r) => setTimeout(r, 2500))]).then(() => setTimeout(restart, 200));
  else S.demoTimer = setTimeout(restart, 600);
}

// Display options live in the pause sheet.
function fillViewMenu() {
  const level = S.activity ? S.activity.level ?? 1 : coach.level;
  const opts = stageOptions(level);
  for (const el of $$('#view-menu [data-opt]')) {
    const k = el.dataset.opt;
    if (el.type === 'checkbox') el.checked = k in opts ? !!opts[k] : !!coach.settings[k];
    else el.value = coach.settings[k];
  }
}
$('#view-menu').addEventListener('change', (e) => {
  const k = e.target.dataset.opt;
  if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  coach.setSetting(k, v);
  stage.setOptions(stageOptions(S.activity ? S.activity.level ?? 1 : coach.level));
  resizeStage();
});

// ---- input: on-screen keys and computer keyboard --------------------------------------------
const touches = new Map();
$('#stage').addEventListener('pointerdown', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const m = stage.keyAt(e.clientX - r.left, e.clientY - r.top);
  if (m == null) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, m);
  audio.ensureContext().then(() => audio.noteOn(m, audio.now(), 0.7, 'touch'));
});
const endTouch = (e) => {
  const m = touches.get(e.pointerId);
  if (m == null) return;
  touches.delete(e.pointerId);
  audio.noteOff(m, audio.now(), 'touch');
};
$('#stage').addEventListener('pointerup', endTouch);
$('#stage').addEventListener('pointercancel', endTouch);

const KEYMAP = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73, l: 74, p: 75, ';': 76 };
const keysDown = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === ' ' && S.screen === 'play') {
    e.preventDefault();
    pause();
    return;
  }
  const base = KEYMAP[e.key.toLowerCase()];
  if (base == null || keysDown.has(e.key) || e.repeat) return;
  keysDown.add(e.key);
  const m = base + (e.shiftKey ? -12 : 0);
  audio.ensureContext().then(() => audio.noteOn(m, audio.now(), 0.7, 'touch'));
});
window.addEventListener('keyup', (e) => {
  const base = KEYMAP[e.key.toLowerCase()];
  keysDown.delete(e.key);
  if (base == null) return;
  audio.noteOff(base, audio.now(), 'touch');
  audio.noteOff(base - 12, audio.now(), 'touch');
});

window.addEventListener('resize', () => {
  if (S.screen === 'play') resizeStage();
});

// ---- free play ----------------------------------------------------------------------------
export function startFreePlay() {
  app.withListening(() => {
    stopPlay(true);
    S.free = true;
    $('#pause-menu').classList.add('hidden');
    $('#results').classList.add('hidden');
    $('#screen-play').classList.add('free');
    $('#screen-play').classList.remove('placement');
    S.piece = null;
    S.activity = null;
    S.history = [];
    show('play');
    stage.setOptions({ showStaff: false, showFalling: true, showHints: false, showNames: false, noteColors: true });
    stage.setPiece(null, [21, 108]);
    requestAnimationFrame(() => resizeStage());
    $('#hud-title').textContent = 'Free play';
    $('#hud-sub').textContent = 'Play anything. Every note I hear lights up.';
    $('#hud-progress').classList.add('hidden');
    $('#hud-bpm').textContent = '';
    $('#hud-beats').innerHTML = '';
    $('#results').classList.add('hidden');
    $('#free-display').classList.remove('hidden');
    $('#free-display')._html = '';
    audio.setExpected([]);
    acquireWakeLock();
    loop();
  });
}
app.startFreePlay = startFreePlay;

const IDLE = `<div class="fd-idle">${pip('listen', 110)}<div class="bubble tail-left">I'm listening… play anything!</div></div>`;
function drawFree() {
  const heard = new Map();
  for (const [m] of audio.heard) heard.set(m, { kind: 'neutral' });
  const now = audio.now();
  S.history = S.history.filter((n) => !n.off || now - n.off < 6);
  stage.draw({ nowBeat: 0, heard, history: S.history, nowSec: now });
  const notes = [...audio.heard.keys()].sort((a, b) => a - b);
  const el = $('#free-display');
  const chord = chordName(notes);
  const html = notes.length
    ? `<div class="fd-notes">${notes.map((m) => noteName(m, new Key(0))).join(' · ')}</div>${chord ? `<div class="fd-chord">${chord}</div>` : ''}`
    : IDLE;
  if (el._html !== html) {
    el.innerHTML = html;
    el._html = html;
  }
  micDot();
}

// ---- keep the screen awake ------------------------------------------------------------------
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && !S.wakeLock) {
      S.wakeLock = await navigator.wakeLock.request('screen');
      S.wakeLock.addEventListener('release', () => (S.wakeLock = null));
    }
  } catch {
    /* not supported / denied */
  }
}
function releaseWakeLock() {
  if (S.wakeLock) S.wakeLock.release().catch(() => {});
  S.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.screen === 'play') acquireWakeLock();
    if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume().catch(() => {});
  } else if (S.session && !S.session.finished && !S.session.paused && !S.free) {
    S.session.pause();
    fillViewMenu();
    $('#pause-menu').classList.remove('hidden');
  }
});

screen('play', {
  enter() {
    requestAnimationFrame(() => resizeStage());
  },
});
