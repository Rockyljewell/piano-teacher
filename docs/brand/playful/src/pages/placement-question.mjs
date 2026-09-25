import { page, pip, icon, bars } from '../lib.mjs';

const options = [
  { lvl: 1, t: 'Never, I’m brand new', d: 'We’ll start with your very first note.' },
  { lvl: 2, t: 'A little', d: 'I can pick out a tune with one hand.', on: true },
  { lvl: 3, t: 'Yes, I’ve had lessons', d: 'I read notes and play with both hands.' },
  { lvl: 4, t: 'Lots, challenge me!', d: 'I play real pieces from sheet music.' },
];

export default () => page({
  title: 'Maestro · Placement question (playful)',
  css: `
  .top { position: absolute; left: 32px; right: 32px; top: 24px; display: flex; align-items: center; gap: 20px; }
  .top .bar { flex: 1; height: 18px; }
  .top .step { font-weight: 800; font-size: 15px; color: var(--ink-3); white-space: nowrap; }
  .left { position: absolute; left: 56px; top: 128px; width: 470px; }
  .left .bubble { font-family: var(--font-display); font-weight: 600; font-size: 34px; line-height: 1.15; padding: 22px 26px; }
  .left .bubble .speaker { vertical-align: -2px; }
  .left .pipwrap { margin: 30px 0 0 70px; }
  .left .bubble::after { left: 150px; }
  .left .note { margin-top: 10px; font-weight: 700; font-size: 17px; color: var(--ink-2); max-width: 420px; }
  .opts { position: absolute; left: 580px; top: 128px; width: 548px; display: flex; flex-direction: column; gap: 18px; }
  .opt {
    display: grid; grid-template-columns: 56px 1fr 32px; align-items: center; gap: 16px;
    height: 112px; padding: 0 24px; border-radius: 24px; background: #fff;
    border: 2.5px solid var(--line); box-shadow: 0 5px 0 var(--edge);
  }
  .opt .ico { width: 56px; height: 56px; border-radius: 16px; background: var(--brand-soft); display: grid; place-items: center; }
  .opt b { display: block; font-family: var(--font-display); font-weight: 600; font-size: 24px; line-height: 1.15; }
  .opt small { display: block; font-weight: 700; font-size: 16px; color: var(--ink-2); margin-top: 2px; }
  .opt .radio { width: 30px; height: 30px; border-radius: 50%; border: 3px solid var(--edge); }
  .opt.on { background: var(--brand-soft); border-color: var(--brand); box-shadow: 0 5px 0 var(--brand-hi); }
  .opt.on b { color: var(--brand-ink); }
  .opt.on .ico { background: #fff; }
  .opt.on .radio { border: 0; background: var(--brand); display: grid; place-items: center; color: #fff; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: 112px; border-top: 2px solid var(--line); display: flex; align-items: center; justify-content: space-between; padding: 0 52px; }
  .foot .btn-lg { min-width: 260px; }
  `,
  body: `
  <header class="top">
    <button class="icon-btn" aria-label="Back">${icon('back', 22)}</button>
    <div class="bar"><i style="width:12%"></i></div>
    <span class="step">Find my level</span>
  </header>

  <section class="left">
    <div class="bubble tail-bottom-left">${icon('speaker', 28, 'speaker')}Have you played piano before?</div>
    <div class="pipwrap anim-bob">${pip({ pose: 'think', size: 250 })}</div>
    <p class="note">Pick one, then I’ll listen to a few short tunes to find your perfect starting level.</p>
  </section>

  <section class="opts" role="radiogroup" aria-label="Piano experience">
    ${options.map((o) => `
    <div class="opt${o.on ? ' on' : ''}" role="radio" aria-checked="${!!o.on}">
      <span class="ico">${bars(o.lvl, 34)}</span>
      <div><b>${o.t}</b><small>${o.d}</small></div>
      <span class="radio">${o.on ? icon('check', 18) : ''}</span>
    </div>`).join('')}
  </section>

  <footer class="foot">
    <button class="btn btn-ghost">Skip, start at Level 1</button>
    <button class="btn btn-primary btn-lg">Continue</button>
  </footer>
  `,
});
