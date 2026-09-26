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

// ---- motion helpers -----------------------------------------------------------------------
// The motion language (docs/brand/playful/spec.md §5): entrances ease out, pops spring, exits
// ease in and are faster than entrances. Only transform and opacity move, so everything runs
// on the compositor. With prefers-reduced-motion, movement becomes a short fade.
export const MOTION = { press: 90, fast: 160, base: 240, slow: 420 };
export const EASE = { out: 'cubic-bezier(.22,1,.36,1)', in: 'cubic-bezier(.55,0,1,.45)', spring: 'cubic-bezier(.34,1.56,.64,1)' };

/** Element.animate that never throws (old WebKit, detached nodes). */
export function animate(el, frames, opts) {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(frames, opts);
  } catch {
    return null;
  }
}

/** Entrance: fade up `y` px, staggered by `step` ms; items after `max` steps enter as a group. */
export function rise(els, { delay = 60, step = 50, max = 8, y = 12, dur = 360, easing = EASE.out } = {}) {
  const list = [...(els || [])].filter(Boolean);
  const rm = reducedMotion();
  list.forEach((el, i) => {
    const d = delay + Math.min(i, max) * step;
    if (rm) animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: Math.min(d, 120), fill: 'backwards' });
    else animate(el, [{ opacity: 0, transform: `translate3d(0,${y}px,0)` }, { opacity: 1, transform: 'none' }], { duration: dur, delay: d, easing, fill: 'backwards' });
  });
}

/** Pop in with a spring (scale .6 -> 1). */
export function popIn(el, { delay = 0, dur = MOTION.slow, from = 0.6 } = {}) {
  if (!el) return null;
  if (reducedMotion()) return animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay, fill: 'backwards' });
  return animate(el, [{ opacity: 0, transform: `scale(${from})` }, { opacity: 1, transform: 'none' }], { duration: dur, delay, easing: EASE.spring, fill: 'backwards' });
}

/** Count a number up (ease-out cubic). fmt formats the value; resolves when done. */
export function countUp(el, from, to, { ms = 700, delay = 0, fmt = (v) => String(v), onStep } = {}) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    const end = () => {
      el.textContent = fmt(to);
      if (onStep) onStep(to, 1);
      resolve();
    };
    if (reducedMotion() || from === to) return end();
    el.textContent = fmt(from);
    setTimeout(() => {
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        const v = Math.round(from + (to - from) * e);
        el.textContent = fmt(v);
        if (onStep) onStep(v, k);
        if (k < 1 && el.isConnected) requestAnimationFrame(step);
        else end();
      };
      requestAnimationFrame(step);
    }, delay);
  });
}

// Range sliders show their filled part (CSS reads --p).
export function fillRange(el) {
  if (!el || el.type !== 'range') return;
  const lo = +el.min || 0,
    hi = +el.max || 100;
  el.style.setProperty('--p', `${(100 * ((+el.value || 0) - lo)) / (hi - lo || 1)}%`);
}
document.addEventListener('input', (e) => fillRange(e.target), true);

// ---- router -------------------------------------------------------------------------------
const screens = {};
export function screen(name, handlers) {
  screens[name] = handlers;
}

// Navigation depth: going deeper (home -> intro -> play, list -> detail) slides the new screen in
// from the right, going back from the left; rail tabs cross-fade with a small rise. show() can
// also take an explicit { dir: 'forward' | 'back' | 'tab' | 'none' }.
const DEPTH = { home: 0, songs: 0, practice: 0, progress: 0, settings: 0, map: 1, setup: 1, placement: 1, intro: 1, reveal: 2, play: 2 };
const TABS = new Set(['home', 'songs', 'practice', 'progress', 'settings']);
function navDir(from, to) {
  if (from === to) return 'none';
  if (TABS.has(from) && TABS.has(to)) return 'tab';
  return (DEPTH[to] ?? 1) < (DEPTH[from] ?? 1) ? 'back' : 'forward';
}

const leaving = new Map(); // screen element -> { timer, anims }
function settle(el) {
  const l = leaving.get(el);
  if (!l) return;
  clearTimeout(l.timer);
  for (const a of l.anims) if (a) a.cancel();
  leaving.delete(el);
  el.classList.remove('leaving');
  el.removeAttribute('inert');
}

// The old screen stays visible (under the new one) while it fades out, but takes no taps.
function exitScreen(el, dir, bothRailed) {
  el.classList.remove('active');
  el.classList.add('leaving');
  el.setAttribute('inert', '');
  const rm = reducedMotion();
  const dur = rm ? 120 : MOTION.fast;
  const dx = rm ? 0 : dir === 'forward' ? -12 : dir === 'back' ? 12 : 0;
  const content = el.querySelector(':scope > .content');
  const target = bothRailed && content ? content : el;
  const a = animate(target, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate3d(${dx}px,0,0)` }], { duration: dur, easing: EASE.in, fill: 'forwards' });
  // Settle when the exit has played (a busy enter hook can delay its start), with a fallback.
  const entry = { anims: [a], timer: setTimeout(() => settle(el), dur + 900) };
  leaving.set(el, entry);
  if (a && a.finished) a.finished.then(() => leaving.get(el) === entry && settle(el), () => {});
}

function enterScreen(el, dir, bothRailed) {
  const content = el.querySelector(':scope > .content');
  const rail = el.querySelector(':scope > .rail');
  if (reducedMotion()) {
    animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
    return;
  }
  const from = dir === 'tab' ? 'translate3d(0,8px,0)' : `translate3d(${dir === 'back' ? -24 : 24}px,0,0)`;
  const frames = [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }];
  const opts = { duration: MOTION.base, easing: EASE.out };
  if (rail && content) {
    // Rail screens: the rail stays put (or just fades in from a focus screen); the page moves.
    if (!bothRailed) animate(rail, [{ opacity: 0 }, { opacity: 1 }], opts);
    animate(content, frames, opts);
  } else animate(el, frames, opts);
}

let booted = false;
export function show(name, params, opts = {}) {
  const prev = S.screen;
  if (prev !== name && screens[prev] && screens[prev].leave) screens[prev].leave();
  S.screen = name;
  const dir = !booted ? 'none' : opts.dir || navDir(prev, name);
  booted = true;
  const incoming = document.getElementById(`screen-${name}`);
  const outgoing = $$('.screen.active').filter((el) => el !== incoming);
  const bothRailed = !!incoming && incoming.classList.contains('railed') && outgoing.some((el) => el.classList.contains('railed'));
  for (const el of outgoing) {
    if (dir === 'none') el.classList.remove('active');
    else exitScreen(el, dir, bothRailed);
  }
  let entered = false;
  if (incoming && !incoming.classList.contains('active')) {
    settle(incoming);
    for (const a of incoming.getAnimations ? incoming.getAnimations({ subtree: false }) : []) a.cancel();
    incoming.classList.add('active');
    entered = true;
  }
  if (entered && dir !== 'none') enterScreen(incoming, dir, bothRailed);
  if (incoming) for (const r of incoming.querySelectorAll('input[type=range]')) fillRange(r);
  if (screens[name] && screens[name].enter) screens[name].enter(params);
  // Into a lesson: a soft whoosh (sfx() stays silent while a take is being graded).
  if (entered && dir === 'forward' && (name === 'intro' || name === 'play') && !opts.quiet) sfx('whoosh');
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

// ---- overlays (sheets and dialogs) ---------------------------------------------------------
// Opening: the backdrop fades in and the card rises from +24 px (CSS). Closing plays a short
// exit (fade + drop) before the overlay is hidden; it takes no taps while it closes.
export function openOverlay(el) {
  if (!el) return;
  clearTimeout(el._closeT);
  el.classList.remove('hidden', 'closing');
}
export function closeOverlay(el) {
  if (!el || el.classList.contains('hidden')) return;
  if (reducedMotion()) {
    el.classList.add('hidden');
    return;
  }
  el.classList.add('closing');
  clearTimeout(el._closeT);
  el._closeT = setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('closing');
  }, MOTION.fast);
}
