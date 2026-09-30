// Teaching a key. The first time a key comes up (C at the start, then G, F, D, B♭ ...) the student
// gets a short lesson: the key signature, the hand position, the scale with its fingering up and
// down (where the thumb tucks under, where a finger crosses over it) and the I-IV-V-I chord
// progression, then a little guided practice. This module builds everything that lesson shows
// and says; js/ui/keylesson.js draws it and js/coach.js decides when it is due.
import { STEP_NAMES, MAJOR_KEYS, MINOR_KEYS, pcName, signature, keyReminder } from './theory.js';
import { LEVELS } from './curriculum.js';
import { scaleFingers, crossings, keyOf } from './fingering.js';
import { tonicIn, chordPcs, chordFingers, progressionVoicings } from './generator.js';

export { keyOf, signature, keyReminder };
export const keyId = (key) => `${key.fifths}${key.mode}`;
export const specOf = (key) => ({ f: key.fifths, m: key.mode });
export const specId = (spec) => `${spec.f}${spec.m}`;

const pcOf = (m) => ((m % 12) + 12) % 12;
const HAND_WORD = { R: 'right', L: 'left' };
const FINGER_WORD = { 1: 'thumb', 2: 'pointer', 3: 'middle finger', 4: 'ring finger', 5: 'pinky' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
// Text-to-speech reads ♯ and ♭ unreliably.
export const spoken = (s) => String(s).replace(/𝄪/g, ' double sharp').replace(/♯/g, ' sharp').replace(/♭/g, ' flat');

// ---- which keys are new at which level ----------------------------------------------------------
// A level introduces the keys in its pool that no earlier level used, focus keys first. Levels
// with many new keys (28 has six) teach the first few; the Keys section of Practice has the rest.
// The same keys on the piano under another name: F♯ and G♭ major, C♯ and D♭, B and C♭ (and the
// same for minors). A key whose twin is already known is not new.
export function twinOf(spec) {
  const f = spec.f > 0 ? spec.f - 12 : spec.f + 12;
  return Math.abs(f) <= 7 ? { f, m: spec.m } : null;
}
let NEW = null;
function newKeys() {
  if (NEW) return NEW;
  const seen = new Set();
  NEW = LEVELS.map((lv) => {
    const focus = (lv.focusKeys || []).map(([f, m]) => `${f}${m}`);
    const rank = (id) => (focus.includes(id) ? focus.indexOf(id) : 100);
    const known = (k) => seen.has(specId(k)) || (twinOf(k) && seen.has(specId(twinOf(k))));
    const fresh = lv.keys.map(([f, m]) => ({ f, m })).filter((k) => !known(k));
    fresh.sort((a, b) => rank(specId(a)) - rank(specId(b)));
    // F♯ and G♭ in the same level: teach the first.
    const out = [];
    for (const k of fresh) if (!out.some((o) => specId(o) === specId(k) || (twinOf(o) && specId(twinOf(o)) === specId(k)))) out.push(k);
    for (const [f, m] of lv.keys) seen.add(`${f}${m}`);
    return out;
  });
  return NEW;
}
export function newKeysAt(level) {
  return (newKeys()[level - 1] || []).map((k) => ({ ...k }));
}
export const MAX_KEYS_PER_LEVEL = 2;
export function keysToTeach(level) {
  return newKeysAt(level).slice(0, MAX_KEYS_PER_LEVEL);
}

// The keys of the Keys section: majors and their relative minors around the circle of fifths.
export function allKeys() {
  const out = [];
  for (const f of [0, 1, 2, 3, 4, 5, 6, -5, -4, -3, -2, -1]) out.push({ major: { f, m: 'major' }, minor: { f, m: 'minor' } });
  return out;
}

// ---- the lesson -------------------------------------------------------------------------------------
// The name of the raised 7th in harmonic minor: the 7th step with its sharpened accidental
// (C♯ in D minor, B♮ in C minor, F𝄪 in G♯ minor).
function raisedSeventh(key) {
  const step = (key.tonicStep + 6) % 7;
  const alt = key.alter[step] + 1;
  const acc = alt === 2 ? '𝄪' : alt === 1 ? '♯' : alt === -1 ? '♭' : alt === 0 ? '♮' : alt === -2 ? '𝄫' : '';
  return `${STEP_NAMES[step]}${acc}`;
}

// One hand's scale, one octave: notes, names, fingers and the moves going up and down.
function scaleFor(key, hand) {
  const tonic = hand === 'R' ? tonicIn(key, 60, 71) : tonicIn(key, 40, 51);
  let up = [];
  for (let d = 0; d <= 7; d++) up.push(key.degreeToMidi(d, tonic));
  const harmonic = key.mode === 'minor';
  if (harmonic) {
    const pcs = key.scalePcs();
    up = up.map((m) => (pcOf(m) === pcs[6] ? m + 1 : m));
  }
  const names = up.map((m, i) => (harmonic && i === 6 ? raisedSeventh(key) : pcName(m, key)));
  const fingers = scaleFingers(key, hand, 1);
  const down = { midis: [...up].reverse(), names: [...names].reverse(), fingers: [...fingers].reverse() };
  down.moves = crossings(down.fingers, hand, 'down');
  return { hand, midis: up, names, fingers, up: { midis: up, names, fingers, moves: crossings(fingers, hand, 'up') }, down };
}

// How one run of a scale goes, in words: "1 2 3, tuck the thumb under to play C, then 1 2 3 4 5".
function runWords(run, hand, dir) {
  const { fingers, names, moves } = run;
  const parts = [];
  const steps = [];
  let from = 0;
  for (const c of moves) {
    const seg = fingers.slice(from, c.at);
    parts.push(seg.join(' '));
    steps.push({ fingers: seg, names: names.slice(from, c.at) });
    from = c.at;
    const move = c.kind === 'under' ? `tuck your thumb under finger ${c.finger} to play ${names[c.at]}` : `cross finger ${c.to} over your thumb to play ${names[c.at]}`;
    parts.push(move);
    steps.push({ move: c.kind, finger: c.finger, to: c.to, text: move });
  }
  parts.push(fingers.slice(from).join(' '));
  steps.push({ fingers: fingers.slice(from), names: names.slice(from) });
  const go = dir === 'up' ? 'Going up' : 'Coming down';
  const first = fingers[0];
  const start = first === 1 ? `Start with your thumb on ${names[0]}` : `Start with finger ${first} on ${names[0]}`;
  const text = `${go}, ${HAND_WORD[hand]} hand. ${start}: ${parts.join(', then ')}.`;
  const sayParts = parts.map((p, i) => (i % 2 === 0 ? `fingers ${p}` : p));
  const say = `${go}, ${HAND_WORD[hand]} hand: ${sayParts.join('. Then ')}.`;
  return { text, say: spoken(say), steps };
}

function chordLabel(pcs, key, rootMidi) {
  const third = (pcs[1] - pcs[0] + 12) % 12;
  const fifth = (pcs[2] - pcs[0] + 12) % 12;
  return `${pcName(rootMidi, key)}${fifth === 6 ? '°' : third === 3 ? 'm' : ''}`;
}
const INVERSION = ['root position', 'first inversion', 'second inversion'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// The I-IV-V-I progression of a key, as each hand plays it (the same voicings as the chord
// warm-up).
function chordsFor(key) {
  const prog = [0, 3, 4, 0];
  const vo = { R: progressionVoicings(key, prog, 'R'), L: progressionVoicings(key, prog, 'L') };
  return prog.map((deg, i) => {
    const pcs = chordPcs(key, deg);
    const minor = key.mode === 'minor';
    const roman = minor && deg !== 4 ? ROMAN[deg].toLowerCase() : ROMAN[deg];
    const hands = {};
    for (const h of ['R', 'L']) {
      const v = vo[h][i];
      hands[h] = { midis: v, names: v.map((m) => pcName(m, key)), fingers: chordFingers(v, h), inversion: INVERSION[pcs.indexOf(pcOf(v[0]))] || '' };
    }
    const root = hands.L.midis.find((m) => pcOf(m) === pcs[0]);
    const name = chordLabel(pcs, key, root);
    const last = i === prog.length - 1;
    return { degree: deg, roman, name, pcs, hands, last };
  });
}

// Everything the key lesson shows and says. `level` decides which hands are shown (level 1 only
// has the right hand).
export function keyLesson(spec, { level = 99 } = {}) {
  const key = keyOf(spec);
  const tonic = key.name.split(' ')[0];
  const sig = signature(key);
  const minor = key.mode === 'minor';
  const hands = level <= 2 ? ['R'] : ['R', 'L'];
  const scale = { R: scaleFor(key, 'R'), L: scaleFor(key, 'L') };
  for (const h of ['R', 'L']) {
    scale[h].up.words = runWords(scale[h].up, h, 'up');
    scale[h].down.words = runWords(scale[h].down, h, 'down');
  }
  // The five-finger position: the tonic under the thumb (right) or pinky (left), one finger a key.
  const position = {};
  for (const h of ['R', 'L']) {
    const lo = h === 'R' ? tonicIn(key, 60, 71) : tonicIn(key, 41, 52);
    const midis = [];
    for (let d = 0; d < 5; d++) midis.push(key.degreeToMidi(d, key.tonicNear(lo)));
    const names = midis.map((m) => pcName(m, key));
    const fingers = h === 'R' ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1];
    const f1 = fingers[0];
    const text = `${cap(HAND_WORD[h])} hand: ${FINGER_WORD[f1]} (${f1}) on ${names[0]}, then one finger on each key up to ${names[4]}: ${names.join(' ')}.`;
    position[h] = { lo, midis, names, fingers, text, say: spoken(`${cap(HAND_WORD[h])} ${FINGER_WORD[f1]} on ${names[0]}, then one finger on each key up to ${names[4]}.`) };
  }
  const chords = chordsFor(key);
  const progText = chords.map((c) => c.name).join(', ');
  const home = minor ? `${tonic} is the home note, where every ${tonic} minor tune comes to rest.` : `${tonic} is the home note, where every tune in ${tonic} comes to rest.`;
  const twin = twinOf(specOf(key));
  const twinNote = twin ? ` ${key.name} and ${keyOf(twin).name} are the same keys on the piano, written differently.` : '';
  const intro = {
    text: `${key.name}: ${sig.text}. ${home}${minor ? ` Its relative major, ${MAJOR_KEYS[key.fifths]} major, has the same signature.` : ''}${twinNote}`,
    say: spoken(`${key.name}. ${sig.count ? `It has ${sig.text.split(':')[0].toLowerCase()}: ${list(sig.notes)}.` : 'No sharps or flats.'} ${tonic} is home.`),
  };
  const fifthNote = position.R.names[4];
  return {
    id: keyId(key), key, spec: specOf(key), name: key.name, tonic, signature: sig, minor, hands, intro, scale, position, chords,
    scaleName: `${tonic} ${minor ? 'harmonic minor' : 'major'} scale`,
    scaleNote: minor ? `The seventh note is raised (${raisedSeventh(key)}): that is what makes it harmonic minor.` : '',
    chordNote: `The I, IV and V chords of ${key.name}: ${progText}. They are built on the 1st, 4th and 5th notes of the scale, and nearly every song in the key is made from them.`,
    chordSay: spoken(`${key.name} has three main chords: ${chords.slice(0, 3).map((c) => c.name).join(', ')}. Play them one after another, then come home to ${chords[0].name}.`),
    positionSay: spoken(`${position.R.say} That is five fingers on ${position.R.names[0]} to ${fifthNote}.`),
    relative: minor ? `${MAJOR_KEYS[key.fifths]} major` : `${MINOR_KEYS[key.fifths]} minor`,
  };
}

// ---- guided practice after the lesson -----------------------------------------------------------
// The activities of a key's practice flow: [{ kind, key, hand?, prog?, label, coachLine, tip }].
// The first levels only have a five-finger position to practise; from level 8 the student plays
// the scale with each hand, then the I-IV-V-I chords. `full` (the Keys section) always gives
// the scale and chords.
export function keyFlowSteps(level, spec, { full = false } = {}) {
  const key = keyOf(spec);
  const k = specOf(key);
  const lesson = keyLesson(spec, { level });
  const name = key.name;
  if (level < 8 && !full) {
    return [{ kind: 'fivefinger', key: k, label: `${name}: five-finger position`, coachLine: `Let's try ${name} in your hands.`, tip: lesson.position.R.text }];
  }
  const steps = [];
  for (const h of ['R', 'L']) {
    steps.push({
      kind: 'scale', key: k, hand: h, harmonic: true, label: `${name} scale: ${HAND_WORD[h]} hand`, coachLine: `The ${lesson.scaleName}, ${HAND_WORD[h]} hand, one note at a time: up, then back down.`,
      tip: `Fingers up: ${lesson.scale[h].up.fingers.join(' ')}. Coming down: ${lesson.scale[h].down.fingers.join(' ')}.`,
    });
  }
  steps.push({ kind: 'chords', key: k, prog: [0, 3, 4, 0], label: `${name} chords: ${lesson.chords.map((c) => c.roman).join(' ')}`, coachLine: `The three main chords of ${name}, then home again.`, tip: lesson.chordNote });
  return steps;
}
