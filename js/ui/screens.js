// Navigation rail, Home (learning path + today), level intro, lesson map, practice, progress and
// settings.
import { $, $$, S, app, audio, coach, esc, screen, show, say, showLine, sfx, toast, unlockVoice, getVoice, voiceReady } from './core.js';
import { icon, pip, pipFace, wordmark } from './brand.js';
import { levelInfo, LEVELS, STAGES } from '../music/curriculum.js';

const STAGE_VARS = STAGES.map((_, i) => `--sc:var(--stage-${i + 1});--sce:var(--stage-${i + 1}-edge)`);
const stageOf = (n) => Math.max(0, STAGES.findIndex((s) => n >= s.from && n <= s.to));

// Wake the audio context and speech on the first touch so UI sounds and Pip's voice work.
document.addEventListener(
  'pointerdown',
  () => {
    unlockVoice();
    audio.ensureContext().catch(() => {});
  },
  { once: true, capture: true },
);

// ---- navigation rail ------------------------------------------------------------------------
const NAV = [
  ['home', 'Learn', 'home'],
  ['songs', 'Songs', 'note'],
  ['practice', 'Practice', 'target'],
  ['free', 'Free play', 'pianokeys'],
  ['progress', 'Progress', 'chart'],
];
function railHtml(active) {
  const item = ([id, label, ic]) =>
    `<button class="nav${id === active ? ' on' : ''}" data-go="${id}"${id === active ? ' aria-current="page"' : ''}><span class="tile t-${id}">${icon(ic, 24)}</span><span>${label}</span></button>`;
  return `<div class="logo">${wordmark(40)}${pipFace(52, '#6F4BF2')}</div>${NAV.map(item).join('')}<div class="spacer"></div>${item(['settings', 'Settings', 'gear'])}
    <div class="me">${pipFace(44, '#EEE8FF')}<div><b>You</b><small class="rail-level"></small></div></div>`;
}
for (const r of $$('[data-rail]')) r.innerHTML = railHtml(r.dataset.rail);
function updateRails() {
  const txt = coach.s.placed ? `Level ${coach.level}` : 'Not placed yet';
  for (const el of $$('.rail-level')) el.textContent = txt;
}

// ---- home ---------------------------------------------------------------------------------
const OFF = [0, -1, -1.6, -1, 0, 1, 1.6, 1];
const AMP = 58,
  GAP = 104,
  TOP = 72,
  PW = 460;

function levelStars(n) {
  const m = coach.s.mastery[n] || 0;
  if (!m) return 0;
  return m >= 100 ? 3 : m >= 60 ? 2 : 1;
}

function trailPath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0].x} ${pts[0].y - 60}`;
  let prev = { x: pts[0].x, y: pts[0].y - 60 };
  for (const p of pts) {
    const my = (prev.y + p.y) / 2;
    d += ` C${prev.x} ${my} ${p.x} ${my} ${p.x} ${p.y}`;
    prev = p;
  }
  return d;
}

function homeLine(placed, lv) {
  if (!placed) return "Hi, I'm Pip! Tap Start and I'll find your level.";
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning!' : h < 18 ? 'Welcome back!' : 'Good evening!';
  const sm = coach.summary();
  if (sm.todayXp >= sm.dailyGoal) return `${hello} Daily goal done. Want a song for fun?`;
  if (sm.streak >= 2) return `${hello} ${sm.streak} days in a row. Let's keep it going!`;
  return `${hello} Ready for ${lv.title.toLowerCase()}?`;
}

function renderPath() {
  const placed = coach.s.placed;
  const cur = placed ? coach.level : 1;
  let html = '';
  STAGES.forEach((st, si) => {
    const levels = LEVELS.filter((l) => l.n >= st.from && l.n <= st.to);
    const pts = levels.map((l, i) => ({ l, x: PW / 2 + OFF[i % 8] * AMP, y: TOP + i * GAP }));
    const h = TOP + (levels.length - 1) * GAP + 80;
    const stageLocked = !placed || st.from > cur;
    const doneUpTo = pts.findIndex((p) => p.l.n === cur);
    const goldPts = placed ? (doneUpTo >= 0 ? pts.slice(0, doneUpTo + 1) : st.to < cur ? pts : []) : [];
    let nodes = '';
    pts.forEach((p, i) => {
      const n = p.l.n;
      const state = !placed ? 'locked' : n < cur ? 'done' : n === cur ? 'current' : 'locked';
      const label = `Level ${n}: ${esc(p.l.title)}`;
      if (state === 'current') {
        const m = coach.mastery();
        const c = 2 * Math.PI * 58;
        nodes += `<div class="cur-ring" style="left:${p.x - 66}px;top:${p.y - 62}px"><svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" fill="none" stroke="#DCD2FF" stroke-width="8"/><circle cx="66" cy="66" r="58" fill="none" stroke="var(--brand)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${((c * Math.max(4, m)) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 66 66)"/></svg></div>
          <div class="cur-ring pulse" style="left:${p.x - 66}px;top:${p.y - 62}px"></div>
          <button class="node current" data-level="${n}" style="left:${p.x - 52}px;top:${p.y - 46}px;--i:${i}" aria-label="${label}, your level">${n}</button>`;
      } else {
        nodes += `<button class="node ${state}" data-level="${n}" style="left:${p.x - 42}px;top:${p.y - 38}px;--i:${i}" aria-label="${label}${state === 'done' ? ', done' : ', locked'}">${n}</button>`;
        const k = state === 'done' ? levelStars(n) : 0;
        if (k) nodes += `<div class="node-stars" style="left:${p.x - 42}px;top:${p.y + 44}px">${[0, 1, 2].map((j) => icon(j < k ? 'star' : 'starOff', 20)).join('')}</div>`;
      }
    });
    // Pip beside the current level (or level 1 before placement), on the roomier side.
    const pipAt = pts.find((p) => p.l.n === cur);
    let pipHtml = '';
    if (pipAt) {
      const right = pipAt.x <= PW / 2;
      const px = right ? Math.min(PW - 170, pipAt.x + 90) : Math.max(-60, pipAt.x - 320);
      pipHtml = `<div class="path-pip" style="left:${px}px;top:${Math.max(8, pipAt.y - 150)}px"><div class="bubble tail-bottom" data-coach>${esc(homeLine(placed, levelInfo(cur)))}</div><div class="pip-slot">${pip('hello', 128)}</div></div>`;
    }
    html += `<section class="stage-sec" style="${STAGE_VARS[si]}">
      <header class="banner${stageLocked && !(placed && st.to < cur) ? ' locked' : ''}"><div><div class="eyebrow">Stage ${si + 1} · Levels ${st.from}–${st.to}</div><h2>${esc(st.name)}</h2></div>
        <button class="guide" data-go="map">${icon(stageLocked && !(placed && st.to < cur) ? 'lock' : 'book', 22)} ${stageLocked && !(placed && st.to < cur) ? 'Levels' : 'Guide'}</button></header>
      <div class="path-nodes" style="height:${h}px">
        <svg class="trail" width="${PW}" height="${h}" viewBox="0 0 ${PW} ${h}" aria-hidden="true">
          <path d="${trailPath(pts)}" fill="none" stroke="#F1E4CE" stroke-width="22" stroke-linecap="round"/>
          ${goldPts.length ? `<path d="${trailPath(goldPts)}" fill="none" stroke="#FFE4A1" stroke-width="22" stroke-linecap="round"/>` : ''}
          <path d="${trailPath(pts)}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 14" opacity=".9"/>
        </svg>
        ${nodes}${pipHtml}
      </div>
    </section>`;
  });
  $('#path-nodes').innerHTML = html;
  // Scroll so the current level sits comfortably in view.
  requestAnimationFrame(() => {
    const col = $('#path-col');
    const node = col.querySelector('.node.current') || col.querySelector('.node');
    if (!node) return;
    const top = node.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop;
    const sec = node.closest('.stage-sec');
    const secTop = sec ? sec.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop - 2 : 0;
    col.style.scrollBehavior = 'auto';
    // Keep the current node near the middle, but never show a sliver of the previous stage's banner.
    col.scrollTop = Math.max(0, secTop, top - col.clientHeight * 0.52);
    col.style.scrollBehavior = '';
  });
}

function ring(value, max) {
  const r = 45.5,
    c = 2 * Math.PI * r;
  const pct = Math.min(1, max ? value / max : 0);
  return `<div class="ring"><svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="${r}" class="ring-bg"/><circle cx="52" cy="52" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-to="${(c * (1 - pct)).toFixed(1)}"/></svg>
    <div class="v"><b>${value}</b><small>of ${max} XP</small></div></div>`;
}

function weekHtml(sm) {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date();
  const practicedToday = sm.todayXp > 0;
  // The streak counts consecutive days up to the last practice (today or yesterday).
  const lit = new Set();
  const lastIsToday = practicedToday;
  const run = sm.streak;
  for (let i = 0; i < Math.min(7, run); i++) lit.add(lastIsToday ? i : i + 1);
  let html = '';
  for (let back = 6; back >= 0; back--) {
    const d = new Date(today);
    d.setDate(today.getDate() - back);
    const isToday = back === 0;
    const on = lit.has(back);
    html += `<div class="d${isToday ? ' today' : ''}${on ? ' lit' : isToday ? '' : ' off'}"><i>${on ? icon('flame', 20) : isToday ? icon('flameOff', 20) : ''}</i>${days[d.getDay()]}</div>`;
  }
  return html;
}

function renderHome() {
  const sm = coach.summary();
  const placed = coach.s.placed;
  const lv = levelInfo(coach.level);
  updateRails();
  renderPath();
  // pills
  $('#pill-streak').innerHTML = `${icon(sm.streak ? 'flame' : 'flameOff', 26)} ${sm.streak}`;
  $('#pill-xp').innerHTML = `${icon('bolt', 26)} ${sm.xp.toLocaleString()} XP`;
  const micOk = audio.micOn || coach.s.micChecked;
  const pm = $('#pill-mic');
  pm.classList.toggle('on', !!micOk);
  pm.innerHTML = `<i class="dot"></i>${audio.micOn ? 'Listening' : micOk ? 'Mic ready' : 'Set up mic'}`;
  // hero
  const next = placed ? coach.nextActivity() : null;
  if (placed) {
    const concept = (lv.concept || '').split(/(?<=[.!?])\s/)[0];
    const m = sm.mastery;
    $('#today-level').innerHTML = `<div class="eyebrow">Up next · Level ${lv.n}</div><h1>${esc(lv.title)}</h1><p>${esc(concept)}</p>
      <div class="prog">${m}% mastered<div class="bar"><i style="width:${Math.max(3, m)}%"></i></div></div>`;
  } else {
    $('#today-level').innerHTML = `<div class="eyebrow">First step</div><h1>Find your level</h1><p>A few short pieces for both hands. They get harder or easier to match you.</p>`;
  }
  $('#btn-start').innerHTML = `${icon('play', 24)} ${placed ? (next && next.kind === 'intro' ? `Start Level ${lv.n}` : 'Continue') : 'Start'}`;
  $('#btn-hear').classList.toggle('hidden', !placed || !next || next.kind === 'intro');
  $('#btn-hear').innerHTML = `${icon('speaker', 20)} Hear it first`;
  // daily goal
  const left = Math.max(0, sm.dailyGoal - sm.todayXp);
  $('#today-goal').innerHTML = `${ring(sm.todayXp, sm.dailyGoal)}<div><h3>Daily goal</h3><p>${left ? `${left} XP to go · about ${Math.max(1, Math.ceil(left / 15))} exercise${left > 15 ? 's' : ''}` : 'Goal reached today!'}</p><div class="week">${weekHtml(sm)}</div></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const c of $$('#today-goal .ring-fg')) c.style.strokeDashoffset = c.dataset.to;
  }));
  // journey
  const cur = coach.level;
  $('#journey').innerHTML = `<h3>Your journey <small>40 levels</small></h3>${STAGES.map((st, i) => {
    const total = st.to - st.from + 1;
    const done = placed ? Math.max(0, Math.min(total, cur - st.from)) : 0;
    const now = placed && cur >= st.from && cur <= st.to;
    const complete = done === total;
    const cls = now ? 'now' : complete ? '' : 'locked';
    const ic = complete ? icon('check', 18) : now ? icon('play', 14) : i === 4 ? icon('crown', 18) : icon('lock', 16);
    return `<div class="jrow ${cls}"><span class="dot" style="background:var(--stage-${i + 1})">${ic}</span><b>${esc(st.name)}<small>${st.from}–${st.to}</small></b><div class="bar${complete ? ' mint' : ''}"><i style="width:${(100 * done) / total}%"></i></div><span class="cnt">${done}/${total}</span></div>`;
  }).join('')}`;
}

screen('home', { enter: renderHome });

$('#btn-start').addEventListener('click', () => {
  sfx('tap');
  if (!coach.s.placed) app.startPlacementFlow();
  else app.withListening(() => app.runActivity(coach.nextActivity()));
});
$('#btn-hear').addEventListener('click', () => {
  sfx('tap');
  const next = coach.nextActivity();
  if (!next || next.kind === 'intro') return app.withListening(() => app.runActivity(next));
  app.withListening(() => app.runActivity({ ...next, demoFirst: true }));
});
$('#pill-mic').addEventListener('click', () => {
  sfx('tap');
  S.pendingAfterSetup = () => show('home');
  app.openSetup();
});
$('#path-nodes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const n = +b.dataset.level;
  sfx('tap');
  if (!coach.s.placed) return app.startPlacementFlow();
  if (n === coach.level) return app.withListening(() => app.runActivity(coach.nextActivity()));
  if (n > coach.level) {
    showLine(`Level ${n} unlocks after Level ${n - 1}. You can still peek at it in All levels!`);
    return;
  }
  practiceLevel(n);
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

function practiceLevel(n) {
  app.withListening(() => {
    if (n === coach.level && coach.s.placed) app.runActivity(coach.nextActivity());
    else {
      if (n > coach.level) toast(`Level ${n} is ahead of you. Practising it won't change your lesson level.`, 3500);
      app.runActivity({ kind: 'sight', level: n, mode: 'tempo', tempoFactor: coach.tempoFactor(n), free: true, label: `Practice: Level ${n}` });
    }
  });
}

// ---- level intro --------------------------------------------------------------------------
export function showIntro(level) {
  const lv = levelInfo(level);
  const si = stageOf(lv.n);
  $('#intro-stage').textContent = `Stage ${si + 1} · ${lv.stage}`;
  $('#intro-coin').textContent = String(lv.n);
  $('#intro-coin').style.cssText = `background:var(--stage-${si + 1});box-shadow:0 8px 0 var(--stage-${si + 1}-edge)`;
  $('#intro-title').textContent = lv.title;
  $('#intro-concept').textContent = '';
  $('#intro-tips').innerHTML = lv.tips.map((t) => `<li>${esc(t)}</li>`).join('');
  const start = (demoFirst) => {
    sfx('tap');
    coach.markIntroSeen(level);
    const act = coach.nextActivity();
    app.runActivity(demoFirst && act && act.kind !== 'intro' ? { ...act, demoFirst: true } : act);
  };
  $('#btn-intro-go').onclick = () => start(false);
  $('#btn-intro-hear').onclick = () => start(true);
  $('#btn-intro-hear').innerHTML = `${icon('speaker', 20)} Hear it first`;
  show('intro');
  say(`Level ${lv.n}: ${lv.title}. ${lv.concept}`);
}
app.showIntro = showIntro;

// ---- level map ----------------------------------------------------------------------------
screen('map', {
  enter() {
    updateRails();
    $('#map-list').innerHTML = STAGES.map((st, si) => {
      const items = LEVELS.filter((l) => l.n >= st.from && l.n <= st.to)
        .map((l) => {
          const cls = l.n === coach.level ? 'current' : l.n > coach.level ? 'locked' : 'done';
          const m = l.n < coach.level ? 100 : l.n === coach.level ? coach.mastery() : 0;
          const tag = l.n < coach.level ? ' · done' : l.n === coach.level ? ' · you are here' : '';
          return `<button class="lvl ${cls}" data-level="${l.n}"><span class="n">LEVEL ${l.n}${tag.toUpperCase()}</span><b>${esc(l.title)}</b><div class="bar"><i style="width:${m}%"></i></div></button>`;
        })
        .join('');
      return `<div class="map-stage" style="${STAGE_VARS[si]}"><h3><span class="dot">${si === 4 ? icon('crown', 20) : `<b style="font-size:17px">${si + 1}</b>`}</span>${esc(st.name)} <small>Levels ${st.from}–${st.to}</small></h3><div class="map-grid">${items}</div></div>`;
    }).join('');
  },
});
$('#map-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  sfx('tap');
  practiceLevel(+b.dataset.level);
});

// ---- practice -----------------------------------------------------------------------------
const PR = { kind: 'sight', mode: 'tempo' };
screen('practice', {
  enter() {
    updateRails();
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
  $('#pr-tempo-val').textContent = `≈ ${Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * tf)} bpm`;
}
for (const id of ['#pr-kind', '#pr-mode']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sfx('select');
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
const TILE_COLORS = [
  ['var(--brand)', 'var(--brand-edge)', '#fff'],
  ['var(--mint)', 'var(--mint-edge)'],
  ['var(--stage-3)', 'var(--stage-3-edge)', '#fff'],
  ['var(--sun)', 'var(--sun-edge)'],
  ['var(--lh)', '#0B8C7E'],
  ['var(--sun)', 'var(--sun-edge)'],
  ['#E0436F', '#B32651', '#fff'],
  ['var(--flame)', 'var(--flame-edge)'],
];
screen('progress', {
  enter() {
    updateRails();
    const sm = coach.summary();
    const cents = audio.tuningCents;
    const cards = [
      ['Level', `${sm.level}`, sm.info.title],
      ['Mastery', `${sm.mastery}%`, `of level ${sm.level}`],
      ['Stage', sm.info.stage, `${Math.round((100 * (sm.level - 1)) / 39)}% of the way`],
      ['Avg. score', sm.avg ? `${sm.avg}%` : '–', 'last 20 exercises'],
      ['Practice time', fmtTime(sm.stats.seconds), 'total'],
      ['Total XP', `${sm.xp.toLocaleString()}`, `${sm.todayXp} today`],
      ['Notes played', `${sm.stats.notes.toLocaleString()}`, 'correctly'],
      ['Streak', `${sm.streak} day${sm.streak === 1 ? '' : 's'}`, audio.micOn && cents != null ? `piano tuning ${cents >= 0 ? '+' : ''}${Math.round(cents)}¢` : 'practise daily!'],
    ];
    $('#stats-grid').innerHTML = cards
      .map(([k, v, s], i) => {
        const [c, ce, hc] = TILE_COLORS[i];
        return `<div class="stat-tile" style="--i:${i};--c:${c};--ce:${ce};${hc ? `--hc:${hc}` : ''}"><div class="hd">${k}</div><div class="bd"><b>${esc(v)}</b><small>${esc(s)}</small></div></div>`;
      })
      .join('');
    const hist = sm.history.filter((h) => !h.placement).slice(-60);
    $('#history-empty').classList.toggle('hidden', hist.length > 0);
    $('#history-chart').classList.toggle('hidden', !hist.length);
    if (!hist.length) $('#history-empty').innerHTML = `${pip('think', 96)}<div class="bubble tail-left">Your scores will appear here after your first lesson.</div>`;
    else requestAnimationFrame(() => drawHistory(hist));
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
  const padL = 44,
    padB = 10,
    padT = 10;
  const ph = h - padB - padT;
  ctx.font = '800 13px Nunito, system-ui, sans-serif';
  ctx.fillStyle = '#736A8A';
  ctx.strokeStyle = '#F0E3CD';
  ctx.lineWidth = 2;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, 50, 100]) {
    const y = padT + ph * (1 - v / 100);
    ctx.fillText(`${v}%`, padL - 10, y);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const slot = (w - padL - 4) / Math.max(hist.length, 12);
  const bw = Math.min(22, slot - 5);
  hist.forEach((e, i) => {
    const x = padL + 6 + i * slot;
    const bh = Math.max(6, (ph * e.score) / 100);
    const [col, edge] = e.score >= 85 ? ['#20C07A', '#12985C'] : e.score >= 60 ? ['#6F4BF2', '#4F30C9'] : ['#FF5A6A', '#D93A4C'];
    ctx.fillStyle = edge;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padT + ph - bh, bw, bh, 7);
    else ctx.rect(x, padT + ph - bh, bw, bh);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padT + ph - bh, bw, Math.max(2, bh - 4), 7);
    else ctx.rect(x, padT + ph - bh, bw, Math.max(2, bh - 4));
    ctx.fill();
  });
}

// ---- settings -----------------------------------------------------------------------------
async function fillVoices() {
  const v = getVoice() || (await voiceReady);
  const row = $('#voice-pick-row');
  const sel = $('#set-voice');
  const list = v && v.supported && typeof v.list === 'function' ? v.list() : [];
  row.classList.toggle('hidden', !list.length);
  if (!list.length) return;
  const cur = v.current ? v.current.uri : '';
  sel.innerHTML = `<option value="">Automatic</option>${list.slice(0, 30).map((o) => `<option value="${esc(o.uri)}"${o.uri === cur ? ' selected' : ''}>${esc(o.name)} (${esc(o.lang)})</option>`).join('')}`;
}
screen('settings', {
  enter() {
    updateRails();
    for (const el of $$('#screen-settings [data-set]')) {
      const k = el.dataset.set;
      let v = coach.settings[k];
      if (k === 'voice') {
        const vo = getVoice();
        v = vo ? vo.enabled && v !== false : v;
      }
      if (el.type === 'checkbox') el.checked = v !== false && !!v;
      else el.value = String(v);
    }
    updateSettingLabels();
    fillVoices();
    $('#set-info').textContent = `Input: ${audio.micOn ? 'microphone' : 'not started'}${audio.midiOn ? ' + MIDI' : ''} · sample rate ${audio.ctx ? audio.ctx.sampleRate : '–'} Hz`;
  },
});
voiceReady.then((v) => v && typeof v.onVoicesChanged === 'function' && v.onVoicesChanged(() => S.screen === 'settings' && fillVoices()));
function updateSettingLabels() {
  $('#set-sens-val').textContent = `${(+coach.settings.sensitivity).toFixed(1)}×`;
  $('#set-lat-val').textContent = `${coach.settings.latencyMs} ms`;
  $('#set-look-val').textContent = `${coach.settings.lookaheadSec} s`;
}
$('#screen-settings').addEventListener('input', (e) => {
  if (e.target.id === 'set-voice') {
    const v = getVoice();
    if (v) v.setVoice(e.target.value || null);
    say('Hi! This is my voice now.');
    return;
  }
  const k = e.target.dataset.set;
  if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (e.target.type === 'range' || k === 'dailyGoal') v = +v;
  if (k === 'showNames' || k === 'noteColors') v = v === 'auto' ? 'auto' : v === 'true';
  coach.setSetting(k, v);
  if (e.target.type === 'checkbox') sfx('toggle', { on: !!v });
  if (k === 'sensitivity') audio.setSensitivity(v);
  if (k === 'noisyRoom' && typeof audio.setNoisyRoom === 'function') audio.setNoisyRoom(v);
  if (k === 'voice') {
    const vo = getVoice();
    if (vo && typeof vo.setEnabled === 'function') vo.setEnabled(!!v);
    if (v) say('Voice coach on.');
  }
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
