// Placement onboarding: "Have you played before?" -> adaptive both-hands tests -> level reveal.
import { $, $$, S, app, coach, esc, screen, show, say, sfx, rise } from './core.js';
import { EXPERIENCE } from '../placement.js';
import { levelInfo, STAGES } from '../music/curriculum.js';
import { bars, icon, confetti } from './brand.js';

export function startPlacementFlow() {
  app.withListening(() => show('placement'));
}
app.startPlacementFlow = startPlacementFlow;

let picked = null;

screen('placement', {
  enter() {
    picked = null;
    $('#btn-exp-go').disabled = true;
    $('#placement-note').textContent = "Pick one, then I'll listen to a few short pieces for both hands to find your level.";
    $('#exp-options').innerHTML = EXPERIENCE.map(
      (e, i) => `<button class="exp-option" data-exp="${e.id}" role="radio" aria-checked="false" style="--i:${i}">
        <span class="ico">${bars(i + 1, 34)}</span>
        <span><b>${esc(e.label)}</b><small>${esc(e.detail)}</small></span>
        <span class="radio"></span></button>`,
    ).join('');
    rise([$('#screen-placement .coach-col .bubble'), ...$$('#exp-options .exp-option')], { delay: 80, step: 60 });
    say('Welcome to Maestro! Have you played the piano before?');
  },
});

$('#exp-options').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp]');
  if (!b || b.disabled) return;
  sfx('select');
  picked = b.dataset.exp;
  for (const x of $$('.exp-option')) {
    const on = x === b;
    x.classList.toggle('picked', on);
    x.classList.toggle('just-on', on);
    x.setAttribute('aria-checked', String(on));
    x.querySelector('.radio').innerHTML = on ? icon('check', 18) : '';
  }
  $('#btn-exp-go').disabled = false;
  setTimeout(() => b.classList.remove('just-on'), 300);
});

$('#btn-exp-go').addEventListener('click', () => {
  if (!picked) return;
  sfx('tap');
  const first = coach.startPlacement(picked);
  $('#btn-exp-go').disabled = true;
  for (const x of $$('.exp-option')) x.disabled = true;
  S.placementCue = null;
  const intro = 'Great! I will give you a few short pieces for both hands. Just play what you can. If it goes well they get harder, and if not, easier. Ready?';
  $('#placement-note').textContent = "Short pieces for both hands. They get harder when you do well and easier when you don't, until we find your level.";
  const t0 = performance.now();
  // Give the student time to read (or hear) the explanation, then start test 1.
  say(intro).then(() => setTimeout(() => S.screen === 'placement' && app.runActivity(first), Math.max(300, 3000 - (performance.now() - t0))));
});

// Skip the test: start from the very beginning.
const startAtLevel = (n) => coach.setLevel(n);
$('#btn-exp-skip').addEventListener('click', () => {
  sfx('tap');
  startAtLevel(1);
  app.runActivity(coach.nextActivity());
});

// ---- the reveal after the last test ---------------------------------------------------------
export function showPlacementReveal(pr) {
  app.stopPlay(true);
  show('reveal', pr);
}
app.showPlacementReveal = showPlacementReveal;

let stopConfetti = () => {};
screen('reveal', {
  enter(pr) {
    const lv = levelInfo(pr.level);
    const stage = STAGES.find((s) => lv.n >= s.from && lv.n <= s.to);
    $('#reveal-level').textContent = String(lv.n);
    $('#reveal-stage').textContent = stage ? stage.name : '';
    $('#reveal-headline').textContent = `You're starting at Level ${lv.n}`;
    $('#reveal-title').textContent = `${lv.title} · ${stage ? stage.name : ''} stage`;
    $('#reveal-concept').textContent = lv.concept;
    const tests = pr.tests || [];
    const avg = tests.length ? Math.round(tests.reduce((a, t) => a + t.score, 0) / tests.length) : 0;
    const facts = [
      [icon('check', 16), `${tests.length} test${tests.length === 1 ? '' : 's'}`],
      [icon('target', 16), `${avg}% average`],
    ];
    if (pr.estimate) facts.push([icon('levels', 16), `Skill ≈ levels ${pr.estimate.low}–${pr.estimate.high}`]);
    $('#reveal-tests').innerHTML = facts.map(([ic, t]) => `<span class="fact"><i>${ic}</i>${esc(t)}</span>`).join('');
    // 40 dots in 5 stages: everything below the start level is unlocked.
    let k = 0;
    $('#reveal-strip').innerHTML = STAGES.map((st) => {
      let dots = '';
      for (let n = st.from; n <= st.to; n++, k++) dots += `<i class="${n < lv.n ? 'got' : n === lv.n ? 'here' : ''}" style="--k:${k}">${n === lv.n ? n : ''}</i>`;
      return `<div class="grp"><div class="dots">${dots}</div><small>${esc(st.name)}</small></div>`;
    }).join('');
    $('#reveal-range').textContent = lv.n > 1 ? `Levels 1–${lv.n - 1} are unlocked too: revisit them any time from All levels.` : 'We start with the very first notes. You will move up quickly!';
    $('#btn-reveal-go').innerHTML = `${icon('play', 26)} Start Level ${lv.n}`;
    $('#btn-reveal-go').onclick = () => {
      sfx('tap');
      app.runActivity(coach.nextActivity());
    };
    $('#btn-reveal-level1').classList.toggle('hidden', lv.n <= 1);
    $('#btn-reveal-level1').onclick = () => {
      sfx('tap');
      startAtLevel(1);
      app.runActivity(coach.nextActivity());
    };
    sfx('levelup');
    stopConfetti();
    setTimeout(() => {
      if (S.screen === 'reveal') stopConfetti = confetti($('#reveal-confetti'), { count: 110, from: 'top', duration: 3600, palette: ['#FFC23D', '#FFFFFF', '#20C07A', '#FF9A2E', '#9B82FF', '#7CC8FF'] });
    }, 600);
    say(lv.n > 1 ? `You're starting at level ${lv.n}: ${lv.title}. I unlocked levels 1 to ${lv.n - 1} for you.` : `You're starting at level 1: ${lv.title}. Let's begin!`);
  },
  leave() {
    stopConfetti();
  },
});
