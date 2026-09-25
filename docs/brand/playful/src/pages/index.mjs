import { page, wordmark, pip } from '../lib.mjs';

const screens = [
  ['home', 'Home · learning path', 'Stage banner, 3D level coins, Pip beside the current level, Continue hero, daily goal, 5-stage journey.'],
  ['placement-question', 'Placement · question', '“Have you played piano before?” with four signal-bar answers.'],
  ['placement-test', 'Placement · test 3 of ~7', 'Segmented progress with dashed “maybe” steps, a “bit harder” cue, listening state.'],
  ['placement-reveal', 'Placement · reveal', '“You’re starting at Level 12” coin, unlocked levels strip, stats.'],
  ['play', 'Play', 'HUD, paper sheet music with timing chips and early/late meter, falling notes by pitch, keyboard.'],
  ['results', 'Results', 'Stars, 92% accuracy, stat tiles, timing histogram, Pip’s coach note, Retry / Next.'],
  ['songs', 'Song library', 'Category chips, Pip’s pick, generated covers, level chips, Import MIDI.'],
  ['brand-board', 'Brand board', 'Wordmark, app icon, Pip’s poses, colour, type, components.'],
];

export default () => page({
  title: 'Maestro · Playful direction',
  tall: true,
  css: `
  body { padding: 40px 56px 60px; height: auto; }
  header { display: flex; align-items: center; gap: 24px; margin-bottom: 8px; }
  header p { color: var(--ink-2); font-size: 18px; max-width: 640px; }
  .links { display: flex; gap: 12px; margin: 18px 0 28px; } .links a { text-decoration: none; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px; }
  a.shot { display: block; color: inherit; text-decoration: none; background: #fff; border: 2px solid var(--line); border-radius: 22px; box-shadow: 0 5px 0 var(--edge); overflow: hidden; }
  a.shot img { display: block; width: 100%; aspect-ratio: 1180 / 820; object-fit: cover; object-position: top; border-bottom: 2px solid var(--line); }
  a.shot div { padding: 12px 16px 14px; }
  a.shot b { font-family: var(--font-display); font-weight: 600; font-size: 20px; }
  a.shot small { display: block; color: var(--ink-2); font-size: 15px; font-weight: 700; margin-top: 2px; }
  `,
  body: `
  <header>${pip({ pose: 'hello', size: 120 })}<div>${wordmark(64)}<p>Direction “Playful”: warm cream, one confident violet, chunky 3D buttons and Pip, a penguin who is also an eighth note. iPad landscape 1180 × 820.</p></div></header>
  <div class="links"><a class="btn btn-primary" href="spec.md">Read the spec</a><a class="btn" href="sounds.html">Hear the sounds</a><a class="btn" href="tokens.css">tokens.css</a></div>
  <div class="grid">${screens.map(([f, t, d]) => `<a class="shot" href="${f}.html"><img src="${f}.png" alt="${t}"><div><b>${t}</b><small>${d}</small></div></a>`).join('')}</div>
  `,
});
