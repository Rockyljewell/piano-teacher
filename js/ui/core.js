// Shared UI plumbing: the app singletons, DOM helpers, the screen router, voice and sound hooks.
import { AudioEngine } from '../audio/audio.js';
import { Stage } from '../render/stage.js';
import { Coach } from '../coach.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const coach = new Coach();
export const audio = new AudioEngine();
export const stage = new Stage($('#stage'));

// Mutable app state shared by the UI modules.
export const S = {
  screen: 'home',
  activity: null,
  piece: null,
  session: null,
  demo: false,
  free: false,
  history: [],
  lastKind: new Map(),
  combo: 0,
  bestCombo: 0,
  judged: 0,
  credit: 0,
  pendingAfterSetup: null,
  autoTimer: null,
  wakeLock: null,
  startedAt: 0,
  scheduledTicks: new Set(),
  timingRecent: [],
  timingLast: '',
};

// Functions that modules provide to each other (avoids circular imports).
export const app = {};

// ---- router -------------------------------------------------------------------------------
const screens = {};
export function screen(name, handlers) {
  screens[name] = handlers;
}

export function show(name, params) {
  const prev = S.screen;
  if (prev !== name && screens[prev] && screens[prev].leave) screens[prev].leave();
  S.screen = name;
  for (const el of $$('.screen')) {
    const on = el.id === `screen-${name}`;
    if (on && !el.classList.contains('active')) {
      el.classList.remove('enter');
      void el.offsetWidth; // restart the entrance animation
      el.classList.add('enter');
    }
    el.classList.toggle('active', on);
  }
  if (screens[name] && screens[name].enter) screens[name].enter(params);
}

app.show = show;

export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---- mic gating ---------------------------------------------------------------------------
// While Maestro itself makes sound (voice, demo, jingles) the listener must not grade it.
export function holdMic(reason) {
  if (typeof audio.hold === 'function') return audio.hold(reason);
  audio.muted = true;
  return () => {
    audio.muted = false;
  };
}

export function activeSession() {
  return S.screen === 'play' && S.session && !S.session.finished && !S.session.paused && !S.demo;
}

// ---- voice coach --------------------------------------------------------------------------
let voice = null;
import('../voice.js')
  .then((m) => (voice = m.voice || m.default || null))
  .catch(() => {});

export function voiceAvailable() {
  return !!(voice && voice.supported);
}

// Speak a line (never while the student is being graded). Resolves when done.
export async function say(text, opts = {}) {
  if (!text || !voice || !voice.supported || coach.settings.voice === false) return;
  if (activeSession() && !opts.force) return;
  const release = holdMic('voice');
  try {
    await voice.speak(text, { interrupt: true, ...opts });
  } catch {
    /* speech failed: carry on silently */
  } finally {
    setTimeout(release, 300);
  }
}

export function stopVoice() {
  if (voice && voice.cancel) voice.cancel();
}

export function unlockVoice() {
  if (voice && voice.unlock) {
    try {
      voice.unlock();
    } catch {
      /* ignore */
    }
  }
}

// ---- sound effects ------------------------------------------------------------------------
let sfxEngine = null;
let SfxClass = null;
import('../audio/sfx.js')
  .then((m) => (SfxClass = m.Sfx || m.default || null))
  .catch(() => {});

function sfxReady() {
  if (sfxEngine) return sfxEngine;
  if (!SfxClass || !audio.ctx) return null;
  try {
    sfxEngine = new SfxClass(audio.ctx, audio.ctx.destination, audio.synth);
  } catch {
    sfxEngine = null;
  }
  return sfxEngine;
}

// Play a UI sound. During graded play only microphone-safe (ultrasonic-ish) sounds are allowed.
export function sfx(name, opts) {
  if (coach.settings.sounds === false) return;
  const e = sfxReady();
  if (!e) return;
  const safe = typeof e.isMicSafe === 'function' ? e.isMicSafe(name) : false;
  if (activeSession() && !safe) return;
  if (!safe && audio.micOn && typeof audio.holdFor === 'function') audio.holdFor(900, 'sfx');
  try {
    e.play(name, opts);
  } catch {
    /* unknown sound name */
  }
}
