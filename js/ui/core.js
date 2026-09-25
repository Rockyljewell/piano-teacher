// Shared UI plumbing: the app singletons, DOM helpers, the screen router, voice and sound hooks.
import { AudioEngine } from '../audio/audio.js';
import { Stage } from '../render/stage.js';
import { Coach } from '../coach.js';
import { pip, icon, reducedMotion } from './brand.js';

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
  placementCue: null,
  lastTap: -1,
};

// Functions that modules provide to each other (avoids circular imports).
export const app = {};

// ---- static decoration: icons in icon buttons and Pip in every [data-pip] slot ------------
const ICONS = [
  ['.icon-btn[data-go="home"]', 'back', 22],
  ['#btn-exit', 'close', 22],
  ['#btn-pause', 'pause', 22],
  ['#sheet-close', 'close', 20],
  ['#btn-tempo-down', 'minus', 18],
  ['#btn-tempo-up', 'plus', 18],
  ['.flame-ic', 'flame', 30],
  ['.mic-ic', 'mic', 16],
  ['.search-ic', 'search', 20],
  ['.up-ic', 'upload', 22],
];
export function decorate(root = document) {
  for (const [sel, name, size] of ICONS) for (const el of $$(sel, root)) if (!el.querySelector('svg')) el.innerHTML = icon(name, size);
  const listen = $('#btn-listen', root);
  if (listen && !listen.querySelector('svg')) listen.innerHTML = `${icon('speaker', 22)}<span>Listen</span>`;
  const retry = $('#btn-retry', root);
  if (retry && !retry.querySelector('svg')) retry.innerHTML = `${icon('retry', 22)}<span>Retry</span>`;
  for (const el of $$('[data-pip]', root)) {
    if (el.querySelector('svg')) continue;
    el.innerHTML = pip(el.dataset.pip, +el.dataset.size || 160);
  }
}
decorate();

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
const voiceReady = import('../voice.js')
  .then((m) => {
    voice = m.voice || m.default || null;
    if (voice) {
      if (typeof audio.attachVoice === 'function') audio.attachVoice(voice);
      if (typeof voice.onChange === 'function') voice.onChange(setTalking);
      // One source of truth: the Settings toggle writes both, voice.enabled is what say() reads.
      if (coach.settings.voice === false && voice.enabled) voice.setEnabled(false);
    }
    return voice;
  })
  .catch(() => null);

export function getVoice() {
  return voice;
}
export { voiceReady };

export function voiceAvailable() {
  return !!(voice && voice.supported);
}

// Pip's beak moves while the voice speaks (CSS: body.pip-talking).
function setTalking(on) {
  document.body.classList.toggle('pip-talking', !!on);
  for (const b of $$('.bubble.speaking')) if (!on) b.classList.remove('speaking');
}

// The coach bubble that is visible right now (results layer first, then the active screen).
function visibleBubble() {
  const res = $('#results');
  if (res && !res.classList.contains('hidden') && S.screen === 'play') return $('#res-line');
  const scr = $(`#screen-${S.screen}`);
  return scr ? scr.querySelector('[data-coach]') : null;
}

// Show a coach line in Pip's bubble (without speaking it).
export function showLine(text, { pop = true } = {}) {
  const b = visibleBubble();
  if (!b || !text) return;
  b.textContent = text;
  if (pop && !reducedMotion()) {
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }
}

// Speak a line (never while the student is being graded) and mirror it in Pip's bubble.
// Resolves when done.
export async function say(text, opts = {}) {
  if (!text) return;
  const graded = activeSession() && !opts.force;
  if (!opts.silent) showLine(text);
  if (graded || !voice || !voice.supported || !voice.enabled) return;
  const b = visibleBubble();
  if (b) b.classList.add('speaking');
  try {
    await voice.speak(text, { interrupt: true, ...opts });
  } catch {
    /* speech failed: carry on silently */
  } finally {
    if (b) b.classList.remove('speaking');
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
// Names from js/audio/sfx.js (aliases like select/countin/hitPerfect also work). Full-range
// sounds hold the microphone for exactly their duration (audio.playSfx); during graded play
// only mic-safe sounds (hit, perfect, combo, miss, wrong, count, count-go) are allowed.
export function sfx(name, opts) {
  if (coach.settings.sounds === false || !audio.ctx || typeof audio.playSfx !== 'function') return 0;
  const safe = audio.sfx && typeof audio.sfx.isMicSafe === 'function' ? audio.sfx.isMicSafe(name) : false;
  if (activeSession() && !safe) return 0;
  try {
    return audio.playSfx(name, opts) || 0;
  } catch {
    return 0; /* unknown sound name */
  }
}
