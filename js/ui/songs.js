// Song library: free public-domain songs with graded arrangements, plus MIDI import.
import { $, S, app, coach, esc, screen, show, sfx, toast } from './core.js';
import { SONGS, CATEGORIES, FREE_SOURCES } from '../music/songs.js';
import { midiToPiece } from '../music/midi.js';
import { levelInfo } from '../music/curriculum.js';

const F = { category: 'All', playable: false, query: '' };
const ART = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];

function art(song, i) {
  // A simple generated cover: two colours from the title + a note glyph.
  let h = 0;
  for (const c of song.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = ART[h % ART.length],
    b = ART[(h >>> 3) % ART.length];
  return `<div class="song-art" style="--a:${a};--b:${b === a ? ART[(h + 3) % ART.length] : b}"><span>${['♪', '♫', '♩', '𝄞'][h % 4]}</span></div>`;
}

function stars(n) {
  return `<span class="mini-stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;
}

function bestFor(song) {
  let best = 0;
  for (const a of song.arrangements) {
    const r = coach.songRecord(song.id, a.id);
    if (r) best = Math.max(best, r.stars);
  }
  return best;
}

function render() {
  const lvl = coach.level;
  $('#song-cats').innerHTML = ['All', ...CATEGORIES]
    .map((c) => `<button class="chip ${F.category === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join('') + `<button class="chip ${F.playable ? 'on' : ''}" data-playable="1">Playable at my level</button>`;
  const q = F.query.trim().toLowerCase();
  const list = SONGS.filter((s) => (F.category === 'All' || s.category === F.category) && (!F.playable || s.arrangements[0].level <= lvl + 1) && (!q || `${s.title} ${s.composer}`.toLowerCase().includes(q)));
  list.sort((a, b) => a.arrangements[0].level - b.arrangements[0].level || a.title.localeCompare(b.title));
  $('#song-grid').innerHTML = list.length
    ? list
        .map((s, i) => {
          const easiest = s.arrangements[0].level;
          const locked = easiest > lvl + 3;
          return `<button class="song-card ${locked ? 'stretch' : ''}" data-song="${esc(s.id)}" style="--i:${Math.min(i, 12)}">
            ${art(s, i)}
            <div class="song-meta"><b>${esc(s.title)}</b><small>${esc(s.composer)}</small>
            <div class="song-tags"><span class="lvl-badge">Lv ${easiest}${s.arrangements.length > 1 ? `–${s.arrangements[s.arrangements.length - 1].level}` : ''}</span>${stars(bestFor(s))}</div></div>
          </button>`;
        })
        .join('')
    : '<p class="empty">No songs match.</p>';
  $('#free-sources').innerHTML = FREE_SOURCES.map(
    (f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a> <small>${esc(f.description)}${f.midi ? ' · MIDI you can import' : ''}</small></li>`,
  ).join('');
}

screen('songs', { enter: render });

$('#song-cats').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  sfx('tap');
  if (b.dataset.playable) F.playable = !F.playable;
  else F.category = b.dataset.cat;
  render();
});
$('#song-search').addEventListener('input', (e) => {
  F.query = e.target.value;
  render();
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
  $('#song-sheet').classList.remove('hidden');
  sfx('open');
}

function renderSheet() {
  const s = D.song;
  $('#sheet-title').textContent = s.title;
  $('#sheet-composer').textContent = `${s.composer}${s.year ? ` · ${s.year}` : ''} · ${s.category}`;
  $('#sheet-about').textContent = s.about || '';
  $('#sheet-arrs').innerHTML = s.arrangements
    .map((a) => {
      const r = coach.songRecord(s.id, a.id);
      const lv = levelInfo(a.level);
      return `<button class="arr ${a === D.arr ? 'on' : ''}" data-arr="${esc(a.id)}"><b>${esc(a.name)}</b><small>Level ${a.level} · ${esc(lv.stage)} · ${esc(a.key.name)} · ${a.time}</small>${r ? stars(r.stars) : ''}</button>`;
    })
    .join('');
  const both = D.arr.hands === 'both';
  $('#sheet-hands').innerHTML = both
    ? ['both', 'R', 'L'].map((h) => `<button class="chip ${D.hands === h ? 'on' : ''}" data-hands="${h}">${{ both: 'Both hands', R: 'Right hand', L: 'Left hand' }[h]}</button>`).join('')
    : '';
  $('#sheet-tempo').value = String(Math.round(D.tempo * 100));
  $('#sheet-tempo-val').textContent = `${Math.round(D.arr.bpm * D.tempo)} bpm (${Math.round(D.tempo * 100)}%)`;
  $('#sheet-license').textContent = s.license || '';
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
  sfx('tap');
  renderSheet();
});
$('#sheet-hands').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hands]');
  if (!b) return;
  D.hands = b.dataset.hands;
  sfx('tap');
  renderSheet();
});
$('#sheet-tempo').addEventListener('input', (e) => {
  D.tempo = +e.target.value / 100;
  $('#sheet-tempo-val').textContent = `${Math.round(D.arr.bpm * D.tempo)} bpm (${Math.round(D.tempo * 100)}%)`;
});
$('#sheet-close').addEventListener('click', () => $('#song-sheet').classList.add('hidden'));
$('#song-sheet').addEventListener('click', (e) => {
  if (e.target.id === 'song-sheet') $('#song-sheet').classList.add('hidden');
});
function startSong(mode) {
  const s = D.song,
    a = D.arr;
  $('#song-sheet').classList.add('hidden');
  app.withListening(() =>
    app.runActivity({ kind: 'song', songId: s.id, arrangementId: a.id, hands: D.hands, tempoScale: D.tempo, level: a.level, mode, free: true, label: s.title }),
  );
}
$('#sheet-play').addEventListener('click', () => startSong('tempo'));
$('#sheet-learn').addEventListener('click', () => startSong('wait'));

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
