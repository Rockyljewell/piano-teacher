// Results: a radial score gauge (the stars sit on the arc and pop as the fill passes 70/85/95),
// timing feedback (tiles, early/late histogram), Pip's coaching line, level progress, and what
// comes next (hands-free auto-advance). Choreographed per the motion spec: every block is laid
// out from the first frame and only fades/rises into place; a tap anywhere skips to the end.
import { $, $$, S, app, audio, coach, esc, say, sfx, toast } from './core.js';
import { levelInfo } from '../music/curriculum.js';
import { icon, pip, confetti, reducedMotion } from './brand.js';

let stopConfetti = () => {};
const timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
function clearTimers() {
  while (timers.length) clearTimeout(timers.pop());
}

// ---- the gauge -------------------------------------------------------------------------------
// A 270° arc (r 118 in a 300 box, open at the bottom). Its length is 118 * 1.5π.
const ARC = 556.06;
const THRESHOLDS = [70, 85, 95];
const arcPoint = (pct) => {
  const a = ((135 + 2.7 * pct) * Math.PI) / 180;
  return { x: 150 + 118 * Math.cos(a), y: 150 + 118 * Math.sin(a) };
};
// Fredoka digits are proportional: each digit gets a fixed-width box so the number doesn't jiggle.
const digits = (v) => String(v).split('').map((d) => `<i>${d}</i>`).join('');
let skipGauge = () => {};

function setGauge(v) {
  const off = (ARC * (1 - Math.max(0, Math.min(100, v)) / 100)).toFixed(2);
  $('#res-gauge-fill').setAttribute('stroke-dashoffset', off);
  $('#res-gauge-edge').setAttribute('stroke-dashoffset', off);
}

function lightStar(i, sound) {
  const el = $$('#res-stars .g-star')[i];
  if (!el || el.classList.contains('lit')) return;
  el.classList.add('lit');
  el.innerHTML = icon('star', 40);
  el.setAttribute('aria-label', `Star ${i + 1}: earned`);
  if (sound) sfx(`star${i + 1}`);
}

// Fill 0 -> score (ease-out cubic) with the number counting along; a star pops (with its chime)
// the moment the fill passes its threshold.
function runGauge(score, stars, delay) {
  const num = $('#res-score');
  const res = $('#results');
  const ms = 500 + score * 6;
  let done = false;
  const finish = (sound) => {
    if (done) return;
    done = true;
    setGauge(score);
    num.innerHTML = digits(score);
    for (let i = 0; i < stars; i++) lightStar(i, sound);
  };
  skipGauge = () => finish(false);
  num.parentElement.classList.toggle('wide', score >= 100);
  if (reducedMotion()) return finish(true);
  setGauge(0);
  num.innerHTML = digits(0);
  later(() => {
    if (done) return;
    const t0 = performance.now();
    const step = () => {
      if (done || res.classList.contains('hidden')) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      const v = score * (1 - Math.pow(1 - k, 3));
      setGauge(v);
      num.innerHTML = digits(Math.round(v));
      THRESHOLDS.forEach((th, i) => {
        if (i < stars && v >= th - 0.01) lightStar(i, true);
      });
      if (k < 1) requestAnimationFrame(step);
      else finish(true);
    };
    requestAnimationFrame(step);
  }, delay);
}

// Headlines vary with how it went (never negative).
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function headline(score) {
  if (score >= 95) return pick(['Perfect!', 'Brilliant!', 'Flawless!']);
  if (score >= 85) return pick(['Great job!', 'So good!', 'Awesome!']);
  if (score >= 70) return pick(['Nice work!', 'Well played!', 'Good job!']);
  if (score >= 50) return pick(['Getting there!', 'Good effort!', 'Keep going!']);
  return pick(['Good try!', 'Tricky one!', 'Keep at it!']);
}

function histogramHtml(result) {
  const h = result.histogram;
  if (!h || result.mode !== 'tempo' || !result.errs.length) return '';
  // Re-bin to 40 ms buckets for a readable chart.
  const merge = 2;
  const bins = [];
  for (let i = 0; i < h.bins.length; i += merge) bins.push(h.bins.slice(i, i + merge).reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...bins);
  const binMs = h.binMs * merge;
  const span = -h.fromMs;
  const p = result.profile;
  const pos = (ms) => Math.max(0, Math.min(100, (100 * (ms + span)) / (2 * span)));
  const bars = bins
    .map((c, i) => {
      const from = h.fromMs + i * binMs;
      const mid = from + binMs / 2;
      const cls = !c ? 'zero' : Math.abs(mid) <= p.perfect ? 'on' : mid < 0 ? 'early' : 'late';
      const ht = c ? Math.max(10, Math.round((100 * c) / max)) : 4;
      return `<i class="${cls}" style="height:${ht}%;--k:${Math.abs(i - bins.length / 2)}" title="${from} to ${from + binMs} ms: ${c}">${c >= 3 ? c : ''}</i>`;
    })
    .join('');
  const win = `<span class="win" style="left:${pos(-p.perfect)}%;right:${100 - pos(p.perfect)}%"></span>`;
  const avg = `<span class="avg" style="left:${pos(result.medianErrMs)}%" title="Median ${result.medianErrMs} ms"></span>`;
  return `<div class="histo">
    <div class="histo-bars">${win}${bars}${avg}</div>
    <div class="histo-axis"><span>−${span} ms · early</span><span>on the beat</span><span>late · +${span} ms</span></div>
  </div>`;
}

function offsetInfo(result) {
  if (result.mode !== 'tempo') return { v: '–', d: 'wait mode', cls: 'none' };
  if (!result.hits) return { v: '–', d: 'no notes to time', cls: 'none' };
  const m = result.medianErrMs;
  const p = result.profile;
  if (Math.abs(m) <= p.perfect / 2) return { v: `${m > 0 ? '+' : m < 0 ? '−' : '±'}${Math.abs(m)} ms`, d: 'right on the beat', cls: 'none' };
  const word = Math.abs(m) <= p.perfect ? 'a touch' : Math.abs(m) <= p.great ? 'a bit' : 'quite';
  return { v: `${m > 0 ? '+' : '−'}${Math.abs(m)} ms`, d: `${word} ${m < 0 ? 'early' : 'late'}`, cls: m < 0 ? 'early' : '' };
}

function cueHtml(dir) {
  const [cls, ic, text] = dir === 'harder' ? ['harder', 'up', 'Next one: a bit harder'] : dir === 'easier' ? ['easier', 'down', "Next one: a bit easier"] : ['same', 'retry', 'One more at this level'];
  return `<span class="cue ${cls}"><span class="arrow">${icon(ic, 17)}</span>${text}</span>`;
}

export function finishPiece(result) {
  const act = S.activity;
  const piece = S.piece;
  const seconds = Math.max(1, audio.now() - S.startedAt);
  $('#countdown').textContent = '';
  clearTimers();
  stopConfetti();
  const out = coach.record(act, piece, result, seconds);
  // A song's best score before this take (for the "New best!" tag).
  const prevSong = act.kind === 'song' ? coach.songRecord(act.songId, act.arrangementId) : null;
  const prevBest = prevSong ? prevSong.best : null;
  if (act.kind === 'song') coach.recordSong(act.songId, act.arrangementId, result);
  const res = $('#results');
  res.classList.remove('placement-card', 'skip', 'anim');

  // The gauge: three stars sit on the arc at 70 / 85 / 95 and light up as the fill passes them.
  $('#res-stars').innerHTML = THRESHOLDS.map((th, i) => {
    const p = arcPoint(th);
    return `<span class="g-star" style="left:${((100 * p.x) / 300).toFixed(2)}%;top:${((100 * p.y) / 282).toFixed(2)}%" aria-label="Star ${i + 1}: ${i < result.stars ? 'earned' : `needs ${th}%`}">${icon('starOff', 40)}</span>`;
  }).join('');
  $('#res-gauge').setAttribute('aria-label', `Accuracy ${result.score}%, ${result.stars} of 3 stars`);
  runGauge(result.score, result.stars, 350);
  const best = $('#res-best');
  const newBest = prevBest != null && result.score > prevBest;
  best.classList.toggle('hidden', !newBest);
  best.innerHTML = newBest ? `${icon('trophy', 22)} New best!` : '';
  if (newBest) later(() => sfx('success'), reducedMotion() ? 0 : 1500);
  $('#res-notes').textContent = `${result.hits}/${result.total}`;
  $('#res-extra').textContent = `${result.extras} wrong note${result.extras === 1 ? '' : 's'}`;
  const tempo = result.mode === 'tempo';
  $('#res-timing').textContent = tempo && result.hits ? `${Math.round(result.timing * 100)}%` : '–';
  $('#res-timing-d').textContent = !tempo ? 'wait mode' : result.hits ? `${result.onTime} of ${result.hits} on the beat` : 'no notes to time';
  const off = offsetInfo(result);
  $('#res-offset').textContent = off.v;
  $('#res-offset-d').textContent = off.d;
  $('#tile-offset').className = `tile t-off ${off.cls}`;
  $('#res-histo').innerHTML = histogramHtml(result);
  $('#res-histo').closest('.histo-card').classList.toggle('hidden', !tempo || !result.errs.length);
  $('#res-timing-summary').textContent = result.timingSummary || '';
  // What to fix: the bar with most slips, notes missed most, the weaker hand, rushing or
  // dragging (coach.review). Up to three tips; Pip speaks one short line.
  const rv = coach.review(piece, result, act, out);
  $('#res-tips').innerHTML = rv.tips.map((t, i) => `<li style="--i:${i}">${esc(t)}</li>`).join('');
  $('#res-xp').innerHTML = out.xp ? `${icon('bolt', 20)} +${out.xp} XP${out.goalReached ? ' · daily goal!' : ''}` : '';

  // Microphone delay: corrected automatically (with an undo), or offered when auto is off.
  const lat = $('#res-latency');
  lat.innerHTML = '';
  if (out.latency && !act.placement) {
    const { from, to } = out.latency;
    lat.innerHTML = `<button class="btn btn-sm">${icon('clock', 18)} Mic delay adjusted to ${to} ms · Undo</button>`;
    lat.firstChild.onclick = () => {
      coach.setSetting('latencyMs', from);
      coach.setSetting('autoLatency', false);
      toast(`Timing offset back to ${from} ms. Automatic adjustment is off.`);
      lat.innerHTML = '';
    };
  } else if (result.suggestedLatencyMs && !act.placement && coach.settings.autoLatency === false) {
    const next = coach.settings.latencyMs + result.suggestedLatencyMs;
    lat.innerHTML = `<button class="btn btn-sm">${icon('clock', 18)} Always ${result.suggestedLatencyMs > 0 ? 'late' : 'early'} by ~${Math.abs(result.suggestedLatencyMs)} ms? Calibrate timing</button>`;
    lat.firstChild.onclick = () => {
      coach.setSetting('latencyMs', Math.max(-150, Math.min(250, next)));
      toast(`Timing offset set to ${coach.settings.latencyMs} ms`);
      lat.innerHTML = '';
    };
  }

  const lvlEl = $('#res-level');
  const lvNow = levelInfo(act.level ?? coach.level);
  let title = headline(result.score);
  let subtitle = act.kind === 'song' ? `${piece.title} · ${piece.subtitle || ''}` : act.placement ? 'Placement test' : `${act.label || 'Exercise'} · Level ${lvNow.n}`;
  let nextAct = null;
  let nextLabel = 'Next';
  let line = '';
  let autoSecs = 8;
  let nextFn = null;
  let pose = result.score >= 85 ? 'cheer' : result.score >= 60 ? 'hello' : 'oops';
  if (act.placement) {
    const pr = coach.placementResult(result);
    res.classList.add('placement-card');
    autoSecs = 4;
    title = `Test ${act.testIndex || ''} done`;
    subtitle = pr.estimate ? `Finding your level · so far about level ${Math.round((pr.estimate.low + pr.estimate.high) / 2)}` : 'Finding your level';
    if (pr.done) {
      lvlEl.innerHTML = `<span class="levelup">${icon('trophy', 26)} Placement complete! Let's see your level.</span>`;
      nextLabel = 'See my level';
      line = 'That was the last test. Let me work out your level.';
      nextFn = () => app.showPlacementReveal(pr);
      pose = 'cheer';
    } else {
      const d = pr.direction;
      S.placementCue = d;
      const total = Math.max(act.testIndex || 1, (pr.next && pr.next.estTotal) || act.estTotal || 1);
      let segs = '';
      for (let i = 1; i <= total; i++) segs += `<i class="${i <= (act.testIndex || 1) ? 'done' : i === (act.testIndex || 1) + 1 ? 'cur' : i > total - 2 ? 'maybe' : ''}"></i>`;
      lvlEl.innerHTML = `${cueHtml(d)}<div class="segs" aria-label="Test ${act.testIndex} of about ${total}">${segs}</div>`;
      line = d === 'harder' ? `${result.score} percent. Nice! Let's try something harder.` : d === 'easier' ? `${result.score} percent. No problem, let's try an easier one.` : `${result.score} percent. Let's try one more like that.`;
      sfx(d === 'harder' ? 'harder' : d === 'easier' ? 'easier' : 'tap');
      nextAct = pr.next;
      nextLabel = 'Next test';
      pose = d === 'harder' ? 'cheer' : d === 'easier' ? 'hello' : 'listen';
    }
  } else if (act.kind === 'song' || act.kind === 'import') {
    const rec = act.kind === 'song' ? coach.songRecord(act.songId, act.arrangementId) : null;
    lvlEl.innerHTML = rec ? `<div class="mastery">Best: <b>${rec.best}%</b> ${[0, 1, 2].map((i) => icon(i < rec.stars ? 'star' : 'starOff', 20)).join('')}${prevBest != null && result.score > prevBest ? `<span class="was">was ${prevBest}%</span>` : ''}</div>` : '';
    nextFn = () => {
      app.stopPlay();
      app.show('songs');
    };
    nextLabel = 'Back to songs';
    autoSecs = 0;
    line = rv.speak;
  } else if (act.free) {
    lvlEl.innerHTML = '';
    nextAct = { ...act, seed: undefined, demoFirst: false };
    nextLabel = 'Another one';
    line = rv.speak;
  } else {
    const lv = levelInfo(coach.level);
    if (out.levelUp) {
      lvlEl.innerHTML = `<span class="levelup">${icon('trophy', 26)} Level up! Welcome to <b>Level ${lv.n}: ${esc(lv.title)}</b></span>`;
      line = `Level up! Welcome to level ${lv.n}, ${lv.title}.`;
      title = 'Level up!';
      pose = 'cheer';
      later(() => sfx('levelup'), 900);
    } else if (out.levelDown) {
      lvlEl.innerHTML = `<div class="mastery">Let's strengthen the basics: back to <b>Level ${lv.n}: ${esc(lv.title)}</b></div>`;
      line = `Let's strengthen the basics with level ${lv.n}.`;
    } else {
      // The bar grows from where it was to where it is now (transform only).
      const now = coach.mastery();
      const was = Math.max(0, Math.min(now, now - out.gain));
      lvlEl.innerHTML = `<div class="mastery">Level ${lv.n} mastery <b>${out.gain >= 0 ? '+' : ''}${out.gain}</b><span class="bar grow"><i style="transform:scaleX(${Math.max(0.03, was / 100)})" data-to="${Math.max(0.03, now / 100)}"></i></span><span>${now}%</span></div>`;
      line = rv.speak;
    }
    nextAct = coach.nextActivity();
  }
  $('#res-title').textContent = title;
  $('#res-subtitle').textContent = subtitle;
  $('#res-pip').innerHTML = pip(pose, 150);
  $('#res-line').textContent = line.replace(/\s+/g, ' ').trim();
  S.nextFn = nextFn || (() => app.runActivity(nextAct));
  $('#btn-next').onclick = () => {
    clearTimeout(S.autoTimer);
    const f = S.nextFn;
    S.nextFn = null;
    if (f) f();
  };
  $('#btn-next').innerHTML = `${esc(nextLabel)} ${icon('chevron', 24)}`;
  $('#btn-retry').onclick = () => {
    clearTimers();
    stopConfetti();
    app.startSession(S.session ? S.session.mode : 'tempo');
  };
  $('#btn-retry').classList.toggle('hidden', !!act.placement);
  res.classList.remove('hidden');
  void res.offsetWidth;
  res.classList.add('anim');
  for (const b of $$('#res-level .bar.grow > i')) requestAnimationFrame(() => requestAnimationFrame(() => (b.style.transform = `scaleX(${b.dataset.to})`)));
  if (!out.levelUp) sfx(result.score >= 70 ? 'complete' : 'tryAgain');
  if ((result.stars >= 2 || out.levelUp) && !act.placement) later(() => (stopConfetti = confetti($('#confetti'), { count: 110 })), reducedMotion() ? 0 : 2100);

  // Speak the summary, then (hands-free) continue automatically.
  const auto = $('#res-auto');
  auto.textContent = '';
  const spoken = new Promise((r) => later(r, reducedMotion() ? 0 : 1900)).then(() => say(line.replace(/\s+/g, ' ').trim(), { silent: true }));
  if (coach.settings.autoAdvance && autoSecs > 0) {
    S.stayOnResults = false;
    Promise.resolve(spoken).then(() => {
      let n = autoSecs;
      const tick = () => {
        if (res.classList.contains('hidden') || S.screen !== 'play' || S.stayOnResults) return;
        if (n <= 0) {
          const f = S.nextFn;
          S.nextFn = null;
          return f && f();
        }
        auto.textContent = `Continuing in ${n}… (tap to stay)`;
        n--;
        S.autoTimer = setTimeout(tick, 1000);
      };
      tick();
    });
  }
}
app.finishPiece = finishPiece;

$('#results').addEventListener('pointerdown', (e) => {
  $('#results').classList.add('skip');
  skipGauge();
  if (e.target.closest('button')) return;
  clearTimeout(S.autoTimer);
  S.stayOnResults = true;
  $('#res-auto').textContent = '';
});
$('#btn-res-home').addEventListener('click', () => {
  app.stopPlay();
  app.show('home');
});
// Stop the celebration when the layer closes. (Only touch the class list when needed:
// classList.remove always rewrites the attribute, which would re-trigger this observer forever.)
new MutationObserver(() => {
  const r = $('#results');
  if (r.classList.contains('hidden')) {
    stopConfetti();
    stopConfetti = () => {};
    if (r.classList.contains('anim')) r.classList.remove('anim');
  }
}).observe($('#results'), { attributes: true, attributeFilter: ['class'] });
