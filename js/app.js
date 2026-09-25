// App controller: screens, the Start -> mic setup -> placement -> lessons flow, the play loop.
import { AudioEngine } from './audio/audio.js';
import { Stage } from './render/stage.js';
import { Session } from './game/engine.js';
import { generate, generateRhythm } from './music/generator.js';
import { levelInfo, LEVELS, STAGES } from './music/curriculum.js';
import { Coach, PASS_SCORE } from './coach.js';
import { noteName, chordName, Key } from './music/theory.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const coach = new Coach();
const audio = new AudioEngine();
const stage = new Stage($('#stage'));
// Handy for debugging and the end-to-end tests.
window.__maestro = { coach, audio, stage, session: () => S.session, piece: () => S.piece, run: (act) => runActivity(act) };

const S = {
  screen: 'home',
  activity: null,
  piece: null,
  session: null,
  demo: false,
  free: false,
  history: [],
  lastKind: new Map(), // midi -> {kind, t}
  combo: 0,
  judged: 0,
  credit: 0,
  pendingAfterSetup: null,
  autoTimer: null,
  wakeLock: null,
  startedAt: 0,
  scheduledTicks: new Set(),
};

// ---------------------------------------------------------------------------------------------
// Screens
function show(name) {
  S.screen = name;
  for (const el of $$('.screen')) el.classList.toggle('active', el.id === `screen-${name}`);
  if (name === 'home') renderHome();
  if (name === 'map') renderMap();
  if (name === 'progress') renderProgress();
  if (name === 'settings') renderSettings();
  if (name === 'practice') renderPractice();
  if (name === 'play') requestAnimationFrame(() => stage.resize());
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (!go) return;
  const where = go.dataset.go;
  if (where === 'free') startFreePlay();
  else if (where === 'placement') withListening(() => runPlacement());
  else {
    stopPlay();
    show(where);
  }
});

// ---------------------------------------------------------------------------------------------
// Home
function renderHome() {
  const st = $('#home-status');
  const btn = $('#btn-start');
  if (!coach.s.placed) {
    st.innerHTML = 'Welcome! Start with a short placement test. Just play what scrolls by.';
    btn.textContent = 'Start';
  } else {
    const lv = levelInfo(coach.level);
    st.innerHTML = `<b>Level ${lv.n}</b> · ${lv.stage} · ${lv.title}<div class="mastery-bar"><i style="width:${coach.mastery()}%"></i></div>`;
    btn.textContent = 'Continue lesson';
  }
  const streak = coach.s.streak.days;
  $('#home-hint').textContent = streak > 1 ? `🔥 ${streak}-day practice streak. Keep it going!` : 'Put your iPad on the music stand in landscape, then tap Start.';
}

$('#btn-start').addEventListener('click', () => {
  withListening(() => (coach.s.placed ? runLesson() : runPlacement()));
});

// ---------------------------------------------------------------------------------------------
// Listening setup: mic permission, noise calibration, "play middle C" check.
async function withListening(then) {
  // Resume audio inside the user gesture (iOS requirement).
  try {
    await audio.ensureContext();
  } catch {
    /* ignored */
  }
  audio.startMidi();
  if (audio.micOn) return then();
  if (coach.s.micChecked) {
    try {
      await audio.startMic();
      audio.setSensitivity(coach.settings.sensitivity);
      toast('Listening to the room… stay quiet a moment', 1600);
      await audio.calibrate(1400);
      return then();
    } catch (err) {
      console.warn(err);
    }
  }
  S.pendingAfterSetup = then;
  openSetup();
}

function setStep(id, cls) {
  const el = $(id);
  el.classList.remove('doing', 'done');
  if (cls) el.classList.add(cls);
}

function openSetup() {
  show('setup');
  ['#step-mic', '#step-quiet', '#step-c'].forEach((s) => setStep(s, null));
  setStep('#step-mic', 'doing');
  $('#setup-msg').textContent = '';
  const go = $('#btn-setup-go');
  go.textContent = 'Allow microphone';
  go.disabled = false;
  go.onclick = runSetup;
  $('#btn-setup-skip').onclick = finishSetup;
  if (audio.micOn) runSetup();
}

let meterRaf = 0;
function meterLoop() {
  const lvl = Math.min(1, audio.level * 6);
  $('#setup-meter').style.width = `${Math.round(lvl * 100)}%`;
  audio.level *= 0.92;
  meterRaf = requestAnimationFrame(meterLoop);
}

async function runSetup() {
  const go = $('#btn-setup-go');
  go.disabled = true;
  const msg = $('#setup-msg');
  try {
    await audio.ensureContext();
    await audio.startMic();
    audio.setSensitivity(coach.settings.sensitivity);
  } catch (err) {
    console.warn(err);
    msg.innerHTML = window.isSecureContext
      ? 'Microphone access was blocked. On iPad: Settings → Safari → Microphone → Allow, then reload. You can still use the on-screen keyboard.'
      : 'The microphone only works over a secure (https) connection. Open Maestro from its https address.';
    go.textContent = 'Use on-screen keys instead';
    go.disabled = false;
    go.onclick = finishSetup;
    return;
  }
  cancelAnimationFrame(meterRaf);
  meterLoop();
  setStep('#step-mic', 'done');
  setStep('#step-quiet', 'doing');
  msg.textContent = 'Shh… measuring the room';
  await audio.calibrate(1800);
  setStep('#step-quiet', 'done');
  setStep('#step-c', 'doing');
  msg.textContent = 'Now play middle C';
  go.textContent = 'Waiting for middle C…';
  const off = audio.on('noteon', (ev) => {
    if (S.screen !== 'setup') return off();
    if (ev.midi === 60) {
      off();
      setStep('#step-c', 'done');
      msg.textContent = '✓ Perfect! I can hear you clearly.';
      coach.s.micChecked = true;
      coach.save();
      setTimeout(finishSetup, 1100);
    } else {
      msg.textContent = `I heard ${noteName(ev.midi)}. Middle C is the white key just left of the two black keys in the middle.`;
    }
  });
}

function finishSetup() {
  cancelAnimationFrame(meterRaf);
  const then = S.pendingAfterSetup;
  S.pendingAfterSetup = null;
  if (then) then();
  else show('home');
}

$('#btn-recal').addEventListener('click', () => {
  coach.s.micChecked = false;
  coach.save();
  S.pendingAfterSetup = () => show('settings');
  openSetup();
});

// ---------------------------------------------------------------------------------------------
// Flows
function runPlacement() {
  const act = coach.startPlacement();
  toast('Placement test: play what you can. It gets harder until we find your level.', 4000);
  runActivity(act);
}

function runLesson() {
  runActivity(coach.nextActivity());
}

function runActivity(act) {
  clearTimeout(S.autoTimer);
  if (act.kind === 'intro') return showIntro(act.level);
  const opts = { kind: act.kind, seed: act.seed, measures: act.measures, tempoFactor: act.tempoFactor, bpm: act.bpm, bothHands: act.bothHands };
  const piece = act.kind === 'rhythm' ? generateRhythm(act.level, opts) : generate(act.level, opts);
  S.activity = act;
  play(piece, act);
}

function showIntro(level) {
  const lv = levelInfo(level);
  $('#intro-stage').textContent = `Level ${lv.n} · ${lv.stage}`;
  $('#intro-title').textContent = lv.title;
  $('#intro-concept').textContent = lv.concept;
  $('#intro-tips').innerHTML = lv.tips.map((t) => `<li>${t}</li>`).join('');
  $('#btn-intro-go').onclick = () => {
    coach.markIntroSeen(level);
    runLesson();
  };
  show('intro');
}

// ---------------------------------------------------------------------------------------------
// Play
function stageOptions(level) {
  const st = coach.settings;
  return {
    showStaff: st.showStaff,
    showFalling: st.showFalling,
    showNames: coach.showNames(level),
    showFingers: st.showFingers,
    showHints: st.showHints,
    noteColors: st.noteColors === 'auto' ? level <= 8 : !!st.noteColors,
  };
}

function play(piece, act, { skipDemo } = {}) {
  stopPlay(true);
  S.free = false;
  $('#screen-play').classList.remove('free');
  S.piece = piece;
  $('#free-display').classList.add('hidden');
  show('play');
  stage.setOptions(stageOptions(act.level));
  stage.setPiece(piece);
  requestAnimationFrame(() => stage.resize());
  const lv = levelInfo(act.level);
  $('#hud-title').textContent = act.placement ? `${act.label} · Level ${lv.n}` : act.label || piece.title;
  $('#hud-sub').textContent = `${act.free ? 'Practice' : act.placement ? 'Placement' : 'Lesson'} · Level ${lv.n}: ${lv.title} · ${piece.key.name} · ${piece.tsName}`;
  const lock = !!act.placement;
  for (const id of ['#btn-mode', '#btn-tempo-down', '#btn-tempo-up', '#btn-listen']) $(id).classList.toggle('hidden', lock);
  startSession(act.mode || 'tempo');
  acquireWakeLock();
}

function startSession(mode) {
  const piece = S.piece;
  if (S.session) S.session.finished = true;
  S.combo = 0;
  S.judged = 0;
  S.credit = 0;
  S.lastKind.clear();
  S.scheduledTicks.clear();
  $('#results').classList.add('hidden');
  $('#pause-menu').classList.add('hidden');
  $('#hud-score').textContent = '–';
  $('#hud-combo').textContent = '0';
  $('#hud-bpm').textContent = `♩ ${piece.bpm}`;
  $('#btn-mode').textContent = mode === 'wait' ? 'Wait mode' : 'Tempo';
  $('#btn-mode').classList.toggle('on', mode === 'wait');
  $('#hud-beats').innerHTML = Array.from({ length: piece.ts.num > 4 ? 2 : piece.beatsPer }, () => '<i></i>').join('');
  S.timingRecent = [];
  S.timingLast = '';
  const session = new Session(piece, {
    mode,
    level: S.activity ? S.activity.level : piece.level,
    clock: () => audio.now(),
    latency: coach.settings.latencyMs / 1000,
    onEvent: onSessionEvent,
  });
  S.session = session;
  S.startedAt = audio.now();
  session.start();
  loop();
}

function scheduleTicks() {
  const s = S.session;
  if (!s || !audio.synth || s.paused || S.demo) return;
  const met = coach.settings.metronome;
  if (met === 'off') return;
  const now = audio.now();
  const piece = S.piece;
  const beatUnit = piece.ts.compound ? 1.5 : 1;
  // schedule ticks up to 0.2 s ahead
  for (let k = Math.ceil(s.beat / beatUnit - 1e-6); k * beatUnit < s.beat + 1.5; k++) {
    const b = k * beatUnit;
    if (b >= 0 && (met !== 'always' || s.mode !== 'tempo')) continue;
    if (b >= piece.totalBeats) continue;
    const t = s.timeOfBeat(b);
    if (t < now - 0.01 || t > now + 0.2) continue;
    const key = b.toFixed(3) + (b < 0 ? `c${S.startedAt}` : '');
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
    S.judged++;
    S.credit += ev.grade === 'perfect' ? 1 : ev.grade === 'great' ? 0.9 : ev.grade === 'good' ? 0.7 : 0.45;
    S.lastKind.set(ev.note.midi, { kind: 'good', t: performance.now() });
    const col = ev.grade === 'perfect' ? '#1fbf6a' : ev.grade === 'great' ? '#27b36b' : ev.grade === 'good' ? '#e0a800' : '#f08a24';
    stage.burst(ev.note.midi, col, ev.grade === 'perfect' ? 18 : 10);
    stage.ring(ev.note.eventId, ev.note.midi, col);
    stage.chip(ev.note.midi, ev.label, col);
    if (S.session.mode === 'tempo') {
      S.timingRecent.push({ errMs: ev.errMs, t: performance.now(), color: col });
      if (S.timingRecent.length > 12) S.timingRecent.shift();
      S.timingLast = ev.grade === 'perfect' ? `on time (${ev.errMs >= 0 ? '+' : ''}${ev.errMs} ms)` : `${Math.abs(ev.errMs)} ms ${ev.errMs < 0 ? 'early' : 'late'}`;
    }
  } else if (ev.type === 'miss') {
    S.combo = 0;
    S.judged++;
  } else if (ev.type === 'wrong') {
    S.combo = 0;
    S.lastKind.set(ev.midi, { kind: 'bad', t: performance.now() });
    stage.chip(ev.midi, `✗ ${noteName(ev.midi, S.piece.key)}`, '#ef476f');
  } else if (ev.type === 'beat') {
    const dots = $$('#hud-beats i');
    const unit = S.piece.ts.compound ? 1.5 : 1;
    const idx = Math.floor((((ev.beat % S.piece.beatsPer) + S.piece.beatsPer) % S.piece.beatsPer) / unit);
    dots.forEach((d, i) => {
      d.classList.toggle('on', i === idx);
      d.classList.toggle('first', i === 0);
    });
    const cd = $('#countdown');
    if (ev.beat < 0) cd.textContent = String(-ev.beat);
    else cd.textContent = '';
  } else if (ev.type === 'finish') {
    finishPiece(ev.result);
  }
  $('#hud-combo').textContent = String(S.combo);
  if (S.judged) $('#hud-score').textContent = `${Math.round((100 * S.credit) / S.judged)}%`;
}

function pop(text, color) {
  const el = $('#feedback-pop');
  el.textContent = text;
  el.style.color = color;
  el.classList.add('show');
  clearTimeout(pop._t);
  pop._t = setTimeout(() => el.classList.remove('show'), 350);
}

// Audio events -> session
audio.on('noteon', (ev) => {
  if (S.free) {
    S.history.push({ midi: ev.midi, on: ev.time, off: null });
    if (S.history.length > 400) S.history.shift();
    return;
  }
  if (!S.session || S.demo || S.piece.rhythmOnly) return;
  S.session.noteOn(ev.midi, ev.time, { confidence: ev.confidence ?? 1 });
});
audio.on('noteoff', (ev) => {
  if (S.free) {
    for (let i = S.history.length - 1; i >= 0; i--)
      if (S.history[i].midi === ev.midi && S.history[i].off === null) {
        S.history[i].off = ev.time;
        break;
      }
  }
});
audio.on('onset', (ev) => {
  if (!S.session || S.demo || !S.piece || !S.piece.rhythmOnly) return;
  S.session.noteOn(0, ev.time, { anyPitch: true });
});

function loop() {
  cancelAnimationFrame(S.raf);
  const frame = () => {
    S.raf = requestAnimationFrame(frame);
    if (S.screen !== 'play') return;
    if (S.free) return drawFree();
    const s = S.session;
    if (!s) return;
    s.update();
    scheduleTicks();
    const expected = s.expectedNotes(1);
    audio.setExpected(expected.map((n) => n.midi));
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
    const wrongMarks = s.wrong.filter((w) => audio.now() - w.t < 2.5).map((w) => ({ ...w, age: audio.now() - w.t }));
    stage.draw({
      nowBeat: s.beat,
      status: s.status,
      hints,
      heard,
      waitMode: s.mode === 'wait',
      waitEvents,
      wrongMarks,
      lookaheadSec: coach.settings.lookaheadSec,
      timingMeter: s.mode === 'tempo' && !S.piece.waitOnly ? { profile: s.profile, recent: S.timingRecent, last: S.timingLast } : null,
    });
    const md = $('#mic-dot');
    const lvl = Math.min(1, audio.level * 8);
    md.style.background = audio.micOn ? `rgba(31,191,106,${0.25 + lvl * 0.75})` : '#444a66';
    md.style.transform = `scale(${1 + lvl * 0.6})`;
    audio.level *= 0.9;
  };
  S.raf = requestAnimationFrame(frame);
}

function stopPlay(keepScreen) {
  cancelAnimationFrame(S.raf);
  clearTimeout(S.autoTimer);
  if (S.session) S.session.finished = true;
  S.session = null;
  S.demo = false;
  audio.muted = false;
  if (audio.synth) audio.synth.stopAll();
  $('#countdown').textContent = '';
  if (!keepScreen) releaseWakeLock();
}

function finishPiece(result) {
  const act = S.activity;
  const piece = S.piece;
  const seconds = Math.max(1, audio.now() - S.startedAt);
  $('#countdown').textContent = '';
  const out = coach.record(act, piece, result, seconds);
  // results UI
  $('#res-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < result.stars ? '' : 'off'}">★</span>`).join('');
  $('#res-score').textContent = result.score;
  $('#res-notes').textContent = `${result.hits}/${result.total}`;
  $('#res-timing').textContent = result.mode === 'tempo' ? `${Math.round(result.timing * 100)}%` : 'n/a';
  $('#res-extra').textContent = String(result.extras);
  $('#res-offset').textContent = result.mode === 'tempo' && result.hits ? `${result.meanErr >= 0 ? '+' : ''}${Math.round(result.meanErr * 1000)} ms` : 'n/a';
  const tips = coach.feedback(piece, result);
  $('#res-tips').innerHTML = tips.map((t) => `<li>${t}</li>`).join('');
  const lvlEl = $('#res-level');
  let nextAct = null;
  let nextLabel = 'Next';
  if (act.placement) {
    const pr = coach.placementResult(result);
    if (pr.done) {
      const lv = levelInfo(pr.level);
      lvlEl.innerHTML = `🎉 Placement complete! You start at <b>Level ${lv.n}: ${lv.title}</b> (${lv.stage}).`;
      nextAct = coach.nextActivity();
      nextLabel = 'Start my lessons';
    } else {
      lvlEl.innerHTML = result.score >= PASS_SCORE ? '✓ Passed. Let\'s try something harder.' : 'Let\'s try something a bit easier.';
      nextAct = pr.next;
      nextLabel = 'Next test';
    }
  } else if (act.free) {
    lvlEl.innerHTML = '';
    nextAct = { ...act, seed: undefined };
    nextLabel = 'Another one';
  } else {
    const lv = levelInfo(coach.level);
    if (out.levelUp) lvlEl.innerHTML = `🏆 Level up! Welcome to <b>Level ${lv.n}: ${lv.title}</b>`;
    else if (out.levelDown) lvlEl.innerHTML = `Let's strengthen the basics: back to <b>Level ${lv.n}: ${lv.title}</b>`;
    else lvlEl.innerHTML = `Level ${lv.n} mastery ${out.gain >= 0 ? '+' : ''}${out.gain}<div class="bar"><i style="width:${coach.mastery()}%"></i></div>`;
    nextAct = coach.nextActivity();
  }
  $('#btn-next').textContent = nextLabel;
  $('#btn-next').onclick = () => runActivity(nextAct);
  $('#btn-retry').onclick = () => startSession(S.session ? S.session.mode : 'tempo');
  $('#btn-retry').classList.toggle('hidden', !!act.placement);
  $('#results').classList.remove('hidden');
  // Hands-free: continue automatically.
  const auto = $('#res-auto');
  auto.textContent = '';
  if (coach.settings.autoAdvance) {
    let n = act.placement ? 5 : 8;
    const tick = () => {
      if ($('#results').classList.contains('hidden') || S.screen !== 'play') return;
      if (n <= 0) return runActivity(nextAct);
      auto.textContent = `Continuing in ${n}… (tap anywhere to stay)`;
      n--;
      S.autoTimer = setTimeout(tick, 1000);
    };
    tick();
  }
}

$('#results').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  clearTimeout(S.autoTimer);
  $('#res-auto').textContent = '';
});

// HUD controls
$('#btn-exit').addEventListener('click', () => {
  stopPlay();
  show('home');
});
$('#btn-pause').addEventListener('click', () => {
  if (!S.session || S.free) return;
  S.session.pause();
  $('#pause-menu').classList.remove('hidden');
});
$('#btn-resume').addEventListener('click', () => {
  $('#pause-menu').classList.add('hidden');
  S.scheduledTicks.clear();
  S.session.resume();
});
$('#btn-restart').addEventListener('click', () => startSession(S.session.mode));
$('#btn-skip').addEventListener('click', () => {
  $('#pause-menu').classList.add('hidden');
  if (S.activity && S.activity.placement) {
    // Skipping a placement test counts as not passing it.
    S.session.finished = true;
    finishPiece({ ...S.session.result(), score: 0 });
  } else runActivity(S.activity.free ? { ...S.activity, seed: undefined } : coach.nextActivity());
});
$('#btn-quit').addEventListener('click', () => {
  stopPlay();
  show('home');
});
$('#btn-res-home').addEventListener('click', () => {
  stopPlay();
  show('home');
});
$('#btn-mode').addEventListener('click', () => {
  if (!S.session || S.piece.waitOnly) return;
  startSession(S.session.mode === 'wait' ? 'tempo' : 'wait');
});
function changeTempo(d) {
  if (!S.piece) return;
  S.piece.bpm = Math.max(30, Math.min(200, S.piece.bpm + d));
  startSession(S.session ? S.session.mode : 'tempo');
}
$('#btn-tempo-down').addEventListener('click', () => changeTempo(-5));
$('#btn-tempo-up').addEventListener('click', () => changeTempo(5));

// Demo: play the piece through the synth while the playhead moves (grading muted).
$('#btn-listen').addEventListener('click', async () => {
  if (!S.piece) return;
  await audio.ensureContext();
  const mode = S.session ? S.session.mode : 'tempo';
  startSession('tempo');
  S.demo = true;
  S.demoMode = mode;
  audio.muted = true;
  const s = S.session;
  const base = audio.ctx.currentTime - audio.now();
  for (const n of S.piece.notes) audio.synth.note(n.midi, s.timeOfBeat(n.beat) + base, (n.dur * 60) / S.piece.bpm * 0.95, 0.7);
  pop('🔊 Listen…', '#9fb3ff');
});
function endDemo() {
  S.demo = false;
  setTimeout(() => {
    audio.muted = false;
    if (S.screen === 'play' && S.piece) startSession(S.demoMode || 'tempo');
  }, 600);
}

// View menu
$('#btn-view').addEventListener('click', () => {
  const m = $('#view-menu');
  m.classList.toggle('hidden');
  for (const el of $$('#view-menu [data-opt]')) {
    const k = el.dataset.opt;
    if (el.type === 'checkbox') el.checked = k === 'showNames' ? coach.showNames(S.activity ? S.activity.level : coach.level) : !!coach.settings[k];
    else el.value = coach.settings[k];
  }
});
$('#view-menu').addEventListener('change', (e) => {
  const k = e.target.dataset.opt;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  coach.setSetting(k, v);
  stage.setOptions(stageOptions(S.activity ? S.activity.level : coach.level));
  stage.resize();
});
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#view-menu') && !e.target.closest('#btn-view')) $('#view-menu').classList.add('hidden');
});

// On-screen keyboard (touch) input
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

// Computer keyboard input (handy with a Bluetooth keyboard or for testing): A=C4 ... K=C5.
const KEYMAP = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73, l: 74, p: 75, ';': 76 };
const keysDown = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select')) return;
  if (e.key === ' ' && S.screen === 'play') {
    e.preventDefault();
    $('#btn-pause').click();
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
  if (S.screen === 'play') stage.resize();
});

// ---------------------------------------------------------------------------------------------
// Free play: shows every note heard, with chord names.
function startFreePlay() {
  withListening(() => {
    stopPlay(true);
    S.free = true;
    $('#screen-play').classList.add('free');
    S.piece = null;
    S.activity = null;
    S.history = [];
    show('play');
    stage.setOptions({ showStaff: false, showFalling: true, showHints: false, showNames: false });
    stage.setPiece(null, [21, 108]);
    requestAnimationFrame(() => stage.resize());
    $('#hud-title').textContent = 'Free play';
    $('#hud-sub').textContent = 'Play anything. Every note Maestro hears lights up below.';
    for (const id of ['#btn-mode', '#btn-tempo-down', '#btn-tempo-up', '#btn-listen']) $(id).classList.add('hidden');
    $('#hud-bpm').textContent = '';
    $('#hud-beats').innerHTML = '';
    $('#hud-score').textContent = '–';
    $('#results').classList.add('hidden');
    $('#free-display').classList.remove('hidden');
    audio.setExpected([]);
    acquireWakeLock();
    loop();
  });
}

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
    : '<div class="fd-idle">Listening…</div>';
  if (el._html !== html) {
    el.innerHTML = html;
    el._html = html;
  }
  const md = $('#mic-dot');
  const lvl = Math.min(1, audio.level * 8);
  md.style.background = audio.micOn ? `rgba(31,191,106,${0.25 + lvl * 0.75})` : '#444a66';
  audio.level *= 0.9;
}

// ---------------------------------------------------------------------------------------------
// Level map
function renderMap() {
  const list = $('#map-list');
  list.innerHTML = STAGES.map((st) => {
    const items = LEVELS.filter((l) => l.n >= st.from && l.n <= st.to)
      .map((l) => {
        const cls = l.n === coach.level ? 'current' : l.n > coach.level ? 'locked' : '';
        const m = l.n < coach.level ? 100 : l.n === coach.level ? coach.mastery() : 0;
        return `<button class="lvl ${cls}" data-level="${l.n}"><span class="n">LEVEL ${l.n}${l.n < coach.level ? ' · ✓' : l.n === coach.level ? ' · CURRENT' : ''}</span><b>${l.title}</b><div class="bar"><i style="width:${m}%"></i></div></button>`;
      })
      .join('');
    return `<div class="map-stage"><h3>${st.name}</h3><div class="map-grid">${items}</div></div>`;
  }).join('');
}
$('#map-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const n = +b.dataset.level;
  withListening(() => {
    if (n === coach.level && coach.s.placed) runLesson();
    else {
      if (n > coach.level) toast(`Level ${n} is ahead of you. Practising it won't change your lesson level.`, 3500);
      runActivity({ kind: 'sight', level: n, mode: 'tempo', tempoFactor: coach.tempoFactor(n), free: true, label: `Practice: Level ${n}` });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Practice
const PR = { kind: 'sight', mode: 'tempo' };
function renderPractice() {
  const lvl = $('#pr-level');
  if (!lvl._init) {
    lvl.value = coach.level;
    $('#pr-tempo').value = Math.round(coach.tempoFactor() * 100);
    lvl._init = true;
  }
  updatePracticeLabels();
}
function updatePracticeLabels() {
  const n = +$('#pr-level').value;
  const lv = levelInfo(n);
  $('#pr-level-name').textContent = `${n}: ${lv.title}`;
  const tf = +$('#pr-tempo').value / 100;
  $('#pr-tempo-val').textContent = `≈ ♩ ${Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * tf)}`;
}
for (const id of ['#pr-kind', '#pr-mode']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of $(id).querySelectorAll('button')) x.classList.toggle('on', x === b);
    PR[id === '#pr-kind' ? 'kind' : 'mode'] = b.dataset.v;
  });
}
$('#pr-level').addEventListener('input', updatePracticeLabels);
$('#pr-tempo').addEventListener('input', updatePracticeLabels);
$('#btn-pr-go').addEventListener('click', () => {
  const level = +$('#pr-level').value;
  withListening(() =>
    runActivity({ kind: PR.kind, level, mode: PR.kind === 'notes' ? 'wait' : PR.mode, tempoFactor: +$('#pr-tempo').value / 100, free: true, label: `Practice: ${PR.kind === 'sight' ? 'sight-reading' : PR.kind}` }),
  );
});

// ---------------------------------------------------------------------------------------------
// Progress
function fmtTime(sec) {
  const h = Math.floor(sec / 3600),
    m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function renderProgress() {
  const sm = coach.summary();
  const cents = audio.tuningCents;
  const cards = [
    ['Level', `${sm.level}`, sm.info.title],
    ['Mastery', `${sm.mastery}%`, `of level ${sm.level}`],
    ['Stage', sm.info.stage, `${Math.round((100 * (sm.level - 1)) / 39)}% of the way to Master`],
    ['Avg. score', sm.avg ? `${sm.avg}%` : '–', 'last 20 exercises'],
    ['Practice time', fmtTime(sm.stats.seconds), 'total'],
    ['Exercises', `${sm.stats.pieces}`, 'completed'],
    ['Notes played', `${sm.stats.notes}`, 'correctly'],
    ['Streak', `${sm.streak} day${sm.streak === 1 ? '' : 's'}`, audio.micOn ? `piano tuning ${cents >= 0 ? '+' : ''}${Math.round(cents)}¢` : 'practice daily!'],
  ];
  $('#stats-grid').innerHTML = cards.map(([k, v, s]) => `<div class="stat"><small>${k}</small><b>${v}</b><small>${s}</small></div>`).join('');
  requestAnimationFrame(() => drawHistory(sm.history.filter((h) => !h.placement).slice(-60)));
}

function drawHistory(hist) {
  const c = $('#history-chart');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth,
    h = c.clientHeight;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const padL = 34,
    padB = 18,
    padT = 8;
  const ph = h - padB - padT;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#9aa3c2';
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, 50, 100]) {
    const y = padT + ph * (1 - v / 100);
    ctx.fillText(`${v}%`, padL - 8, y);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  if (!hist.length) {
    ctx.textAlign = 'center';
    ctx.fillText('Your scores will appear here after your first lesson.', (w + padL) / 2, h / 2);
    return;
  }
  const bw = Math.min(18, (w - padL) / hist.length - 3);
  hist.forEach((e, i) => {
    const x = padL + 4 + i * ((w - padL - 4) / hist.length);
    const bh = (ph * e.score) / 100;
    ctx.fillStyle = e.score >= 85 ? '#1fbf6a' : e.score >= 60 ? '#3b8cff' : '#ef476f';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padT + ph - bh, bw, Math.max(2, bh), [3, 3, 0, 0]);
    else ctx.rect(x, padT + ph - bh, bw, Math.max(2, bh));
    ctx.fill();
  });
}

// ---------------------------------------------------------------------------------------------
// Settings
function renderSettings() {
  for (const el of $$('#screen-settings [data-set]')) {
    const k = el.dataset.set;
    const v = coach.settings[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  }
  updateSettingLabels();
  $('#set-info').textContent = `Maestro ${window.__maestroVersion || ''} · input: ${audio.micOn ? 'microphone' : 'not started'}${audio.midiOn ? ' + MIDI' : ''} · sample rate ${audio.ctx ? audio.ctx.sampleRate : '–'} Hz`;
}
function updateSettingLabels() {
  $('#set-sens-val').textContent = `${(+coach.settings.sensitivity).toFixed(1)}×`;
  $('#set-lat-val').textContent = `${coach.settings.latencyMs} ms`;
  $('#set-look-val').textContent = `${coach.settings.lookaheadSec} s`;
}
$('#screen-settings').addEventListener('input', (e) => {
  const k = e.target.dataset.set;
  if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (e.target.type === 'range') v = +v;
  if (k === 'showNames') v = v === 'auto' ? 'auto' : v === 'true';
  coach.setSetting(k, v);
  if (k === 'sensitivity') audio.setSensitivity(v);
  updateSettingLabels();
});
$('#btn-reset').addEventListener('click', () => {
  if (confirm('Reset all progress and start over with a new placement test?')) {
    coach.reset();
    toast('Progress reset.');
    show('home');
  }
});

// ---------------------------------------------------------------------------------------------
// Keep the screen awake while playing.
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
    $('#pause-menu').classList.remove('hidden');
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

show('home');
