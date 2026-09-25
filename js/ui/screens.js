// Home (learning path + today), level intro, lesson map, practice, progress and settings.
import { $, $$, S, app, audio, coach, esc, screen, show, say, sfx, toast } from './core.js';
import { levelInfo, LEVELS, STAGES } from '../music/curriculum.js';
import { songsForLevel } from '../music/songs.js';

const STAGE_ICONS = ['🌱', '🎵', '🎹', '🎼', '👑'];

function ring(pct, label) {
  const r = 34,
    c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 80 80" aria-label="${esc(label)}"><circle cx="40" cy="40" r="${r}" class="ring-bg"/><circle cx="40" cy="40" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, pct))}"/></svg>`;
}

// ---- home ---------------------------------------------------------------------------------
function renderHome() {
  const sm = coach.summary();
  const lv = levelInfo(coach.level);
  const placed = coach.s.placed;
  const stageIdx = STAGES.findIndex((s) => lv.n >= s.from && lv.n <= s.to);
  const st = STAGES[stageIdx];
  $('#home-greeting').textContent = placed ? greeting() : 'Welcome to Maestro';
  $('#home-sub').textContent = placed ? `Level ${lv.n} · ${lv.stage}` : 'Your piano coach listens as you play.';
  // Path of the current stage
  const nodes = LEVELS.filter((l) => l.n >= st.from && l.n <= st.to)
    .map((l, i) => {
      const state = !placed ? 'locked' : l.n < coach.level ? 'done' : l.n === coach.level ? 'current' : 'locked';
      const off = [0, 1, 2, 1, 0, -1, -2, -1][i % 8];
      return `<button class="node ${state}" data-level="${l.n}" style="--off:${off};--i:${i}" aria-label="Level ${l.n}: ${esc(l.title)}">
        <span class="node-disc">${state === 'done' ? '✓' : state === 'current' ? '★' : l.n}</span>
        ${state === 'current' ? `<span class="node-label">${esc(l.title)}</span>` : ''}
      </button>`;
    })
    .join('');
  $('#path-stage').innerHTML = `<span class="stage-icon">${STAGE_ICONS[stageIdx]}</span><div><small>Stage ${stageIdx + 1} of 5</small><b>${esc(st.name)}</b></div>`;
  $('#path-nodes').innerHTML = nodes;
  $('#path-stages').innerHTML = STAGES.map((s, i) => `<i class="${i < stageIdx ? 'done' : i === stageIdx ? 'current' : ''}" title="${esc(s.name)}"></i>`).join('');
  // Today card
  $('#today-level').innerHTML = placed
    ? `<small>Up next</small><b>${esc(lv.title)}</b><div class="mastery"><div class="bar"><i style="width:${sm.mastery}%"></i></div><span>${sm.mastery}% mastered</span></div>`
    : `<small>First step</small><b>Find your level</b><p>A few short pieces for both hands. They adapt to you.</p>`;
  $('#btn-start').textContent = placed ? 'Continue' : 'Start';
  $('#today-goal').innerHTML = `${ring(sm.todayXp / sm.dailyGoal, 'daily goal')}<div><b>${sm.todayXp}/${sm.dailyGoal} XP</b><small>daily goal</small></div>`;
  $('#today-streak').innerHTML = `<span class="flame ${sm.streak ? 'lit' : ''}">🔥</span><div><b>${sm.streak}</b><small>day streak</small></div>`;
  // Songs you can play now
  const songs = placed ? songsForLevel(coach.level).slice(0, 4) : [];
  $('#home-songs').innerHTML = songs.length
    ? songs.map((s) => `<button class="mini-song" data-song="${esc(s.id)}"><b>${esc(s.title)}</b><small>${esc(s.composer)}</small></button>`).join('')
    : '';
  $('#home-songs-wrap').classList.toggle('hidden', !songs.length);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

screen('home', { enter: renderHome });

$('#btn-start').addEventListener('click', () => {
  sfx('tap');
  if (!coach.s.placed) app.startPlacementFlow();
  else app.withListening(() => app.runActivity(coach.nextActivity()));
});
$('#path-nodes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const n = +b.dataset.level;
  sfx('tap');
  if (!coach.s.placed) return app.startPlacementFlow();
  if (n === coach.level) app.withListening(() => app.runActivity(coach.nextActivity()));
  else show('map');
});
$('#home-songs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-song]');
  if (!b) return;
  show('songs');
  S.openSong(b.dataset.song);
});

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (!go) return;
  const where = go.dataset.go;
  sfx('tap');
  if (where === 'free') app.startFreePlay();
  else if (where === 'placement') app.startPlacementFlow();
  else {
    app.stopPlay();
    show(where);
  }
});

// ---- level intro --------------------------------------------------------------------------
export function showIntro(level) {
  const lv = levelInfo(level);
  $('#intro-stage').textContent = `Level ${lv.n} · ${lv.stage}`;
  $('#intro-title').textContent = lv.title;
  $('#intro-concept').textContent = lv.concept;
  $('#intro-tips').innerHTML = lv.tips.map((t) => `<li>${esc(t)}</li>`).join('');
  $('#btn-intro-go').onclick = () => {
    sfx('tap');
    coach.markIntroSeen(level);
    app.runActivity(coach.nextActivity());
  };
  show('intro');
  say(`Level ${lv.n}: ${lv.title}. ${lv.concept}`);
}
app.showIntro = showIntro;

// ---- level map ----------------------------------------------------------------------------
screen('map', {
  enter() {
    $('#map-list').innerHTML = STAGES.map((st, si) => {
      const items = LEVELS.filter((l) => l.n >= st.from && l.n <= st.to)
        .map((l) => {
          const cls = l.n === coach.level ? 'current' : l.n > coach.level ? 'locked' : 'done';
          const m = l.n < coach.level ? 100 : l.n === coach.level ? coach.mastery() : 0;
          return `<button class="lvl ${cls}" data-level="${l.n}"><span class="n">LEVEL ${l.n}${l.n < coach.level ? ' · ✓' : l.n === coach.level ? ' · YOU ARE HERE' : ''}</span><b>${esc(l.title)}</b><div class="bar"><i style="width:${m}%"></i></div></button>`;
        })
        .join('');
      return `<div class="map-stage"><h3>${STAGE_ICONS[si]} ${esc(st.name)} <small>Levels ${st.from}–${st.to}</small></h3><div class="map-grid">${items}</div></div>`;
    }).join('');
  },
});
$('#map-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const n = +b.dataset.level;
  sfx('tap');
  app.withListening(() => {
    if (n === coach.level && coach.s.placed) app.runActivity(coach.nextActivity());
    else {
      if (n > coach.level) toast(`Level ${n} is ahead of you. Practising it won't change your lesson level.`, 3500);
      app.runActivity({ kind: 'sight', level: n, mode: 'tempo', tempoFactor: coach.tempoFactor(n), free: true, label: `Practice: Level ${n}` });
    }
  });
});

// ---- practice -----------------------------------------------------------------------------
const PR = { kind: 'sight', mode: 'tempo' };
screen('practice', {
  enter() {
    const lvl = $('#pr-level');
    if (!lvl._init) {
      lvl.value = coach.level;
      $('#pr-tempo').value = Math.round(coach.tempoFactor() * 100);
      lvl._init = true;
    }
    updatePracticeLabels();
  },
});
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
    sfx('tap');
    for (const x of $(id).querySelectorAll('button')) x.classList.toggle('on', x === b);
    PR[id === '#pr-kind' ? 'kind' : 'mode'] = b.dataset.v;
  });
}
$('#pr-level').addEventListener('input', updatePracticeLabels);
$('#pr-tempo').addEventListener('input', updatePracticeLabels);
$('#btn-pr-go').addEventListener('click', () => {
  const level = +$('#pr-level').value;
  sfx('tap');
  app.withListening(() =>
    app.runActivity({ kind: PR.kind, level, mode: PR.kind === 'notes' ? 'wait' : PR.mode, tempoFactor: +$('#pr-tempo').value / 100, free: true, label: `Practice: ${PR.kind === 'sight' ? 'sight-reading' : PR.kind}` }),
  );
});

// ---- progress -----------------------------------------------------------------------------
function fmtTime(sec) {
  const h = Math.floor(sec / 3600),
    m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
screen('progress', {
  enter() {
    const sm = coach.summary();
    const cents = audio.tuningCents;
    const cards = [
      ['Level', `${sm.level}`, sm.info.title],
      ['Mastery', `${sm.mastery}%`, `of level ${sm.level}`],
      ['Stage', sm.info.stage, `${Math.round((100 * (sm.level - 1)) / 39)}% of the way to Master`],
      ['Avg. score', sm.avg ? `${sm.avg}%` : '–', 'last 20 exercises'],
      ['Practice time', fmtTime(sm.stats.seconds), 'total'],
      ['Total XP', `${sm.xp}`, `${sm.todayXp} today`],
      ['Notes played', `${sm.stats.notes}`, 'correctly'],
      ['Streak', `${sm.streak} day${sm.streak === 1 ? '' : 's'}`, audio.micOn ? `piano tuning ${cents >= 0 ? '+' : ''}${Math.round(cents)}¢` : 'practice daily!'],
    ];
    $('#stats-grid').innerHTML = cards.map(([k, v, s], i) => `<div class="stat" style="--i:${i}"><small>${k}</small><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');
    requestAnimationFrame(() => drawHistory(sm.history.filter((h) => !h.placement).slice(-60)));
  },
});

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
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--muted').trim() || '#9aa3c2';
  const padL = 34,
    padB = 18,
    padT = 8;
  const ph = h - padB - padT;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.strokeStyle = 'rgba(128,128,160,0.18)';
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
    ctx.fillStyle = e.score >= 85 ? '#1fbf6a' : e.score >= 60 ? css.getPropertyValue('--accent').trim() || '#3b8cff' : '#ef476f';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padT + ph - bh, bw, Math.max(2, bh), [3, 3, 0, 0]);
    else ctx.rect(x, padT + ph - bh, bw, Math.max(2, bh));
    ctx.fill();
  });
}

// ---- settings -----------------------------------------------------------------------------
screen('settings', {
  enter() {
    for (const el of $$('#screen-settings [data-set]')) {
      const k = el.dataset.set;
      const v = coach.settings[k];
      if (el.type === 'checkbox') el.checked = v !== false && !!v;
      else el.value = String(v);
    }
    updateSettingLabels();
    $('#set-info').textContent = `Input: ${audio.micOn ? 'microphone' : 'not started'}${audio.midiOn ? ' + MIDI' : ''} · sample rate ${audio.ctx ? audio.ctx.sampleRate : '–'} Hz`;
  },
});
function updateSettingLabels() {
  $('#set-sens-val').textContent = `${(+coach.settings.sensitivity).toFixed(1)}×`;
  $('#set-lat-val').textContent = `${coach.settings.latencyMs} ms`;
  $('#set-look-val').textContent = `${coach.settings.lookaheadSec} s`;
}
$('#screen-settings').addEventListener('input', (e) => {
  const k = e.target.dataset.set;
  if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (e.target.type === 'range' || k === 'dailyGoal') v = +v;
  if (k === 'showNames' || k === 'noteColors') v = v === 'auto' ? 'auto' : v === 'true';
  coach.setSetting(k, v);
  if (k === 'sensitivity') audio.setSensitivity(v);
  if (k === 'noisyRoom' && typeof audio.setNoisyRoom === 'function') audio.setNoisyRoom(v);
  if (k === 'voice' && v) say('Voice coach on.');
  updateSettingLabels();
});
$('#btn-recal').addEventListener('click', () => {
  coach.s.micChecked = false;
  coach.save();
  S.pendingAfterSetup = () => show('settings');
  app.openSetup();
});
$('#btn-reset').addEventListener('click', () => {
  if (confirm('Reset all progress and start over with a new placement test?')) {
    coach.reset();
    toast('Progress reset.');
    show('home');
  }
});
