// "Get ready": before an exercise starts, show where the hands go. The keyboard lights up the
// hand position with finger numbers, the first notes pulse, and Pip says where to start. The
// count-in begins when the student plays a first note (hands-free) or taps "I'm ready".
import { $, S, app, audio, coach, say, stopVoice, sfx } from './core.js';
import { noteName } from '../music/theory.js';
import { pip } from './brand.js';

const FINGER = { 1: 'thumb', 2: 'pointer', 3: 'middle finger', 4: 'ring finger', 5: 'pinky' };
const HAND = { R: 'right', L: 'left' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A note name a beginner can find: "middle C (C4)", "C3, the C below middle C".
function findable(midi, key, level) {
  const n = noteName(midi, key);
  if (level > 8) return n;
  if (midi === 60) return `middle C (${n})`;
  if (midi === 48) return `${n}, the C below middle C`;
  if (midi === 72) return `${n}, the C above middle C`;
  return n;
}
// The same for speech: "middle C", "the C below middle C", "G 4".
function spoken(midi, key) {
  if (midi === 60) return 'middle C';
  if (midi === 48) return 'the C below middle C';
  if (midi === 72) return 'the C above middle C';
  return noteName(midi, key).replace('♯', ' sharp').replace('♭', ' flat').replace(/(-?\d+)$/, ' $1');
}

// Which hands play, where, with which fingers and which notes come first. Uses the generator's
// piece.prep when present, otherwise works it out from the notes.
export function prepInfo(piece, act = {}) {
  const level = act.level ?? piece.level ?? 1;
  const key = piece.key;
  const keys = new Map(); // midi -> { hand, finger, first }
  if (piece.rhythmOnly || piece.anyKey) {
    const s = piece.suggestKey || {};
    const midi = s.midi ?? (piece.notes[0] && piece.notes[0].midi) ?? 60;
    keys.set(midi, { hand: s.hand || 'R', finger: s.finger ?? null, first: true });
    const who = s.finger ? ` with your ${HAND[s.hand || 'R']} ${FINGER[s.finger]}` : '';
    return {
      level,
      keys,
      anyKey: midi,
      starts: null, // any key starts
      middleC: level <= 8,
      title: 'Rhythm drill: any key works',
      text: s.text || `Only your timing counts. Tap ${findable(midi, key, level)}${who}, the glowing key.`,
      say: s.say || `Rhythm time! Any key works. Try ${spoken(midi, key)}.`,
    };
  }
  const P = piece.prep || null;
  const events = [...(piece.events || [])].filter((e) => e.midis && e.midis.length && !e.rest).sort((a, b) => a.beat - b.beat);
  const hands = [];
  for (const h of ['L', 'R']) {
    const evs = events.filter((e) => (e.hand || 'R') === h);
    if (!evs.length) continue;
    const fingerOf = new Map();
    for (const e of evs) if (e.fingers) e.midis.forEach((m, i) => e.fingers[i] && !fingerOf.has(m) && fingerOf.set(m, e.fingers[i]));
    const midis = [...new Set(evs.flatMap((e) => e.midis))].sort((a, b) => a - b);
    const ph = P && P.hands ? P.hands.find((x) => x.hand === h) : null;
    const lo = ph && ph.position ? ph.position.lo : midis[0];
    const hi = ph && ph.position ? ph.position.hi : midis[midis.length - 1];
    const firstBeat = evs[0].beat;
    const first = evs.filter((e) => Math.abs(e.beat - firstBeat) < 1e-6).flatMap((e) => e.midis);
    // A compact position: light every key the hand uses. A wide part: just the first notes.
    const lit = hi - lo <= 9 ? midis : first;
    for (const m of lit) if (!keys.has(m) || h === 'R') keys.set(m, { hand: h, finger: fingerOf.get(m) ?? null, first: first.includes(m) });
    let anchor = ph && ph.anchor ? ph.anchor : null;
    if (!anchor) {
      const want = h === 'R' ? 1 : 5;
      const m = [...fingerOf].find(([, f]) => f === want);
      anchor = m ? { midi: m[0], finger: want } : { midi: first[0], finger: fingerOf.get(first[0]) ?? null };
    }
    hands.push({ hand: h, anchor, first, firstBeat });
  }
  const line = (hd, forSpeech) => {
    const a = hd.anchor;
    const where = forSpeech ? spoken(a.midi, key) : findable(a.midi, key, level);
    if (a.finger) return `${cap(HAND[hd.hand])} ${FINGER[a.finger]} on ${where}`;
    if (hd.first.length > 1) {
      const names = [...hd.first].sort((x, y) => x - y).map((m) => (forSpeech ? spoken(m, key) : noteName(m, key)));
      return `${cap(HAND[hd.hand])} hand starts with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} together`;
    }
    return `${cap(HAND[hd.hand])} hand starts on ${where}`;
  };
  const ordered = [...hands].sort((a, b) => a.firstBeat - b.firstBeat || (a.hand === 'R' ? -1 : 1));
  const title = hands.length === 2 ? 'Both hands ready' : `${cap(HAND[hands[0]?.hand || 'R'])} hand ready`;
  const together = hands.length === 2 && Math.abs(hands[0].firstBeat - hands[1].firstBeat) < 1e-6;
  const order = hands.length === 2 ? (together ? ' Both hands start together.' : ` The ${HAND[ordered[0].hand]} hand plays first.`) : '';
  const text = (P && P.text) || `${ordered.map((hd) => line(hd, false)).join('. ')}.${order}`;
  const sayText = (P && P.say) || `${ordered.map((hd) => line(hd, true)).join('. ')}.`;
  const starts = new Set(together ? hands.flatMap((hd) => hd.first) : ordered.length ? ordered[0].first : []);
  return { level, keys, anyKey: null, starts, middleC: level <= 8, title, text, say: sayText, hands };
}

// Should this activity get a "get ready" step?
export function wantsPrep(piece, act = {}) {
  if (!piece || act.demoFirst) return false;
  if (coach.settings.prep === false) return false;
  if (act.placement) return true;
  const level = act.level ?? piece.level ?? 1;
  return level <= 16;
}

// How long before starting on its own (ms), or 0 to wait for the student.
function autoStartMs(act, info) {
  if (act.placement) return 6000;
  if (info.level <= 8) return 0;
  return coach.settings.autoAdvance === false ? 0 : 7000;
}

let autoTimer = 0;
let autoRaf = 0;

export function enterPrep(piece, act, mode) {
  const info = prepInfo(piece, act);
  S.prep = { info, act, mode, t0: performance.now(), wrongAt: 0 };
  const card = $('#prep');
  card.innerHTML = `
    <div class="prep-pip">${pip(info.anyKey != null ? 'conduct' : 'hello', 92)}</div>
    <div class="prep-body">
      <div class="eyebrow">Get ready</div>
      <div class="prep-title">${esc(info.title)}</div>
      <div class="prep-text" id="prep-text">${esc(info.text)}</div>
    </div>
    <div class="prep-go">
      <button id="btn-prep-go" class="btn btn-primary btn-lg"><span class="prep-ring"></span>I'm ready</button>
      <div class="prep-or">${info.anyKey != null ? 'or tap any key to start' : 'or play the first note to start'}</div>
    </div>`;
  card.classList.remove('hidden', 'leave');
  $('#btn-prep-go').addEventListener('click', () => {
    sfx('tap');
    startFromPrep('tap');
  });
  placePrep();
  // Help the listener hear the first notes.
  audio.setExpected(info.starts ? [...info.starts] : [...info.keys.keys()]);
  if (coach.settings.voice !== false) say(info.say, { silent: true });
  const ms = autoStartMs(act, info);
  clearTimeout(autoTimer);
  cancelAnimationFrame(autoRaf);
  if (ms) {
    const ring = card.querySelector('.prep-ring');
    const t0 = performance.now();
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / ms);
      ring.style.setProperty('--p', f.toFixed(3));
      if (f < 1 && S.prep) autoRaf = requestAnimationFrame(tick);
    };
    ring.classList.add('on');
    tick();
    autoTimer = setTimeout(() => startFromPrep('auto'), ms);
  }
}

// Place the card over the falling-notes area, above the hand brackets.
export function placePrep() {
  const card = $('#prep');
  const L = app.stageLayout && app.stageLayout();
  if (!card || !L || !L.fall) return;
  const top = L.fall.h > 120 ? L.fall.y + 10 : L.strip.y + L.strip.h + 4;
  card.style.top = `${Math.round(top)}px`;
  card.style.maxHeight = `${Math.max(120, Math.round(L.kb.y - 44 - top))}px`;
}

function leaveUI() {
  clearTimeout(autoTimer);
  cancelAnimationFrame(autoRaf);
  const card = $('#prep');
  if (card) card.classList.add('hidden');
}

export function cancelPrep() {
  if (!S.prep) return;
  S.prep = null;
  leaveUI();
}

async function startFromPrep(why) {
  const p = S.prep;
  if (!p) return;
  S.prep = null;
  leaveUI();
  stopVoice();
  if (why === 'note') app.flash && app.flash('Great, here we go!', 'info', 1400);
  // Make sure the audio clock runs and the mic delivers before the count-in starts.
  if (typeof audio.ready === 'function') {
    try {
      await audio.ready({ timeoutMs: 2500 });
    } catch {
      /* start anyway */
    }
  } else if (typeof audio.resume === 'function') await audio.resume();
  if (S.screen !== 'play' || S.piece == null) return;
  app.startSession(p.mode);
}

// A note while getting ready: a first note starts; another key gets a gentle pointer.
export function prepNote(ev) {
  const p = S.prep;
  if (!p) return false;
  if (performance.now() - p.t0 < 600) return true; // ignore the tail of whatever sounded before
  const info = p.info;
  if (!info.starts || info.starts.has(ev.midi)) {
    startFromPrep('note');
    return true;
  }
  if (info.level <= 16 && performance.now() - p.wrongAt > 1500 && (ev.confidence ?? 1) >= 0.6) {
    p.wrongAt = performance.now();
    const want = [...info.starts][0];
    const el = $('#prep-text');
    if (el) {
      el.innerHTML = `That was <b>${esc(noteName(ev.midi, S.piece.key))}</b>. The first note is <b>${esc(findable(want, S.piece.key, info.level))}</b>: the glowing key.`;
      el.classList.remove('nudge');
      void el.offsetWidth;
      el.classList.add('nudge');
    }
  }
  return true;
}

// The notes that start the count-in (tests and tools).
app.prepStarts = () => (S.prep ? [...(S.prep.info.starts || S.prep.info.keys.keys())] : []);

// Stage state for drawing while getting ready.
export function prepDrawState() {
  const p = S.prep;
  if (!p) return null;
  return { keys: p.info.keys, anyKey: p.info.anyKey, middleC: p.info.middleC };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
