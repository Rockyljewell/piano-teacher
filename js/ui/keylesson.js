// The key lesson screen: what a key is (signature), where the hands go, the scale with its
// fingering up and down (where the thumb tucks under or a finger crosses over it) and the
// I-IV-V-I chords. "Hear it" plays what is on screen and lights the keys and fingers in turn.
// What it shows comes from music/keylesson.js; js/coach.js decides when it is due.
import { $, $$, S, app, audio, coach, esc, screen, show, say, showLine, sfx, stopVoice, rise, popIn } from './core.js';
import { icon } from './brand.js';
import { keyLesson } from '../music/keylesson.js';
import { isBlack } from '../music/theory.js';
import { STAGE_VARS, stageOf } from './screens.js';

const HAND = {
  R: { name: 'Right hand', c: '#6F4BF2', soft: '#E9E2FF', ink: '#4A2FC2' },
  L: { name: 'Left hand', c: '#14B8A6', soft: '#D3F4EF', ink: '#0B7568' },
};
const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
const wIndex = (m) => Math.floor(m / 12) * 7 + WHITE_PC.indexOf((isBlack(m) ? m - 1 : m) % 12) + (isBlack(m) ? 0.5 : 0);
const wMidi = (w) => Math.floor(w / 7) * 12 + WHITE_PC[((w % 7) + 7) % 7];
const LETTER = (m) => 'CDEFGAB'[WHITE_PC.indexOf(m % 12)];

// Key sizes: a big keyboard for the scale, smaller for the hand positions and the four chords.
const SIZES = {
  lg: { wk: 56, kh: 136, bk: 32, bh: 86, r: 16, pad: 1, font: 16 },
  md: { wk: 46, kh: 120, bk: 27, bh: 76, r: 14, pad: 1, font: 14 },
  sm: { wk: 38, kh: 100, bk: 23, bh: 64, r: 12, pad: 1, font: 13 },
};

// One keyboard strip with finger numbers on the notes played, in playing order.
//   notes [{ midi, finger, name }]   moves [{ at, kind, finger, to }] (indexes into notes)
export function keyboardSvg({ hand, notes, moves = [], size = 'lg' }) {
  const Z = SIZES[size];
  const H = HAND[hand];
  const midis = notes.map((n) => n.midi);
  const a = Math.floor(wIndex(Math.min(...midis))) - Z.pad;
  const b = Math.ceil(wIndex(Math.max(...midis))) + Z.pad;
  const X = (w) => (w - a) * Z.wk + 4;
  const owner = new Map(notes.map((n, i) => [n.midi, { ...n, i }]));
  const movedAt = new Map(moves.map((m) => [m.at, m]));
  const KH = Z.kh;
  let bed = `<rect x="2" y="6" width="${(b - a + 1) * Z.wk + 4}" height="${KH}" rx="8" fill="#E6D6BC"/>`;
  let whites = '',
    blacks = '',
    labels = '',
    discs = '',
    arcs = '';
  const blackLabelX = [];
  for (let w = a; w <= b; w++) {
    const m = wMidi(w);
    const own = owner.get(m);
    whites += `<rect class="kb-k" data-m="${m}" x="${X(w) + 1}" y="2" width="${Z.wk - 2}" height="${KH}" rx="6" fill="${own ? H.soft : '#fff'}" stroke="#E6D6BC" stroke-width="1.5"/>`;
    const bm = m + 1;
    if (isBlack(bm) && w < b) {
      const bo = owner.get(bm);
      blacks += `<rect class="kb-k kb-b" data-m="${bm}" x="${X(w) + Z.wk - Z.bk / 2}" y="1" width="${Z.bk}" height="${Z.bh}" rx="4" fill="${bo ? H.c : '#2E2B5F'}"/>`;
      if (bo) blackLabelX.push(X(w) + Z.wk);
    }
  }
  const kx = (m) => (isBlack(m) ? X(Math.floor(wIndex(m))) + Z.wk : X(Math.floor(wIndex(m))) + Z.wk / 2);
  // Note names under the keys: the notes played in colour, the other white keys faint.
  for (let w = a; w <= b; w++) {
    const m = wMidi(w);
    if (owner.has(m)) labels += `<text x="${kx(m)}" y="${KH + 26}" text-anchor="middle" font-size="${Z.font + 2}" font-weight="900" fill="${H.ink}">${esc(owner.get(m).name)}</text>`;
    else if (!blackLabelX.some((x) => Math.abs(x - kx(m)) < Z.wk / 2 + 2)) labels += `<text x="${kx(m)}" y="${KH + 26}" text-anchor="middle" font-size="${Z.font}" font-weight="700" fill="#B8AE9A">${LETTER(m)}</text>`;
  }
  for (const n of notes) {
    if (isBlack(n.midi)) labels += `<text x="${kx(n.midi)}" y="${KH + 26}" text-anchor="middle" font-size="${Z.font + 2}" font-weight="900" fill="${H.ink}">${esc(n.name)}</text>`;
  }
  notes.forEach((n, i) => {
    const blk = isBlack(n.midi);
    const cx = kx(n.midi);
    const cy = blk ? Z.bh - 22 : KH - 30;
    const r = blk ? Z.r - 3 : Z.r;
    const mv = movedAt.get(i);
    discs += `<g class="kb-note" data-i="${i}" style="--k:${i}">
      ${mv ? `<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="#E09A0B" stroke-width="3.5" stroke-dasharray="5 3"/>` : ''}
      <circle class="kb-disc" cx="${cx}" cy="${cy}" r="${r}" fill="${blk ? '#fff' : H.c}" ${blk ? `stroke="${H.c}" stroke-width="3"` : ''}/>
      <text x="${cx}" y="${cy + Z.r * 0.36}" text-anchor="middle" font-size="${Z.r * 1.15}" font-weight="900" fill="${blk ? H.c : '#fff'}">${n.finger ?? ''}</text></g>`;
  });
  // Where the hand moves: an arrow under the keys from the finger that stays to the one that lands.
  const y0 = KH + 40;
  for (const mv of moves) {
    const x1 = kx(notes[mv.at - 1].midi);
    const x2 = kx(notes[mv.at].midi);
    const mid = (x1 + x2) / 2;
    const label = mv.kind === 'under' ? 'thumb under' : `${mv.to} over thumb`;
    const pw = label.length * 8.2 + 22;
    arcs += `<g class="kb-move"><path d="M${x1} ${y0} C${x1} ${y0 + 26} ${x2} ${y0 + 26} ${x2} ${y0 + 4}" fill="none" stroke="#E09A0B" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M${x2 - 7} ${y0 + 12} L${x2} ${y0 + 3} L${x2 + 7} ${y0 + 12}" fill="none" stroke="#E09A0B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="${mid - pw / 2}" y="${y0 + 32}" width="${pw}" height="26" rx="13" fill="#FFC23D"/><text x="${mid}" y="${y0 + 50}" text-anchor="middle" font-size="14" font-weight="900" fill="#2A2346">${esc(label)}</text></g>`;
  }
  const width = (b - a + 1) * Z.wk + 8;
  const height = KH + 38 + (moves.length ? 70 : 8);
  return `<svg class="kb" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${H.name}: ${notes.map((n) => `${n.name} finger ${n.finger}`).join(', ')}`)}" font-family="Nunito, system-ui, sans-serif">${bed}${whites}${blacks}${labels}${arcs}${discs}</svg>`;
}

// ---- state ------------------------------------------------------------------------------------
let K = null; // { spec, lesson, level, library, tab, hand, dir, demo }
const TABS = [
  ['position', 'Hand position'],
  ['scale', 'The scale'],
  ['chords', 'The chords'],
];

function notesOf(run, hand) {
  return run.midis.map((midi, i) => ({ midi, finger: run.fingers[i], name: run.names[i] }));
}

// ---- drawing ----------------------------------------------------------------------------------
function renderTabs() {
  $('#key-tabs').innerHTML = TABS.map(([id, label], i) => `<button role="tab" class="key-tab${K.tab === id ? ' on' : ''}" data-tab="${id}" aria-selected="${K.tab === id}"><b>${i + 1}</b>${esc(label)}</button>`).join('');
}

function renderToolbar() {
  const L = K.lesson;
  const chip = (attr, val, label, on) => `<button class="chip${on ? ' on' : ''}" data-${attr}="${val}" aria-pressed="${on}">${label}</button>`;
  const hands = L.hands.length > 1 ? L.hands.map((h) => chip('hand', h, `<span class="dot" style="background:${HAND[h].c}"></span>${HAND[h].name}`, K.hand === h)).join('') : '';
  let html = '';
  if (K.tab === 'scale') html = `${hands}<span class="key-sep"></span>${chip('dir', 'up', `${icon('up', 16)} Going up`, K.dir === 'up')}${chip('dir', 'down', `${icon('down', 16)} Coming down`, K.dir === 'down')}`;
  else if (K.tab === 'chords') html = hands;
  else html = `<span class="key-hint">Numbers are fingers: <b>1</b> is the thumb, <b>5</b> the little finger.</span>`;
  $('#key-toolbar').innerHTML = html;
}

function runNow() {
  const S_ = K.lesson.scale[K.hand];
  return K.dir === 'up' ? S_.up : S_.down;
}

// The row of fingers under the keyboard: each finger with its note, and the moves between runs.
function seqHtml(run) {
  let i = 0;
  const parts = run.words.steps.map((st) => {
    if (st.move) return `<span class="seq-move ${st.move}">${icon(st.move === 'under' ? 'down' : 'up', 16)}${st.move === 'under' ? 'thumb tucks under' : `${st.to} crosses over`}</span>`;
    return `<span class="seq-run">${st.fingers.map((f, k) => `<span class="seq-f" data-i="${i++}"><b>${f}</b><i>${esc(st.names[k])}</i></span>`).join('')}</span>`;
  });
  return parts.join('');
}

function renderBoard() {
  const L = K.lesson;
  const board = $('#key-board');
  const seq = $('#key-seq');
  const words = $('#key-words');
  seq.innerHTML = '';
  seq.classList.add('hidden');
  words.classList.remove('sr');
  board.className = `key-board ${K.tab}`;
  if (K.tab === 'position') {
    board.innerHTML = [...L.hands]
      .reverse()
      .map((h) => {
        const P = L.position[h];
        const notes = P.midis.map((midi, i) => ({ midi, finger: P.fingers[i], name: P.names[i] }));
        return `<figure class="key-strip" data-hand="${h}"><figcaption style="--c:${HAND[h].c}">${HAND[h].name}</figcaption>${keyboardSvg({ hand: h, notes, size: 'md' })}</figure>`;
      })
      .join('');
    words.innerHTML = L.hands.map((h) => esc(L.position[h].text)).join('<br>');
  } else if (K.tab === 'scale') {
    const run = runNow();
    board.innerHTML = `<figure class="key-strip wide" data-hand="${K.hand}">${keyboardSvg({ hand: K.hand, notes: notesOf(run, K.hand), moves: run.moves, size: 'lg' })}</figure>`;
    seq.innerHTML = seqHtml(run);
    seq.classList.remove('hidden');
    words.innerHTML = `${esc(run.words.text)}${L.scaleNote ? `<br><span class="key-note">${esc(L.scaleNote)}</span>` : ''}`;
    // (the finger row and Pip say it; the sentence stays for screen readers, and the note for minor keys shows)
    words.classList.toggle('sr', !L.scaleNote);
  } else {
    board.innerHTML = L.chords
      .map((c, i) => {
        const hd = c.hands[K.hand];
        const notes = hd.midis.map((midi, k) => ({ midi, finger: hd.fingers[k], name: hd.names[k] }));
        return `<figure class="key-chord" data-i="${i}"><figcaption><b>${esc(c.roman)}</b> ${esc(c.name)}</figcaption>${keyboardSvg({ hand: K.hand, notes, size: 'sm' })}<small>${esc(hd.names.join(' '))} · fingers ${hd.fingers.join(' ')}${c.last ? '' : ''}</small></figure>`;
      })
      .join('');
    words.innerHTML = `${esc(L.chordNote)}<br><span class="key-note">Each chord is one hand shape: press all three keys at the same moment.</span>`;
  }
}

function renderFoot() {
  const i = TABS.findIndex(([id]) => id === K.tab);
  const last = i === TABS.length - 1;
  $('#btn-key-next').innerHTML = last ? `${icon('play', 24)} ${K.library ? 'Practise this key' : "Let's practise"}` : `Next: ${TABS[i + 1][1].toLowerCase()} ${icon('chevron', 24)}`;
  $('#btn-key-skip').textContent = K.library ? 'Back' : 'Skip for now';
  $('#btn-key-hear').innerHTML = `${icon('speaker', 22)} ${K.demo ? 'Stop' : 'Hear it'}`;
}

function render() {
  stopDemo();
  renderTabs();
  renderToolbar();
  renderBoard();
  renderFoot();
}

// Pip's line for what is on screen (shown in the bubble and spoken).
function lineFor() {
  const L = K.lesson;
  if (K.tab === 'position') return `${L.intro.say} ${L.positionSay}`;
  if (K.tab === 'scale') return runNow().words.say;
  return L.chordSay;
}
function pipSays() {
  const line = lineFor();
  showLine(line, { pop: true });
  stopVoice();
  say(line, { silent: true });
}

// ---- "hear it" ----------------------------------------------------------------------------------
function stopDemo() {
  if (!K || !K.demo) return;
  const d = K.demo;
  K.demo = null;
  d.timers.forEach(clearTimeout);
  if (d.handle && d.handle.stop) d.handle.stop();
  light(null);
  if (S.screen === 'key') renderFoot();
}

// Light one moment of the demo: the keys, discs and fingers of that step (null clears).
function light(step) {
  for (const el of $$('#screen-key .on[data-i], #screen-key .kb-k.on, #screen-key .key-chord.on')) el.classList.remove('on');
  if (!step) return;
  for (const sel of step.sel) for (const el of $$(`#screen-key ${sel}`)) el.classList.add('on');
}

// Steps of what is on screen: [{ t (seconds), dur, midis, sel: [css selectors to light] }].
function demoSteps() {
  const L = K.lesson;
  const steps = [];
  if (K.tab === 'position') {
    let t = 0;
    for (const h of L.hands.slice().reverse()) {
      L.position[h].midis.forEach((m, i) => {
        steps.push({ t, dur: 0.5, midis: [m], sel: [`.key-strip[data-hand="${h}"] .kb-note[data-i="${i}"]`, `.key-strip[data-hand="${h}"] .kb-k[data-m="${m}"]`] });
        t += 0.55;
      });
      t += 0.35;
    }
  } else if (K.tab === 'scale') {
    const run = runNow();
    run.midis.forEach((m, i) => steps.push({ t: i * 0.6, dur: 0.55, midis: [m], sel: [`.kb-note[data-i="${i}"]`, `.kb-k[data-m="${m}"]`, `.seq-f[data-i="${i}"]`] }));
  } else {
    L.chords.forEach((c, i) => steps.push({ t: i * 1.5, dur: 1.3, midis: c.hands[K.hand].midis, sel: [`.key-chord[data-i="${i}"]`, ...c.hands[K.hand].midis.map((m) => `.key-chord[data-i="${i}"] .kb-k[data-m="${m}"]`)] }));
  }
  return steps;
}

async function startDemo() {
  stopVoice();
  const steps = demoSteps();
  const d = { timers: [], handle: null };
  K.demo = d;
  renderFoot();
  try {
    await audio.ensureContext();
  } catch {
    /* play silently: the keys still light up */
  }
  if (K.demo !== d) return;
  // (playNotes starts its first note 0.1 s after the call: the lights follow the sound)
  const lead = 0.15;
  if (audio.ctx && typeof audio.playNotes === 'function') {
    const notes = steps.flatMap((s) => s.midis.map((midi) => ({ midi, time: lead + s.t, dur: s.dur, vel: 0.72 })));
    d.handle = audio.playNotes(notes);
  }
  const sound = 0.1 + lead;
  steps.forEach((s) => d.timers.push(setTimeout(() => K.demo === d && light(s), (sound + s.t) * 1000)));
  const end = steps[steps.length - 1];
  d.timers.push(setTimeout(() => K.demo === d && stopDemo(), (sound + end.t + end.dur + 0.7) * 1000));
}

// ---- opening the screen -------------------------------------------------------------------------
// act: { key: {f, m}, level } from the coach (a lesson that is due), or the Keys section
// (library: true, free practice, any key).
export function showKeyLesson(act) {
  const level = act.level ?? coach.level;
  const lesson = keyLesson(act.key, { level: act.library ? 99 : level });
  const hand = lesson.hands[0];
  K = { spec: act.key, lesson, level, library: !!act.library, tab: 'position', hand, dir: 'up', demo: null };
  const scr = $('#screen-key');
  scr.setAttribute('style', act.library ? '' : STAGE_VARS[stageOf(level)]);
  $('#key-stage').textContent = act.library ? 'Keys' : `New key · Level ${level}`;
  $('#key-stage').classList.toggle('hidden', false);
  $('#key-coin').innerHTML = `<span>${esc(lesson.tonic)}</span>`;
  $('#key-eyebrow').textContent = act.library ? 'Key lesson' : 'Meet a new key';
  $('#key-title').textContent = lesson.name;
  $('#key-sub').textContent = lesson.signature.text;
  $('#key-facts').innerHTML = [
    [icon('note', 18), lesson.signature.count ? `${lesson.signature.count} ${lesson.signature.kind}${lesson.signature.count > 1 ? 's' : ''}` : 'No sharps or flats'],
    [icon('levels', 18), `Relative ${lesson.minor ? 'major' : 'minor'}: ${lesson.relative}`],
  ].map(([ic, t]) => `<span class="fact-chip">${ic}${esc(t)}</span>`).join('');
  $('#btn-key-back').innerHTML = icon('back', 22);
  render();
  show('key');
  rise([$('#key-stage'), ...$$('#key-facts .fact-chip')], { delay: 60, step: 40, y: 8 });
  rise([$('.key-head'), $('#key-tabs'), $('.key-card'), $('.key-foot')], { delay: 140, step: 70 });
  popIn($('#key-line'), { delay: 500, dur: 320, from: 0.85 });
  pipSays();
}
app.showKeyLesson = showKeyLesson;

// ---- events ---------------------------------------------------------------------------------------
function setTab(tab) {
  if (!K || K.tab === tab) return;
  K.tab = tab;
  render();
  pipSays();
}
$('#key-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  sfx('select');
  setTab(b.dataset.tab);
});
$('#key-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hand],[data-dir]');
  if (!b || !K) return;
  sfx('select');
  if (b.dataset.hand) K.hand = b.dataset.hand;
  if (b.dataset.dir) K.dir = b.dataset.dir;
  render();
  if (K.tab === 'scale') pipSays();
});
$('#btn-key-hear').addEventListener('click', () => {
  if (!K) return;
  sfx('tap');
  if (K.demo) stopDemo();
  else startDemo();
});
$('#btn-key-next').addEventListener('click', () => {
  if (!K) return;
  sfx('tap');
  const i = TABS.findIndex(([id]) => id === K.tab);
  if (i < TABS.length - 1) return setTab(TABS[i + 1][0]);
  const { spec, level, library } = K;
  stopDemo();
  coach.keyLessonDone(spec, { practice: true, level, free: library });
  app.withListening(() => app.runActivity(coach.nextActivity()));
});
$('#btn-key-skip').addEventListener('click', () => {
  if (!K) return;
  sfx('tap');
  const { spec, library } = K;
  stopDemo();
  if (library) return show('practice');
  coach.keyLessonDone(spec, { practice: false });
  app.runActivity(coach.nextActivity());
});
$('#btn-key-back').addEventListener('click', () => {
  if (!K) return;
  sfx('tap');
  stopDemo();
  show(K.library ? 'practice' : 'home');
});

screen('key', {
  leave() {
    stopDemo();
    stopVoice();
  },
});
