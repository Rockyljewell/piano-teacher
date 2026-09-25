import { page, pip, icon, rail } from '../lib.mjs';

// Learning path for stage 2 (Elementary, levels 9-16). Level 12 is current.
const nodes = [
  { n: 9, x: 478, y: 172, st: 'done', stars: 3, title: 'Melodies across both hands' },
  { n: 10, x: 414, y: 272, st: 'done', stars: 3, title: 'Harmonic intervals' },
  { n: 11, x: 380, y: 372, st: 'done', stars: 2, title: 'F major and B flat' },
  { n: 12, x: 410, y: 510, st: 'current', title: 'Dotted rhythms' },
  { n: 13, x: 474, y: 642, st: 'locked', title: 'Moving around the keyboard' },
  { n: 14, x: 540, y: 746, st: 'locked', title: 'Left-hand chords' },
  { n: 15, x: 572, y: 850, st: 'locked', title: 'Minor keys' },
];

const trail = () => {
  let d = `M${nodes[0].x} ${nodes[0].y - 60}`;
  let prev = { x: nodes[0].x, y: nodes[0].y - 60 };
  for (const p of nodes) {
    const my = (prev.y + p.y) / 2;
    d += ` C${prev.x} ${my} ${p.x} ${my} ${p.x} ${p.y}`;
    prev = p;
  }
  return d;
};
const doneTrail = () => {
  let d = `M${nodes[0].x} ${nodes[0].y - 60}`;
  let prev = { x: nodes[0].x, y: nodes[0].y - 60 };
  for (const p of nodes.slice(0, 4)) {
    const my = (prev.y + p.y) / 2;
    d += ` C${prev.x} ${my} ${p.x} ${my} ${p.x} ${p.y}`;
    prev = p;
  }
  return d;
};

const starRow = (k) => `<div class="stars">${[0, 1, 2].map((i) => icon(i < k ? 'star' : 'starOff', 20)).join('')}</div>`;

const nodeHtml = (p) => {
  if (p.st === 'current') {
    return `
    <div class="cur-ring" style="left:${p.x - 66}px;top:${p.y - 62}px"></div>
    <div class="cur-ring pulse" style="left:${p.x - 66}px;top:${p.y - 62}px"></div>
    <div class="node current big" style="left:${p.x - 52}px;top:${p.y - 46}px">${p.n}</div>`;
  }
  const inner = p.st === 'locked' ? `<span>${p.n}</span>` : `${p.n}`;
  return `<div class="node ${p.st}" style="left:${p.x - 42}px;top:${p.y - 38}px">${inner}</div>
    ${p.st === 'done' ? `<div class="under" style="left:${p.x - 40}px;top:${p.y + 44}px">${starRow(p.stars)}</div>` : ''}`;
};

export default () => page({
  title: 'Maestro · Home (playful)',
  css: `
  .path-col { position: absolute; left: 212px; top: 0; width: 520px; height: 820px; overflow: hidden; }
  .path-col > * { position: absolute; }
  .path-svg { left: -212px; top: 0; }
  .banner {
    left: 24px; top: 20px; width: 472px; height: 92px; border-radius: 22px; z-index: 3;
    background: var(--stage-2); box-shadow: 0 6px 0 var(--stage-2-edge);
    color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 16px 0 24px;
  }
  .banner .eyebrow { opacity: .85; }
  .banner h2 { font-size: 30px; line-height: 1.05; margin-top: 2px; }
  .banner .guide { display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 16px; border-radius: 16px; border: 2.5px solid rgba(255,255,255,.45); box-shadow: 0 4px 0 rgba(0,0,0,.14); font-family: var(--font-display); font-size: 18px; font-weight: 600; }
  .fade-top { left: 0; top: 0; width: 520px; height: 150px; background: linear-gradient(var(--bg) 70%, rgba(255,247,234,0)); z-index: 2; }
  .node { left: 0; top: 0; }
  .node.locked span { opacity: .9; }
  .node.big { width: 104px; height: 92px; font-size: 38px; box-shadow: 0 9px 0 var(--n-edge); }
  .node.big::before { left: 20px; right: 20px; top: 10px; height: 16px; }
  .cur-ring { width: 132px; height: 132px; border-radius: 50%; border: 8px solid #DCD2FF; }
  .cur-ring.pulse { border-color: var(--brand); opacity: .0; }
  .cur-ring::after { content: ""; position: absolute; inset: -8px; border-radius: 50%; border: 8px solid transparent; border-top-color: var(--brand); border-right-color: var(--brand); transform: rotate(-45deg); }
  .cur-ring.pulse::after { display: none; }
  @media (prefers-reduced-motion: no-preference) { .cur-ring.pulse { animation: pulse-ring 1.8s var(--ease-out) infinite; } }
  .start-tip {
    width: 116px; height: 46px; border-radius: 14px; background: #fff; border: 2.5px solid var(--line);
    box-shadow: 0 4px 0 var(--edge); color: var(--brand-ink); z-index: 4;
    display: grid; place-items: center; font-family: var(--font-display); font-weight: 600; font-size: 20px; letter-spacing: .06em; text-transform: uppercase;
  }
  .start-tip::after { content: ""; position: absolute; left: 50%; bottom: -10px; width: 16px; height: 16px; margin-left: -8px; background: #fff; border-right: 2.5px solid var(--line); border-bottom: 2.5px solid var(--line); transform: rotate(45deg); border-radius: 0 0 4px 0; }
  .under .stars { display: flex; gap: 0; width: 80px; justify-content: center; }
  .coach { left: 300px; top: 356px; width: 212px; z-index: 3; }
  .coach .bubble { font-size: 18px; padding: 12px 16px; line-height: 1.32; }
  .coach-pip { left: 330px; top: 478px; z-index: 3; }
  .lvl-label { font-family: var(--font-display); font-weight: 600; font-size: 17px; color: var(--ink-2); white-space: nowrap; }

  /* right column */
  .side { position: absolute; left: 748px; top: 20px; width: 412px; display: flex; flex-direction: column; gap: 16px; }
  .pills { display: flex; gap: 10px; }
  .pill .mic { width: 12px; height: 12px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 0 4px var(--mint-soft); margin: 0 4px 0 6px; }
  .pill.mic-pill { font-family: var(--font-ui); font-weight: 800; font-size: 16px; color: var(--mint-ink); }
  .hero {
    position: relative; overflow: hidden; border-radius: 26px; padding: 20px 24px 22px;
    background: var(--brand); box-shadow: 0 7px 0 var(--brand-edge); color: #fff;
  }
  .hero .eyebrow { color: #F3EFFF; }
  .hero h1 { font-size: 36px; line-height: 1.05; margin: 6px 0 6px; }
  .hero p { font-size: 17px; font-weight: 700; color: #F3EFFF; line-height: 1.4; max-width: 350px; }
  .hero .prog { display: flex; align-items: center; gap: 12px; margin: 14px 0 16px; font-weight: 800; font-size: 15px; color: #fff; }
  .hero .bar { flex: 1; height: 14px; background: rgba(255,255,255,.22); }
  .hero .bar > i { background: var(--sun); }
  .hero .deco { position: absolute; right: 14px; top: 14px; opacity: .2; color: #fff; }
  .hero .btn { color: var(--brand-ink); }
  .goal { display: grid; grid-template-columns: 104px 1fr; gap: 18px; align-items: center; padding: 16px 20px; }
  .ring { position: relative; width: 104px; height: 104px; } .ring svg { width: 104px; height: 104px; }
  .ring svg { position: absolute; inset: 0; }
  .ring .v { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
  .ring .v b { font-family: var(--font-display); font-weight: 600; font-size: 28px; line-height: 1; }
  .ring .v small { font-weight: 800; font-size: 13px; color: var(--ink-3); }
  .goal h3 { font-size: 21px; }
  .goal p { font-size: 15px; color: var(--ink-2); font-weight: 700; margin: 2px 0 10px; }
  .week { display: flex; gap: 3px; }
  .week .d { width: 32px; text-align: center; font-weight: 800; font-size: 12px; color: var(--ink-3); line-height: 1.2; }
  .week .d i { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--flame-soft); margin-bottom: 3px; }
  .week .d.off i { background: #F3EADB; }
  .week .d.today i { background: #fff; border: 2.5px dashed var(--flame); }
  .week .d.today { color: var(--flame-ink); }
  .journey { padding: 14px 20px 10px; }
  .journey h3 { font-size: 21px; display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .journey h3 small { font-family: var(--font-ui); font-weight: 800; font-size: 14px; color: var(--ink-3); }
  .stage { display: grid; grid-template-columns: 30px 1fr 84px 40px; gap: 12px; align-items: center; height: 38px; }
  .stage .dot { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; color: #fff; box-shadow: inset 0 -3px 0 rgba(0,0,0,.16); }
  .stage b { font-family: var(--font-display); font-weight: 600; font-size: 18px; }
  .stage b small { font-family: var(--font-ui); font-weight: 700; font-size: 13px; color: var(--ink-3); margin-left: 6px; }
  .stage .bar { height: 12px; }
  .stage .cnt { font-weight: 800; font-size: 14px; color: var(--ink-2); text-align: right; }
  .stage.locked b { color: var(--ink-3); }
  .stage.now { background: var(--brand-soft); margin: 0 -10px; padding: 0 10px; border-radius: 12px; }
  `,
  body: `
  ${rail('learn')}
  <main class="path-col">
    <svg class="path-svg" width="732" height="820" viewBox="0 0 732 820" aria-hidden="true">
      <path d="${trail()}" fill="none" stroke="#F1E4CE" stroke-width="22" stroke-linecap="round"/>
      <path d="${doneTrail()}" fill="none" stroke="#FFE4A1" stroke-width="22" stroke-linecap="round"/>
      <path d="${trail()}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 14" opacity=".9"/>
    </svg>
    <div class="fade-top"></div>
    <header class="banner">
      <div><div class="eyebrow">Stage 2 · Levels 9–16</div><h2>Elementary</h2></div>
      <div class="guide">${icon('book', 22)} Guide</div>
    </header>
    ${nodes.map((p) => nodeHtml({ ...p, x: p.x - 212 })).join('')}
    <div class="coach"><div class="bubble tail-bottom-left">${icon('speaker', 20, 'speaker')}Welcome back, Sam! Today we make rhythms <b>bounce</b>.</div></div>
    <div class="coach-pip anim-bob">${pip({ pose: 'hello', size: 150 })}</div>
  </main>

  <aside class="side">
    <div class="pills">
      <span class="pill flame">${icon('flame', 26)} 12</span>
      <span class="pill sun">${icon('bolt', 26)} 1,240 XP</span>
      <span class="pill mic-pill"><i class="mic"></i>Mic ready</span>
    </div>

    <section class="hero">
      <svg class="deco" width="96" height="86" viewBox="0 0 170 150" aria-hidden="true" fill="currentColor">
        <circle cx="52" cy="112" r="20"/><rect x="66" y="22" width="9" height="92" rx="4.5"/><rect x="126" y="6" width="9" height="92" rx="4.5"/><circle cx="112" cy="96" r="20"/><path d="M70 22 L135 6 L135 30 L70 46 Z"/>
      </svg>
      <div class="eyebrow">Up next · Level 12</div>
      <h1>Dotted rhythms</h1>
      <p>A dot makes a note longer. Long‑short pairs make a tune skip along.</p>
      <div class="prog">Exercise 2 of 5<div class="bar"><i style="width:28%"></i></div></div>
      <button class="btn btn-white-on-brand btn-lg btn-block">${icon('play', 24)} Continue</button>
    </section>

    <section class="card goal">
      <div class="ring">
        <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
          <circle cx="56" cy="56" r="47" fill="none" stroke="#F3EADB" stroke-width="13"/>
          <circle cx="56" cy="56" r="47" fill="none" stroke="var(--sun)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 47 * 0.6).toFixed(1)} 400" transform="rotate(-90 56 56)"/>
        </svg>
        <div class="v"><b>30</b><small>of 50 XP</small></div>
      </div>
      <div>
        <h3>Daily goal</h3>
        <p>20 XP to go · about one exercise</p>
        <div class="week">
          ${['M', 'T', 'W', 'T', 'F'].map((d) => `<div class="d"><i>${icon('flame', 20)}</i>${d}</div>`).join('')}
          <div class="d today"><i>${icon('flameOff', 20)}</i>S</div>
          <div class="d off"><i></i>S</div>
        </div>
      </div>
    </section>

    <section class="card journey">
      <h3>Your journey <small>40 levels</small></h3>
      <div class="stage"><span class="dot" style="background:var(--stage-1)">${icon('check', 18)}</span><b>Beginner<small>1–8</small></b><div class="bar mint"><i style="width:100%"></i></div><span class="cnt">8/8</span></div>
      <div class="stage now"><span class="dot" style="background:var(--stage-2)">${icon('play', 14)}</span><b>Elementary<small>9–16</small></b><div class="bar"><i style="width:37.5%"></i></div><span class="cnt">3/8</span></div>
      <div class="stage locked"><span class="dot" style="background:var(--stage-3);opacity:.45">${icon('lock', 16)}</span><b>Intermediate<small>17–26</small></b><div class="bar"><i style="width:0"></i></div><span class="cnt">0/10</span></div>
      <div class="stage locked"><span class="dot" style="background:var(--stage-4);opacity:.45">${icon('lock', 16)}</span><b>Advanced<small>27–34</small></b><div class="bar"><i style="width:0"></i></div><span class="cnt">0/8</span></div>
      <div class="stage locked"><span class="dot" style="background:var(--stage-5);opacity:.45">${icon('crown', 18)}</span><b>Master<small>35–40</small></b><div class="bar"><i style="width:0"></i></div><span class="cnt">0/6</span></div>
    </section>
  </aside>
  `,
});
