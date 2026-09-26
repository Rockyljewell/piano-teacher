// Navigation rail, Home (learning path + today), level intro, lesson map, practice, progress and
// settings.
import { $, $$, S, app, audio, coach, esc, screen, show, say, showLine, sfx, toast, unlockVoice, getVoice, voiceReady, rise, popIn, countUp, fillRange } from './core.js';
import { icon, pip, pipFace, wordmark, reducedMotion } from './brand.js';
import { levelInfo, LEVELS, STAGES } from '../music/curriculum.js';
import { generate } from '../music/generator.js';
import { isBlack } from '../music/theory.js';

// Per-stage colour variables: full (--sc/--sce), softened (--scs/--scse) and ink (--sci).
const STAGE_VARS = STAGES.map((_, i) => {
  const k = i + 1;
  return `--sc:var(--stage-${k});--sce:var(--stage-${k}-edge);--scs:var(--stage-${k}-soft);--scse:var(--stage-${k}-soft-edge);--sci:var(--stage-${k}-ink)`;
});
const stageOf = (n) => Math.max(0, STAGES.findIndex((s) => n >= s.from && n <= s.to));
// A level title inside a sentence: lowercase the first word, but keep note names ("G position",
// "F major and B flat"), "C" in "Middle C" and proper names (Alberti) as they are.
function inSentence(t) {
  const first = t.split(/[\s:,]/)[0];
  if (/^[A-G][♯♭]?$/.test(first) || /^(Alberti)$/.test(first)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

const MAX_XP = 19; // per exercise: score/10 + 3 per star (coach.record)

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
  if (!placed) return "Hi, I'm Pip! Tap here and I'll find your level.";
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning!' : h < 18 ? 'Welcome back!' : 'Good evening!';
  const sm = coach.summary();
  if (sm.todayXp >= sm.dailyGoal) return `${hello} Daily goal done. Want a song for fun?`;
  if (sm.streak >= 2) return `${hello} ${sm.streak} days in a row. Let's keep it going!`;
  return `${hello} Ready for ${inSentence(lv.title)}?`;
}

// First run: a "find your level" start node at the top of the path, Pip pointing at it.
function pathStartHtml() {
  return `<section class="path-start" aria-label="Find your level">
    <div class="ps-ring" aria-hidden="true"></div><div class="ps-ring p2" aria-hidden="true"></div>
    <button class="ps-coin" data-np="place" aria-label="Find your level"><svg viewBox="0 0 28 26" width="52" height="48" aria-hidden="true">${[7, 12, 17, 22].map((h, i) => `<rect x="${1 + i * 7}" y="${24 - h}" width="5" height="${h}" rx="2.5" fill="#fff" opacity="${i < 3 ? 1 : 0.45}"/>`).join('')}</svg></button>
    <button class="ps-btn" data-np="place">${icon('play', 18)} Find my level</button>
    <div class="path-pip ps-pip"><div class="bubble tail-bottom" data-coach>${esc(homeLine(false))}</div><div class="pip-slot pip-flip">${pip('point', 124)}</div></div>
  </section>`;
}

function renderPath() {
  const placed = coach.s.placed;
  const cur = placed ? coach.level : 1;
  let html = placed ? '' : pathStartHtml();
  STAGES.forEach((st, si) => {
    const levels = LEVELS.filter((l) => l.n >= st.from && l.n <= st.to);
    const pts = levels.map((l, i) => ({ l, x: PW / 2 + OFF[i % 8] * AMP, y: TOP + i * GAP }));
    const h = TOP + (levels.length - 1) * GAP + 80;
    const reached = placed && st.from <= cur;
    const doneUpTo = pts.findIndex((p) => p.l.n === cur);
    const goldPts = placed ? (doneUpTo >= 0 ? pts.slice(0, doneUpTo + 1) : st.to < cur ? pts : []) : [];
    let nodes = '';
    pts.forEach((p) => {
      const n = p.l.n;
      const state = !placed ? 'locked' : n < cur ? 'done' : n === cur ? 'current' : 'locked';
      const label = `Level ${n}: ${esc(p.l.title)}`;
      // Nodes pop in along the path, outward from the current node (or from the start node).
      const dist = Math.min(12, placed ? Math.abs(n - cur) : n);
      const at = `data-x="${p.x}" data-y="${p.y}"`;
      if (state === 'current') {
        const m = coach.mastery();
        const c = 2 * Math.PI * 58;
        nodes += `<div class="cur-ring" style="left:${p.x - 66}px;top:${p.y - 62}px"><svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" fill="none" stroke="#DCD2FF" stroke-width="8"/><circle cx="66" cy="66" r="58" fill="none" stroke="var(--brand)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${((c * Math.max(4, m)) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 66 66)"/></svg></div>
          <div class="cur-ring pulse" style="left:${p.x - 66}px;top:${p.y - 62}px"></div><div class="cur-ring pulse p2" style="left:${p.x - 66}px;top:${p.y - 62}px"></div>
          <button class="node current" data-level="${n}" ${at} style="left:${p.x - 52}px;top:${p.y - 46}px;--i:0" aria-label="${label}, your level" aria-haspopup="dialog">${n}</button>`;
      } else {
        const k = state === 'done' ? levelStars(n) : 0;
        const badge = state === 'done' && !k ? `<span class="badge">${icon('check', 16)}</span>` : '';
        nodes += `<button class="node ${state}" data-level="${n}" ${at} style="left:${p.x - 42}px;top:${p.y - 38}px;--i:${dist}" aria-label="${label}${state === 'done' ? ', done' : ', locked'}" aria-haspopup="dialog">${n}${badge}</button>`;
        if (k) nodes += `<div class="node-stars" data-for="${n}" style="left:${p.x - 42}px;top:${p.y + 44}px;--i:${dist}">${[0, 1, 2].map((j) => icon(j < k ? 'star' : 'starOff', 20)).join('')}</div>`;
      }
    });
    // Pip beside the current level, on the roomier side.
    const pipAt = placed ? pts.find((p) => p.l.n === cur) : null;
    let pipHtml = '';
    if (pipAt) {
      const right = pipAt.x <= PW / 2;
      const px = right ? Math.min(PW - 170, pipAt.x + 90) : Math.max(-60, pipAt.x - 320);
      pipHtml = `<div class="path-pip" style="left:${px}px;top:${Math.max(8, pipAt.y - 150)}px"><div class="bubble tail-bottom" data-coach>${esc(homeLine(placed, levelInfo(cur)))}</div><div class="pip-slot">${pip('hello', 128)}</div></div>`;
    }
    const locked = !reached && !(placed && st.to < cur);
    html += `<section class="stage-sec" style="${STAGE_VARS[si]}">
      <header class="banner${locked ? ' locked' : ''}"><div><div class="eyebrow">Stage ${si + 1} · Levels ${st.from}–${st.to}</div><h2>${esc(st.name)}</h2></div>
        <button class="guide" data-go="map">${icon(locked ? 'lock' : 'book', 22)} ${locked ? 'Levels' : 'Guide'}</button></header>
      <div class="path-nodes" style="height:${h}px">
        <svg class="trail" width="${PW}" height="${h}" viewBox="0 0 ${PW} ${h}" aria-hidden="true">
          <path d="${trailPath(pts)}" fill="none" stroke="${locked ? '#F1E4CE' : '#F1E4CE'}" stroke-width="22" stroke-linecap="round"/>
          ${goldPts.length ? `<path d="${trailPath(goldPts)}" fill="none" stroke="#FFE4A1" stroke-width="22" stroke-linecap="round"/>` : ''}
          <path d="${trailPath(pts)}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 14" opacity=".9"/>
        </svg>
        ${nodes}${pipHtml}
      </div>
    </section>`;
  });
  popFor = 0;
  $('#path-nodes').innerHTML = html;
  // Scroll so the current level sits comfortably in view (first run: the start node at the top).
  const col = $('#path-col');
  const node = placed ? col.querySelector('.node.current') : null;
  col.style.scrollBehavior = 'auto';
  if (!node) col.scrollTop = 0;
  else {
    const top = node.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop;
    const sec = node.closest('.stage-sec');
    const secTop = sec ? sec.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop - 2 : 0;
    // Keep the current node near the middle, but never show a sliver of the previous stage's banner.
    col.scrollTop = Math.max(0, secTop, top - col.clientHeight * 0.52);
  }
  col.style.scrollBehavior = '';
}

// ---- home: the card that pops from a tapped node --------------------------------------------
let popFor = 0;
function closeNodePop(instant = false) {
  for (const el of $$('#path-nodes .node-pop')) {
    if (instant || reducedMotion()) el.remove();
    else {
      el.classList.add('out');
      setTimeout(() => el.remove(), 130);
    }
  }
  for (const b of $$('#path-nodes .node.sel')) b.classList.remove('sel');
  popFor = 0;
}

function nodePopHtml(n) {
  const placed = coach.s.placed;
  const cur = placed ? coach.level : 0;
  const lv = levelInfo(n);
  const first = (lv.concept || '').split(/(?<=[.!?])\s/)[0];
  const eb = (ic, t) => `<div class="eyebrow">${ic ? icon(ic, 16) : ''}${esc(t)}</div><h3>${esc(lv.title)}</h3>`;
  if (!placed) {
    return ['locked', `${eb(null, `Level ${n} · ${lv.stage}`)}<p>Find your level first. I'll unlock everything you already know.</p>
      <div class="np-actions"><button class="btn btn-primary" data-np="place">${icon('play', 18)} Find my level</button></div>`];
  }
  if (n === cur) {
    const next = coach.nextActivity();
    const m = coach.mastery();
    const label = next && next.kind === 'intro' ? `Start Level ${n}` : 'Continue';
    const up = next && next.kind !== 'intro' && next.label ? `Up next: ${next.label}` : first;
    return ['cur', `${eb('play', `Level ${n} · you are here`)}<p>${esc(up)}</p>
      <div class="np-prog">${m}% mastered<span class="bar"><i style="width:${Math.max(3, m)}%"></i></span></div>
      <div class="np-actions"><button class="btn btn-white" data-np="start">${icon('play', 20)} ${label}<span class="np-xp" title="Up to ${MAX_XP} XP per exercise">${icon('bolt', 14)}up to ${MAX_XP}</span></button></div>`];
  }
  if (n < cur) {
    const k = levelStars(n);
    const stars = `<div class="np-stars">${[0, 1, 2].map((j) => icon(j < k ? 'star' : 'starOff', 22)).join('')}<span>${k ? `${k} of 3 stars` : 'Passed'}</span></div>`;
    return ['done', `${eb('check', `Level ${n} · done`)}${stars}
      <div class="np-actions"><button class="btn btn-primary" data-np="practice">${icon('retry', 20)} Practise again</button></div>`];
  }
  return ['locked', `${eb('lock', `Level ${n} · locked`)}<p>Finish Level ${cur} to unlock it. You can still try it for practice.</p>
    <div class="np-actions"><button class="btn" data-np="practice">Try it anyway</button><button class="btn btn-ghost" data-go="map">All levels</button></div>`];
}

function openNodePop(btn) {
  closeNodePop(true);
  const n = +btn.dataset.level;
  const wrap = btn.closest('.path-nodes');
  if (!wrap) return;
  const cx = +btn.dataset.x,
    cy = +btn.dataset.y;
  const W = 300;
  const left = Math.max(4, Math.min(wrap.clientWidth - W - 4, cx - W / 2));
  const isCur = btn.classList.contains('current');
  const hasStars = !!wrap.querySelector(`.node-stars[data-for="${n}"]`);
  const top = cy + (isCur ? 66 : hasStars ? 70 : 52);
  const [kind, inner] = nodePopHtml(n);
  const el = document.createElement('div');
  el.className = `node-pop ${kind}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Level ${n}`);
  el.style.cssText = `left:${left}px;top:${top}px;--ax:${Math.round(cx - left)}px`;
  el.innerHTML = `<div class="np-card">${inner}</div>`;
  wrap.appendChild(el);
  btn.classList.add('sel');
  popFor = n;
  // Keep the whole card on screen.
  requestAnimationFrame(() => {
    const col = $('#path-col');
    const r = el.getBoundingClientRect(),
      cr = col.getBoundingClientRect();
    const over = r.top + el.offsetHeight + 16 - cr.bottom;
    if (over > 0) col.scrollBy({ top: over, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
}

function ring(value, max, prev = 0) {
  const r = 45.5,
    c = 2 * Math.PI * r;
  const pct = Math.min(1, max ? value / max : 0);
  const from = Math.min(1, max ? prev / max : 0);
  return `<div class="ring"><svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="${r}" class="ring-bg"/><circle cx="52" cy="52" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - from)).toFixed(1)}" data-to="${(c * (1 - pct)).toFixed(1)}"/></svg>
    <div class="v"><b>${prev}</b><small>of ${max} XP</small></div></div>`;
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

// What the numbers showed last time, so they count up from there (first visit: from 0).
const SEEN = { xp: 0, today: 0 };

function renderHome() {
  const sm = coach.summary();
  const placed = coach.s.placed;
  const lv = levelInfo(coach.level);
  updateRails();
  renderPath();
  // pills: XP counts up from what was shown last time
  $('#pill-streak').innerHTML = `${icon(sm.streak ? 'flame' : 'flameOff', 26)} <span>${sm.streak}</span>`;
  $('#pill-xp').innerHTML = `${icon('bolt', 26)} <span class="xp-n">${SEEN.xp.toLocaleString()}</span> XP`;
  countUp($('#pill-xp .xp-n'), SEEN.xp, sm.xp, { ms: 800, delay: 260, fmt: (v) => v.toLocaleString() });
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
  // daily goal: the ring fills and its number counts up from the last value shown
  const left = Math.max(0, sm.dailyGoal - sm.todayXp);
  const prevToday = Math.min(SEEN.today, sm.todayXp);
  $('#today-goal').innerHTML = `${ring(sm.todayXp, sm.dailyGoal, prevToday)}<div><h3>Daily goal</h3><p>${left ? `${left} XP to go · about ${Math.max(1, Math.ceil(left / 15))} exercise${left > 15 ? 's' : ''}` : 'Goal reached today!'}</p><div class="week">${weekHtml(sm)}</div></div>`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const c of $$('#today-goal .ring-fg')) c.style.strokeDashoffset = c.dataset.to;
    }),
  );
  countUp($('#today-goal .ring .v b'), prevToday, sm.todayXp, { ms: 900, delay: 320 });
  SEEN.xp = sm.xp;
  SEEN.today = sm.todayXp;
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
  // Entrance: the right-hand column fades up in reading order (the path pops in via CSS).
  rise([$('#screen-home .pills'), $('#screen-home .hero'), $('#today-goal'), $('#journey')], { delay: 70, step: 60 });
}

screen('home', { enter: renderHome, leave: () => closeNodePop(true) });

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
  const act = e.target.closest('[data-np]');
  if (act) {
    const n = popFor;
    sfx('tap');
    closeNodePop(true);
    if (act.dataset.np === 'place') return app.startPlacementFlow();
    if (act.dataset.np === 'start') return app.withListening(() => app.runActivity(coach.nextActivity()));
    if (act.dataset.np === 'practice' && n) return practiceLevel(n);
    return;
  }
  const b = e.target.closest('.node[data-level]');
  if (b) {
    sfx('tap');
    if (popFor === +b.dataset.level) closeNodePop();
    else openNodePop(b);
    return;
  }
  if (!e.target.closest('.node-pop')) closeNodePop();
});
// A tap anywhere else on Home closes the node card.
document.addEventListener('pointerdown', (e) => {
  if (popFor && S.screen === 'home' && !e.target.closest('.node-pop, .node')) closeNodePop();
});
document.addEventListener('keydown', (e) => {
  if (popFor && e.key === 'Escape') closeNodePop();
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
// The new level at a glance: a stage-coloured coin, the title and concept, a mini keyboard with
// the hand position and finger numbers (from a generated sample piece), and Pip's short line.
const HAND = { R: { name: 'Right hand', tag: 'RH', c: '#6F4BF2', soft: '#E9E2FF', ink: '#4A2FC2' }, L: { name: 'Left hand', tag: 'LH', c: '#14B8A6', soft: '#D3F4EF', ink: '#0B7568' } };
const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
const wIndex = (m) => Math.floor(m / 12) * 7 + WHITE_PC.indexOf((isBlack(m) ? m - 1 : m) % 12) + (isBlack(m) ? 0.5 : 0);
const wMidi = (w) => Math.floor(w / 7) * 12 + WHITE_PC[((w % 7) + 7) % 7];

export function miniKeysSvg(piece) {
  const prep = piece && piece.prep;
  if (!prep || !prep.hands || !prep.hands.length || prep.anyKey) return '';
  const key = piece.key;
  const hands = prep.hands.map((h, hi) => {
    const inPos = [];
    for (let m = h.position.lo; m <= h.position.hi; m++) if (!key || key.inKey(m)) inPos.push(m);
    const five = inPos.slice(0, 5);
    const fingers = new Map(five.map((m, i) => [m, h.hand === 'L' ? 5 - i : i + 1]));
    // reaches outside the five-finger position (e.g. level 8: left pinky down to F sharp)
    const ext = (prep.extensions || []).filter((e) => e.hand === h.hand && !five.includes(e.midi));
    const all = [...five, ...(h.anchor ? [h.anchor.midi] : []), ...ext.map((e) => e.midi)];
    return { hand: h.hand === 'L' ? 'L' : 'R', five, fingers, ext, anchor: h.anchor ? h.anchor.midi : null, lo: Math.min(...all), hi: Math.max(...all), order: hi };
  });
  // One keyboard strip per hand, merged when they are close; a "…" gap when they are far apart.
  const single = hands.length === 1;
  const pad = single ? 3 : 2;
  const mc = wIndex(60);
  const segs = hands
    .map((h) => {
      const s = { a: Math.floor(wIndex(h.lo)) - pad, b: Math.ceil(wIndex(h.hi)) + pad };
      // Show middle C for orientation when it is just outside the strip.
      if (mc < s.a && s.a - mc <= 4) s.a = mc - 1;
      if (mc > s.b && mc - s.b <= 4) s.b = mc + 1;
      return s;
    })
    .sort((x, y) => x.a - y.a)
    .reduce((out, s) => {
      const last = out[out.length - 1];
      if (last && s.a - last.b <= 4) last.b = Math.max(last.b, s.b);
      else out.push({ ...s });
      return out;
    }, []);
  const WK = 36,
    KH = 124,
    BK = 22,
    BH = 78,
    GAP_W = 40,
    TOPY = 40;
  const xs = new Map(); // white index -> x
  let x = 0;
  segs.forEach((s, i) => {
    if (i) x += GAP_W;
    for (let w = s.a; w <= s.b; w++, x += WK) xs.set(w, x);
  });
  const width = x;
  const owner = new Map();
  for (const h of hands) for (const m of [...h.five, ...h.ext.map((e) => e.midi)]) owner.set(m, h);
  let whites = '',
    blacks = '',
    labels = '',
    discs = '',
    brackets = '',
    gaps = '';
  let k = 0;
  segs.forEach((s, i) => {
    // the key bed (its lower edge is the 3D depth of the keyboard)
    gaps += `<rect x="${xs.get(s.a) - 2}" y="${TOPY + 4}" width="${(s.b - s.a + 1) * WK + 4}" height="${KH}" rx="8" fill="#E6D6BC"/>`;
    if (i) {
      const gx = xs.get(s.a) - GAP_W / 2;
      gaps += `<g fill="#C9BBA3">${[-10, 0, 10].map((d) => `<circle cx="${gx + d}" cy="${TOPY + KH / 2}" r="3.2"/>`).join('')}</g>`;
    }
    for (let w = s.a; w <= s.b; w++) {
      const m = wMidi(w);
      const wx = xs.get(w);
      const h = owner.get(m);
      whites += `<rect x="${wx + 1}" y="${TOPY}" width="${WK - 2}" height="${KH}" rx="6" fill="${h ? HAND[h.hand].soft : '#fff'}" stroke="#E6D6BC" stroke-width="1.5"/>`;
      const letter = 'CDEFGAB'[WHITE_PC.indexOf(m % 12)];
      labels += `<text x="${wx + WK / 2}" y="${TOPY + KH + 22}" text-anchor="middle" font-size="15" font-weight="${h ? 900 : 700}" fill="${h ? HAND[h.hand].ink : '#A79D8A'}">${letter}</text>`;
      if (m === 60) labels += `<text x="${wx + WK / 2}" y="${TOPY + KH + 40}" text-anchor="middle" font-size="12" font-weight="800" fill="#736A8A">middle C</text>`;
      // the black key to the right of this white key
      const bm = m + 1;
      if (isBlack(bm) && w < s.b) {
        const bh = owner.get(bm);
        blacks += `<rect x="${wx + WK - BK / 2}" y="${TOPY - 1}" width="${BK}" height="${BH}" rx="4" fill="${bh ? HAND[bh.hand].c : '#2E2B5F'}"/>`;
      }
    }
  });
  const kx = (m) => (isBlack(m) ? xs.get(wIndex(m) - 0.5) + WK : xs.get(wIndex(m)) + WK / 2);
  for (const h of [...hands].sort((a, b) => a.order - b.order)) {
    const H = HAND[h.hand];
    const lo = Math.min(...h.five),
      hi = Math.max(...h.five);
    if (xs.get(Math.floor(wIndex(lo))) == null || xs.get(Math.floor(wIndex(hi))) == null) continue;
    const x0 = kx(lo) - 14,
      x1 = kx(hi) + 14;
    const mid = (x0 + x1) / 2;
    const tw = H.name.length * 8.4 + 22;
    brackets += `<g class="mk-hand" style="--k:${k}"><path d="M${x0} ${TOPY - 6} v-8 h${x1 - x0} v8" fill="none" stroke="${H.c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="${mid - tw / 2}" y="${TOPY - 34}" width="${tw}" height="24" rx="12" fill="${H.c}"/><text x="${mid}" y="${TOPY - 17}" text-anchor="middle" font-size="14" font-weight="900" fill="#fff">${H.name}</text></g>`;
    for (const m of h.five.slice().sort((a, b) => (h.hand === 'L' ? b - a : a - b))) {
      const f = h.fingers.get(m);
      const blk = isBlack(m);
      const cx = kx(m),
        cy = blk ? TOPY + BH - 18 : TOPY + KH - 24;
      const r = blk ? 10 : 13;
      const anchor = m === h.anchor;
      discs += `<g class="mk-f" style="--k:${k++}">${anchor ? `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="none" stroke="${H.c}" stroke-width="2.5" stroke-dasharray="4 3"/>` : ''}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${blk ? '#fff' : H.c}"/><text x="${cx}" y="${cy + (blk ? 4.5 : 5.5)}" text-anchor="middle" font-size="${blk ? 13 : 16}" font-weight="900" fill="${blk ? H.c : '#fff'}">${f}</text></g>`;
    }
    // a reach: outlined disc with the finger that stretches to it, and a small "reach" tag
    for (const e of h.ext) {
      if (xs.get(Math.floor(wIndex(e.midi))) == null) continue;
      const blk = isBlack(e.midi);
      const cx = kx(e.midi),
        cy = blk ? TOPY + BH - 18 : TOPY + KH - 24;
      const r = blk ? 10 : 13;
      discs += `<g class="mk-f" style="--k:${k++}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${H.c}" stroke-width="3"/><text x="${cx}" y="${cy + (blk ? 4.5 : 5.5)}" text-anchor="middle" font-size="${blk ? 13 : 16}" font-weight="900" fill="${H.c}">${e.finger || ''}</text>
        <rect x="${cx - 22}" y="${cy - r - 26}" width="44" height="18" rx="9" fill="${H.c}"/><text x="${cx}" y="${cy - r - 13}" text-anchor="middle" font-size="11" font-weight="900" fill="#fff">reach</text></g>`;
    }
  }
  const height = TOPY + KH + 46;
  const text = prep.text || '';
  return `<svg viewBox="-4 0 ${width + 8} ${height}" role="img" aria-label="${esc(text)}" font-family="Nunito, system-ui, sans-serif">
    ${gaps}${whites}${blacks}${brackets}${discs}${labels}</svg>`;
}

function introPiece(level) {
  try {
    return generate(level, { kind: 'sight', seed: level * 7 + 1 });
  } catch (err) {
    console.warn(err);
    return null;
  }
}

export function showIntro(level) {
  const lv = levelInfo(level);
  const si = stageOf(lv.n);
  const scr = $('#screen-intro');
  scr.setAttribute('style', STAGE_VARS[si]);
  $('#intro-stage').textContent = `Stage ${si + 1} · ${lv.stage}`;
  $('#intro-coin').innerHTML = `<span>${lv.n}</span>`;
  $('#intro-eyebrow').textContent = `New level · ${lv.n} of ${LEVELS.length}`;
  $('#intro-title').textContent = lv.title;
  $('#intro-concept').textContent = lv.concept || '';
  $('#intro-tips').innerHTML = (lv.tips || []).slice(0, 2).map((t) => `<li>${esc(t)}</li>`).join('');
  // A sample piece at this level shows where the hands go.
  const piece = introPiece(lv.n);
  const keys = miniKeysSvg(piece);
  $('#intro-skill').classList.toggle('hidden', !keys);
  $('#intro-keys').innerHTML = keys;
  const fixed = piece && piece.prep && piece.prep.hands.some((h) => h.fixed);
  $('#intro-skill-title').textContent = fixed ? 'Where your hands go' : 'Hands for a piece like this';
  $('#intro-skill-sub').textContent = lv.hands === 'R' ? 'Right hand only' : lv.hands === 'L' ? 'Left hand only' : 'Both hands';
  $('#intro-hands').innerHTML = keys ? `Numbers are fingers: <b>1</b> is the thumb, <b>5</b> the little finger.${piece.prep.hands.length > 1 ? ' The dashed ring is where each hand starts.' : ' Start on the dashed ring.'}` : '';
  const facts = [];
  if (piece) facts.push([icon('note', 18), piece.key.name], [icon('levels', 18), `${piece.tsName} time`]);
  if (lv.bpm) facts.push([icon('metronome', 18), `${lv.bpm[0]}–${lv.bpm[1]} bpm`]);
  $('#intro-facts').innerHTML = facts.map(([ic, t]) => `<span class="fact-chip">${ic}${esc(t)}</span>`).join('');
  const start = (demoFirst) => {
    // (no tap sound: entering the lesson plays the whoosh)
    coach.markIntroSeen(level);
    const act = coach.nextActivity();
    app.runActivity(demoFirst && act && act.kind !== 'intro' ? { ...act, demoFirst: true } : act);
  };
  $('#btn-intro-go').onclick = () => start(false);
  $('#btn-intro-hear').onclick = () => start(true);
  $('#btn-intro-go').innerHTML = `${icon('play', 24)} Let's play`;
  $('#btn-intro-hear').innerHTML = `${icon('speaker', 22)} Hear it first`;
  show('intro');
  // Entrance: the coin stamps in (CSS), then the words and the keyboard rise in reading order.
  rise([$('#intro-stage'), ...$$('#intro-facts .fact-chip')], { delay: 60, step: 40, y: 8 });
  rise([$('.intro-titles'), $('#intro-concept'), ...$$('#intro-tips li')], { delay: 160, step: 60 });
  rise([$('#intro-skill'), $('.intro-coach .pip-slot'), $('.intro-actions')], { delay: 260, step: 70 });
  // Pip says the short line; the bubble shows exactly what is spoken.
  const line = lv.say || lv.concept;
  showLine(line, { pop: false });
  popIn($('#intro-line'), { delay: 520, dur: 320, from: 0.85 });
  say(line, { silent: true });
}
app.showIntro = showIntro;

// ---- level map ----------------------------------------------------------------------------
screen('map', {
  enter() {
    updateRails();
    $('#map-list').innerHTML = STAGES.map((st, si) => {
      const items = LEVELS.filter((l) => l.n >= st.from && l.n <= st.to)
        .map((l) => {
          const placed = coach.s.placed;
          const cls = placed && l.n === coach.level ? 'current' : !placed || l.n > coach.level ? 'locked' : 'done';
          const m = cls === 'done' ? 100 : cls === 'current' ? coach.mastery() : 0;
          const tag = cls === 'done' ? ' · done' : cls === 'current' ? ' · you are here' : '';
          const k = cls === 'done' ? levelStars(l.n) : 0;
          const ic = cls === 'done' ? (k ? [0, 1, 2].map((j) => icon(j < k ? 'star' : 'starOff', 16)).join('') : icon('check', 18)) : cls === 'current' ? icon('play', 18) : icon('lock', 16);
          return `<button class="lvl ${cls}" data-level="${l.n}"><span class="lvl-ic">${ic}</span><span class="n">LEVEL ${l.n}${tag.toUpperCase()}</span><b>${esc(l.title)}</b><div class="bar"><i style="width:${m}%"></i></div></button>`;
        })
        .join('');
      return `<div class="map-stage" style="${STAGE_VARS[si]}"><h3><span class="dot">${si === 4 ? icon('crown', 20) : `<b style="font-size:17px">${si + 1}</b>`}</span>${esc(st.name)} <small>Levels ${st.from}–${st.to}</small></h3><div class="map-grid">${items}</div></div>`;
    }).join('');
    // Open at the stage you're in, then let the cards rise in from there.
    const scroller = $('#screen-map .scroller');
    const curEl = $('#map-list .lvl.current');
    scroller.scrollTop = 0;
    if (curEl) {
      const stageEl = curEl.closest('.map-stage');
      if (stageEl && stageEl.offsetTop > 200) scroller.scrollTop = stageEl.offsetTop - 110;
    }
    rise($$('#map-list .map-stage'), { delay: 60, step: 60, max: 4 });
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
const KIND_IC = {
  sight: '<path d="M3 9h26M3 14h26M3 19h26M3 24h26" stroke="currentColor" stroke-width="1.6" opacity=".5"/><g fill="currentColor"><ellipse cx="9" cy="21.5" rx="3.6" ry="2.7" transform="rotate(-22 9 21.5)"/><ellipse cx="16.5" cy="16.5" rx="3.6" ry="2.7" transform="rotate(-22 16.5 16.5)"/><ellipse cx="24" cy="11.5" rx="3.6" ry="2.7" transform="rotate(-22 24 11.5)"/><rect x="11.6" y="7" width="2.2" height="14" rx="1.1"/><rect x="19.1" y="3" width="2.2" height="13" rx="1.1"/><rect x="26.6" y="-1" width="2.2" height="12" rx="1.1" opacity="0"/></g>',
  rhythm: '<g fill="currentColor"><ellipse cx="8" cy="24" rx="4" ry="3" transform="rotate(-22 8 24)"/><ellipse cx="20" cy="24" rx="4" ry="3" transform="rotate(-22 20 24)"/><rect x="10.6" y="7" width="2.4" height="17" rx="1.2"/><rect x="22.6" y="7" width="2.4" height="17" rx="1.2"/><path d="M10.6 6.5h14.4v4.6H10.6z"/><circle cx="28.5" cy="9" r="2"/><circle cx="28.5" cy="17" r="2"/></g>',
  scale: '<g fill="currentColor"><rect x="3" y="21" width="5" height="7" rx="2.5"/><rect x="9.5" y="17" width="5" height="11" rx="2.5"/><rect x="16" y="12" width="5" height="16" rx="2.5"/><rect x="22.5" y="6" width="5" height="22" rx="2.5"/></g>',
  arpeggio: '<path d="M6 23 L13 11 L20 19 L27 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/><g fill="currentColor"><circle cx="6" cy="23" r="3.6"/><circle cx="13" cy="11" r="3.6"/><circle cx="20" cy="19" r="3.6"/><circle cx="27" cy="7" r="3.6"/></g>',
  chords: '<g fill="currentColor"><ellipse cx="12" cy="25" rx="4.4" ry="3.2" transform="rotate(-20 12 25)"/><ellipse cx="12" cy="18" rx="4.4" ry="3.2" transform="rotate(-20 12 18)"/><ellipse cx="12" cy="11" rx="4.4" ry="3.2" transform="rotate(-20 12 11)"/><rect x="15.3" y="3" width="2.4" height="21.5" rx="1.2"/><path d="M17.5 3c5 1.5 9 4.5 7.5 10-1.3-3.4-4-5-7.5-5.5z"/></g>',
  notes: '<g fill="currentColor"><ellipse cx="9" cy="24" rx="4.6" ry="3.4" transform="rotate(-22 9 24)"/><rect x="12.4" y="6" width="2.4" height="18" rx="1.2"/><path d="M14.6 6c4 1 7 3.5 6 8-1-2.6-3.2-3.8-6-4z"/></g><text x="25" y="29" text-anchor="middle" font-family="Fredoka, Nunito, sans-serif" font-weight="700" font-size="15" fill="currentColor">A</text>',
};
const KINDS = [
  ['sight', 'Sight-reading', 'Fresh music at your level', 'var(--brand)', 'var(--brand-edge)'],
  ['rhythm', 'Rhythm', 'Timing drills on any key', 'var(--flame)', 'var(--flame-edge)'],
  ['scale', 'Scales', 'Smooth fingers, up and down', 'var(--mint)', 'var(--mint-edge)'],
  ['arpeggio', 'Arpeggios', 'Broken chords across the keys', 'var(--early)', 'var(--early-edge)'],
  ['chords', 'Chords', 'Several notes together', '#E0436F', '#B32651'],
  ['notes', 'Note reading', 'Name each note, no rush', 'var(--sun)', 'var(--sun-edge)', 'var(--ink)'],
];
$('#pr-kind').innerHTML = KINDS.map(
  ([v, name, desc, c, ce, ink]) =>
    `<button class="kind${v === PR.kind ? ' on' : ''}" data-v="${v}" role="radio" aria-checked="${v === PR.kind}" style="--k:${c};--ke:${ce}"><span class="k-ic"${ink ? ` style="color:${ink}"` : ''}><svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">${KIND_IC[v]}</svg></span><b>${name}</b><small>${desc}</small><span class="k-check">${icon('check', 16)}</span></button>`,
).join('');

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
    fillRange(lvl);
    fillRange($('#pr-tempo'));
    rise([...$$('#pr-kind .kind'), $('#screen-practice .pr-card')], { delay: 60, step: 40 });
  },
});
function updatePracticeLabels() {
  const n = +$('#pr-level').value;
  const lv = levelInfo(n);
  $('#pr-level-name').innerHTML = `<span class="pr-lv" style="${STAGE_VARS[stageOf(n)]}">${n}</span> ${esc(lv.title)}`;
  const tf = +$('#pr-tempo').value / 100;
  $('#pr-tempo-val').textContent = `≈ ${Math.round(lv.bpm[0] + (lv.bpm[1] - lv.bpm[0]) * tf)} bpm`;
}
function setMode(v, locked = false) {
  const seg = $('#pr-mode');
  seg.dataset.i = v === 'wait' ? '1' : '0';
  seg.classList.toggle('locked', locked);
  $('#pr-mode-hint').textContent = locked ? 'Note reading always waits for you.' : '';
  for (const x of seg.querySelectorAll('button')) {
    const on = x.dataset.v === v;
    x.classList.toggle('on', on);
    x.setAttribute('aria-checked', String(on));
  }
}
$('#pr-kind').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b || b.classList.contains('on')) return;
  sfx('select');
  for (const x of $$('#pr-kind .kind')) {
    const on = x === b;
    x.classList.toggle('on', on);
    x.classList.toggle('just-on', on);
    x.setAttribute('aria-checked', String(on));
  }
  setTimeout(() => b.classList.remove('just-on'), 300);
  PR.kind = b.dataset.v;
  // Note reading always waits for you.
  setMode(PR.kind === 'notes' ? 'wait' : PR.mode, PR.kind === 'notes');
});
$('#pr-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b || PR.kind === 'notes') return;
  sfx('toggle', { on: b.dataset.v === 'wait' });
  PR.mode = b.dataset.v;
  setMode(PR.mode);
});
$('#pr-level').addEventListener('input', updatePracticeLabels);
$('#pr-tempo').addEventListener('input', updatePracticeLabels);
$('#btn-pr-go').addEventListener('click', () => {
  const level = +$('#pr-level').value;
  sfx('tap');
  app.withListening(() =>
    app.runActivity({ kind: PR.kind, level, mode: PR.kind === 'notes' ? 'wait' : PR.mode, tempoFactor: +$('#pr-tempo').value / 100, free: true, label: `Practice: ${PR.kind === 'sight' ? 'sight-reading' : PR.kind}` }),
  );
});
$('#btn-pr-go').innerHTML = `${icon('play', 24)} Start practice`;

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
    // [label, value, detail, number to count up to (optional), formatter]
    const pct = (v) => `${v}%`;
    const cards = [
      ['Level', `${sm.level}`, sm.info.title, sm.level],
      ['Mastery', `${sm.mastery}%`, `of level ${sm.level}`, sm.mastery, pct],
      ['Stage', sm.info.stage, `${Math.round((100 * (sm.level - 1)) / 39)}% of the way`],
      ['Avg. score', sm.avg ? `${sm.avg}%` : '–', 'last 20 exercises', sm.avg || null, pct],
      ['Practice time', fmtTime(sm.stats.seconds), 'total'],
      ['Total XP', `${sm.xp.toLocaleString()}`, `${sm.todayXp} today`, sm.xp, (v) => v.toLocaleString()],
      ['Notes played', `${sm.stats.notes.toLocaleString()}`, 'correctly', sm.stats.notes, (v) => v.toLocaleString()],
      ['Streak', `${sm.streak} day${sm.streak === 1 ? '' : 's'}`, audio.micOn && cents != null ? `piano tuning ${cents >= 0 ? '+' : ''}${Math.round(cents)}¢` : 'practise daily!'],
    ];
    $('#stats-grid').innerHTML = cards
      .map(([k, v, s], i) => {
        const [c, ce, hc] = TILE_COLORS[i];
        return `<div class="stat-tile" style="--i:${i};--c:${c};--ce:${ce};${hc ? `--hc:${hc}` : ''}"><div class="hd">${k}</div><div class="bd"><b>${esc(v)}</b><small>${esc(s)}</small></div></div>`;
      })
      .join('');
    // Numbers count up as their tiles land.
    $$('#stats-grid .stat-tile b').forEach((b, i) => {
      const [, , , to, fmt] = cards[i];
      if (typeof to === 'number' && to > 0) countUp(b, 0, to, { ms: 700, delay: 160 + i * 45, fmt: fmt || String });
    });
    const hist = sm.history.filter((h) => !h.placement).slice(-60);
    $('#history-empty').classList.toggle('hidden', hist.length > 0);
    $('#history-chart').classList.toggle('hidden', !hist.length);
    rise([$('#screen-progress .chart-card')], { delay: 300 });
    if (!hist.length) $('#history-empty').innerHTML = `${pip('think', 96)}<div class="bubble tail-left">Your scores will appear here after your first lesson.</div>`;
    else requestAnimationFrame(() => growHistory(hist));
  },
});

// The bars grow from the baseline, left to right (canvas; ~0.7 s, then it stops).
let chartRaf = 0;
function growHistory(hist) {
  cancelAnimationFrame(chartRaf);
  if (reducedMotion()) return drawHistory(hist, 1);
  const t0 = performance.now() + 250;
  const step = () => {
    const k = Math.max(0, Math.min(1, (performance.now() - t0) / 700));
    drawHistory(hist, k);
    if (k < 1 && S.screen === 'progress') chartRaf = requestAnimationFrame(step);
  };
  step();
}

function drawHistory(hist, grow = 1) {
  const c = $('#history-chart');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth,
    h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // each bar starts a little after the one before it, and eases out
    const local = Math.max(0, Math.min(1, grow * 1.6 - (i / Math.max(1, hist.length)) * 0.6));
    const g = 1 - Math.pow(1 - local, 3);
    if (g <= 0) return;
    const x = padL + 6 + i * slot;
    const bh = Math.max(6, (ph * e.score) / 100) * g;
    const [col, edge] = e.score >= 85 ? ['#20C07A', '#12985C'] : e.score >= 60 ? ['#6F4BF2', '#4F30C9'] : ['#FF5A6A', '#D93A4C'];
    ctx.fillStyle = edge;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padT + ph - bh, bw, bh, Math.min(7, bh / 2));
    else ctx.rect(x, padT + ph - bh, bw, bh);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padT + ph - bh, bw, Math.max(2, bh - 4), Math.min(7, bh / 2));
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
      fillRange(el);
    }
    updateSettingLabels();
    fillVoices();
    $('#set-info').textContent = `Input: ${audio.micOn ? 'microphone' : 'not started'}${audio.midiOn ? ' + MIDI' : ''} · sample rate ${audio.ctx ? audio.ctx.sampleRate : '–'} Hz`;
    rise($$('#screen-settings .settings > .card'), { delay: 60, step: 70 });
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
