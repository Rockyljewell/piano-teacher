import { page, pip, pipFace, icon, wordmark, keyboard, meter } from '../lib.mjs';

const poses = [
  ['hello', 'Hello', 'Home, greetings, tips'],
  ['listen', 'Listening', 'Mic check, placement, "your turn"'],
  ['conduct', 'Conducting', 'Count-in, Listen demo, tempo'],
  ['cheer', 'Yay!', 'Stars, level up, streak'],
  ['oops', 'Oops', 'Missed notes, mic trouble'],
  ['think', 'Hmm', 'Choices, placement question'],
  ['sleep', 'Snooze', 'Streak at risk, idle'],
];

const sw = (name, hex, v, ink = '#fff') => `<div class="sw"><i style="background:${v};color:${ink}">${hex}</i><b>${name}</b></div>`;

export default () => page({
  title: 'Maestro · Playful brand board',
  tall: true,
  css: `
  body { height: auto; padding: 48px 56px 64px; }
  .hero { display: grid; grid-template-columns: 1fr 360px; gap: 40px; align-items: center; margin-bottom: 44px; }
  .hero h1 { font-size: 20px; color: var(--ink-2); font-family: var(--font-ui); font-weight: 800; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 14px; }
  .hero p { font-size: 22px; color: var(--ink-2); max-width: 560px; margin-top: 18px; font-weight: 700; }
  .lockups { display: flex; gap: 20px; align-items: center; justify-content: flex-end; }
  .appicon { width: 132px; height: 132px; border-radius: 30px; box-shadow: 0 8px 0 var(--brand-edge), var(--shadow-pop); overflow: hidden; }
  .appicon.sm { width: 76px; height: 76px; border-radius: 18px; box-shadow: 0 5px 0 var(--brand-edge); }
  .on-brand { background: var(--brand); border-radius: 28px; padding: 26px 34px; box-shadow: 0 7px 0 var(--brand-edge); }
  section { margin-top: 40px; }
  section > h2 { font-size: 30px; margin-bottom: 6px; }
  section > p.lead { color: var(--ink-2); font-size: 17px; margin-bottom: 20px; max-width: 820px; }
  .poses { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
  .pose { background: #fff; border: 2px solid var(--line); border-radius: 22px; box-shadow: 0 5px 0 var(--edge); padding: 16px 8px 14px; text-align: center; }
  .pose .pip { display: block; margin: 0 auto 6px; }
  .pose b { font-family: var(--font-display); font-weight: 600; font-size: 19px; display: block; }
  .pose small { color: var(--ink-2); font-size: 13px; font-weight: 700; line-height: 1.3; display: block; margin-top: 2px; }
  .anatomy { display: grid; grid-template-columns: 300px 1fr; gap: 28px; align-items: center; margin-top: 18px; background: #fff; border: 2px solid var(--line); border-radius: 22px; padding: 18px 28px; }
  .anatomy ul { margin: 0; padding-left: 20px; color: var(--ink-2); font-size: 16px; line-height: 1.55; }
  .anatomy li b { color: var(--ink); }
  .grid-sw { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; }
  .sw i { border: 2px solid rgba(42,35,70,.08); display: flex; align-items: flex-end; height: 76px; border-radius: 16px; padding: 8px 10px; font-style: normal; font-weight: 800; font-size: 13px; box-shadow: inset 0 -5px 0 rgba(0,0,0,.12); }
  .sw b { display: block; font-size: 14px; margin-top: 6px; font-weight: 800; }
  .sw-row-label { font-family: var(--font-display); font-size: 19px; font-weight: 600; margin: 18px 0 10px; }
  .type { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .type .card { padding: 22px 26px; }
  .spec-line { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px dashed var(--line); padding: 7px 0; }
  .spec-line:last-child { border-bottom: 0; }
  .spec-line small { color: var(--ink-3); font-weight: 800; font-size: 13px; }
  .comp { display: grid; grid-template-columns: 1.15fr 1fr; gap: 20px; }
  .comp .card { padding: 22px 26px; }
  .comp h3 { font-size: 19px; margin-bottom: 14px; }
  .row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
  .nodes { position: relative; height: 120px; }
  .nodes .node { position: absolute; top: 12px; }
  .nodes label { position: absolute; top: 100px; width: 84px; text-align: center; font-size: 13px; font-weight: 800; color: var(--ink-2); }
  .ring { position: absolute; border-radius: 50%; border: 6px solid var(--brand-soft); }
  code { font-family: var(--font-ui); font-weight: 800; font-size: .92em; background: #F3EADB; padding: 1px 6px; border-radius: 6px; }
  .pitch { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; }
  .pitch div { height: 64px; border-radius: 14px; display: grid; place-items: center; font-family: var(--font-display); font-size: 28px; font-weight: 600; color: #fff; }
  `,
  body: `
  <div class="hero">
    <div>
      <h1>Maestro · direction “Playful”</h1>
      ${wordmark(112)}
      <p>A warm, bouncy piano coach with a friend inside. Pip listens to every note, cheers the wins, and makes the hard bits feel like a game.</p>
    </div>
    <div class="lockups">
      <div class="appicon">${pipFace({ size: 132, bg: '#6F4BF2' })}</div>
      <div style="display:flex;flex-direction:column;gap:14px;align-items:center">
        <div class="appicon sm">${pipFace({ size: 76, bg: '#6F4BF2' })}</div>
        <div class="appicon sm" style="box-shadow:0 5px 0 var(--edge)">${pipFace({ size: 76, bg: '#FFF7EA' })}</div>
      </div>
    </div>
  </div>

  <div class="on-brand" style="display:flex;align-items:center;justify-content:space-between">
    ${wordmark(64, '#fff')}
    <span style="color:#fff;font-family:var(--font-display);font-size:24px;font-weight:500;opacity:.92">Your piano buddy that listens.</span>
    ${pip({ pose: 'conduct', size: 104 })}
  </div>

  <section>
    <h2>Meet Pip</h2>
    <p class="lead">A round little penguin in concert tails. Pip’s body is the note head and the tuft is the stem and flag of an eighth note, so Pip literally <b>is</b> a note. Pip speaks every coach line (Web Speech) and the same words appear in a speech bubble.</p>
    <div class="poses">
      ${poses.map(([p, n, d]) => `<div class="pose">${pip({ pose: p, size: 112 })}<b>${n}</b><small>${d}</small></div>`).join('')}
    </div>
    <div class="anatomy">
      ${pip({ pose: 'hello', size: 220 })}
      <ul>
        <li><b>Silhouette:</b> an egg (body = note head) + eighth-note tuft. Readable at 28 px as an avatar.</li>
        <li><b>Colours:</b> midnight body <code>#2E2B5F</code>, cream mask <code>#FFF4E0</code>, beak and feet <code>#FFA629</code>, violet bow tie (brand), pink cheeks at 60%.</li>
        <li><b>Face:</b> big glossy eyes with two highlights; the eyes carry the emotion (joy arcs, worried brows, wink).</li>
        <li><b>Motion:</b> idle bob 2.4 s, blink every 3–6 s, squash 6% on landing, flippers lead every gesture.</li>
        <li><b>Rules:</b> never mocks, never frowns at the player, never covers the notes you are about to play.</li>
      </ul>
    </div>
  </section>

  <section>
    <h2>Colour</h2>
    <p class="lead">Warm cream paper, one confident violet, and reward colours that always mean the same thing. Every fill has a darker “edge” shade for the 3D bottom border.</p>
    <div class="sw-row-label">Brand & surfaces</div>
    <div class="grid-sw">
      ${sw('Violet (brand)', '#6F4BF2', 'var(--brand)')}
      ${sw('Violet edge', '#4F30C9', 'var(--brand-edge)')}
      ${sw('Violet soft', '#EEE8FF', 'var(--brand-soft)', 'var(--brand-ink)')}
      ${sw('Cream (bg)', '#FFF7EA', 'var(--bg)', 'var(--ink-2)')}
      ${sw('Paper (sheet)', '#FFFCF4', 'var(--paper)', 'var(--ink-2)')}
      ${sw('Ink', '#2A2346', 'var(--ink)')}
    </div>
    <div class="sw-row-label">Rewards & feedback</div>
    <div class="grid-sw">
      ${sw('Sun · XP, Perfect', '#FFC23D', 'var(--sun)', 'var(--ink)')}
      ${sw('Flame · streak', '#FF7A2F', 'var(--flame)', 'var(--ink)')}
      ${sw('Mint · hit, Great', '#20C07A', 'var(--mint)', 'var(--ink)')}
      ${sw('Coral · miss', '#FF5A6A', 'var(--coral)', 'var(--ink)')}
      ${sw('Early (cool, left)', '#2F9BFF', 'var(--early)', 'var(--ink)')}
      ${sw('Late (warm, right)', '#FF9A2E', 'var(--late)', 'var(--ink)')}
    </div>
    <div class="sw-row-label">Note colours · “by pitch” (Beginner & Elementary) and “by hand”</div>
    <div class="pitch">
      <div style="background:var(--pc-c);box-shadow:inset 0 -6px 0 var(--pc-c-edge)">C</div>
      <div style="background:var(--pc-d);box-shadow:inset 0 -6px 0 var(--pc-d-edge)">D</div>
      <div style="background:var(--pc-e);box-shadow:inset 0 -6px 0 var(--pc-e-edge);color:var(--ink)">E</div>
      <div style="background:var(--pc-f);box-shadow:inset 0 -6px 0 var(--pc-f-edge)">F</div>
      <div style="background:var(--pc-g);box-shadow:inset 0 -6px 0 var(--pc-g-edge)">G</div>
      <div style="background:var(--pc-a);box-shadow:inset 0 -6px 0 var(--pc-a-edge)">A</div>
      <div style="background:var(--pc-b);box-shadow:inset 0 -6px 0 var(--pc-b-edge)">B</div>
    </div>
    <div class="row" style="margin-top:14px">
      <div class="chip" style="gap:10px"><i style="width:22px;height:22px;border-radius:7px;background:var(--rh);box-shadow:inset 0 -3px 0 var(--rh-edge)"></i>Right hand · violet</div>
      <div class="chip" style="gap:10px"><i style="width:22px;height:22px;border-radius:7px;background:var(--lh);box-shadow:inset 0 -3px 0 var(--lh-edge)"></i>Left hand · teal</div>
      <span class="muted" style="font-size:15px">Sharps and flats take the colour of their letter, drawn narrower on the black-key lane with a ♯/♭ label.</span>
    </div>
  </section>

  <section>
    <h2>Type</h2>
    <p class="lead">Fredoka for anything you read from the music stand (headlines, numbers, buttons). Nunito for sentences and labels. Both OFL-1.1 on npm as <code>@fontsource-variable/fredoka</code> and <code>@fontsource-variable/nunito</code>; clefs use <code>@fontsource/noto-music</code>.</p>
    <div class="type">
      <div class="card">
        <div style="font-family:var(--font-display);font-weight:600;font-size:64px;line-height:1">Aa 92%</div>
        <div class="muted" style="font-weight:800;margin:6px 0 14px">Fredoka · 500 / 600 / 700</div>
        <div class="spec-line"><span class="display" style="font-size:52px;font-weight:700;line-height:1">Level 12</span><small>D1 52/1.05 · 700</small></div>
        <div class="spec-line"><span class="display" style="font-size:36px">Dotted rhythms</span><small>H1 36/1.12 · 600</small></div>
        <div class="spec-line"><span class="display" style="font-size:28px">Song library</span><small>H2 28/1.15 · 600</small></div>
        <div class="spec-line"><span class="display" style="font-size:22px">Ode to Joy</span><small>H3 22/1.2 · 600</small></div>
      </div>
      <div class="card">
        <div style="font-family:var(--font-ui);font-weight:800;font-size:64px;line-height:1">Aa 123</div>
        <div class="muted" style="font-weight:800;margin:6px 0 14px">Nunito · 600 / 700 / 800</div>
        <div class="spec-line"><span style="font-size:21px;font-weight:700">Long, short, long, short. Bounce it!</span><small>Bubble 21/1.35 · 700</small></div>
        <div class="spec-line"><span style="font-size:18px">Play the first note to start.</span><small>Body 18/1.45 · 600</small></div>
        <div class="spec-line"><span style="font-size:15px">Beethoven · 1824</span><small>Small 15/1.4 · 600</small></div>
        <div class="spec-line"><span class="eyebrow" style="color:var(--brand-ink)">Up next · Level 12</span><small>Eyebrow 13 · 800 · +0.1em</small></div>
      </div>
    </div>
  </section>

  <section>
    <h2>Components</h2>
    <div class="comp">
      <div class="card">
        <h3>Buttons (3D, bottom edge presses down 5 px)</h3>
        <div class="row">
          <button class="btn btn-primary btn-lg">Continue</button>
          <button class="btn btn-lg">${icon('retry', 24)} Retry</button>
          <button class="btn btn-primary btn-lg is-pressed">Pressed</button>
        </div>
        <div class="row">
          <button class="btn btn-sun">${icon('sparkle', 22)} Claim 25 XP</button>
          <button class="btn">${icon('upload', 22)} Import MIDI</button>
          <button class="btn" disabled>Continue</button>
          <button class="btn btn-ghost">Not now</button>
        </div>
        <div class="row">
          <button class="icon-btn">${icon('close', 22)}</button>
          <button class="icon-btn">${icon('pause', 22)}</button>
          <button class="icon-btn brand">${icon('play', 22)}</button>
          <span class="chip on">Classical <span class="count">16</span></span>
          <span class="chip">Holiday <span class="count">9</span></span>
        </div>
        <h3 style="margin-top:4px">Timing chips</h3>
        <div class="row">
          <span class="tchip perfect"><span class="dot">${icon('sparkle', 18)}</span>Perfect</span>
          <span class="tchip great"><span class="dot">${icon('check', 18)}</span>Great <small>· 70 ms late</small></span>
          <span class="tchip early"><span class="dot">${icon('back', 16)}</span>Early <small>· 150 ms</small></span>
          <span class="tchip late"><span class="dot" style="transform:scaleX(-1)">${icon('back', 16)}</span>Late <small>· 130 ms</small></span>
          <span class="tchip miss"><span class="dot">${icon('close', 15)}</span>Missed</span>
        </div>
      </div>
      <div class="card">
        <h3>Path nodes</h3>
        <div class="nodes">
          <div class="node done" style="left:0">${icon('check', 34)}</div><label style="left:0">Done</label>
          <div class="ring" style="left:98px;top:-2px;width:112px;height:112px"></div>
          <div class="node current" style="left:112px">12</div><label style="left:112px">Current</label>
          <div class="node locked" style="left:228px">${icon('lock', 28)}</div><label style="left:228px">Locked</label>
          <div class="node locked" style="left:334px">${icon('trophy', 36)}</div><label style="left:334px">Stage test</label>
        </div>
        <h3>Coach bubble</h3>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
          ${pip({ pose: 'hello', size: 84 })}
          <div class="bubble tail-left" style="font-size:19px">${icon('speaker', 22, 'speaker')}Long, short, long, short. Make it <b>bounce</b>!</div>
        </div>
        <h3>Early | late meter</h3>
        <div style="display:flex;align-items:center;gap:12px;font-weight:800;font-size:15px">
          <span style="color:var(--early-ink)">Early</span>${meter({ width: 300, hits: [-60, -20, 10, 25, 5, 40, 18, 30], avg: 18 })}<span style="color:var(--late-ink)">Late</span>
        </div>
      </div>
    </div>
  </section>
  `,
});
