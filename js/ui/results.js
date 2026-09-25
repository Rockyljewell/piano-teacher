// Results overlay: stars, score, timing feedback (how early/late, histogram), coaching tips,
// level progress, and what comes next (hands-free auto-advance).
import { $, S, app, audio, coach, esc, say, sfx, toast } from './core.js';
import { levelInfo } from '../music/curriculum.js';

function countUp(el, to, ms = 900) {
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(to * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
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
  const p = result.profile;
  const bars = bins
    .map((c, i) => {
      const from = h.fromMs + i * binMs;
      const mid = from + binMs / 2;
      const cls = Math.abs(mid) <= p.perfect ? 'on' : mid < 0 ? 'early' : 'late';
      return `<i class="${cls}" style="height:${Math.round((100 * c) / max)}%" title="${from} to ${from + binMs} ms: ${c}"></i>`;
    })
    .join('');
  return `<div class="histo">
    <div class="histo-bars">${bars}</div>
    <div class="histo-axis"><span>◀ early</span><span>on the beat</span><span>late ▶</span></div>
  </div>`;
}

function offsetText(result) {
  if (result.mode !== 'tempo' || !result.hits) return 'n/a';
  const m = result.medianErrMs;
  if (Math.abs(m) <= result.profile.perfect / 2) return `±${Math.abs(m)} ms`;
  return `${Math.abs(m)} ms ${m < 0 ? 'early' : 'late'}`;
}

export function finishPiece(result) {
  const act = S.activity;
  const piece = S.piece;
  const seconds = Math.max(1, audio.now() - S.startedAt);
  $('#countdown').textContent = '';
  const out = coach.record(act, piece, result, seconds);
  if (act.kind === 'song') coach.recordSong(act.songId, act.arrangementId, result);
  const card = $('#results .card');
  card.classList.remove('placement-card');

  // Stars pop in one by one.
  $('#res-stars').innerHTML = [0, 1, 2].map((i) => `<span class="star ${i < result.stars ? 'won' : 'off'}" style="--d:${250 + i * 220}ms">★</span>`).join('');
  for (let i = 0; i < result.stars; i++) setTimeout(() => sfx(`star${i + 1}`), 250 + i * 220);
  countUp($('#res-score'), result.score);
  $('#res-notes').textContent = `${result.hits}/${result.total}`;
  $('#res-timing').textContent = result.mode === 'tempo' ? `${Math.round(result.timing * 100)}%` : 'n/a';
  $('#res-extra').textContent = String(result.extras);
  $('#res-offset').textContent = offsetText(result);
  $('#res-histo').innerHTML = histogramHtml(result);
  $('#res-timing-summary').textContent = result.timingSummary || '';
  const tips = coach.feedback(piece, result);
  $('#res-tips').innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join('');
  $('#res-xp').textContent = out.xp ? `+${out.xp} XP${out.goalReached ? ' · Daily goal reached! 🎯' : ''}` : '';

  // Timing offset suggestion (consistent offset = device latency, not the player).
  const lat = $('#res-latency');
  lat.innerHTML = '';
  if (result.suggestedLatencyMs && !act.placement) {
    const next = coach.settings.latencyMs + result.suggestedLatencyMs;
    lat.innerHTML = `<button class="btn small ghost">Always ${result.suggestedLatencyMs > 0 ? 'late' : 'early'} by ~${Math.abs(result.suggestedLatencyMs)} ms? Calibrate timing</button>`;
    lat.firstChild.onclick = () => {
      coach.setSetting('latencyMs', Math.max(-150, Math.min(250, next)));
      toast(`Timing offset set to ${coach.settings.latencyMs} ms`);
      lat.innerHTML = '';
    };
  }

  const lvlEl = $('#res-level');
  let nextAct = null;
  let nextLabel = 'Next';
  let line = '';
  let autoSecs = 8;
  let nextFn = null;
  if (act.placement) {
    const pr = coach.placementResult(result);
    card.classList.add('placement-card');
    autoSecs = 4;
    if (pr.done) {
      lvlEl.innerHTML = '🎉 Placement complete!';
      nextAct = null;
      nextLabel = 'See my level';
      line = 'That was the last test. Let me work out your level.';
      nextFn = () => app.showPlacementReveal(pr);
    } else {
      const d = pr.direction;
      lvlEl.innerHTML =
        d === 'harder'
          ? '<span class="cue up">▲ Nice! The next one is a little harder.</span>'
          : d === 'easier'
            ? '<span class="cue down">▼ Let\'s try an easier one.</span>'
            : '<span class="cue">One more at this level.</span>';
      line = d === 'harder' ? `${result.score} percent. Nice! Let's try something harder.` : d === 'easier' ? `${result.score} percent. No problem, let's try an easier one.` : `${result.score} percent. Let's try one more like that.`;
      sfx(d === 'harder' ? 'harder' : d === 'easier' ? 'easier' : 'tap');
      nextAct = pr.next;
      nextLabel = 'Next test';
    }
  } else if (act.kind === 'song' || act.kind === 'import') {
    const rec = act.kind === 'song' ? coach.songRecord(act.songId, act.arrangementId) : null;
    lvlEl.innerHTML = rec ? `Best: <b>${rec.best}%</b> · ${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}` : '';
    nextFn = () => {
      app.stopPlay();
      app.show('songs');
    };
    nextLabel = 'Back to songs';
    autoSecs = 0;
    line = `${result.score} percent. ${result.timingSummary || ''}`;
  } else if (act.free) {
    lvlEl.innerHTML = '';
    nextAct = { ...act, seed: undefined };
    nextLabel = 'Another one';
    line = `${result.score} percent.`;
  } else {
    const lv = levelInfo(coach.level);
    if (out.levelUp) {
      lvlEl.innerHTML = `<span class="levelup">🏆 Level up! Welcome to <b>Level ${lv.n}: ${esc(lv.title)}</b></span>`;
      line = `Level up! Welcome to level ${lv.n}, ${lv.title}.`;
      setTimeout(() => sfx('levelup'), 900);
      $('#results').classList.add('celebrate');
    } else if (out.levelDown) {
      lvlEl.innerHTML = `Let's strengthen the basics: back to <b>Level ${lv.n}: ${esc(lv.title)}</b>`;
      line = `Let's strengthen the basics with level ${lv.n}.`;
    } else {
      lvlEl.innerHTML = `Level ${lv.n} mastery <b>${out.gain >= 0 ? '+' : ''}${out.gain}</b><div class="bar"><i style="width:${coach.mastery()}%"></i></div>`;
      line = `${result.score} percent. ${tips[0] || ''} ${result.timingSummary || ''}`;
    }
    nextAct = coach.nextActivity();
  }
  S.nextFn = nextFn || (() => app.runActivity(nextAct));
  $('#btn-next').onclick = () => {
    clearTimeout(S.autoTimer);
    const f = S.nextFn;
    S.nextFn = null;
    if (f) f();
  };
  $('#btn-next').textContent = nextLabel;
  $('#btn-retry').onclick = () => app.startSession(S.session ? S.session.mode : 'tempo');
  $('#btn-retry').classList.toggle('hidden', !!act.placement);
  $('#results').classList.remove('hidden');
  if (result.stars === 3) $('#results').classList.add('celebrate');
  if (!out.levelUp) sfx(result.score >= 70 ? 'complete' : 'tryAgain');

  // Speak the summary, then (hands-free) continue automatically.
  const auto = $('#res-auto');
  auto.textContent = '';
  const spoken = say(line.replace(/\s+/g, ' ').trim());
  if (coach.settings.autoAdvance && autoSecs > 0) {
    Promise.resolve(spoken).then(() => {
      let n = autoSecs;
      const tick = () => {
        if ($('#results').classList.contains('hidden') || S.screen !== 'play' || S.stayOnResults) return;
        if (n <= 0) {
          const f = S.nextFn;
          S.nextFn = null;
          return f && f();
        }
        auto.textContent = `Continuing in ${n}… (tap to stay)`;
        n--;
        S.autoTimer = setTimeout(tick, 1000);
      };
      S.stayOnResults = false;
      tick();
    });
  }
}
app.finishPiece = finishPiece;

$('#results').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  clearTimeout(S.autoTimer);
  S.stayOnResults = true;
  $('#res-auto').textContent = '';
});
$('#btn-res-home').addEventListener('click', () => {
  app.stopPlay();
  app.show('home');
});
// Drop the celebration glow when the overlay closes. (Only touch the class list when needed:
// classList.remove always rewrites the attribute, which would re-trigger this observer forever.)
new MutationObserver(() => {
  const r = $('#results');
  if (r.classList.contains('hidden') && r.classList.contains('celebrate')) r.classList.remove('celebrate');
}).observe($('#results'), { attributes: true, attributeFilter: ['class'] });
