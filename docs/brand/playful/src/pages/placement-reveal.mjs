import { page, pip, icon, confetti } from '../lib.mjs';

const STAGES = [
  ['Beginner', 1, 8, 'var(--stage-1)'], ['Elementary', 9, 16, 'var(--stage-2)'], ['Intermediate', 17, 26, 'var(--stage-3)'],
  ['Advanced', 27, 34, 'var(--stage-4)'], ['Master', 35, 40, 'var(--stage-5)'],
];
const START = 12;

const strip = () => STAGES.map(([name, a, b]) => {
  let dots = '';
  for (let n = a; n <= b; n++) {
    const cls = n < START ? 'got' : n === START ? 'here' : '';
    dots += `<i class="${cls}">${n === START ? START : ''}</i>`;
  }
  return `<div class="grp"><div class="dots">${dots}</div><small>${name}</small></div>`;
}).join('');

export default () => page({
  title: 'Maestro · Placement result (playful)',
  css: `
  body { background: var(--brand); color: #fff; }
  .rays { position: absolute; left: 50%; top: 250px; width: 1500px; height: 1500px; margin: -750px 0 0 -750px; border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, rgba(255,255,255,.07) 0deg 9deg, rgba(255,255,255,0) 9deg 18deg);
    -webkit-mask: radial-gradient(circle, #000 20%, transparent 62%); mask: radial-gradient(circle, #000 20%, transparent 62%); }
  .confetti { position: absolute; left: 0; top: 0; }
  .coin-wrap { position: absolute; left: 50%; top: 58px; transform: translateX(-50%); width: 220px; height: 230px; }
  .coin { position: absolute; left: 20px; top: 0; width: 180px; height: 166px; border-radius: 50%; background: var(--sun); box-shadow: 0 12px 0 var(--sun-edge), 0 26px 40px -10px rgba(30,10,90,.45);
    display: grid; place-items: center; font-family: var(--font-display); font-weight: 700; font-size: 84px; color: var(--ink); }
  .coin::before { content: ""; position: absolute; left: 30px; right: 30px; top: 14px; height: 26px; border-radius: 50%; background: rgba(255,255,255,.35); }
  .coin::after { content: ""; position: absolute; inset: 12px; border-radius: 50%; border: 5px dashed rgba(138,90,0,.25); }
  .ribbon { position: absolute; left: 0; right: 0; top: 150px; height: 50px; background: #fff; color: var(--brand-ink); border-radius: 14px; box-shadow: 0 5px 0 #D8CCFF;
    display: grid; place-items: center; font-family: var(--font-display); font-weight: 600; font-size: 22px; letter-spacing: .06em; text-transform: uppercase; }
  .ribbon::before, .ribbon::after { content: ""; position: absolute; top: 12px; width: 26px; height: 40px; background: #E4DCFF; z-index: -1; }
  .ribbon::before { left: -16px; clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 40% 50%); }
  .ribbon::after { right: -16px; clip-path: polygon(0 0, 100% 0, 60% 50%, 100% 100%, 0 100%); }
  h1 { position: absolute; left: 0; right: 0; top: 304px; text-align: center; font-size: 56px; line-height: 1.05; font-weight: 700; text-shadow: 0 4px 0 var(--brand-edge); }
  .sub { position: absolute; left: 0; right: 0; top: 376px; text-align: center; font-size: 21px; font-weight: 700; color: #F3EFFF; }
  .facts { position: absolute; left: 0; right: 0; top: 422px; display: flex; justify-content: center; gap: 12px; }
  .fact { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 16px 0 10px; border-radius: 999px; background: rgba(255,255,255,.14); border: 2px solid rgba(255,255,255,.22); font-weight: 800; font-size: 16px; }
  .fact i { width: 26px; height: 26px; border-radius: 50%; background: #fff; color: var(--brand); display: grid; place-items: center; }
  .journey { position: absolute; left: 50%; top: 492px; transform: translateX(-50%); display: flex; gap: 16px; padding: 16px 22px 12px; border-radius: 22px; background: rgba(33,14,110,.28); }
  .grp { text-align: center; }
  .grp small { display: block; margin-top: 6px; font-weight: 800; font-size: 14px; color: #F3EFFF; letter-spacing: .04em; }
  .dots { display: flex; gap: 5px; align-items: center; height: 40px; }
  .dots i { width: 16px; height: 16px; border-radius: 50%; background: rgba(255,255,255,.22); display: grid; place-items: center; font-style: normal; }
  .dots i.got { background: #fff; }
  .dots i.here { width: 40px; height: 40px; background: var(--sun); box-shadow: 0 4px 0 var(--sun-edge), 0 0 0 5px rgba(255,194,61,.3); font-family: var(--font-display); font-weight: 700; font-size: 20px; color: var(--ink); }
  .actions { position: absolute; left: 0; right: 0; top: 636px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .actions .btn-lg { min-width: 340px; height: 72px; font-size: 26px; }
  .actions .btn-ghost { --b-ink: #fff; font-size: 19px; opacity: .92; }
  .pipL { position: absolute; left: 64px; top: 56px; }
  .pipL .bubble { position: absolute; left: 200px; top: 26px; width: 214px; font-size: 18px; padding: 12px 16px; color: var(--ink); }
  .fine { position: absolute; right: 44px; bottom: 30px; width: 230px; text-align: right; font-weight: 700; font-size: 15px; color: #DCD3FF; }
  `,
  body: `
  <div class="rays"></div>
  ${confetti(5, 200, undefined, ['#FFC23D', '#FFFFFF', '#20C07A', '#FF9A2E', '#9B82FF', '#7CC8FF'], [[60, 50, 420, 215], [460, 50, 262, 220], [220, 296, 740, 170], [110, 486, 960, 104], [400, 626, 380, 140]])}
  <div class="coin-wrap"><div class="coin">12</div><div class="ribbon">Elementary</div></div>
  <h1>You’re starting at Level 12</h1>
  <p class="sub">Dotted rhythms · you already know your notes, both hands and 3/4 time.</p>
  <div class="facts">
    <span class="fact"><i>${icon('check', 16)}</i>6 tests</span>
    <span class="fact"><i>${icon('target', 16)}</i>91% average</span>
    <span class="fact"><i>${icon('clock', 16)}</i>Timing ±38 ms</span>
  </div>
  <div class="journey" aria-label="Levels 1 to 11 unlocked, starting at level 12">${strip()}</div>
  <div class="pipL">${pip({ pose: 'cheer', size: 200 })}<div class="bubble tail-left">Wow! I unlocked <b>Levels 1–11</b> for you. Revisit them any time.</div></div>
  <div class="actions">
    <button class="btn btn-white-on-brand btn-lg">${icon('play', 26)} Start Level 12</button>
    <button class="btn btn-ghost">Start at Level 1 instead</button>
  </div>
  `,
});
