import { page, pip, icon, keyboard, falling, staff, meter, keyGeometry, midi } from '../lib.mjs';

// Level 12 "Dotted rhythms", exercise 2 of 5, both hands, C major, 4/4. "now" is beat 5.6.
const NOW = 5.6;
const rh = [
  { p: 'E4', t: 0, d: 'q.', b: 1.5, grade: 'perfect' }, { p: 'F4', t: 1.5, d: '8', b: 0.5, grade: 'great' }, { p: 'G4', t: 2, d: 'h', b: 2, grade: 'perfect' },
  { p: 'G4', t: 4, d: 'q.', b: 1.5, grade: 'great' }, { p: 'A4', t: 5.5, d: '8', b: 0.5, grade: 'perfect', now: true }, { p: 'G4', t: 6, d: 'q', b: 1 }, { p: 'E4', t: 7, d: 'q', b: 1 },
  { p: 'F4', t: 8, d: 'q.', b: 1.5 }, { p: 'E4', t: 9.5, d: '8', b: 0.5 }, { p: 'D4', t: 10, d: 'h', b: 2 },
  { p: 'E4', t: 12, d: 'q.', b: 1.5 }, { p: 'D4', t: 13.5, d: '8', b: 0.5 }, { p: 'C4', t: 14, d: 'h', b: 2 },
].map((n) => ({ ...n, hand: 'R' }));
const lh = [
  { p: 'C3', t: 0, d: 'w', b: 4, grade: 'great' }, { p: 'E3', t: 4, d: 'h', b: 2, grade: 'early' }, { p: 'G3', t: 6, d: 'h', b: 2 },
  { p: 'F3', t: 8, d: 'h', b: 2 }, { p: 'G3', t: 10, d: 'h', b: 2 }, { p: 'C3', t: 12, d: 'w', b: 4 },
].map((n) => ({ ...n, hand: 'L' }));

const KB = { from: 'C3', to: 'C6', width: 1140 };
const PLAY_X = 470, PPB = 76;
const st = staff({ width: 1140, height: 252, top: 52, sp: 12, playX: PLAY_X, now: NOW, ppb: PPB, notes: [...rh, ...lh], clefW: 150, bars: 4 });
const xOf = st.xOf;
const g = keyGeometry({ ...KB, x: 20 });
const laneX = (name) => g.keys[midi(name)].cx;

export default () => page({
  title: 'Maestro · Play (playful)',
  css: `
  .hud { position: absolute; left: 20px; right: 20px; top: 14px; height: 58px; display: flex; align-items: center; gap: 12px; }
  .hud .title { width: 250px; }
  .hud .title b { display: block; font-family: var(--font-display); font-weight: 600; font-size: 23px; line-height: 1.1; }
  .hud .title small { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; color: var(--ink-2); margin-top: 3px; }
  .segs { display: flex; gap: 3px; }
  .segs i { width: 16px; height: 7px; border-radius: 4px; background: #EADFCC; }
  .segs i.done { background: var(--mint); } .segs i.cur { background: var(--brand); }
  .stat { height: 58px; padding: 0 16px; border-radius: 18px; background: #fff; border: 2px solid var(--line); box-shadow: 0 4px 0 var(--edge); display: flex; align-items: center; gap: 10px; }
  .stat .k { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); line-height: 1; }
  .stat .v { font-family: var(--font-num); font-weight: 900; font-size: 27px; line-height: 1; }
  .stat.combo .v { color: var(--flame-ink); }
  .stat.combo small { font-weight: 800; font-size: 13px; color: var(--flame-ink); line-height: 1.05; }
  .grow { flex: 1; }
  .stepper { display: flex; align-items: center; height: 58px; border-radius: 18px; background: #fff; border: 2px solid var(--line); box-shadow: 0 4px 0 var(--edge); padding: 0 6px; gap: 4px; }
  .stepper button { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: var(--brand-ink); background: var(--brand-soft); }
  .stepper .bpm { min-width: 70px; text-align: center; font-family: var(--font-num); font-weight: 900; font-size: 21px; }
  .stepper .bpm small { display: block; font-family: var(--font-ui); font-size: 11px; font-weight: 800; letter-spacing: .08em; color: var(--ink-3); margin-top: -2px; }
  .seg { display: flex; height: 58px; padding: 5px; border-radius: 18px; background: #F1E6D4; gap: 4px; }
  .seg span { display: grid; place-items: center; padding: 0 16px; border-radius: 13px; font-family: var(--font-display); font-weight: 600; font-size: 19px; color: var(--ink-2); }
  .seg span.on { background: var(--brand); color: #fff; box-shadow: 0 4px 0 var(--brand-edge); }
  .hud .btn { height: 58px; border-radius: 18px; padding: 0 18px; font-size: 19px; }
  .hud .icon-btn { width: 58px; height: 58px; border-radius: 18px; }

  .paper {
    position: absolute; left: 20px; top: 84px; width: 1140px; height: 256px; border-radius: 24px;
    background: var(--paper); border: 2px solid #EADBBE; box-shadow: 0 5px 0 #E3CFAD, var(--shadow-card);
    overflow: visible;
  }
  .paper .staff { position: absolute; left: 0; top: 0; }
  .paper .bar-no { position: absolute; top: 30px; font-weight: 800; font-size: 13px; color: var(--ink-3); }
  .paper .hand-tag { position: absolute; left: -2px; font-weight: 800; font-size: 12px; color: #fff; padding: 2px 7px; border-radius: 0 8px 8px 0; }
  .tchip { position: absolute; transform: translateX(-50%); }
  .tchip::after { content: ""; position: absolute; left: 50%; width: 12px; height: 12px; margin-left: -6px; background: #fff; border: 2.5px solid var(--t); border-top: 0; border-left: 0; }
  .tchip.down::after { bottom: -8.5px; transform: rotate(45deg); border-radius: 0 0 3px 0; }
  .tchip.up::after { top: -8.5px; transform: rotate(-135deg); border-radius: 0 0 3px 0; }
  .tchip.right { transform: translateX(calc(-100% + 26px)); }
  .tchip.right::after { left: auto; right: 20px; margin: 0; }
  .tchip.older { opacity: .82; }
  .tchip.pop { z-index: 5; }

  .meter-pill {
    position: absolute; right: 36px; top: 92px; z-index: 6;
    display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 14px; border-radius: 999px;
    background: #fff; border: 2px solid #EADBBE; box-shadow: 0 3px 0 #E3CFAD;
    font-weight: 800; font-size: 15px;
  }
  .meter-pill .e { color: var(--early-ink); display: flex; align-items: center; gap: 4px; }
  .meter-pill .l { color: var(--late-ink); display: flex; align-items: center; gap: 4px; }
  .meter-pill .avg { font-family: var(--font-display); font-weight: 600; font-size: 16px; color: var(--ink-2); padding-left: 12px; border-left: 2px solid var(--line); }

  .lanes { position: absolute; left: 20px; top: 352px; width: 1140px; height: 288px; border-radius: 22px 22px 0 0; background: var(--bg-sunk); overflow: hidden; }
  .hitline { position: absolute; left: 20px; width: 1140px; top: 636px; height: 6px; border-radius: 3px; background: linear-gradient(90deg, rgba(111,75,242,.25), rgba(111,75,242,.55), rgba(111,75,242,.25)); z-index: 3; }
  .burst { position: absolute; z-index: 4; pointer-events: none; }
  .kb { position: absolute; left: 20px; top: 640px; }
  .coach { position: absolute; z-index: 5; }
  .coach .bubble { font-size: 19px; padding: 12px 16px; line-height: 1.3; }
  .score-float { position: absolute; z-index: 6; font-family: var(--font-display); font-weight: 700; font-size: 24px; color: var(--sun-ink); text-shadow: 0 2px 0 #fff, 0 -2px 0 #fff, 2px 0 0 #fff, -2px 0 0 #fff; }
  .mic-pill { position: absolute; left: 34px; top: 362px; z-index: 6; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px 0 10px; border-radius: 999px; background: #fff; border: 2px solid var(--line); font-weight: 800; font-size: 14px; color: var(--mint-ink); }
  .mic { display: inline-flex; align-items: center; gap: 3px; color: var(--mint-ink); }
  .mic i { display: inline-block; width: 3px; border-radius: 2px; background: var(--mint); }
  `,
  body: `
  <header class="hud">
    <button class="icon-btn" aria-label="Exit">${icon('close', 22)}</button>
    <div class="title">
      <b>Dotted rhythms</b>
      <small>Level 12 · 2 of 5 <span class="mic" title="Microphone is listening">${icon('mic', 16)}<i style="height:6px"></i><i style="height:12px"></i><i style="height:9px"></i><i style="height:4px"></i></span></small>
    </div>
    <div class="stat"><div><div class="k">Score</div><div class="v">2,450</div></div></div>
    <div class="stat combo">${icon('flame', 30)}<div class="v">12</div><small>in a<br>row</small></div>
    <div class="grow"></div>
    <div class="stepper" aria-label="Tempo">
      <button aria-label="Slower">${icon('minus', 18)}</button>
      <div class="bpm">♩ 72<small>TEMPO</small></div>
      <button aria-label="Faster">${icon('plus', 18)}</button>
    </div>
    <div class="seg" role="radiogroup" aria-label="Mode"><span class="on">Tempo</span><span>Wait</span></div>
    <button class="btn">${icon('speaker', 22)} Listen</button>
    <button class="icon-btn" aria-label="Pause">${icon('pause', 22)}</button>
  </header>

  <section class="paper" aria-label="Sheet music">
    ${st.svg}
    <span class="hand-tag" style="top:${st.T + 12}px;background:var(--rh)">RH</span>
    <span class="hand-tag" style="top:${st.Bt + 12}px;background:var(--lh);color:var(--ink)">LH</span>
    <!-- timing chips: newest centred on its note, older ones drift left with their notes -->
    <span class="tchip perfect down pop" style="left:${xOf(5.5)}px;top:6px"><span class="dot">${icon('sparkle', 17)}</span>Perfect</span>
    <span class="tchip great down right older" style="left:${xOf(4)}px;top:6px"><span class="dot">${icon('check', 17)}</span>Great <small>· 70 ms late</small></span>
    <span class="tchip early up right older" style="left:${xOf(4)}px;top:${st.Bt + 48 + 12}px"><span class="dot">${icon('back', 15)}</span>Early <small>· 150 ms</small></span>
  </section>

  <div class="lanes">
    ${falling({ ...KB, height: 288, now: NOW, ppb: 80, notes: [...rh, ...lh].map((n) => ({ p: n.p, t: n.t, d: n.b, hand: n.hand })), active: ['A4', 'E3'] })}
  </div>

  <div class="meter-pill" aria-label="Timing: early or late">
    <span class="e">${icon('back', 16)} Early</span>
    ${meter({ width: 250, hits: [-150, -30, 20, 70, 5, -10, 25, 12], avg: 14 })}
    <span class="l">Late <span style="display:inline-block;transform:scaleX(-1)">${icon('back', 16)}</span></span>
    <span class="avg">avg +14 ms</span>
  </div>

  <div class="hitline"></div>
  <svg class="burst" style="left:${laneX('A4') - 70}px;top:${566}px" width="140" height="120" viewBox="0 0 140 120" aria-hidden="true">
    <defs><radialGradient id="bg1"><stop offset="0" stop-color="#FFE7A0" stop-opacity=".95"/><stop offset=".45" stop-color="#FFC23D" stop-opacity=".35"/><stop offset="1" stop-color="#FFC23D" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="70" cy="74" rx="66" ry="44" fill="url(#bg1)"/>
    <g fill="#FFC23D"><path d="M30 30 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3Z"/><path d="M108 22 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5Z"/><circle cx="118" cy="58" r="4"/><circle cx="22" cy="64" r="3.5"/></g>
    <g fill="#fff"><path d="M88 8 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z"/><circle cx="50" cy="16" r="3"/></g>
  </svg>
  <div class="score-float" style="left:${laneX('A4') + 26}px;top:520px">+100</div>

  <div class="coach" style="left:846px;top:474px">
    <div class="bubble tail-bottom" style="width:236px;margin-left:-40px">${icon('speaker', 19, 'speaker')}Long, short! Keep that <b>bounce</b>.</div>
  </div>
  <div class="coach" style="left:960px;top:540px">${pip({ pose: 'conduct', size: 104 })}</div>

  <div class="kb">${keyboard({ ...KB, height: 166, pressed: { A4: 'hit', E3: 'held' }, hintLetters: ['G4', 'G3'] })}</div>
  `,
});
