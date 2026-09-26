// Song library: free public-domain songs with graded arrangements, plus MIDI import. Covers draw
// each song's opening melody as a little bar graph (time across, pitch up).
import { $, $$, S, app, coach, esc, screen, sfx, toast, rise, openOverlay, closeOverlay, fillRange } from './core.js';
import { SONGS, CATEGORIES, FREE_SOURCES, songPiece, songsForLevel } from '../music/songs.js';
import { midiToPiece } from '../music/midi.js';
import { levelInfo, STAGES } from '../music/curriculum.js';
import { icon, pip } from './brand.js';

const F = { category: 'All', playable: false, query: '' };
const CAT_COLORS = {
  'Kids & folk': ['#20C07A', '#12985C'],
  Holiday: ['#E8484F', '#B8303A'],
  'Hymns & ballads': ['#14B8A6', '#0B8C7E'],
  Classical: ['#6F4BF2', '#4F30C9'],
  'Ragtime & blues': ['#FF9A2E', '#D9760C'],
};
const catColor = (c) => CAT_COLORS[c] || ['#6F4BF2', '#4F30C9'];

// ---- covers: the opening melody as rounded bars ---------------------------------------------
const COVERS = new Map();
function melody(song) {
  try {
    const arr = song.arrangements[0];
    const piece = songPiece(song.id, arr.id, { hands: 'R' });
    const notes = piece.notes.filter((n) => n.hand !== 'L').sort((a, b) => a.beat - b.beat || b.midi - a.midi);
    const out = [];
    let lastBeat = -1;
    for (const n of notes) {
      if (n.beat === lastBeat) continue; // top note of a chord
      lastBeat = n.beat;
      out.push(n);
      if (out.length >= 14 || n.beat - notes[0].beat > 11) break;
    }
    return out;
  } catch {
    return [];
  }
}
export function cover(song, w = 220, h = 100) {
  const key = `${song.id}:${w}x${h}`;
  if (COVERS.has(key)) return COVERS.get(key);
  const [c1, c2] = catColor(song.category);
  const notes = melody(song);
  let bars = '';
  if (notes.length) {
    const b0 = notes[0].beat;
    const b1 = Math.max(...notes.map((n) => n.beat + n.dur));
    const lo = Math.min(...notes.map((n) => n.midi));
    const hi = Math.max(lo + 7, ...notes.map((n) => n.midi));
    const sx = (w - 28) / Math.max(1, b1 - b0);
    const y = (m) => h - 20 - ((m - lo) / (hi - lo)) * (h - 44);
    bars = notes
      .map((n) => {
        const x = 14 + (n.beat - b0) * sx;
        const bw = Math.max(9, n.dur * sx - 4);
        return `<rect x="${x.toFixed(1)}" y="${(y(n.midi) - 5).toFixed(1)}" width="${bw.toFixed(1)}" height="10" rx="5" fill="#fff" opacity=".95"/>`;
      })
      .join('');
  }
  const lines = [0, 1, 2, 3, 4].map((i) => `<rect x="0" y="${(24 + i * 13).toFixed(0)}" width="${w}" height="1.5" fill="#fff" opacity=".13"/>`).join('');
  const svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="cg-${song.id}-${w}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#cg-${song.id}-${w})"/><circle cx="${w * 0.84}" cy="${h * 0.1}" r="${h * 0.62}" fill="#fff" opacity=".08"/>${lines}${bars}</svg>`;
  COVERS.set(key, svg);
  return svg;
}

function starsHtml(n, size = 16) {
  return `<span class="mini-stars">${[0, 1, 2].map((i) => icon(i < n ? 'star' : 'starOff', size)).join('')}</span>`;
}

function bestFor(song) {
  let best = 0;
  for (const a of song.arrangements) {
    const r = coach.songRecord(song.id, a.id);
    if (r) best = Math.max(best, r.stars);
  }
  return best;
}

function card(s, i, lvl) {
  const levels = [...new Set(s.arrangements.map((a) => a.level))].sort((a, b) => a - b);
  const chips = levels.map((n) => `<span class="lv ${n <= lvl ? 'ok' : n <= lvl + 4 ? 'soon' : 'later'}">${n}</span>`).join('');
  const easiest = levels[0];
  const got = bestFor(s);
  const foot = easiest <= lvl + 1 ? `<span class="play-ic">${icon('play', 16)}</span>` : `<span class="soon-txt">${easiest <= lvl + 4 ? 'Almost!' : 'Challenge'}</span>`;
  return `<button class="song" data-song="${esc(s.id)}" style="--i:${Math.min(i, 12)}">
    <div class="cover">${cover(s)}<span class="cat">${esc(s.category)}</span>${got ? `<span class="got">${starsHtml(got)}</span>` : ''}</div>
    <div class="info"><h3>${esc(s.title)}</h3><p class="by">${esc(s.composer)}${s.year ? ` · ${s.year}` : ''}</p>
      <div class="foot"><span class="lvs"><small>Lv</small>${chips}</span>${foot}</div></div>
  </button>`;
}

// justOn: the chip that was just picked (it pops); animate: 'enter' | 'filter' | false.
function render({ justOn = null, animate = false } = {}) {
  const lvl = coach.s.placed ? coach.level : 1;
  const count = (c) => (c === 'All' ? SONGS.length : SONGS.filter((s) => s.category === c).length);
  const on = (key, cond) => (cond ? ` on${justOn === key ? ' just-on' : ''}` : '');
  $('#song-cats').innerHTML =
    ['All', ...CATEGORIES].map((c) => `<button class="chip${on(c, F.category === c)}" data-cat="${esc(c)}" aria-pressed="${F.category === c}">${esc(c)} <span class="count">${count(c)}</span></button>`).join('') +
    `<button class="chip${on('near', F.playable)}" data-playable="1" aria-pressed="${F.playable}">${icon('target', 18)} Near Level ${lvl}</button>`;
  const q = F.query.trim().toLowerCase();
  const list = SONGS.filter((s) => (F.category === 'All' || s.category === F.category) && (!F.playable || s.arrangements[0].level <= lvl + 1) && (!q || `${s.title} ${s.composer}`.toLowerCase().includes(q)));
  list.sort((a, b) => a.arrangements[0].level - b.arrangements[0].level || a.title.localeCompare(b.title));
  $('#song-grid').innerHTML = list.length
    ? list.map((s, i) => card(s, i, lvl)).join('')
    : `<div class="empty-state">${pip('think', 96)}<div class="bubble tail-left">No songs match that. Try another word, or import a MIDI file!</div></div>`;
  // Pip's pick: the best match for the current level.
  const pickEl = $('#song-pick');
  const pick = coach.s.placed && F.category === 'All' && !q ? songsForLevel(coach.level)[0] : null;
  pickEl.classList.toggle('hidden', !pick);
  if (pick) {
    const a = pick.recommended;
    pickEl.innerHTML = `<div class="art">${cover(pick, 150, 96)}</div>
      <div><div class="eyebrow">Pip's pick for Level ${coach.level}</div><h2>${esc(pick.title)}</h2><p>${esc(pick.composer.replace(/\s*\(.*\)\s*$/, ''))} · ${esc(a.name)} · Level ${a.level}</p></div>
      <button class="btn btn-white btn-lg" data-pick-play="${esc(pick.id)}" data-arr="${esc(a.id)}">${icon('play', 22)} Play</button>
      ${pip('conduct', 118)}`;
    pickEl.dataset.song = pick.id;
  }
  $('#free-sources').innerHTML = FREE_SOURCES.map(
    (f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a> <small>${esc(f.description)}${f.midi ? ' · MIDI you can import' : ''}</small></li>`,
  ).join('');
  // Entrance: header, chips and Pip's pick, then the first cards in reading order (the rest as
  // a group). A filter change only fades the new cards up, quickly.
  const cards = $$('#song-grid > *');
  if (animate === 'enter') {
    rise([$('#screen-songs .page-head'), $('#song-cats'), pick ? pickEl : null], { delay: 40, step: 50, y: 8 });
    rise(cards, { delay: 160, step: 40, max: 8 });
  } else if (animate === 'filter') rise(cards, { delay: 0, step: 25, max: 8, y: 8, dur: 260 });
}

screen('songs', {
  enter() {
    const txt = coach.s.placed ? `Level ${coach.level}` : 'Not placed yet';
    for (const el of $$('.rail-level')) el.textContent = txt;
    render({ animate: 'enter' });
  },
  leave() {
    $('#song-sheet').classList.add('hidden');
  },
});

$('#song-cats').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  sfx('select');
  if (b.dataset.playable) F.playable = !F.playable;
  else F.category = b.dataset.cat;
  render({ justOn: b.dataset.playable ? 'near' : b.dataset.cat, animate: 'filter' });
});
$('#song-search').addEventListener('input', (e) => {
  F.query = e.target.value;
  render();
});
$('#song-pick').addEventListener('click', (e) => {
  const play = e.target.closest('[data-pick-play]');
  sfx('tap');
  if (play) {
    const song = SONGS.find((s) => s.id === play.dataset.pickPlay);
    const arr = song && song.arrangements.find((a) => a.id === play.dataset.arr);
    if (song && arr) return launch(song, arr, 'both', coach.level <= 8 ? 0.8 : 1, 'tempo');
  }
  if ($('#song-pick').dataset.song) openSong($('#song-pick').dataset.song);
});

// ---- song detail sheet --------------------------------------------------------------------
const D = { song: null, arr: null, hands: 'both', tempo: 1 };

function openSong(id) {
  const song = SONGS.find((s) => s.id === id);
  if (!song) return;
  D.song = song;
  // Suggest the hardest arrangement at or just above the student's level.
  const fit = [...song.arrangements].reverse().find((a) => a.level <= coach.level + 1) || song.arrangements[0];
  D.arr = fit;
  D.hands = 'both';
  D.tempo = coach.level <= 8 ? 0.8 : 1;
  renderSheet();
  openOverlay($('#song-sheet'));
  sfx('tap');
}

const stageVars = (n) => {
  const k = Math.max(0, STAGES.findIndex((st) => n >= st.from && n <= st.to)) + 1;
  return `--sc:var(--stage-${k});--sce:var(--stage-${k}-edge)`;
};
function renderSheet(justOn = null) {
  const s = D.song;
  $('#sheet-cover').innerHTML = cover(s, 140, 90);
  $('#sheet-title').textContent = s.title;
  $('#sheet-composer').textContent = `${s.composer}${s.year ? ` · ${s.year}` : ''} · ${s.category}`;
  $('#sheet-about').textContent = s.about || '';
  $('#sheet-arrs').innerHTML = s.arrangements
    .map((a) => {
      const r = coach.songRecord(s.id, a.id);
      const lv = levelInfo(a.level);
      const best = r ? `<span class="arr-best">${starsHtml(r.stars, 20)}<span>Best ${r.best}%</span></span>` : '';
      return `<button class="arr${a === D.arr ? ` on${justOn === a.id ? ' just-on' : ''}` : ''}" data-arr="${esc(a.id)}" aria-pressed="${a === D.arr}"><span class="arr-lv" style="${stageVars(a.level)}">${a.level}</span><b>${esc(a.name)}</b><small>Level ${a.level} · ${esc(lv.stage)} · ${esc(a.key.name)} · ${a.time}</small>${best}</button>`;
    })
    .join('');
  const both = D.arr.hands === 'both';
  $('#sheet-hands').innerHTML = both
    ? ['both', 'R', 'L'].map((h) => `<button class="chip${D.hands === h ? ` on${justOn === h ? ' just-on' : ''}` : ''}" data-hands="${h}" aria-pressed="${D.hands === h}">${{ both: 'Both hands', R: 'Right hand', L: 'Left hand' }[h]}</button>`).join('')
    : '';
  $('#sheet-tempo').value = String(Math.round(D.tempo * 100));
  fillRange($('#sheet-tempo'));
  $('#sheet-tempo-val').textContent = `${Math.round(D.arr.bpm * D.tempo)} bpm (${Math.round(D.tempo * 100)}%)`;
  $('#sheet-license').textContent = s.license || '';
  $('#sheet-play').innerHTML = `${icon('play', 22)} Play`;
}

$('#song-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-song]');
  if (b) openSong(b.dataset.song);
});
$('#sheet-arrs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-arr]');
  if (!b) return;
  D.arr = D.song.arrangements.find((a) => a.id === b.dataset.arr);
  if (D.arr.hands !== 'both') D.hands = 'both';
  sfx('select');
  renderSheet(D.arr.id);
});
$('#sheet-hands').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hands]');
  if (!b) return;
  D.hands = b.dataset.hands;
  sfx('select');
  renderSheet(D.hands);
});
$('#sheet-tempo').addEventListener('input', (e) => {
  D.tempo = +e.target.value / 100;
  $('#sheet-tempo-val').textContent = `${Math.round(D.arr.bpm * D.tempo)} bpm (${Math.round(D.tempo * 100)}%)`;
});
$('#sheet-close').addEventListener('click', () => {
  sfx('tap');
  closeOverlay($('#song-sheet'));
});
$('#song-sheet').addEventListener('click', (e) => {
  if (e.target.id === 'song-sheet') closeOverlay($('#song-sheet'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.screen === 'songs') closeOverlay($('#song-sheet'));
});
function launch(s, a, hands, tempo, mode) {
  closeOverlay($('#song-sheet'));
  app.withListening(() => app.runActivity({ kind: 'song', songId: s.id, arrangementId: a.id, hands, tempoScale: tempo, level: a.level, mode, free: true, label: s.title }));
}
$('#sheet-play').addEventListener('click', () => launch(D.song, D.arr, D.hands, D.tempo, 'tempo'));
$('#sheet-learn').addEventListener('click', () => launch(D.song, D.arr, D.hands, D.tempo, 'wait'));

// ---- MIDI import --------------------------------------------------------------------------
$('#btn-import').addEventListener('click', () => $('#midi-file').click());
$('#midi-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const piece = midiToPiece(await file.arrayBuffer(), { title: file.name.replace(/\.midi?$/i, '') });
    toast(`Imported "${piece.title}": ${piece.measures} bars, about level ${piece.level}`);
    app.withListening(() => app.runActivity({ kind: 'import', piece, level: piece.level, mode: 'wait', free: true, label: piece.title }));
  } catch (err) {
    console.warn(err);
    toast(err.message || 'That file could not be read as MIDI.');
    sfx('error');
  }
});

export { openSong };
S.openSong = openSong;
