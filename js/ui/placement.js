// Placement onboarding: "Have you played before?" -> adaptive both-hands tests -> level reveal.
import { $, S, app, coach, esc, screen, show, say, sfx } from './core.js';
import { EXPERIENCE } from '../placement.js';
import { levelInfo, STAGES } from '../music/curriculum.js';

export function startPlacementFlow() {
  app.withListening(() => show('placement'));
}
app.startPlacementFlow = startPlacementFlow;

screen('placement', {
  enter() {
    $('#exp-options').innerHTML = EXPERIENCE.map(
      (e, i) => `<button class="exp-option" data-exp="${e.id}" style="--i:${i}">
        <span class="exp-icon" aria-hidden="true">${['🌱', '🎵', '🎹', '🏆'][i]}</span>
        <b>${esc(e.label)}</b><small>${esc(e.detail)}</small></button>`,
    ).join('');
    say('Welcome to Maestro! Have you played the piano before?');
  },
});

$('#exp-options').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp]');
  if (!b) return;
  sfx('select');
  for (const x of document.querySelectorAll('.exp-option')) x.classList.toggle('picked', x === b);
  const first = coach.startPlacement(b.dataset.exp);
  const intro = 'Great. I will give you a few short pieces for both hands. Just play what you can. If it goes well they get harder, and if not, easier. Ready?';
  $('#placement-note').textContent = 'Short pieces for both hands. They get harder when you do well and easier when you don\'t, until we find your level.';
  for (const x of document.querySelectorAll('.exp-option')) x.disabled = true;
  const t0 = performance.now();
  // Give the student time to read (or hear) the explanation, then start test 1.
  say(intro).then(() => setTimeout(() => app.runActivity(first), Math.max(300, 3000 - (performance.now() - t0))));
});

// The reveal after the last test.
export function showPlacementReveal(pr) {
  app.stopPlay(true);
  show('reveal', pr);
}
app.showPlacementReveal = showPlacementReveal;

screen('reveal', {
  enter(pr) {
    const lv = levelInfo(pr.level);
    const stage = STAGES.find((s) => lv.n >= s.from && lv.n <= s.to);
    $('#reveal-level').textContent = String(lv.n);
    $('#reveal-stage').textContent = stage ? stage.name : '';
    $('#reveal-title').textContent = lv.title;
    $('#reveal-concept').textContent = lv.concept;
    // Mini chart of the tests: level tried and score.
    $('#reveal-tests').innerHTML = pr.tests
      .map(
        (t, i) => `<div class="rt" style="--i:${i}"><div class="rt-bar"><i style="height:${Math.max(4, t.score)}%" class="${t.score >= 80 ? 'good' : t.score >= 55 ? 'mid' : 'low'}"></i></div><small>L${t.level}</small><b>${t.score}%</b></div>`,
      )
      .join('');
    $('#reveal-range').textContent = pr.estimate ? `Your skill estimate: levels ${pr.estimate.low}–${pr.estimate.high}. We'll start you at ${lv.n} so the first lessons feel comfortable.` : '';
    sfx('levelup');
    say(`You're starting at level ${lv.n}: ${lv.title}.`);
    $('#btn-reveal-go').onclick = () => {
      sfx('tap');
      app.runActivity(coach.nextActivity());
    };
  },
});
